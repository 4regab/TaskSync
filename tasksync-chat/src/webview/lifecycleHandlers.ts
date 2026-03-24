/**
 * Lifecycle handlers extracted from webviewProvider.ts.
 * Contains HTML generation, dispose, resolveWebviewView setup, and startNewSession.
 */
import * as fs from "fs";
import * as vscode from "vscode";

import * as fileH from "./fileHandlers";
import type { FromWebviewMessage, P, ToWebviewMessage } from "./webviewTypes";
import { debugLog, getNonce } from "./webviewUtils";

/** Cached HTML body template to avoid repeated synchronous I/O. */
let cachedBodyTemplate: string | undefined;

/**
 * Preload the shared HTML body template asynchronously during activation.
 * Call this early to avoid a synchronous `readFileSync` on first webview resolve.
 */
export async function preloadBodyTemplate(
	extensionUri: vscode.Uri,
): Promise<void> {
	if (cachedBodyTemplate) return;
	const templatePath = vscode.Uri.joinPath(
		extensionUri,
		"media",
		"webview-body.html",
	).fsPath;
	try {
		cachedBodyTemplate = await fs.promises.readFile(templatePath, "utf8");
	} catch (err) {
		console.error("Failed to preload webview body template:", err);
		cachedBodyTemplate = undefined;
	}
}

/**
 * Generate HTML content for the webview panel.
 */
export function getHtmlContent(
	extensionUri: vscode.Uri,
	webview: vscode.Webview,
): string {
	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "main.css"),
	);
	const markdownLinksScriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "markdownLinks.js"),
	);
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "webview.js"),
	);
	const mermaidScriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "mermaid.min.js"),
	);
	const codiconsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(
			extensionUri,
			"node_modules",
			"@vscode",
			"codicons",
			"dist",
			"codicon.css",
		),
	);
	const logoUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "TS-logo.svg"),
	);
	const notificationSoundUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "media", "notification.wav"),
	);
	const nonce = getNonce();

	// Read shared HTML body template (SSOT) — preloaded at activation, sync fallback for safety
	const templatePath = vscode.Uri.joinPath(
		extensionUri,
		"media",
		"webview-body.html",
	).fsPath;
	if (!cachedBodyTemplate) {
		try {
			cachedBodyTemplate = fs.readFileSync(templatePath, "utf8"); // sync-io-allowed: sync fallback when async preload misses
		} catch (err) {
			console.error(
				"Failed to load webview body template (sync fallback):",
				err,
			);
		}
	}
	let bodyHtml =
		cachedBodyTemplate ??
		`<main class="tsc-root"><h1>TaskSync Chat</h1><p>Unable to load the webview template. Please reload the window.</p></main>`;

	bodyHtml = bodyHtml
		.replace(/\{\{LOGO_URI\}\}/g, logoUri.toString())
		.replace(/\{\{TITLE\}\}/g, "Let's build")
		.replace(/\{\{SUBTITLE\}\}/g, "Sync your tasks, automate your workflow");

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src ${webview.cspSource} data:;">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>TaskSync Chat</title>
    <audio id="notification-sound" preload="auto" src="${notificationSoundUri}"></audio>
</head>
<body>
    ${bodyHtml}
    <script nonce="${nonce}">window.__MERMAID_SRC__ = "${mermaidScriptUri}";</script>
    <script nonce="${nonce}" src="${markdownLinksScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Set up a webview view with event handlers.
 */
export function setupWebviewView(p: P, webviewView: vscode.WebviewView): void {
	debugLog("[TaskSync] setupWebviewView — initializing webview");
	p._view = webviewView;
	p._webviewReady = false;

	webviewView.webview.options = {
		enableScripts: true,
		localResourceRoots: [p._extensionUri],
	};

	webviewView.webview.html = getHtmlContent(
		p._extensionUri,
		webviewView.webview,
	);

	// Restore session timer display if timer is already running
	if (p._sessionStartTime !== null || p._sessionFrozenElapsed !== null) {
		p._updateViewTitle();
		if (p._sessionStartTime !== null && p._sessionFrozenElapsed === null) {
			p._startSessionTimerInterval();
		}
	}

	webviewView.webview.onDidReceiveMessage(
		(message: FromWebviewMessage) => {
			p._handleWebviewMessage(message);
		},
		undefined,
		p._disposables,
	);

	webviewView.onDidDispose(
		() => {
			debugLog("[TaskSync] webviewView disposed — cleaning up");
			p._webviewReady = false;
			p._view = undefined;
			p._fileSearchCache.clear();
			p.saveCurrentSessionToHistory();
		},
		null,
		p._disposables,
	);

	webviewView.onDidChangeVisibility(
		() => {
			if (!webviewView.visible) {
				debugLog("[TaskSync] webviewView hidden — saving session to history");
				p.saveCurrentSessionToHistory();
			}
		},
		null,
		p._disposables,
	);
}

/**
 * Dispose all provider resources.
 */
export function disposeProvider(p: P): void {
	debugLog("[TaskSync] disposeProvider — disposing all resources");
	p.saveCurrentSessionToHistory();

	// Stop remote server if running
	if (p._remoteServer) {
		p._remoteServer.stop();
	}

	if (p._queueSaveTimer) {
		clearTimeout(p._queueSaveTimer);
		p._queueSaveTimer = null;
	}
	if (p._historySaveTimer) {
		clearTimeout(p._historySaveTimer);
		p._historySaveTimer = null;
	}

	p._fileSearchCache.clear();
	p._currentSessionCallsMap.clear();

	// Reject all pending requests so callers don't hang forever
	for (const [id, resolve] of p._pendingRequests) {
		debugLog(`disposeProvider — rejecting pending request ${id}`);
		resolve({ value: "[Extension disposed]", queue: false, attachments: [] });
	}
	p._pendingRequests.clear();

	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}

	p._stopSessionTimerInterval();
	fileH.cleanupTempImagesFromEntries(p._currentSessionCalls);

	p._currentSessionCalls = [];
	p._attachments = [];
	p._disposables.forEach((d: vscode.Disposable) => d.dispose());
	p._disposables = [];
	p._view = undefined;
}

/**
 * Start a new session: save history, clean up, and reset state.
 */
export function startNewSession(p: P): void {
	debugLog(
		`[TaskSync] startNewSession — currentToolCallId: ${p._currentToolCallId}, sessionCalls: ${p._currentSessionCalls.length}, aiTurnActive: ${p._aiTurnActive}, sessionTerminated: ${p._sessionTerminated}`,
	);
	if (p._responseTimeoutTimer) {
		clearTimeout(p._responseTimeoutTimer);
		p._responseTimeoutTimer = null;
	}
	if (p._currentToolCallId) {
		debugLog(
			`[TaskSync] startNewSession — resolving pending request ${p._currentToolCallId} with [Session reset by user]`,
		);
		const resolve = p._pendingRequests.get(p._currentToolCallId);
		if (resolve) {
			resolve({
				value: "[Session reset by user]",
				queue: false,
				attachments: [],
			});
		}
		p._pendingRequests.delete(p._currentToolCallId);
		p._currentToolCallId = null;
	}
	p._consecutiveAutoResponses = 0;
	p._autopilotIndex = 0;

	p.saveCurrentSessionToHistory();
	fileH.cleanupTempImagesFromEntries(p._currentSessionCalls);

	p._currentSessionCalls = [];
	p._currentSessionCallsMap.clear();
	p._sessionStartTime = null;
	p._sessionFrozenElapsed = null;
	p._stopSessionTimerInterval();
	p._sessionTerminated = false;
	p._sessionWarningShown = false;
	p._aiTurnActive = false;
	debugLog(
		"[TaskSync] startNewSession — session reset complete, aiTurnActive: false, posting clear to webview",
	);
	p._updateViewTitle();
	p._updateCurrentSessionUI();
	p._updatePersistedHistoryUI();
	p._view?.webview.postMessage({ type: "clear" } satisfies ToWebviewMessage);

	// Notify remote clients of session reset
	p._remoteServer?.broadcast("newSession", {});
}
