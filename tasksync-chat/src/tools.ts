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
 * Validates that image file content matches its claimed MIME type using magic numbers
 */
function validateImageMagicNumber(buffer: Uint8Array, mimeType: string): boolean {
    if (buffer.length < 8) return false;

    const signatures: Record<string, number[][]> = {
        'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
        'image/jpeg': [[0xFF, 0xD8, 0xFF]],
        'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
        'image/webp': [[0x52, 0x49, 0x46, 0x46]],
        'image/bmp': [[0x42, 0x4D]],
        'image/x-icon': [[0x00, 0x00, 0x01, 0x00], [0x00, 0x00, 0x02, 0x00]],
        'image/tiff': [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]],
    };

    if (mimeType === 'image/svg+xml') {
        const text = new TextDecoder().decode(buffer.slice(0, 500));
        return text.includes('<svg') || text.includes('<?xml');
    }

    const expectedSignatures = signatures[mimeType];
    if (!expectedSignatures) {
        return true; // Unknown MIME type - allow
    }

    for (const signature of expectedSignatures) {
        let matches = true;
        for (let i = 0; i < signature.length; i++) {
            if (buffer[i] !== signature[i]) {
                matches = false;
                break;
            }
        }
        if (matches) return true;
    }

    return false;
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
        const result = await provider.waitForUserResponse(params.question);
        return {
            response: result.value,
            attachments: result.attachments.map(att => att.uri)
        };
    } catch {
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

                            // Only process image files
                            if (mimeType !== 'application/octet-stream') {
                                const data = await readFileAsBuffer(filePath);

                                // Validate file content matches MIME type
                                if (!validateImageMagicNumber(data, mimeType)) {
                                    console.warn(`Image file ${filePath} does not match expected format for ${mimeType}`);
                                    return null;
                                }

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
