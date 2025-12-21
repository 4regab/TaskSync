import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';

export interface Input {
    question: string;
}

export interface AskUserToolResult {
    response: string;
    attachments: string[];
}

/**
 * Reads a file as Uint8Array for efficient binary handling
 */
async function readFileAsBuffer(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
}

/**
 * Gets the MIME type for an image file based on its extension
 */
function getImageMimeType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
    };
    return mimeTypes[extension] || 'application/octet-stream';
}

/**
 * Core logic to ask user, reusable by MCP server
 * Queue handling and history tracking is done in waitForUserResponse()
 */
export async function askUser(
    params: Input,
    provider: TaskSyncWebviewProvider,
    _token: vscode.CancellationToken
): Promise<AskUserToolResult> {
    try {
        console.log('[TaskSync] askUser called with question:', params.question.substring(0, 100));
        const result = await provider.waitForUserResponse(params.question);
        console.log('[TaskSync] askUser received response:', result.value.substring(0, 50));
        return {
            response: result.value,
            attachments: result.attachments.map(att => att.uri)
        };
    } catch (error) {
        // Log the error instead of silently swallowing it
        console.error('[TaskSync] askUser error:', error instanceof Error ? error.message : error);
        // Show error to user so they know something went wrong
        vscode.window.showErrorMessage(`TaskSync: ${error instanceof Error ? error.message : 'Failed to show question'}`);
        return {
            response: '',
            attachments: []
        };
    }
}

export function registerTools(context: vscode.ExtensionContext, provider: TaskSyncWebviewProvider) {

    // Register ask_user tool (VS Code native LM tool)
    const askUserTool = vscode.lm.registerTool('ask_user', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<Input>, token: vscode.CancellationToken) {
            const params = options.input;

            try {
                const result = await askUser(params, provider, token);

                // Build result parts - text first, then images
                const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        response: result.response,
                        queued: provider.isQueueEnabled(),
                        attachmentCount: result.attachments.length
                    }))
                ];

                // Add image attachments as LanguageModelDataPart for vision models
                if (result.attachments && result.attachments.length > 0) {
                    const imagePromises = result.attachments.map(async (uri) => {
                        try {
                            const fileUri = vscode.Uri.parse(uri);
                            const filePath = fileUri.fsPath;
                            const mimeType = getImageMimeType(filePath);

                            // Only process image files (skip non-image attachments)
                            if (mimeType !== 'application/octet-stream') {
                                const data = await readFileAsBuffer(filePath);
                                return vscode.LanguageModelDataPart.image(data, mimeType);
                            }
                            return null;
                        } catch (error) {
                            console.error('Failed to read image attachment:', error);
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

                return new vscode.LanguageModelToolResult(resultParts);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart("Error: " + message)
                ]);
            }
        }
    });

    context.subscriptions.push(askUserTool);
}
