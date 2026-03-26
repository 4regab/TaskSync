import * as http from "http";
import type * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import { WebSocket, WebSocketServer } from "ws";
import {
	CONFIG_SECTION,
	DEFAULT_REMOTE_CHAT_COMMAND,
	DEFAULT_REMOTE_PORT,
	DEFAULT_REMOTE_SESSION_QUERY,
	ErrorCode,
	isValidQueueId,
	MAX_QUEUE_PROMPT_LENGTH,
	MAX_RESPONSE_LENGTH,
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	WS_MAX_PAYLOAD,
	WS_PROTOCOL_VERSION,
} from "../constants/remoteConstants";
import type { TaskSyncWebviewProvider } from "../webview/webviewProvider";
import { notifyQueueChanged } from "../webview/webviewUtils";
import { GitService } from "./gitService";
import { RemoteAuthService } from "./remoteAuthService";
import { dispatchGitMessage } from "./remoteGitHandlers";
import { RemoteHtmlService } from "./remoteHtmlService";
import { dispatchSettingsMessage } from "./remoteSettingsHandler";
import {
	createServer,
	findAvailablePort,
	generateSelfSignedCert,
	getLocalIp,
	getSafeErrorMessage,
	isOriginAllowed,
	normalizeAttachments,
	sendWsError,
	type TlsCert,
} from "./serverUtils";

function getDebugEnabled(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>("remoteDebugLogging", false);
}
function debugLog(...args: unknown[]): void {
	if (getDebugEnabled()) console.error("[TaskSync Remote Debug]", ...args);
}

/** Get the configured VS Code command for opening chat from remote sessions. */
function getRemoteChatCommand(): string {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>("remoteChatCommand", DEFAULT_REMOTE_CHAT_COMMAND);
}

/** Start a fresh chat session and send a query via Agent Mode. */
async function openNewChatWithQuery(query: string): Promise<void> {
	await vscode.commands.executeCommand("workbench.action.chat.newChat");
	await vscode.commands.executeCommand(getRemoteChatCommand(), { query });
}

export interface RemoteServerUrls {
	localUrl: string;
	pin?: string;
}

export class RemoteServer {
	private server: http.Server | https.Server | null = null;
	private wss: WebSocketServer | null = null;
	private clients: Set<WebSocket> = new Set();
	private authService: RemoteAuthService;
	private htmlService: RemoteHtmlService;
	private gitService: GitService;
	private readonly RATE_LIMIT_WINDOW_MS = 1000;
	private readonly RATE_LIMIT_MAX_MESSAGES = 50;

	private readonly RATE_LIMIT_MAX_PER_IP = 100;
	private ipRateLimits: Map<string, { count: number; windowStart: number }> =
		new Map();
	private readonly HEARTBEAT_INTERVAL_MS = 30000;
	private readonly HEARTBEAT_TIMEOUT_MS = 45000;
	private readonly MAX_CLIENTS = 50;
	private running: boolean = false;
	private port: number = DEFAULT_REMOTE_PORT;
	private gitServiceAvailable: boolean = true;
	private configChangeDisposable: vscode.Disposable | null = null;
	private tlsCert: TlsCert | undefined;

	constructor(
		private provider: TaskSyncWebviewProvider,
		extensionUri: vscode.Uri,
		context: vscode.ExtensionContext,
	) {
		const webDir = path.join(extensionUri.fsPath, "web");
		const mediaDir = path.join(extensionUri.fsPath, "media");
		this.authService = new RemoteAuthService(context);
		this.authService.onAuthFailure = (ip, count, lockedOut) => {
			if (!lockedOut && count < 3) return;
			const msg = lockedOut
				? `Client ${ip} locked out after ${count} failed PIN attempts.`
				: `${count} failed PIN attempts from ${ip}.`;
			vscode.window.showWarningMessage(`[TaskSync Remote] ${msg}`);
		};
		this.htmlService = new RemoteHtmlService(webDir, mediaDir);
		this.gitService = new GitService();
	}

	isRunning(): boolean {
		return this.running;
	}
	getPort(): number {
		return this.port;
	}

	private get protocol(): string {
		return this.tlsCert ? "https" : "http";
	}
	private getRemoteState(): Record<string, unknown> {
		return {
			...(this.provider.getRemoteState() as Record<string, unknown>),
		};
	}

	getConnectionInfo(): { url: string; pin?: string } {
		const url = `${this.protocol}://${getLocalIp()}:${this.port}`;
		return {
			url,
			pin: this.authService.pinEnabled
				? this.authService.getOrCreatePin()
				: undefined,
		};
	}

	async start(port: number = DEFAULT_REMOTE_PORT): Promise<RemoteServerUrls> {
		const pin = this.authService.pinEnabled
			? this.authService.getOrCreatePin()
			: undefined;
		if (this.running) {
			return {
				localUrl: `${this.protocol}://${getLocalIp()}:${this.port}`,
				pin,
			};
		}

		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		this.authService.pinEnabled = config.get<boolean>("remotePinEnabled", true);

		this.tlsCert = config.get<boolean>("remoteTlsEnabled", false)
			? await generateSelfSignedCert(getLocalIp())
			: undefined;
		this.htmlService.tlsEnabled = !!this.tlsCert;

		if (this.authService.pinEnabled) {
			this.authService.getOrCreatePin();
		}
		this.configChangeDisposable?.dispose();
		this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
			(e) => {
				if (!e.affectsConfiguration(CONFIG_SECTION)) return;
				const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
				const wasPinEnabled = this.authService.pinEnabled;
				this.authService.pinEnabled = cfg.get<boolean>(
					"remotePinEnabled",
					true,
				);
				if (this.authService.pinEnabled) {
					if (!wasPinEnabled) {
						// PIN was just re-enabled — generate fresh PIN and clear all sessions
						this.authService.pin = "";
						this.authService.getOrCreatePin();
						this.authService.authenticatedClients.clear();
						this.authService.clearSessionTokens();
					}
				}
			},
		);
		await this.initializeServices();
		this.port = await findAvailablePort(port);

		return new Promise((resolve, reject) => {
			this.setupServerAndWss();

			this.server!.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.port} is in use`));
				} else {
					reject(err);
				}
			});

			this.server!.listen(this.port, "0.0.0.0", () => {
				this.markRunning();
				resolve({
					localUrl: `${this.protocol}://${getLocalIp()}:${this.port}`,
					pin: this.authService.pinEnabled
						? this.authService.getOrCreatePin()
						: undefined,
				});
			});
		});
	}

	stop(): void {
		const shutdownMsg = JSON.stringify({
			type: "serverShutdown",
			reason: "Server stopped by user",
		});
		const targets = this.authService.pinEnabled
			? this.authService.authenticatedClients
			: this.clients;
		for (const ws of targets) {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(shutdownMsg);
					ws.close(1000, "Server shutdown");
				} catch {
					// Ignore send errors during shutdown
				}
			}
		}
		this.wss?.close();
		this.server?.close();
		this.clients.clear();
		this.ipRateLimits.clear();
		if (this.ipRateLimitCleanupTimer) {
			clearInterval(this.ipRateLimitCleanupTimer);
			this.ipRateLimitCleanupTimer = null;
		}
		this.authService.cleanup();
		this.authService.pin = ""; // Fresh PIN will be generated on next start
		this.configChangeDisposable?.dispose();
		this.configChangeDisposable = null;
		this.running = false;
	}

	broadcast(type: string, data: unknown): void {
		debugLog("broadcast:", type, JSON.stringify(data).slice(0, 100));
		const msg = JSON.stringify({ type, data });
		const targets = this.authService.pinEnabled
			? this.authService.authenticatedClients
			: this.clients;
		debugLog("broadcast: targets=", targets.size);
		for (const ws of targets) {
			if (ws.readyState === WebSocket.OPEN) {
				if (ws.bufferedAmount > WS_MAX_PAYLOAD * 4) {
					console.error("[TaskSync Remote] Skipping broadcast to slow client");
					continue;
				}
				try {
					ws.send(msg);
				} catch {
					/* client may be closing */
				}
			}
		}
	}

	private async initializeServices(): Promise<void> {
		this.gitServiceAvailable = true;
		await this.gitService.initialize().catch((err: Error) => {
			console.error(
				"[TaskSync Remote] Git service failed to initialize:",
				err.message,
			);
			this.gitServiceAvailable = false;
		});
		await this.htmlService.preloadTemplates();
	}

	private ipRateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

	private setupServerAndWss(): void {
		const handler: http.RequestListener = (req, res) =>
			this.htmlService.handleHttp(
				req,
				res,
				this.authService,
				this.gitService,
				this.gitServiceAvailable,
				this.provider,
				this.broadcast.bind(this),
			);
		this.server = createServer(handler, this.tlsCert);
		this.wss = new WebSocketServer({
			server: this.server,
			maxPayload: WS_MAX_PAYLOAD,
		});
		this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
	}

	private markRunning(): void {
		this.running = true;
		this.authService.startFailedAttemptsCleanup();

		this.ipRateLimitCleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [ip, limit] of this.ipRateLimits.entries()) {
				if (now - limit.windowStart > 5 * 60 * 1000) {
					this.ipRateLimits.delete(ip);
				}
			}
		}, 60 * 1000);
	}

	private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
		debugLog(
			`[TaskSync Remote] New WebSocket connection from ${req.socket.remoteAddress}, clients: ${this.clients.size + 1}`,
		);
		if (this.clients.size >= this.MAX_CLIENTS) {
			sendWsError(ws, "Server at capacity");
			ws.close(1013, "Server at capacity");
			return;
		}
		if (!isOriginAllowed(req)) {
			sendWsError(ws, "Cross-origin connection blocked");
			ws.close(1008, "Origin not allowed");
			return;
		}

		this.clients.add(ws);
		let messageCount = 0;
		let windowStart = Date.now();
		const clientIp = this.authService.normalizeIp(
			req.socket.remoteAddress || "",
		);
		let lastPongTime = Date.now();
		const heartbeatTimer = setInterval(() => {
			if (Date.now() - lastPongTime > this.HEARTBEAT_TIMEOUT_MS) {
				clearInterval(heartbeatTimer);
				ws.terminate();
				return;
			}
			ws.ping();
		}, this.HEARTBEAT_INTERVAL_MS);
		ws.on("pong", () => {
			lastPongTime = Date.now();
		});

		if (!this.authService.pinEnabled) {
			this.authService.authenticatedClients.add(ws);
			try {
				ws.send(
					JSON.stringify({
						type: "connected",
						state: this.getRemoteState(),
						gitServiceAvailable: this.gitServiceAvailable,
						protocolVersion: WS_PROTOCOL_VERSION,
					}),
				);
			} catch (err) {
				console.error(
					"[TaskSync Remote] Error sending initial state:",
					getSafeErrorMessage(err),
				);
				try {
					sendWsError(ws, "Internal server error");
				} catch {
					/* socket closed */
				}
			}
		} else {
			try {
				ws.send(JSON.stringify({ type: "requireAuth" }));
			} catch {
				/* socket closed */
			}
		}

		ws.on("message", (data) => {
			const now = Date.now();
			if (now - windowStart > this.RATE_LIMIT_WINDOW_MS) {
				windowStart = now;
				messageCount = 0;
			}
			messageCount++;
			if (messageCount > this.RATE_LIMIT_MAX_MESSAGES) {
				sendWsError(ws, "Rate limit exceeded");
				return;
			}
			let ipLimit = this.ipRateLimits.get(clientIp);
			if (!ipLimit || now - ipLimit.windowStart > this.RATE_LIMIT_WINDOW_MS) {
				ipLimit = { count: 0, windowStart: now };
				this.ipRateLimits.set(clientIp, ipLimit);
			}
			ipLimit.count++;
			if (ipLimit.count > this.RATE_LIMIT_MAX_PER_IP) {
				sendWsError(ws, "Rate limit exceeded");
				return;
			}

			const str = data.toString();
			if (!str) return;
			try {
				const msg = JSON.parse(str);
				if (!msg || typeof msg.type !== "string") return;
				void this.handleMessage(ws, clientIp, msg).catch((err) => {
					console.error("[TaskSync Remote] handleMessage error:", err);
					try {
						sendWsError(ws, "Internal error");
					} catch {
						/* closed */
					}
				});
			} catch {
				try {
					sendWsError(ws, "Invalid JSON");
				} catch {
					// Socket may be closed
				}
			}
		});

		ws.on("close", () => {
			debugLog(
				`[TaskSync Remote] WebSocket disconnected, remaining clients: ${this.clients.size - 1}`,
			);
			clearInterval(heartbeatTimer);
			this.clients.delete(ws);
			this.authService.removeClient(ws);
		});
	}

	private async handleMessage(
		ws: WebSocket,
		clientIp: string,
		msg: { type: string; [key: string]: unknown },
	): Promise<void> {
		if (!msg || typeof msg.type !== "string") {
			sendWsError(ws, "Invalid message format");
			return;
		}
		debugLog("handleMessage:", msg.type, JSON.stringify(msg).slice(0, 200));

		if (msg.type === "auth") {
			debugLog("Processing auth from", clientIp);
			this.authService.handleAuth(
				ws,
				clientIp,
				typeof msg.pin === "string" ? msg.pin : undefined,
				typeof msg.sessionToken === "string" ? msg.sessionToken : undefined,
				() => this.getRemoteState(),
				this.gitServiceAvailable,
			);
			return;
		}

		if (
			this.authService.pinEnabled &&
			!this.authService.authenticatedClients.has(ws)
		) {
			debugLog("Rejected unauthenticated message:", msg.type);
			sendWsError(ws, "Not authenticated");
			return;
		}

		const broadcastFn = this.broadcast.bind(this);

		switch (msg.type) {
			case "respond": {
				const id = typeof msg.id === "string" ? msg.id : "";
				debugLog("respond: id=", id);
				if (!id) {
					sendWsError(ws, "Missing tool call ID", ErrorCode.INVALID_INPUT);
					return;
				}
				const value = typeof msg.value === "string" ? msg.value : "";
				if (value.length > MAX_RESPONSE_LENGTH) {
					sendWsError(ws, "Response too large", ErrorCode.INVALID_INPUT);
					return;
				}
				const attachments = normalizeAttachments(msg.attachments);
				const accepted = this.provider.resolveRemoteResponse(
					id,
					value,
					attachments,
				);
				debugLog("respond: accepted=", accepted);
				if (!accepted)
					sendWsError(
						ws,
						"This question was already answered from another device.",
						ErrorCode.ALREADY_ANSWERED,
					);
				break;
			}
			case "addToQueue": {
				const prompt = typeof msg.prompt === "string" ? msg.prompt : "";
				if (!prompt || prompt.length > MAX_QUEUE_PROMPT_LENGTH) {
					sendWsError(ws, "Invalid prompt length", ErrorCode.INVALID_INPUT);
					return;
				}
				const attachments = normalizeAttachments(msg.attachments);
				const result = this.provider.addToQueueFromRemote(prompt, attachments);
				if (result.error) {
					sendWsError(ws, result.error, result.code);
				}
				break;
			}
			case "removeFromQueue": {
				const id = typeof msg.id === "string" ? msg.id : "";
				if (!isValidQueueId(id)) {
					sendWsError(ws, "Invalid queue ID", ErrorCode.INVALID_INPUT);
					return;
				}
				this.provider.removeFromQueueById(id);
				break;
			}
			case "editQueuePrompt": {
				const promptId = typeof msg.promptId === "string" ? msg.promptId : "";
				if (!isValidQueueId(promptId)) {
					sendWsError(ws, "Invalid queue ID", ErrorCode.INVALID_INPUT);
					return;
				}
				const newPrompt =
					typeof msg.newPrompt === "string" ? msg.newPrompt : "";
				if (!newPrompt || newPrompt.length > MAX_QUEUE_PROMPT_LENGTH) {
					sendWsError(ws, "Invalid prompt length", ErrorCode.INVALID_INPUT);
					return;
				}
				const editResult = this.provider.editQueuePromptFromRemote(
					promptId,
					newPrompt,
				);
				if (editResult.error) {
					sendWsError(ws, editResult.error, editResult.code);
				}
				break;
			}
			case "reorderQueue": {
				const fromIndex = Number(msg.fromIndex);
				const toIndex = Number(msg.toIndex);
				if (
					!Number.isInteger(fromIndex) ||
					!Number.isInteger(toIndex) ||
					fromIndex < 0 ||
					toIndex < 0
				) {
					sendWsError(ws, "Invalid indices", ErrorCode.INVALID_INPUT);
					return;
				}
				this.provider.reorderQueueFromRemote(fromIndex, toIndex);
				break;
			}
			case "toggleAutopilot":
				await this.provider.setAutopilotEnabled(msg.enabled === true);
				break;
			case "toggleQueue":
				this.provider.setQueueEnabled(msg.enabled === true);
				break;
			case "clearQueue":
				this.provider.clearQueueFromRemote();
				break;
			case "updateResponseTimeout": {
				const timeout = Number(msg.timeout);
				if (!RESPONSE_TIMEOUT_ALLOWED_VALUES.has(timeout)) {
					sendWsError(ws, "Invalid timeout value", ErrorCode.INVALID_INPUT);
					return;
				}
				await this.provider.setResponseTimeoutFromRemote(timeout);
				break;
			}
			case "startSession": {
				const rawPrompt =
					typeof msg.prompt === "string" && msg.prompt.trim()
						? msg.prompt.slice(0, MAX_QUEUE_PROMPT_LENGTH)
						: "";
				const prompt = rawPrompt
					? `The user is connected remotely via TaskSync and can ONLY see messages you send via the #askUser tool. Their request: "${rawPrompt}". Do the work, then call #askUser to report results. NEVER end your turn without calling #askUser.`
					: DEFAULT_REMOTE_SESSION_QUERY;
				debugLog(
					"startSession:",
					rawPrompt ? "custom prompt" : "default greeting",
					"query length:",
					prompt.length,
				);
				// Route through configured chat command (defaults to Agent Mode)
				void openNewChatWithQuery(prompt).catch((e) =>
					console.error("[TaskSync Remote] startSession:", e),
				);
				break;
			}
			case "getState": {
				const state = this.getRemoteState();
				debugLog(
					"getState: isProcessing=",
					state.isProcessing,
					"pending=",
					!!state.pending,
				);
				ws.send(
					JSON.stringify({
						type: "state",
						data: state,
						gitServiceAvailable: this.gitServiceAvailable,
					}),
				);
				break;
			}
			case "chatFollowUp":
			case "chatMessage": {
				const chatContent =
					typeof msg.content === "string" ? msg.content.trim() : "";
				if (!chatContent) {
					sendWsError(ws, "Empty message", ErrorCode.INVALID_INPUT);
					break;
				}

				// Send follow-up to configured chat mode with askUser context
				const userMessage = chatContent.slice(0, MAX_QUEUE_PROMPT_LENGTH);
				const fullQuery = `The remote user sent this follow-up via TaskSync: "${userMessage}". The user can ONLY see messages sent via the #askUser tool — your chat responses are invisible to them. Call #askUser to respond. NEVER end your turn without calling #askUser.`;
				debugLog(
					"chatMessage/chatFollowUp: sending to Agent Mode, length:",
					fullQuery.length,
					"content:",
					userMessage.slice(0, 60),
				);
				vscode.commands
					.executeCommand(getRemoteChatCommand(), {
						query: fullQuery,
					})
					.then(undefined, (e: unknown) => console.error("[TaskSync Chat]", e));
				break;
			}
			case "chatCancel":
				this.provider.cancelPendingToolCall("[Cancelled by user]");
				break;
			case "newSession": {
				this.provider.cancelPendingToolCall("[Session reset by user]");
				this.provider.startNewSession();
				const first = this.provider._promptQueue[0];
				const query = first?.prompt.slice(0, MAX_QUEUE_PROMPT_LENGTH);
				if (first) {
					this.provider._promptQueue.shift();
					notifyQueueChanged(this.provider);
				}
				const chatQuery = query
					? `The user is connected remotely via TaskSync and can ONLY see messages you send via the #askUser tool. Their request: "${query}". Do the work, then call #askUser to report results. NEVER end your turn without calling #askUser.`
					: DEFAULT_REMOTE_SESSION_QUERY;
				debugLog("newSession:", query ? "queue query" : "default greeting");
				void openNewChatWithQuery(chatQuery).catch((e) =>
					console.error("[TaskSync Remote] newSession error:", e),
				);
				break;
			}
			default: {
				const p = this.provider;
				if (await dispatchSettingsMessage(ws, p, broadcastFn, msg)) break;
				const handled = await dispatchGitMessage(
					ws,
					this.gitService,
					this.gitServiceAvailable,
					broadcastFn,
					(q: string) => this.provider.searchFilesForRemote(q),
					msg,
				);
				if (!handled) debugLog("Unknown message type:", msg.type);
			}
		}
	}
}
