import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
	FILE_EXCLUSION_PATTERNS,
	FILE_SEARCH_EXCLUSION_PATTERNS,
	formatExcludePattern,
} from "../constants/fileExclusions";
import { MAX_IMAGE_PASTE_BYTES } from "../constants/remoteConstants";
import { ContextReferenceType } from "../context";
import type {
	AttachmentInfo,
	FileSearchResult,
	P,
	ToWebviewMessage,
} from "./webviewTypes";
import { generateId, getFileIcon } from "./webviewUtils";

export async function handleAddAttachment(p: P): Promise<void> {
	try {
		const excludePattern = formatExcludePattern(FILE_EXCLUSION_PATTERNS);
		const files = await vscode.workspace.findFiles(
			"**/*",
			excludePattern,
			p._MAX_FOLDER_SEARCH_RESULTS,
		);

		if (files.length === 0) {
			vscode.window.showInformationMessage("No files found in workspace");
			return;
		}

		const items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = files
			.map((uri) => {
				const relativePath = vscode.workspace.asRelativePath(uri);
				const fileName = path.basename(uri.fsPath);
				return {
					label: `$(file) ${fileName}`,
					description: relativePath,
					uri: uri,
				};
			})
			.sort((a, b) => a.label.localeCompare(b.label));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: "Select files to attach",
			matchOnDescription: true,
		});

		if (selected && selected.length > 0) {
			for (const item of selected) {
				const labelMatch = item.label.match(/\$\([^)]+\)\s*(.+)/);
				const cleanName = labelMatch ? labelMatch[1] : item.label;
				const attachment: AttachmentInfo = {
					id: generateId("att"),
					name: cleanName,
					uri: item.uri.toString(),
				};
				p._attachments.push(attachment);
			}
			updateAttachmentsUI(p);
		}
	} catch (e) {
		console.error("[TaskSync] Failed to add attachment:", e);
		vscode.window.showErrorMessage("Failed to add attachment");
	}
}

/**
 * Handle removing attachment.
 */
export function handleRemoveAttachment(p: P, attachmentId: string): void {
	p._attachments = p._attachments.filter(
		(a: AttachmentInfo) => a.id !== attachmentId,
	);
	updateAttachmentsUI(p);
}

/**
 * Search registered LM tools matching a query.
 * Shared by local handleSearchFiles and remote searchFilesForRemote.
 */
export function searchToolsForAutocomplete(query: string): FileSearchResult[] {
	const queryLower = query.toLowerCase();
	return vscode.lm.tools
		.filter((t) => t.name.toLowerCase().includes(queryLower))
		.slice(0, 20)
		.map((t) => ({
			name: t.name,
			path: t.description,
			uri: `tool://${t.name}`,
			icon: "tools",
			isTool: true,
		}));
}

/**
 * Handle file search for autocomplete (also includes #terminal, #problems context and tools).
 */
export async function handleSearchFiles(p: P, query: string): Promise<void> {
	try {
		const queryLower = query.toLowerCase();
		const cacheKey = queryLower || "__all__";
		// Context suggestions (#terminal, #problems)
		const contextResults: FileSearchResult[] = [];

		if (!queryLower || "terminal".includes(queryLower)) {
			const commands =
				p._contextManager.terminal.formatCommandListForAutocomplete();
			const description =
				commands.length > 0
					? `${commands.length} recent commands`
					: "No commands yet";
			contextResults.push({
				name: "terminal",
				path: description,
				uri: "context://terminal",
				icon: "terminal",
				isFolder: false,
				isContext: true,
			});
		}

		if (!queryLower || "problems".includes(queryLower)) {
			const problemsInfo = p._contextManager.problems.formatForAutocomplete();
			contextResults.push({
				name: "problems",
				path: problemsInfo.description,
				uri: "context://problems",
				icon: "error",
				isFolder: false,
				isContext: true,
			});
		}

		const cached = p._fileSearchCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < p._FILE_CACHE_TTL_MS) {
			const cachedToolResults = searchToolsForAutocomplete(query);
			p._view?.webview.postMessage({
				type: "fileSearchResults",
				files: [...contextResults, ...cachedToolResults, ...cached.results],
			} satisfies ToWebviewMessage);
			return;
		}

		const excludePattern = formatExcludePattern(FILE_SEARCH_EXCLUSION_PATTERNS);
		const allFiles = await vscode.workspace.findFiles(
			"**/*",
			excludePattern,
			p._MAX_FILE_SEARCH_RESULTS,
		);

		const seenFolders = new Set<string>();
		const folderResults: FileSearchResult[] = [];

		for (const uri of allFiles) {
			const relativePath = vscode.workspace.asRelativePath(uri);
			const dirPath = path.dirname(relativePath);

			if (dirPath && dirPath !== "." && !seenFolders.has(dirPath)) {
				seenFolders.add(dirPath);
				const folderName = path.basename(dirPath);

				if (
					!queryLower ||
					folderName.toLowerCase().includes(queryLower) ||
					dirPath.toLowerCase().includes(queryLower)
				) {
					const workspaceFolder =
						vscode.workspace.getWorkspaceFolder(uri)?.uri ??
						vscode.workspace.workspaceFolders?.[0]?.uri;
					if (!workspaceFolder) continue;
					folderResults.push({
						name: folderName,
						path: dirPath,
						uri: vscode.Uri.joinPath(workspaceFolder, dirPath).toString(),
						icon: "folder",
						isFolder: true,
					});
				}
			}
		}

		const fileResults: FileSearchResult[] = allFiles
			.map((uri) => {
				const relativePath = vscode.workspace.asRelativePath(uri);
				const fileName = path.basename(uri.fsPath);
				return {
					name: fileName,
					path: relativePath,
					uri: uri.toString(),
					icon: getFileIcon(fileName),
					isFolder: false,
				};
			})
			.filter(
				(file) =>
					!queryLower ||
					file.name.toLowerCase().includes(queryLower) ||
					file.path.toLowerCase().includes(queryLower),
			);

		const fileAndFolderResults = [...folderResults, ...fileResults]
			.sort((a, b) => {
				if (a.isFolder && !b.isFolder) return -1;
				if (!a.isFolder && b.isFolder) return 1;
				const aExact = a.name.toLowerCase().startsWith(queryLower);
				const bExact = b.name.toLowerCase().startsWith(queryLower);
				if (aExact && !bExact) return -1;
				if (!aExact && bExact) return 1;
				return a.name.localeCompare(b.name);
			})
			.slice(0, 48);

		// Tool results (LM tools matching query)
		const toolResults = searchToolsForAutocomplete(query);

		const allResults = [
			...contextResults,
			...toolResults,
			...fileAndFolderResults,
		];

		p._fileSearchCache.set(cacheKey, {
			results: fileAndFolderResults,
			timestamp: Date.now(),
		});
		if (p._fileSearchCache.size > 20) {
			const firstKey = p._fileSearchCache.keys().next().value;
			if (firstKey) p._fileSearchCache.delete(firstKey);
		}

		p._view?.webview.postMessage({
			type: "fileSearchResults",
			files: allResults,
		} satisfies ToWebviewMessage);
	} catch (error) {
		console.error("[TaskSync] File search error:", error);
		p._view?.webview.postMessage({
			type: "fileSearchResults",
			files: [],
		} satisfies ToWebviewMessage);
	}
}

/**
 * Handle saving pasted/dropped image.
 */
export async function handleSaveImage(
	p: P,
	dataUrl: string,
	mimeType: string,
): Promise<void> {
	try {
		const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
		if (!base64Match) {
			vscode.window.showWarningMessage("Invalid image format");
			return;
		}

		const base64Data = base64Match[1];
		const estimatedSize = Math.ceil(base64Data.length * 0.75);
		if (estimatedSize > MAX_IMAGE_PASTE_BYTES) {
			const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
			vscode.window.showWarningMessage(
				`Image too large (~${sizeMB}MB). Max ${MAX_IMAGE_PASTE_BYTES / (1024 * 1024)}MB.`,
			);
			return;
		}

		const buffer = Buffer.from(base64Data, "base64");
		if (buffer.length > MAX_IMAGE_PASTE_BYTES) {
			const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
			vscode.window.showWarningMessage(
				`Image too large (${sizeMB}MB). Max ${MAX_IMAGE_PASTE_BYTES / (1024 * 1024)}MB.`,
			);
			return;
		}

		const validMimeTypes = [
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/webp",
			"image/bmp",
		];
		if (!validMimeTypes.includes(mimeType)) {
			vscode.window.showWarningMessage(`Unsupported image type: ${mimeType}`);
			return;
		}

		const extMap: Record<string, string> = {
			"image/png": ".png",
			"image/jpeg": ".jpg",
			"image/gif": ".gif",
			"image/webp": ".webp",
			"image/bmp": ".bmp",
		};
		const ext = extMap[mimeType] || ".png";

		const storageUri = p._context.storageUri || p._context.globalStorageUri;
		if (!storageUri) {
			throw new Error("VS Code extension storage URI not available.");
		}

		const tempDir = path.join(storageUri.fsPath, "temp-images");
		if (!fs.existsSync(tempDir)) {
			await fs.promises.mkdir(tempDir, { recursive: true });
		}

		const existingImages = p._attachments.filter(
			(a: AttachmentInfo) => a.isTemporary,
		).length;
		let fileName =
			existingImages === 0
				? `image-pasted${ext}`
				: `image-pasted-${existingImages}${ext}`;
		let filePath = path.join(tempDir, fileName);

		let counter = existingImages;
		while (fs.existsSync(filePath)) {
			counter++;
			fileName = `image-pasted-${counter}${ext}`;
			filePath = path.join(tempDir, fileName);
		}

		await fs.promises.writeFile(filePath, buffer);

		const attachment: AttachmentInfo = {
			id: generateId("img"),
			name: fileName,
			uri: vscode.Uri.file(filePath).toString(),
			isTemporary: true,
		};

		p._attachments.push(attachment);
		p._view?.webview.postMessage({
			type: "imageSaved",
			attachment,
		} satisfies ToWebviewMessage);
		updateAttachmentsUI(p);
	} catch (error) {
		console.error("[TaskSync] Failed to save image:", error);
		vscode.window.showErrorMessage("Failed to save pasted image");
	}
}

/**
 * Handle adding file reference from autocomplete.
 */
export function handleAddFileReference(p: P, file: FileSearchResult): void {
	const attachment: AttachmentInfo = {
		id: generateId(file.isFolder ? "folder" : "file"),
		name: file.name,
		uri: file.uri,
		isFolder: file.isFolder,
		isTextReference: true,
	};
	p._attachments.push(attachment);
	updateAttachmentsUI(p);
}

/**
 * Update attachments UI.
 */
export function updateAttachmentsUI(p: P): void {
	p._view?.webview.postMessage({
		type: "updateAttachments",
		attachments: p._attachments,
	} satisfies ToWebviewMessage);
}

/**
 * Open an external URL from webview using a strict protocol allowlist.
 */
export function handleOpenExternalLink(url: string): void {
	if (!url) return;
	try {
		const parsed = vscode.Uri.parse(url);
		const allowedSchemes = ["http", "https", "mailto"];
		if (!allowedSchemes.includes(parsed.scheme)) {
			vscode.window.showWarningMessage(
				`Unsupported link protocol: ${parsed.scheme}`,
			);
			return;
		}
		void vscode.env.openExternal(parsed);
	} catch (error) {
		console.error("[TaskSync] Failed to open external link:", error);
		vscode.window.showWarningMessage("Unable to open external link");
	}
}

/**
 * Copy plain text to the system clipboard.
 */
export async function handleCopyToClipboard(text: string): Promise<void> {
	if (typeof text !== "string" || text.length === 0) return;
	try {
		await vscode.env.clipboard.writeText(text);
	} catch (error) {
		console.error("[TaskSync] Failed to copy text to clipboard:", error);
		vscode.window.showWarningMessage("Unable to copy content to clipboard");
	}
}

/**
 * Open a file link from webview and reveal requested line or line range.
 */
export async function handleOpenFileLink(target: string): Promise<void> {
	if (!target) return;

	const { parseFileLinkTarget, resolveFileLinkUri } = await import(
		"./webviewUtils"
	);
	const parsedTarget = parseFileLinkTarget(target);
	if (!parsedTarget.filePath) {
		vscode.window.showWarningMessage("File link does not contain a valid path");
		return;
	}

	const fileUri = resolveFileLinkUri(parsedTarget.filePath);
	if (!fileUri) {
		vscode.window.showWarningMessage(
			`File not found: ${parsedTarget.filePath}`,
		);
		return;
	}

	try {
		const document = await vscode.workspace.openTextDocument(fileUri);
		const editor = await vscode.window.showTextDocument(document, {
			preview: false,
		});

		if (parsedTarget.startLine !== null) {
			const maxLine = Math.max(document.lineCount - 1, 0);
			const startLine = Math.min(
				Math.max(parsedTarget.startLine - 1, 0),
				maxLine,
			);
			const requestedEnd = parsedTarget.endLine ?? parsedTarget.startLine;
			const endLine = Math.min(Math.max(requestedEnd - 1, startLine), maxLine);
			const endCharacter = document.lineAt(endLine).range.end.character;
			const range = new vscode.Range(startLine, 0, endLine, endCharacter);
			editor.selection = new vscode.Selection(
				startLine,
				0,
				endLine,
				endCharacter,
			);
			editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
		}
	} catch (error) {
		console.error("[TaskSync] Failed to open file link:", error);
		vscode.window.showWarningMessage(
			`Unable to open file: ${parsedTarget.filePath}`,
		);
	}
}

/**
 * Handle searching context references.
 */
export async function handleSearchContext(p: P, query: string): Promise<void> {
	try {
		const suggestions = await p._contextManager.getContextSuggestions(query);
		p._view?.webview.postMessage({
			type: "contextSearchResults",
			suggestions: suggestions.map(
				(s: {
					type: string;
					label: string;
					description: string;
					detail?: string;
				}) => ({
					type: s.type,
					label: s.label,
					description: s.description,
					detail: s.detail ?? "",
				}),
			),
		} satisfies ToWebviewMessage);
	} catch (error) {
		console.error("[TaskSync] Error searching context:", error);
		p._view?.webview.postMessage({
			type: "contextSearchResults",
			suggestions: [],
		} satisfies ToWebviewMessage);
	}
}

/**
 * Handle selecting a context reference to add as attachment.
 */
export async function handleSelectContextReference(
	p: P,
	contextType: string,
	options?: Record<string, unknown>,
): Promise<void> {
	try {
		const reference = await p._contextManager.getContextContent(
			contextType as ContextReferenceType,
			options,
		);

		if (reference) {
			const contextAttachment: AttachmentInfo = {
				id: reference.id,
				name: reference.label,
				uri: `context://${reference.type}/${reference.id}`,
				isTextReference: true,
			};
			p._attachments.push(contextAttachment);
			updateAttachmentsUI(p);

			p._view?.webview.postMessage({
				type: "contextReferenceAdded",
				reference: {
					id: reference.id,
					type: reference.type,
					label: reference.label,
					content: reference.content,
				},
			} satisfies ToWebviewMessage);
		} else {
			const emptyId = `ctx_empty_${Date.now()}`;
			const friendlyType = contextType.replace(":", " ");
			const contextAttachment: AttachmentInfo = {
				id: emptyId,
				name: `#${friendlyType} (no content)`,
				uri: `context://${contextType}/${emptyId}`,
				isTextReference: true,
			};
			p._attachments.push(contextAttachment);
			updateAttachmentsUI(p);
			vscode.window.showInformationMessage(
				`No ${contextType} content available yet`,
			);
		}
	} catch (error) {
		console.error("[TaskSync] Error selecting context reference:", error);
		vscode.window.showErrorMessage(`Failed to get ${contextType} content`);
	}
}

/**
 * Clean up temporary image files from disk by URI list.
 */
export function cleanupTempImagesByUri(uris: string[]): void {
	for (const uri of uris) {
		try {
			const filePath = vscode.Uri.parse(uri).fsPath;
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} catch (error) {
			console.error("[TaskSync] Failed to cleanup temp image:", error);
		}
	}
}

/**
 * Clean up temporary images from tool call entries.
 */
export function cleanupTempImagesFromEntries(
	entries: { attachments?: AttachmentInfo[] }[],
): void {
	const tempUris: string[] = [];
	for (const entry of entries) {
		if (entry.attachments) {
			for (const att of entry.attachments) {
				if (att.isTemporary && att.uri) {
					tempUris.push(att.uri);
				}
			}
		}
	}
	if (tempUris.length > 0) {
		cleanupTempImagesByUri(tempUris);
	}
}
