import * as fs from "fs";
import * as vscode from "vscode";
import { CONFIG_SECTION } from "./constants/remoteConstants";
import { getImageMimeType } from "./utils/imageUtils";
import { TaskSyncWebviewProvider } from "./webview/webviewProvider";
import { debugLog } from "./webview/webviewUtils";

export interface Input {
	question: string;
}

export interface AskUserToolResult {
	response: string;
	attachments: string[];
	queue: boolean;
}

/**
 * Reads a file as Uint8Array for efficient binary handling
 */
async function readFileAsBuffer(filePath: string): Promise<Uint8Array> {
	const buffer = await fs.promises.readFile(filePath);
	return new Uint8Array(buffer);
}

/**
 * Creates a cancellation promise with proper cleanup to prevent memory leaks.
 * Returns both the promise and a dispose function to clean up the event listener.
 */
function createCancellationPromise(token: vscode.CancellationToken): {
	promise: Promise<never>;
	dispose: () => void;
} {
	let disposable: vscode.Disposable | undefined;

	const promise = new Promise<never>((_, reject) => {
		if (token.isCancellationRequested) {
			reject(new vscode.CancellationError());
			return;
		}
		disposable = token.onCancellationRequested(() => {
			reject(new vscode.CancellationError());
		});
	});

	return {
		promise,
		dispose: () => disposable?.dispose(),
	};
}

/**
 * Core logic to ask user, reusable by extension tool handlers.
 * Queue handling and history tracking is done in waitForUserResponse()
 */
export async function askUser(
	params: Input,
	provider: TaskSyncWebviewProvider,
	token: vscode.CancellationToken,
): Promise<AskUserToolResult> {
	debugLog(
		"[TaskSync] askUser invoked — question:",
		params.question.slice(0, 80),
	);
	// Check if already cancelled before starting
	if (token.isCancellationRequested) {
		debugLog("[TaskSync] askUser — already cancelled before starting");
		throw new vscode.CancellationError();
	}

	// Create cancellation promise with cleanup capability
	const cancellation = createCancellationPromise(token);

	try {
		// Race the user response against cancellation
		const result = await Promise.race([
			provider.waitForUserResponse(params.question),
			cancellation.promise,
		]);

		// Handle case where request was superseded by another call
		if (result.cancelled) {
			debugLog(
				"[TaskSync] askUser — superseded/cancelled, response:",
				result.value.slice(0, 80),
			);
			return {
				response: result.value,
				attachments: [],
				queue: result.queue,
			};
		}
		debugLog(
			"[TaskSync] askUser — user responded:",
			result.value.slice(0, 80),
			"attachments:",
			result.attachments?.length ?? 0,
		);

		let responseText = result.value;
		const validAttachments: string[] = [];

		// Process attachments to resolve context content
		if (result.attachments && result.attachments.length > 0) {
			for (const att of result.attachments) {
				if (att.uri.startsWith("context://")) {
					// Start of context content
					responseText += `\n\n[Attached Context: ${att.name}]\n`;

					const content = await provider.resolveContextContent(att.uri);
					if (content) {
						responseText += content;
					} else {
						responseText += "(Context content not available)";
					}

					// End of context content
					responseText += "\n[End of Context]\n";
				} else {
					// Regular file attachment
					validAttachments.push(att.uri);
				}
			}
		}

		debugLog(
			"[TaskSync] askUser — returning result to AI (response length:",
			responseText.length,
			", attachments:",
			validAttachments.length,
			") — AI should call askUser again next",
		);
		return {
			response: responseText,
			attachments: validAttachments,
			queue: result.queue,
		};
	} catch (error) {
		// Re-throw cancellation errors without logging (they're expected)
		if (error instanceof vscode.CancellationError) {
			throw error;
		}
		// Log other errors
		console.error(
			"[TaskSync] askUser error:",
			error instanceof Error ? error.message : error,
		);
		// Show error to user so they know something went wrong
		vscode.window.showErrorMessage(
			`TaskSync: ${error instanceof Error ? error.message : "Failed to show question"}`,
		);
		return {
			response: "",
			attachments: [],
			queue: false,
		};
	} finally {
		// Always clean up the cancellation listener to prevent memory leaks
		cancellation.dispose();
	}
}

export function registerTools(
	context: vscode.ExtensionContext,
	provider: TaskSyncWebviewProvider,
): void {
	// Register ask_user tool (VS Code native LM tool)
	const askUserTool = vscode.lm.registerTool("ask_user", {
		prepareInvocation(
			options: vscode.LanguageModelToolInvocationPrepareOptions<Input>,
		) {
			const rawQuestion =
				typeof options?.input?.question === "string"
					? options.input.question
					: "";
			const questionPreview = rawQuestion.trim().replace(/\s+/g, " ");

			const MAX_PREVIEW_LEN = 40;
			const truncated =
				questionPreview.length > MAX_PREVIEW_LEN
					? questionPreview.slice(0, MAX_PREVIEW_LEN - 3) + "..."
					: questionPreview;

			return {
				invocationMessage: truncated ? `ask_user: ${truncated}` : "ask_user",
			};
		},
		async invoke(
			options: vscode.LanguageModelToolInvocationOptions<Input>,
			token: vscode.CancellationToken,
		) {
			const params = options.input;
			const safeQuestion =
				typeof params?.question === "string" ? params.question : "";

			debugLog(
				"[TaskSync] LM tool invoke — question:",
				safeQuestion.slice(0, 60),
			);
			try {
				const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
				const includeVerbosePayload = config.get<boolean>(
					"askUserVerbosePayload",
					false,
				);

				const result = await askUser({ question: safeQuestion }, provider, token);

				const resultPayload: {
					response: string;
					queued?: boolean;
					attachmentCount?: number;
					instruction?: string;
				} = {
					response: result.response,
				};

				if (result.queue) {
					resultPayload.queued = true;
				}

				if (result.attachments.length > 0) {
					resultPayload.attachmentCount = result.attachments.length;
				}

				if (includeVerbosePayload) {
					resultPayload.instruction =
						"Do the task, then call the askUser tool; keep this workflow.";
				}

				// Build result parts - text first, then images
				const resultParts: (
					| vscode.LanguageModelTextPart
					| vscode.LanguageModelDataPart
				)[] = [
					new vscode.LanguageModelTextPart(JSON.stringify(resultPayload)),
				];

				// Add image attachments as LanguageModelDataPart for vision models
				if (result.attachments && result.attachments.length > 0) {
					const imagePromises = result.attachments.map(async (uri) => {
						try {
							const fileUri = vscode.Uri.parse(uri);
							const filePath = fileUri.fsPath;

							// Check if file exists
							try {
								await fs.promises.access(filePath);
							} catch {
								console.error(
									"[TaskSync] Attachment file does not exist:",
									filePath,
								);
								return null;
							}

							const mimeType = getImageMimeType(filePath);

							// Only process image files (skip non-image attachments)
							if (mimeType !== "application/octet-stream") {
								const data = await readFileAsBuffer(filePath);
								const dataPart = vscode.LanguageModelDataPart.image(
									data,
									mimeType,
								);
								return dataPart;
							}
							return null;
						} catch (error) {
							console.error(
								"[TaskSync] Failed to read image attachment:",
								error,
							);
							return null;
						}
					});

					const imageParts = await Promise.all(imagePromises);
					for (const part of imageParts) {
						if (part !== null) {
							resultParts.push(part);
						}
					}
				}

				debugLog(
					"[TaskSync] LM tool — returning LanguageModelToolResult to AI (parts:",
					resultParts.length,
					")",
				);
				return new vscode.LanguageModelToolResult(resultParts);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : "Unknown error";
				console.error("[TaskSync] LM tool invoke error:", message);
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart("Error: " + message),
				]);
			}
		},
	});

	context.subscriptions.push(askUserTool);
}
