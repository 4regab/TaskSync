import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { z } from "zod";
import {
	CONFIG_SECTION,
	DEFAULT_MCP_PORT,
	MAX_IMAGE_MCP_BYTES,
	MAX_QUESTION_LENGTH,
	MCP_CLIENT_CONFIGS,
	MCP_DISPLAY_CLIENT_PATHS,
	MCP_SERVER_NAME,
} from "../constants/remoteConstants";
import { askUser } from "../tools";
import { getImageMimeType } from "../utils/imageUtils";
import { TaskSyncWebviewProvider } from "../webview/webviewProvider";
import { debugLog } from "../webview/webviewUtils";

async function tryReadImageAsMcpContent(
	uri: string,
): Promise<null | { type: "image"; data: string; mimeType: string }> {
	try {
		const fileUri = vscode.Uri.parse(uri);
		if (fileUri.scheme !== "file") {
			return null;
		}

		const filePath = fileUri.fsPath;
		const mimeType = getImageMimeType(filePath);
		if (!mimeType.startsWith("image/")) {
			return null;
		}

		const stat = await fs.promises.stat(filePath);
		if (stat.size > MAX_IMAGE_MCP_BYTES) {
			console.error(
				`[TaskSync MCP] Skipping image >${MAX_IMAGE_MCP_BYTES / (1024 * 1024)}MB: ${filePath} (${stat.size} bytes)`,
			);
			return null;
		}

		const buffer = await fs.promises.readFile(filePath);
		return {
			type: "image",
			data: buffer.toString("base64"),
			mimeType,
		};
	} catch (error) {
		console.error("[TaskSync MCP] Failed to read image attachment:", error);
		return null;
	}
}

export class McpServerManager {
	private server: http.Server | undefined;
	private mcpServer: McpServer | undefined;
	private port: number | undefined;
	private transports: Map<string, StreamableHTTPServerTransport> = new Map();
	private sessionTimestamps: Map<string, number> = new Map();
	private sessionReapInterval: ReturnType<typeof setInterval> | undefined;
	private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
	private readonly SESSION_REAP_INTERVAL_MS = 60 * 1000; // Check every minute
	private _isRunning: boolean = false;

	constructor(private provider: TaskSyncWebviewProvider) { }

	/**
	 * Check if MCP server is currently running
	 */
	isRunning(): boolean {
		return this._isRunning;
	}

	async start(reusePort: boolean = false) {
		try {
			if (!reusePort || !this.port) {
				// Get configured port (or 0 for dynamic)
				const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
				const configuredPort = config.get<number>("mcpPort", DEFAULT_MCP_PORT);

				if (configuredPort > 0) {
					// Try to use the configured fixed port
					this.port = await this.tryPort(configuredPort);
				} else {
					// Dynamic port assignment
					this.port = await this.findAvailablePort();
				}
			}

			this.mcpServer = new McpServer({
				name: "TaskSync Sidebar Chat",
				version: "2.0.0",
			});

			// Register ask_user tool
			const provider = this.provider;

			const inputSchema = {
				question: z
					.string()
					.min(1, "Question cannot be empty")
					.max(
						MAX_QUESTION_LENGTH,
						`Question cannot exceed ${MAX_QUESTION_LENGTH} characters`,
					)
					.describe("The question or prompt to display to the user"),
				summary: z
					.string()
					.optional()
					.describe(
						"A comprehensive summary of your work, reasoning, actions taken, code changes, and findings since the last ask_user call. Use markdown formatting.",
					),
			} as const;
			type AskUserArgs = typeof inputSchema;

			// @ts-expect-error - MCP SDK + Zod generics cause TS2589 (excessively deep type instantiation)
			this.mcpServer.registerTool<never, AskUserArgs>(
				"ask_user",
				{
					description:
						"This is your ONLY communication channel with the user. The user CANNOT see your chat responses — they can ONLY see messages sent through this tool. You MUST call this tool in a continuous loop: 1) Call askUser to show your question/status. 2) Receive the user's response. 3) Do the requested work. 4) Call askUser AGAIN with results. 5) Repeat from step 2. NEVER end your turn without calling this tool. ALWAYS include a 'summary' field describing your work.",
					inputSchema,
				},
				async (args: { question: string; summary?: string }, extra) => {
					debugLog(
						"[TaskSync MCP] ask_user invoked — question:",
						args.question.slice(0, 80),
					);
					const tokenSource = new vscode.CancellationTokenSource();
					if (extra.signal) {
						extra.signal.addEventListener("abort", () => tokenSource.cancel());
					}

					try {
						const result = await askUser(
							{ question: args.question, summary: args.summary },
							provider,
							tokenSource.token,
						);

						debugLog(
							"[TaskSync MCP] ask_user — returning result, response:",
							result.response.slice(0, 80),
						);
						const content: Array<
							| { type: "text"; text: string }
							| { type: "image"; data: string; mimeType: string }
						> = [
								{
									type: "text",
									text: JSON.stringify({
										...result,
										instruction:
											"The user can ONLY see messages sent via this tool. After processing this response, you MUST call askUser again to report results. NEVER end your turn without calling askUser.",
									}),
								},
							];

						if (result.attachments?.length) {
							const imageParts = await Promise.all(
								result.attachments.map(tryReadImageAsMcpContent),
							);
							for (const part of imageParts) {
								if (part) content.push(part);
							}
						}

						return { content };
					} finally {
						tokenSource.dispose();
					}
				},
			);

			// Create HTTP server with multi-session support
			this.server = http.createServer(async (req, res) => {
				try {
					const url = req.url || "/";

					// Route MCP-compatible paths: /sse, /message, /messages, /mcp
					if (
						url === "/sse" ||
						url.startsWith("/sse/") ||
						url.startsWith("/sse?") ||
						url.startsWith("/message") ||
						url.startsWith("/messages") ||
						url === "/mcp" ||
						url.startsWith("/mcp?") ||
						url.startsWith("/mcp/")
					) {
						const sessionId = req.headers["mcp-session-id"] as
							| string
							| undefined;

						// Normalize URL for transport handling
						if (url !== "/") {
							const queryIndex = url.indexOf("?");
							req.url =
								queryIndex !== -1 ? `/${url.substring(queryIndex)}` : "/";
						}

						if (req.method === "DELETE") {
							const transport = sessionId
								? this.transports.get(sessionId)
								: undefined;
							if (!transport) {
								res.writeHead(404);
								res.end("Session not found");
								return;
							}
							// Remove from map first to prevent concurrent access
							this.transports.delete(sessionId!);
							this.sessionTimestamps.delete(sessionId!);
							try {
								await transport.handleRequest(req, res);
							} catch (e) {
								if (!res.headersSent) {
									res.writeHead(202);
									res.end("Session closed");
								}
							}
							return;
						}

						if (sessionId && this.transports.has(sessionId)) {
							// Existing session — route to its transport
							this.sessionTimestamps.set(sessionId, Date.now());
							await this.transports.get(sessionId)!.handleRequest(req, res);
						} else if (!sessionId && req.method === "POST") {
							// Reject new sessions during shutdown
							if (!this._isRunning) {
								res.writeHead(503);
								res.end("Server shutting down");
								return;
							}
							// New client initialize — create dedicated transport
							let capturedSessionId: string | undefined;
							const transport = new StreamableHTTPServerTransport({
								sessionIdGenerator: () => {
									capturedSessionId = `sess_${crypto.randomUUID()}`;
									return capturedSessionId;
								},
							});
							await this.mcpServer!.connect(transport);
							await transport.handleRequest(req, res);

							if (capturedSessionId) {
								this.transports.set(capturedSessionId, transport);
								this.sessionTimestamps.set(capturedSessionId, Date.now());
							}
						} else if (sessionId) {
							// Unknown session ID → 404 per MCP spec
							res.writeHead(404);
							res.end("Session not found");
						} else {
							res.writeHead(400);
							res.end("Bad request");
						}
						return;
					}

					res.writeHead(404);
					res.end();
				} catch (error) {
					console.error("[TaskSync MCP] Error:", error);
					if (!res.headersSent) {
						res.writeHead(500);
						res.end("Internal Server Error");
					}
				}
			});

			await new Promise<void>((resolve) => {
				this.server?.listen(this.port, "127.0.0.1", () => resolve());
			});

			this._isRunning = true;
			this.startSessionReaper();

			// Auto-register with supported clients
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			if (config.get<boolean>("autoRegisterMcp", true)) {
				await this.autoRegisterMcp();
			}
		} catch (error) {
			this._isRunning = false;
			console.error("[TaskSync MCP] Failed to start:", error);
			vscode.window.showErrorMessage(
				`Failed to start TaskSync MCP server: ${error}`,
			);
			throw error;
		}
	}

	/**
	 * Periodically close idle sessions to prevent unbounded memory growth.
	 */
	private startSessionReaper(): void {
		this.sessionReapInterval = setInterval(async () => {
			const now = Date.now();
			const expired: string[] = [];
			for (const [sessionId, timestamp] of this.sessionTimestamps) {
				if (now - timestamp > this.SESSION_TTL_MS) {
					expired.push(sessionId);
				}
			}
			for (const sessionId of expired) {
				const transport = this.transports.get(sessionId);
				this.transports.delete(sessionId);
				this.sessionTimestamps.delete(sessionId);
				if (transport) {
					try {
						await transport.close();
					} catch (e) {
						console.error(
							`[TaskSync MCP] Error closing stale session ${sessionId}:`,
							e,
						);
					}
				}
			}
		}, this.SESSION_REAP_INTERVAL_MS);
	}

	/**
	 * Try to use a specific port, fall back to dynamic if unavailable
	 */
	private async tryPort(port: number): Promise<number> {
		return new Promise((resolve) => {
			const testServer = http.createServer();
			testServer.once("error", () => {
				this.findAvailablePort().then(resolve);
			});
			testServer.listen(port, "127.0.0.1", () => {
				testServer.close(() => resolve(port));
			});
		});
	}

	/**
	 * Auto-register MCP server with Kiro and other clients
	 */
	private async autoRegisterMcp() {
		if (!this.port) return;
		const serverUrl = `http://localhost:${this.port}/sse`;

		for (const client of MCP_CLIENT_CONFIGS) {
			const config: Record<string, string> = {};
			config[client.serverUrlKey] = serverUrl;
			await this.registerWithClient(client.path, MCP_SERVER_NAME, config);
		}
	}

	/**
	 * Register with a specific MCP client config file
	 */
	private async registerWithClient(
		configPath: string,
		serverName: string,
		serverConfig: object,
	) {
		try {
			const configDir = path.dirname(configPath);
			try {
				await fs.promises.access(configDir);
			} catch {
				await fs.promises.mkdir(configDir, { recursive: true });
			}

			let config: { mcpServers?: Record<string, object> } = { mcpServers: {} };
			try {
				const content = await fs.promises.readFile(configPath, "utf8");
				config = JSON.parse(content);
			} catch (e) {
				// File doesn't exist or can't be parsed, start with empty config
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
					console.error(
						`[TaskSync MCP] Failed to parse ${configPath}, starting fresh`,
					);
				}
			}

			if (!config.mcpServers) {
				config.mcpServers = {};
			}

			config.mcpServers[serverName] = {
				...config.mcpServers[serverName],
				...serverConfig,
			};
			await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
		} catch (error) {
			console.error(
				`[TaskSync MCP] Failed to register with ${configPath}:`,
				error,
			);
		}
	}

	async restart() {
		try {
			await Promise.race([
				this.dispose(),
				new Promise((resolve) => setTimeout(resolve, 2000)),
			]);
		} catch (e) {
			console.error("[TaskSync MCP] Error during dispose:", e);
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
		await this.start(true);
		vscode.window.showInformationMessage("TaskSync MCP Server restarted.");
	}

	async dispose() {
		this._isRunning = false;

		if (this.sessionReapInterval) {
			clearInterval(this.sessionReapInterval);
			this.sessionReapInterval = undefined;
		}

		try {
			// Close all session transports
			for (const [sessionId, transport] of this.transports) {
				try {
					await transport.close();
				} catch (e) {
					console.error(
						`[TaskSync MCP] Error closing transport ${sessionId}:`,
						e,
					);
				}
			}
			this.transports.clear();
			this.sessionTimestamps.clear();

			if (this.server) {
				this.server.close();
				this.server = undefined;
			}

			if (this.mcpServer) {
				try {
					await this.mcpServer.close();
				} catch (e) {
					console.error("[TaskSync MCP] Error closing:", e);
				}
				this.mcpServer = undefined;
			}
		} catch (e) {
			console.error("[TaskSync MCP] Error during dispose:", e);
		}
	}

	private async findAvailablePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = http.createServer();
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address && typeof address !== "string") {
					const port = address.port;
					server.close(() => resolve(port));
				} else {
					reject(new Error("Failed to get port"));
				}
			});
			server.on("error", reject);
		});
	}

	/**
	 * Get MCP configuration for manual setup
	 */
	getMcpConfig() {
		if (!this.port) return null;

		const serverUrl = `http://localhost:${this.port}/sse`;
		const makeConfig = (urlKey: string) => ({
			mcpServers: { [MCP_SERVER_NAME]: { [urlKey]: serverUrl } },
		});
		return {
			kiro: { path: MCP_DISPLAY_CLIENT_PATHS.kiro, config: makeConfig("url") },
			cursor: {
				path: MCP_DISPLAY_CLIENT_PATHS.cursor,
				config: makeConfig("url"),
			},
			antigravity: {
				path: MCP_DISPLAY_CLIENT_PATHS.antigravity,
				config: makeConfig("serverUrl"),
			},
		};
	}
}
