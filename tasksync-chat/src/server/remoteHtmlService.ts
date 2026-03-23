import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import {
	MAX_COMMIT_MESSAGE_LENGTH,
	MAX_FILE_PATH_LENGTH,
	truncateDiff,
} from "../constants/remoteConstants";
import type { FileSearchResult } from "../webview/webviewProvider";
import type { GitService } from "./gitService";
import { isValidFilePath } from "./gitService";
import type { RemoteAuthService } from "./remoteAuthService";
import {
	getSafeErrorMessage,
	isOriginAllowed,
	setSecurityHeaders,
} from "./serverUtils";

/** Map file extensions to content types for static file serving. */
const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

/**
 * Handles HTTP requests, file serving, and HTML generation for the remote server.
 */
export class RemoteHtmlService {
	private _cachedBodyTemplate: string | null = null;
	private readonly MAX_BODY_SIZE = 1024 * 1024; // 1MB
	/** Set by RemoteServer when TLS is active, enables HSTS header. */
	public tlsEnabled = false;

	constructor(
		private webDir: string,
		private mediaDir: string,
	) {}

	/**
	 * Preload HTML templates asynchronously during server startup.
	 * This avoids blocking the event loop on first request.
	 */
	async preloadTemplates(): Promise<void> {
		if (this._cachedBodyTemplate) return;

		const templatePath = path.join(this.mediaDir, "webview-body.html");
		try {
			this._cachedBodyTemplate = await fs.promises.readFile(
				templatePath,
				"utf8",
			);
		} catch (err) {
			console.error(
				"[TaskSync Remote] Error preloading template:",
				getSafeErrorMessage(err),
			);
		}
	}

	/** Main HTTP request handler - routes to appropriate handler. */
	handleHttp(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		authService: RemoteAuthService,
		gitService: GitService,
		gitServiceAvailable: boolean,
		provider: {
			searchFilesForRemote: (query: string) => Promise<FileSearchResult[]>;
		},
		broadcast?: (type: string, data: unknown) => void,
	): void {
		const url = new URL(req.url || "/", `http://${req.headers.host}`);

		// Handle API endpoints
		if (url.pathname.startsWith("/api/")) {
			this.handleApi(
				req,
				res,
				url,
				authService,
				gitService,
				gitServiceAvailable,
				provider,
				broadcast,
			).catch((err) => {
				console.error("[TaskSync Remote] API error:", err);
				if (!res.headersSent) {
					res.writeHead(500);
					res.end(JSON.stringify({ error: "Internal error" }));
				}
			});
			return;
		}

		// Route: /app.html - serve the main app (VS Code webview)
		if (url.pathname === "/app.html") {
			this.serveRemoteApp(res, req.headers.host || "");
			return;
		}

		// Route: /shared-constants.js - serve shared constants (SSOT for frontend)
		if (url.pathname === "/shared-constants.js") {
			const sharedConstantsPath = path.join(this.webDir, "shared-constants.js");
			this.serveFile(sharedConstantsPath, res);
			return;
		}

		// Route: /media/* - serve from media folder (VS Code webview assets)
		if (url.pathname.startsWith("/media/")) {
			const decodedPath = decodeURIComponent(url.pathname.slice(7));
			const normalizedPath = path
				.normalize(decodedPath)
				.replace(/^(\.\.[\/\\])+/, "");
			const fullPath = path.resolve(
				this.mediaDir,
				normalizedPath.replace(/^[\/\\]+/, ""),
			);
			const canonicalMediaDir = path.resolve(this.mediaDir);

			if (
				!fullPath.startsWith(canonicalMediaDir + path.sep) &&
				fullPath !== canonicalMediaDir
			) {
				res.writeHead(403);
				res.end("Forbidden");
				return;
			}

			this.serveFile(fullPath, res);
			return;
		}

		// Route: /codicon.css - serve codicons from node_modules
		if (url.pathname === "/codicon.css") {
			const codiconPath = path.join(
				path.dirname(this.mediaDir),
				"node_modules",
				"@vscode",
				"codicons",
				"dist",
				"codicon.css",
			);
			this.serveFile(codiconPath, res);
			return;
		}

		// Route: /codicon.ttf - serve codicon font
		if (url.pathname === "/codicon.ttf") {
			const codiconPath = path.join(
				path.dirname(this.mediaDir),
				"node_modules",
				"@vscode",
				"codicons",
				"dist",
				"codicon.ttf",
			);
			this.serveFile(codiconPath, res);
			return;
		}

		// Default: serve from web folder (login page, etc)
		let filePath = url.pathname === "/" ? "/index.html" : url.pathname;

		const decodedPath = decodeURIComponent(filePath);
		const normalizedPath = path
			.normalize(decodedPath)
			.replace(/^(\.\.[\/\\])+/, "");
		const fullPath = path.resolve(
			this.webDir,
			normalizedPath.replace(/^[\/\\]+/, ""),
		);
		const canonicalWebDir = path.resolve(this.webDir);

		if (
			!fullPath.startsWith(canonicalWebDir + path.sep) &&
			fullPath !== canonicalWebDir
		) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}

		const requestHost = req.headers.host || "";

		// For index.html, add a dynamic CSP header with specific ws origin
		const isLoginPage = url.pathname === "/" || url.pathname === "/index.html";
		const cspHeader = isLoginPage ? this.buildLoginCsp(requestHost) : undefined;

		this.serveFile(
			fullPath,
			res,
			() => {
				if (!path.extname(fullPath)) {
					this.serveRemoteApp(res, requestHost);
				} else {
					res.writeHead(404);
					res.end("Not Found");
				}
			},
			cspHeader,
		);
	}

	/**
	 * Serve a static file with symlink protection.
	 * Uses realpath to atomically resolve symlinks and verify the canonical path
	 * is within allowed directories, preventing TOCTOU race conditions.
	 */
	serveFile(
		fullPath: string,
		res: http.ServerResponse,
		onNotFound?: () => void,
		cspOverride?: string,
	): void {
		const ext = path.extname(fullPath).toLowerCase();
		const canonicalWebDir = path.resolve(this.webDir);
		const canonicalMediaDir = path.resolve(this.mediaDir);
		// Also allow codicon assets from node_modules
		const canonicalNodeModules = path.resolve(
			path.dirname(this.mediaDir),
			"node_modules",
		);

		// Atomically resolve symlinks and verify the canonical path
		fs.realpath(fullPath, (realpathErr, resolvedPath) => {
			if (realpathErr) {
				if (onNotFound) {
					onNotFound();
				} else {
					res.writeHead(404);
					res.end("Not Found");
				}
				return;
			}

			// Verify resolved path is within allowed directories
			const inWebDir =
				resolvedPath.startsWith(canonicalWebDir + path.sep) ||
				resolvedPath === canonicalWebDir;
			const inMediaDir =
				resolvedPath.startsWith(canonicalMediaDir + path.sep) ||
				resolvedPath === canonicalMediaDir;
			const inNodeModules = resolvedPath.startsWith(
				canonicalNodeModules + path.sep,
			);
			if (!inWebDir && !inMediaDir && !inNodeModules) {
				res.writeHead(403);
				res.end("Forbidden");
				return;
			}

			fs.readFile(resolvedPath, (err, data) => {
				if (err) {
					if (onNotFound) {
						onNotFound();
					} else {
						res.writeHead(404);
						res.end("Not Found");
					}
					return;
				}

				const headers: Record<string, string> = {
					"Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
					"Cache-Control": "no-cache",
				};
				if (cspOverride) {
					headers["Content-Security-Policy"] = cspOverride;
				}
				setSecurityHeaders(res, this.tlsEnabled);
				res.writeHead(200, headers);
				res.end(data);
			});
		});
	}

	/**
	 * Serve the main remote app HTML page.
	 */
	private serveRemoteApp(res: http.ServerResponse, host: string): void {
		const html = this.generateRemoteAppHtml(host);
		setSecurityHeaders(res, this.tlsEnabled);
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(html);
	}

	/** Build WebSocket origin directives from the request host. Falls back to broad `ws: wss:` if empty. */
	private buildWsOrigin(host: string): string {
		if (!host) return "ws: wss:";
		return `ws://${host} wss://${host}`;
	}

	/** Build a CSP string for the login page (no CDN, no media). */
	private buildLoginCsp(host: string): string {
		const wsOrigin = this.buildWsOrigin(host);
		return `default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${wsOrigin}; manifest-src 'self';`;
	}

	/**
	 * Generate the remote app HTML with template substitution.
	 */
	private generateRemoteAppHtml(host: string): string {
		if (!this._cachedBodyTemplate) {
			// Template not yet loaded — return a lightweight page that auto-refreshes
			console.error(
				"[TaskSync Remote] Template not preloaded, returning auto-refresh page",
			);
			// Trigger async preload for next request
			void this.preloadTemplates();
			return `<!DOCTYPE html><html><head><meta charset="UTF-8">
                <meta http-equiv="refresh" content="1">
                <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1e1e1e;color:#ccc}</style>
                </head><body><p>Loading TaskSync Remote...</p></body></html>`;
		}
		let bodyHtml = this._cachedBodyTemplate;

		bodyHtml = bodyHtml
			.replace(/\{\{LOGO_URI\}\}/g, "/media/TS-logo.svg")
			.replace(/\{\{TITLE\}\}/g, "TaskSync Remote")
			.replace(/\{\{SUBTITLE\}\}/g, "Control your AI workflow from anywhere");

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#1e1e1e">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self' ${this.buildWsOrigin(host)}; media-src 'self' data:;">
    <title>TaskSync Remote</title>
    <link rel="apple-touch-icon" href="/icons/icon-192.svg">
    <link href="/codicon.css" rel="stylesheet">
    <link href="/media/remote-fallback.css" rel="stylesheet">
    <link href="/media/main.css" rel="stylesheet">
    <audio id="notification-sound" preload="auto" src="/media/notification.wav"></audio>
</head>
<body class="remote-mode">
    <!-- Fallback for JavaScript-disabled browsers -->
    <noscript>
        <div class="noscript-message">
            <p>JavaScript is required to use TaskSync Remote.</p>
        </div>
    </noscript>

    <!-- Remote Header -->
    <div class="remote-header">
        <div class="remote-header-left">
            <span class="remote-header-title">TaskSync</span>
            <span class="remote-status" id="remote-connection-status" title="Connecting..." role="status" aria-live="polite"><span class="sr-only">Connecting</span></span>
        </div>
        <div class="remote-header-right">
            <button class="remote-btn" id="remote-new-session-btn" title="New Session">
                <span class="codicon codicon-add"></span> New Session
            </button>
            <button class="remote-btn" id="remote-settings-btn" title="Settings">
                <span class="codicon codicon-gear"></span>
            </button>
        </div>
    </div>

    ${bodyHtml}

    <script>window.__MERMAID_SRC__ = "/media/mermaid.min.js";</script>
    <script src="/shared-constants.js"></script>
    <script src="/media/markdownLinks.js"></script>
    <script src="/media/webview.js"></script>
</body>
</html>`;
	}

	/**
	 * Handle API endpoints (REST).
	 */
	private async handleApi(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		url: URL,
		authService: RemoteAuthService,
		gitService: GitService,
		gitServiceAvailable: boolean,
		provider: {
			searchFilesForRemote: (query: string) => Promise<FileSearchResult[]>;
		},
		broadcast?: (type: string, data: unknown) => void,
	): Promise<void> {
		res.setHeader("Content-Type", "application/json");
		setSecurityHeaders(res, this.tlsEnabled);

		// Reject cross-origin API requests (defense-in-depth)
		if (!isOriginAllowed(req)) {
			res.writeHead(403);
			res.end(JSON.stringify({ error: "Cross-origin request blocked" }));
			return;
		}

		const authResult = authService.verifyHttpAuth(req, url);
		if (!authResult.allowed) {
			const status = authResult.lockedOut ? 429 : 401;
			const msg = authResult.lockedOut
				? "Too many attempts. Try again later."
				: "Unauthorized";
			res.writeHead(status);
			res.end(JSON.stringify({ error: msg }));
			return;
		}

		// File search API
		if (url.pathname === "/api/files" && req.method === "GET") {
			const query = url.searchParams.get("query") || "";
			if (query.length > MAX_FILE_PATH_LENGTH) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: "Query too long" }));
				return;
			}
			const files = await provider.searchFilesForRemote(query);
			res.writeHead(200);
			res.end(JSON.stringify(files));
			return;
		}

		// Git API endpoints - check availability first
		if (url.pathname.startsWith("/api/") && url.pathname !== "/api/files") {
			if (!gitServiceAvailable) {
				res.writeHead(503);
				res.end(JSON.stringify({ error: "Git service unavailable" }));
				return;
			}
		}

		if (url.pathname === "/api/changes" && req.method === "GET") {
			try {
				const changes = await gitService.getChanges();
				res.writeHead(200);
				res.end(JSON.stringify(changes));
			} catch {
				res.writeHead(500);
				res.end(JSON.stringify({ error: "Failed to get changes" }));
			}
			return;
		}

		if (url.pathname === "/api/diff" && req.method === "GET") {
			const file = url.searchParams.get("file");
			if (
				!file ||
				file.length > MAX_FILE_PATH_LENGTH ||
				!isValidFilePath(file)
			) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: "Invalid file path" }));
				return;
			}
			try {
				const diff = truncateDiff(await gitService.getDiff(file));
				res.writeHead(200);
				res.end(JSON.stringify({ diff }));
			} catch {
				res.writeHead(500);
				res.end(JSON.stringify({ error: "Failed to get diff" }));
			}
			return;
		}

		// POST endpoints need body parsing
		if (req.method === "POST") {
			const chunks: Buffer[] = [];
			let bodyLength = 0;
			let aborted = false;
			req.on("data", (chunk: Buffer) => {
				bodyLength += chunk.length;
				if (bodyLength > this.MAX_BODY_SIZE) {
					aborted = true;
					res.writeHead(413);
					res.end(JSON.stringify({ error: "Request body too large" }));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", async () => {
				if (aborted) return;
				try {
					const body = Buffer.concat(chunks).toString("utf8");
					const data = body ? JSON.parse(body) : {};
					await this.handlePostApi(
						url.pathname,
						data,
						res,
						gitService,
						broadcast,
					);
				} catch {
					res.writeHead(400);
					res.end(JSON.stringify({ error: "Invalid JSON" }));
				}
			});
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
	}

	/**
	 * Handle POST API endpoints.
	 */
	private async handlePostApi(
		pathname: string,
		data: Record<string, unknown>,
		res: http.ServerResponse,
		gitService: GitService,
		broadcast?: (type: string, data: unknown) => void,
	): Promise<void> {
		try {
			switch (pathname) {
				case "/api/stage":
				case "/api/unstage":
				case "/api/discard": {
					if (
						typeof data.file !== "string" ||
						!data.file.trim() ||
						data.file.length > MAX_FILE_PATH_LENGTH ||
						!isValidFilePath(data.file)
					) {
						res.writeHead(400);
						res.end(JSON.stringify({ error: "Invalid file path" }));
						return;
					}
					if (pathname === "/api/stage") await gitService.stage(data.file);
					else if (pathname === "/api/unstage")
						await gitService.unstage(data.file);
					else await gitService.discard(data.file);
					if (broadcast) {
						const changes = await gitService.getChanges();
						broadcast("changesUpdated", changes);
					}
					res.writeHead(200);
					res.end(JSON.stringify({ success: true }));
					break;
				}
				case "/api/stageAll":
					await gitService.stageAll();
					if (broadcast) {
						const changes = await gitService.getChanges();
						broadcast("changesUpdated", changes);
					}
					res.writeHead(200);
					res.end(JSON.stringify({ success: true }));
					break;

				case "/api/commit": {
					if (
						typeof data.message !== "string" ||
						!data.message.trim() ||
						data.message.length > MAX_COMMIT_MESSAGE_LENGTH
					) {
						res.writeHead(400);
						res.end(JSON.stringify({ error: "Invalid commit message" }));
						return;
					}
					await gitService.commit(data.message);
					if (broadcast) {
						const changes = await gitService.getChanges();
						broadcast("changesUpdated", changes);
					}
					res.writeHead(200);
					res.end(JSON.stringify({ success: true }));
					break;
				}
				case "/api/push":
					await gitService.push();
					res.writeHead(200);
					res.end(JSON.stringify({ success: true }));
					break;

				default:
					res.writeHead(404);
					res.end(JSON.stringify({ error: "Not found" }));
			}
		} catch (err) {
			console.error(
				"[TaskSync Remote] POST API error:",
				getSafeErrorMessage(err),
			);
			res.writeHead(500);
			res.end(JSON.stringify({ error: "Operation failed" }));
		}
	}
}
