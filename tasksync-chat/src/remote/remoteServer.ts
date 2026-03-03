import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import * as qrcode from 'qrcode';
import type { TaskSyncWebviewProvider } from '../webview/webviewProvider';

/**
 * Manages a remote HTTP + WebSocket server that mirrors the TaskSync webview
 * to any browser on the local network (phone / tablet / desktop).
 */
export class RemoteServer {
    private app: express.Express | undefined;
    private server: http.Server | undefined;
    private io: SocketIOServer | undefined;
    private port: number | undefined;
    private _isRunning = false;
    private _otp: string | undefined;
    private _sessionTokens = new Set<string>();
    private _failedAttempts = new Map<string, number>();
    private static readonly MAX_OTP_ATTEMPTS = 3;

    // Cached file content for inline embedding (populated on start)
    private _cachedMainCss = '';
    private _cachedCodiconCss = '';
    private _cachedLogoDataUri = '';

    constructor(
        private provider: TaskSyncWebviewProvider,
        private extensionUri: vscode.Uri,
    ) { }

    isRunning(): boolean {
        return this._isRunning;
    }

    getPort(): number | undefined {
        return this.port;
    }

    // ── Start ──────────────────────────────────────────────────────────

    async start(): Promise<void> {
        if (this._isRunning) return;

        const config = vscode.workspace.getConfiguration('tasksync');
        const configuredPort = config.get<number>('remotePort', 3000);
        this.port = configuredPort > 0
            ? await this.tryPort(configuredPort)
            : await this.findAvailablePort();

        // Generate a 6-digit OTP for this session
        this._otp = crypto.randomInt(100_000, 999_999).toString();
        this._sessionTokens.clear();

        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new SocketIOServer(this.server, {
            cors: { origin: '*' },
            // Limit max payload to 1 MB to prevent abuse
            maxHttpBufferSize: 1e6,
        });

        this._cacheMediaContent();
        this.setupAuthRoutes();
        this.setupRoutes();
        this.setupSocketHandlers();

        await new Promise<void>((resolve) => {
            this.server!.listen(this.port, '0.0.0.0', () => resolve());
        });

        this._isRunning = true;
        await this.showConnectionInfo();
    }

    // ── Stop ───────────────────────────────────────────────────────────

    async stop(): Promise<void> {
        this._isRunning = false;
        this._otp = undefined;
        this._sessionTokens.clear();
        this._failedAttempts.clear();
        this._cachedMainCss = '';
        this._cachedCodiconCss = '';
        this._cachedLogoDataUri = '';
        if (this.io) {
            this.io.close();
            this.io = undefined;
        }
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
        this.app = undefined;
    }

    // ── Broadcast to all remote clients ────────────────────────────────

    broadcast(event: string, data: unknown): void {
        this.io?.emit(event, data);
    }

    // ── Auth helpers ─────────────────────────────────────────────────

    private _parseCookies(cookieHeader: string | undefined): Record<string, string> {
        const cookies: Record<string, string> = {};
        if (!cookieHeader) return cookies;
        for (const pair of cookieHeader.split(';')) {
            const idx = pair.indexOf('=');
            if (idx > 0) {
                cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
            }
        }
        return cookies;
    }

    private _isAuthenticated(req: express.Request): boolean {
        const cookies = this._parseCookies(req.headers.cookie);
        const token = cookies['tasksync_session'];
        return !!token && this._sessionTokens.has(token);
    }

    // ── Auth routes ────────────────────────────────────────────────────

    private setupAuthRoutes(): void {
        if (!this.app) return;

        // POST /auth — validate OTP and set session cookie
        this.app.post('/auth', (req, res) => {
            // Parse URL-encoded form body manually to avoid express.urlencoded ESM interop issues
            let body = '';
            req.on('data', (chunk: Buffer) => {
                body += chunk.toString();
                if (body.length > 1024) { req.destroy(); return; }
            });
            req.on('end', () => {
                const params = new URLSearchParams(body);
                const otp = params.get('otp') ?? '';
                const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
                const attempts = this._failedAttempts.get(ip) ?? 0;

                if (attempts >= RemoteServer.MAX_OTP_ATTEMPTS) {
                    res.type('html').send(this.getLockedHtml());
                    return;
                }

                if (!this._otp) {
                    // OTP already consumed — one-use only
                    res.type('html').send(this.getLoginHtml('OTP has already been used. Restart the remote server from VS Code to generate a new one.'));
                    return;
                }

                if (otp.trim() === this._otp) {
                    // Invalidate OTP after single use
                    this._otp = undefined;
                    this._failedAttempts.delete(ip);
                    const token = crypto.randomBytes(32).toString('hex');
                    this._sessionTokens.add(token);
                    res.setHeader('Set-Cookie', `tasksync_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
                    res.redirect('/');
                } else {
                    this._failedAttempts.set(ip, attempts + 1);
                    if (attempts + 1 >= RemoteServer.MAX_OTP_ATTEMPTS) {
                        res.type('html').send(this.getLockedHtml());
                    } else {
                        const remaining = RemoteServer.MAX_OTP_ATTEMPTS - (attempts + 1);
                        res.type('html').send(this.getLoginHtml(
                            `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                        ));
                    }
                }
            });
        });
    }

    // ── Routes ─────────────────────────────────────────────────────────

    private setupRoutes(): void {
        if (!this.app) return;
        const mediaDir = path.join(this.extensionUri.fsPath, 'media');

        // Auth middleware — all routes below require a valid session
        const requireAuth: express.RequestHandler = (req, res, next) => {
            if (this._isAuthenticated(req)) {
                next();
            } else {
                const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
                const attempts = this._failedAttempts.get(ip) ?? 0;
                if (attempts >= RemoteServer.MAX_OTP_ATTEMPTS) {
                    res.type('html').send(this.getLockedHtml());
                } else {
                    res.type('html').send(this.getLoginHtml());
                }
            }
        };

        // Serve the remote HTML shell (auth-gated)
        this.app.get('/', requireAuth, (_req, res) => {
            res.type('html').send(this.getRemoteHtml());
        });

        // Serve webview assets (auth-gated) — use readFileSync for robustness
        this.app.get('/webview.js', requireAuth, (_req, res) => {
            try {
                const content = fs.readFileSync(path.join(mediaDir, 'webview.js'), 'utf-8');
                res.type('application/javascript').send(content);
            } catch { res.status(500).end(); }
        });
        this.app.get('/main.css', requireAuth, (_req, res) => {
            res.type('text/css').send(this._cachedMainCss || '');
        });
        this.app.get('/markdownLinks.js', requireAuth, (_req, res) => {
            try {
                const content = fs.readFileSync(path.join(mediaDir, 'markdownLinks.js'), 'utf-8');
                res.type('application/javascript').send(content);
            } catch { res.status(500).end(); }
        });

        // Serve logo (auth-gated)
        this.app.get('/TS-logo.svg', requireAuth, (_req, res) => {
            try {
                const content = fs.readFileSync(path.join(mediaDir, 'TS-logo.svg'), 'utf-8');
                res.type('image/svg+xml').send(content);
            } catch { res.status(404).end(); }
        });

        // Serve codicons CSS + font (auth-gated)
        const codiconsDir = path.join(this.extensionUri.fsPath, 'node_modules', '@vscode', 'codicons', 'dist');
        this.app.get('/codicon.css', requireAuth, (_req, res) => {
            res.type('text/css').send(this._cachedCodiconCss || '');
        });
        this.app.get('/codicon.ttf', requireAuth, (_req, res) => {
            try {
                const content = fs.readFileSync(path.join(codiconsDir, 'codicon.ttf'));
                res.type('font/ttf').send(content);
            } catch { res.status(404).end(); }
        });

        // Serve notification sound if it exists (auth-gated)
        const soundPath = path.join(mediaDir, 'notification.wav');
        this.app.get('/notification.wav', requireAuth, (_req, res) => {
            if (fs.existsSync(soundPath)) {
                res.type('audio/wav').sendFile(soundPath);
            } else {
                res.status(404).end();
            }
        });
    }

    // ── Socket.IO handlers ─────────────────────────────────────────────

    private setupSocketHandlers(): void {
        if (!this.io) return;

        // Reject unauthenticated socket connections
        this.io.use((socket, next) => {
            const cookies = this._parseCookies(socket.handshake.headers.cookie);
            const token = cookies['tasksync_session'];
            if (token && this._sessionTokens.has(token)) {
                next();
            } else {
                next(new Error('Unauthorized'));
            }
        });

        this.io.on('connection', (socket) => {
            console.log('[TaskSync Remote] Client connected:', socket.id);

            // Send current state snapshot to the newly connected client
            this.provider.sendRemoteSnapshot(socket);

            // Forward messages from remote client → extension
            socket.on('message', (msg: { type: string;[key: string]: unknown }) => {
                if (msg && typeof msg === 'object' && typeof msg.type === 'string') {
                    this.provider.handleRemoteMessage(msg);
                }
            });

            socket.on('disconnect', () => {
                console.log('[TaskSync Remote] Client disconnected:', socket.id);
            });
        });
    }

    // ── Connection info (QR + notification) ────────────────────────────

    private async showConnectionInfo(): Promise<void> {
        const addresses = this.getLocalAddresses();
        if (addresses.length === 0) return;

        const url = `http://${addresses[0]}:${this.port}`;

        // Generate QR code for terminal (logged) and show notification
        try {
            const qrTerminal = await qrcode.toString(url, { type: 'terminal', small: true });
            console.log(`[TaskSync Remote] Scan QR code to connect:\n${qrTerminal}`);
            console.log(`[TaskSync Remote] OTP: ${this._otp}`);
        } catch { /* non-critical */ }

        const action = await vscode.window.showInformationMessage(
            `TaskSync Remote: ${url}  |  OTP: ${this._otp}`,
            'Open in Browser',
            'Copy URL',
            'Copy OTP',
        );

        if (action === 'Open in Browser') {
            vscode.env.openExternal(vscode.Uri.parse(url));
        } else if (action === 'Copy URL') {
            await vscode.env.clipboard.writeText(url);
        } else if (action === 'Copy OTP') {
            await vscode.env.clipboard.writeText(this._otp ?? '');
        }
    }

    // ── Cache media content for inline embedding ─────────────────────

    private _cacheMediaContent(): void {
        const mediaDir = path.join(this.extensionUri.fsPath, 'media');
        const codiconsDir = path.join(this.extensionUri.fsPath, 'node_modules', '@vscode', 'codicons', 'dist');

        try {
            this._cachedMainCss = fs.readFileSync(path.join(mediaDir, 'main.css'), 'utf-8');
        } catch (e) {
            console.error('[TaskSync Remote] Failed to read main.css:', e);
        }

        try {
            this._cachedCodiconCss = fs.readFileSync(path.join(codiconsDir, 'codicon.css'), 'utf-8');
        } catch (e) {
            console.error('[TaskSync Remote] Failed to read codicon.css:', e);
        }

        try {
            const svgContent = fs.readFileSync(path.join(mediaDir, 'TS-logo.svg'), 'utf-8');
            this._cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
        } catch (e) {
            console.error('[TaskSync Remote] Failed to read TS-logo.svg:', e);
            this._cachedLogoDataUri = '/TS-logo.svg';
        }
    }

    // ── Locked-out HTML page ─────────────────────────────────────────

    private getLockedHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>TaskSync Remote — Locked</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #1e1e1e; color: #cccccc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; padding: 20px;
        }
        .lock-card {
            background: #252526; border: 1px solid #be1100; border-radius: 8px;
            padding: 32px; max-width: 360px; width: 100%; text-align: center;
        }
        .lock-card h1 { font-size: 20px; margin-bottom: 8px; color: #f48771; }
        .lock-card p { font-size: 13px; color: #888; margin-top: 12px; }
    </style>
</head>
<body>
    <div class="lock-card">
        <h1>Access Denied</h1>
        <p>Too many failed attempts. This device has been locked out.</p>
        <p>Restart the remote server from VS Code to reset.</p>
    </div>
</body>
</html>`;
    }

    // ── Login HTML page ──────────────────────────────────────────────

    private getLoginHtml(errorMsg?: string): string {
        const errorHtml = errorMsg
            ? `<div class="login-error">${errorMsg}</div>`
            : '';
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>TaskSync Remote — Login</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #1e1e1e; color: #cccccc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; padding: 20px;
        }
        .login-card {
            background: #252526; border: 1px solid #3c3c3c; border-radius: 8px;
            padding: 32px; max-width: 360px; width: 100%; text-align: center;
        }
        .login-card h1 { font-size: 20px; margin-bottom: 8px; color: #ffffff; }
        .login-card p { font-size: 13px; color: #888; margin-bottom: 24px; }
        .login-error {
            background: #5a1d1d; border: 1px solid #be1100; color: #f48771;
            padding: 8px 12px; border-radius: 4px; font-size: 13px; margin-bottom: 16px;
        }
        .otp-input {
            width: 100%; padding: 10px 14px; font-size: 24px; letter-spacing: 8px;
            text-align: center; background: #3c3c3c; border: 1px solid #555;
            border-radius: 4px; color: #ffffff; outline: none;
        }
        .otp-input:focus { border-color: #007acc; }
        .otp-input::placeholder { letter-spacing: 2px; font-size: 14px; }
        .login-btn {
            width: 100%; margin-top: 16px; padding: 10px; font-size: 14px;
            background: #0e639c; color: #ffffff; border: none; border-radius: 4px;
            cursor: pointer;
        }
        .login-btn:hover { background: #1177bb; }
    </style>
</head>
<body>
    <div class="login-card">
        <h1>TaskSync Remote</h1>
        <p>Enter the one-time password shown in VS Code</p>
        ${errorHtml}
        <form method="POST" action="/auth">
            <input class="otp-input" type="text" name="otp" placeholder="000000"
                   maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" autofocus required>
            <button class="login-btn" type="submit">Verify</button>
        </form>
    </div>
</body>
</html>`;
    }

    // ── Remote HTML shell ──────────────────────────────────────────────

    private getRemoteHtml(): string {
        // Inline all CSS directly into the HTML to guarantee styles load in the browser.
        // External <link> tags previously failed silently in some environments.
        const codiconCss = this._cachedCodiconCss;
        const mainCss = this._cachedMainCss;
        const logoSrc = this._cachedLogoDataUri || '/TS-logo.svg';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>TaskSync Remote</title>
    <style>
/* ── Codicons ── */
${codiconCss}
/* ── VS Code CSS variable fallbacks for browser rendering ── */
:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    --vscode-font-size: 13px;
    --vscode-font-weight: 400;
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: #8b8b8b;
    --vscode-focusBorder: #007acc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #cccccc;
    --vscode-editor-font-family: 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace;
    --vscode-editor-selectionBackground: rgba(38, 79, 120, 0.5);
    --vscode-sideBar-background: #1e1e1e;
    --vscode-input-background: #313131;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-input-placeholderForeground: #6b6b6b;
    --vscode-panel-border: #2b2b2b;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #313131;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-button-secondaryHoverBackground: #3c3c3c;
    --vscode-badge-background: #4d4d4d;
    --vscode-badge-foreground: #ffffff;
    --vscode-errorForeground: #f48771;
    --vscode-list-activeSelectionBackground: #04395e;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-dropdown-background: #313131;
    --vscode-dropdown-border: #3c3c3c;
    --vscode-editorWidget-background: #252526;
    --vscode-editorWidget-border: #454545;
    --vscode-widget-border: #454545;
    --vscode-widget-shadow: rgba(0, 0, 0, 0.36);
    --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
    --vscode-progressBar-background: #0e70c0;
    --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
    --vscode-scrollbarSlider-hoverBackground: rgba(100, 100, 100, 0.7);
    --vscode-textLink-foreground: #3794ff;
    --vscode-textLink-activeForeground: #3794ff;
    --vscode-textBlockQuote-background: #222222;
    --vscode-textBlockQuote-border: #007acc;
    --vscode-textCodeBlock-background: #2a2a2a;
    --vscode-inputValidation-infoBackground: #063b49;
    --vscode-inputValidation-infoForeground: #ffffff;
    --vscode-inputValidation-errorBackground: #5a1d1d;
    --vscode-symbolIcon-fileForeground: #cccccc;
    --vscode-testing-iconPassed: #73c991;
}
/* ── Main extension CSS ── */
${mainCss}
/* ── Remote-specific overrides ── */
body { background: var(--vscode-editor-background); color: var(--vscode-foreground); }
body.remote-mode #attach-btn { display: none !important; }
.remote-toast {
    position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
    background: var(--vscode-inputValidation-infoBackground);
    color: var(--vscode-inputValidation-infoForeground);
    padding: 12px 16px; text-align: center; font-size: 14px;
    transform: translateY(-100%); transition: transform 0.3s ease;
    cursor: pointer;
}
.remote-toast.visible { transform: translateY(0); }
/* ── Remote title bar ── */
.remote-title-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 100;
}
.remote-title-bar .title-text {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    flex: 1;
}
.remote-title-bar .title-text .session-timer {
    font-weight: 400;
    color: var(--vscode-descriptionForeground);
    margin-left: 6px;
}
.remote-title-bar .title-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    transition: all 0.15s ease;
}
.remote-title-bar .title-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
}
.remote-title-bar .title-btn .codicon { font-size: 14px; }
    </style>
    <audio id="notification-sound" preload="auto" src="/notification.wav"></audio>
</head>
<body class="remote-mode">
    <div id="remote-toast" class="remote-toast" onclick="this.classList.remove('visible')">
        🔔 AI is waiting for your input
    </div>
    <div class="main-container">
        <!-- Remote Title Bar -->
        <div class="remote-title-bar">
            <span class="title-text">TASKSYNC<span class="session-timer" id="remote-session-timer"></span></span>
            <button class="title-btn" title="New Session" aria-label="New Session" id="remote-new-session-btn">
                <span class="codicon codicon-add"></span>
            </button>
            <button class="title-btn" title="View History" aria-label="View History" id="remote-history-btn">
                <span class="codicon codicon-history"></span>
            </button>
            <button class="title-btn" title="Settings" aria-label="Settings" id="remote-settings-btn">
                <span class="codicon codicon-gear"></span>
            </button>
        </div>
        <!-- Chat Container -->
        <div class="chat-container" id="chat-container">
            <!-- Welcome Section - Let's build -->
            <div class="welcome-section" id="welcome-section">
                <div class="welcome-icon">
                    <img src="${logoSrc}" alt="TaskSync Logo" width="48" height="48" class="welcome-logo">
                </div>
                <h1 class="welcome-title">Let's build</h1>
                <p class="welcome-subtitle">Sync your tasks, automate your workflow</p>
                
                <div class="welcome-cards">
                    <div class="welcome-card welcome-card-vibe" id="card-vibe">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-comment-discussion"></span>
                            <span class="welcome-card-title">Normal</span>
                        </div>
                        <p class="welcome-card-desc">Respond to each AI request directly. Full control over every interaction.</p>
                    </div>
                    <div class="welcome-card welcome-card-spec" id="card-spec">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-layers"></span>
                            <span class="welcome-card-title">Queue</span>
                        </div>
                        <p class="welcome-card-desc">Batch your responses. AI consumes from queue automatically, one by one.</p>
                    </div>
                </div>

                <p class="welcome-autopilot-info">The session timer tracks how long you've been using one premium request. It is advisable to start a new session and use another premium request prompt after <strong>2-4 hours</strong> or <strong>50 tool calls</strong>.</p>
            </div>

            <!-- Tool Call History Area -->
            <div class="tool-history-area" id="tool-history-area"></div>

            <!-- Pending Tool Call Message -->
            <div class="pending-message hidden" id="pending-message"></div>
        </div>

        <!-- Combined Input Wrapper (Queue + Input) -->
        <div class="input-area-container" id="input-area-container">
            <!-- File Autocomplete Dropdown -->
            <div class="autocomplete-dropdown hidden" id="autocomplete-dropdown">
                <div class="autocomplete-list" id="autocomplete-list"></div>
                <div class="autocomplete-empty hidden" id="autocomplete-empty">No files found</div>
            </div>
            <!-- Slash Command Autocomplete Dropdown -->
            <div class="slash-dropdown hidden" id="slash-dropdown">
                <div class="slash-list" id="slash-list"></div>
                <div class="slash-empty hidden" id="slash-empty">No prompts found. Add prompts in Settings.</div>
            </div>
            <div class="input-wrapper" id="input-wrapper">
            <!-- Prompt Queue Section - Integrated above input -->
            <div class="queue-section" id="queue-section" role="region" aria-label="Prompt queue">
                <div class="queue-header" id="queue-header" role="button" tabindex="0" aria-expanded="true" aria-controls="queue-list">
                    <div class="accordion-icon" aria-hidden="true">
                        <span class="codicon codicon-chevron-down"></span>
                    </div>
                    <span class="queue-header-title">Prompt Queue</span>
                    <span class="queue-count" id="queue-count" aria-live="polite">0</span>
                </div>
                <div class="queue-list" id="queue-list" role="list" aria-label="Queued prompts">
                    <div class="queue-empty" role="status">No prompts in queue</div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="input-container" id="input-container">
            <!-- Attachment Chips INSIDE input container -->
            <div class="chips-container hidden" id="chips-container"></div>
            <div class="input-row">
                <div class="input-highlighter-wrapper">
                    <div class="input-highlighter" id="input-highlighter" aria-hidden="true"></div>
                    <textarea id="chat-input" placeholder="Reply to tool call. (use # for files, / for prompts)" rows="1" aria-label="Message input. Use # for file references, / for saved prompts"></textarea>
                </div>
            </div>
            <div class="actions-bar">
                <div class="actions-left">
                    <button id="attach-btn" class="icon-btn" title="Add attachment (+)" aria-label="Add attachment">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <div class="mode-selector" id="mode-selector">
                        <button id="mode-btn" class="mode-btn" title="Select mode" aria-label="Select mode">
                            <span id="mode-label">Queue</span>
                            <span class="codicon codicon-chevron-down"></span>
                        </button>
                    </div>
                </div>
                <div class="actions-right">
                    <span class="autopilot-label">Autopilot</span>
                    <div class="toggle-switch" id="autopilot-toggle" role="switch" aria-checked="false" aria-label="Enable Autopilot mode" tabindex="0"></div>
                    <button id="send-btn" title="Send message" aria-label="Send message">
                        <span class="codicon codicon-arrow-up"></span>
                    </button>
                </div>
            </div>
        </div>
        <!-- Mode Dropdown -->
        <div class="mode-dropdown hidden" id="mode-dropdown">
            <div class="mode-option" data-mode="normal">
                <span class="codicon codicon-comment-discussion"></span>
                <span>Normal</span>
            </div>
            <div class="mode-option" data-mode="queue">
                <span class="codicon codicon-layers"></span>
                <span>Queue</span>
            </div>
        </div>
        </div><!-- End input-wrapper -->
        </div><!-- End input-area-container -->
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/markdownLinks.js"></script>
    <script src="/webview.js"></script>
</body>
</html>`;
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private getLocalAddresses(): string[] {
        const interfaces = os.networkInterfaces();
        const addresses: string[] = [];
        for (const iface of Object.values(interfaces)) {
            if (!iface) continue;
            for (const info of iface) {
                if (info.family === 'IPv4' && !info.internal) {
                    addresses.push(info.address);
                }
            }
        }
        return addresses;
    }

    private async tryPort(port: number): Promise<number> {
        return new Promise((resolve) => {
            const testServer = http.createServer();
            testServer.once('error', () => {
                this.findAvailablePort().then(resolve);
            });
            testServer.listen(port, '0.0.0.0', () => {
                testServer.close(() => resolve(port));
            });
        });
    }

    private async findAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = http.createServer();
            server.listen(0, '0.0.0.0', () => {
                const address = server.address();
                if (address && typeof address !== 'string') {
                    const port = address.port;
                    server.close(() => resolve(port));
                } else {
                    reject(new Error('Failed to get port'));
                }
            });
            server.on('error', reject);
        });
    }
}
