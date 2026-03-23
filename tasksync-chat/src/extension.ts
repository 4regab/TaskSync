import * as fs from "fs";
import * as vscode from "vscode";
import {
	CONFIG_SECTION,
	DEFAULT_REMOTE_PORT,
	MCP_CLIENT_CONFIGS,
	MCP_DISPLAY_CLIENT_PATHS,
	MCP_SERVER_NAME,
} from "./constants/remoteConstants";
import { ContextManager } from "./context";
import { McpServerManager } from "./mcp/mcpServer";
import { RemoteServer } from "./server/remoteServer";
import { getSafeErrorMessage } from "./server/serverUtils";
import { registerTools } from "./tools";
import { preloadBodyTemplate } from "./webview/lifecycleHandlers";
import { TaskSyncWebviewProvider } from "./webview/webviewProvider";

let mcpServer: McpServerManager | undefined;
let webviewProvider: TaskSyncWebviewProvider | undefined;
let contextManager: ContextManager | undefined;
let remoteServer: RemoteServer | undefined;

// Memoized result for external MCP client check (only checked once per activation)
let _hasExternalMcpClientsResult: boolean | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 * Result is memoized to avoid repeated file system reads
 * Uses async I/O to avoid blocking the extension host thread
 */
async function hasExternalMcpClientsAsync(): Promise<boolean> {
	// Return cached result if available
	if (_hasExternalMcpClientsResult !== undefined) {
		return _hasExternalMcpClientsResult;
	}

	const configPaths = [
		...MCP_CLIENT_CONFIGS.map((c) => c.path),
		MCP_DISPLAY_CLIENT_PATHS.cursor,
	];

	for (const configPath of configPaths) {
		try {
			const content = await fs.promises.readFile(configPath, "utf8");
			const config = JSON.parse(content);
			// Check if our MCP server is registered
			if (config.mcpServers?.[MCP_SERVER_NAME]) {
				_hasExternalMcpClientsResult = true;
				return true;
			}
		} catch {
			// File doesn't exist or parse error - continue to next path
		}
	}
	_hasExternalMcpClientsResult = false;
	return false;
}

export function activate(context: vscode.ExtensionContext): void {
	// Initialize context manager for #terminal, #problems features
	contextManager = new ContextManager();
	context.subscriptions.push({ dispose: () => contextManager?.dispose() });

	const provider = new TaskSyncWebviewProvider(
		context.extensionUri,
		context,
		contextManager,
	);
	webviewProvider = provider;

	// Register the provider and add it to disposables for proper cleanup
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			TaskSyncWebviewProvider.viewType,
			provider,
		),
		provider, // Provider implements Disposable for cleanup
	);

	// Preload template asynchronously so first webview resolve avoids sync I/O
	preloadBodyTemplate(context.extensionUri).catch(() => {
		/* fallback to sync read */
	});

	// Register VS Code LM Tools (always available for Copilot)
	registerTools(context, provider);

	// Initialize MCP server manager (but don't start yet)
	mcpServer = new McpServerManager(provider);
	context.subscriptions.push({
		dispose: () => {
			mcpServer?.dispose();
		},
	});

	// Check if MCP should auto-start based on settings and external client configs
	// Deferred to avoid blocking activation with file I/O
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mcpEnabled = config.get<boolean>("mcpEnabled", false);
	const autoStartIfClients = config.get<boolean>("mcpAutoStartIfClients", true);

	// Start MCP server only if:
	// 1. Explicitly enabled in settings, OR
	// 2. Auto-start is enabled AND external clients are configured
	// Note: Check is deferred to avoid blocking extension activation with file I/O
	if (mcpEnabled) {
		// Explicitly enabled - start immediately without checking external clients
		mcpServer
			.start()
			.catch((err) => console.error("[TaskSync] MCP start failed:", err));
	} else if (autoStartIfClients) {
		// Defer the external client check to avoid blocking activation
		hasExternalMcpClientsAsync()
			.then((hasClients) => {
				if (hasClients && mcpServer) {
					mcpServer
						.start()
						.catch((err) => console.error("[TaskSync] MCP start failed:", err));
				}
			})
			.catch((err) => {
				console.error("[TaskSync] Failed to check external MCP clients:", err);
			});
	}

	// Start MCP server command
	const startMcpCmd = vscode.commands.registerCommand(
		"tasksync.startMcp",
		async () => {
			if (mcpServer && !mcpServer.isRunning()) {
				try {
					await mcpServer.start();
					if (mcpServer.isRunning()) {
						vscode.window.showInformationMessage("TaskSync MCP Server started");
					}
				} catch (err) {
					console.error("[TaskSync] MCP start failed:", err);
				}
			} else if (mcpServer?.isRunning()) {
				vscode.window.showInformationMessage(
					"TaskSync MCP Server is already running",
				);
			}
		},
	);

	// Send current TaskSync input command (for Keyboard Shortcuts)
	const sendMessageCmd = vscode.commands.registerCommand(
		"tasksync.sendMessage",
		() => {
			provider.triggerSendFromShortcut();
		},
	);

	// Restart MCP server command
	const restartMcpCmd = vscode.commands.registerCommand(
		"tasksync.restartMcp",
		async () => {
			if (mcpServer) {
				await mcpServer.restart();
			}
		},
	);

	// Show MCP configuration command
	const showMcpConfigCmd = vscode.commands.registerCommand(
		"tasksync.showMcpConfig",
		async () => {
			const config = mcpServer?.getMcpConfig?.();
			if (!config) {
				vscode.window.showErrorMessage("MCP server not running");
				return;
			}

			const selected = await vscode.window.showQuickPick(
				[
					{ label: "Kiro", description: "Kiro IDE", value: "kiro" },
					{ label: "Cursor", description: "Cursor Editor", value: "cursor" },
					{
						label: "Antigravity",
						description: "Gemini CLI",
						value: "antigravity",
					},
				],
				{ placeHolder: "Select MCP client to configure" },
			);

			if (!selected) return;

			const cfg = config[selected.value as keyof typeof config];
			const configJson = JSON.stringify(cfg.config, null, 2);

			const message = `Add this to ${cfg.path}:\n\n${configJson}`;
			const action = await vscode.window.showInformationMessage(
				message,
				"Copy to Clipboard",
				"Open File",
			);

			if (action === "Copy to Clipboard") {
				await vscode.env.clipboard.writeText(configJson);
				vscode.window.showInformationMessage(
					"Configuration copied to clipboard",
				);
			} else if (action === "Open File") {
				const uri = vscode.Uri.file(cfg.path);
				await vscode.commands.executeCommand("vscode.open", uri);
			}
		},
	);

	// Open history modal command (triggered from view title bar)
	const openHistoryCmd = vscode.commands.registerCommand(
		"tasksync.openHistory",
		() => {
			provider.openHistoryModal();
		},
	);

	// New session command (triggered from view title bar)
	const newSessionCmd = vscode.commands.registerCommand(
		"tasksync.newSession",
		async () => {
			const answer = await vscode.window.showWarningMessage(
				"Are you sure you want to start a new session? This will clear the current session history.",
				{ modal: true },
				"Start New Session",
			);
			if (answer === "Start New Session") {
				provider.startNewSession();
			}
		},
	);

	// Open settings modal command (triggered from view title bar)
	const openSettingsCmd = vscode.commands.registerCommand(
		"tasksync.openSettings",
		() => {
			provider.openSettingsModal();
		},
	);

	// Initialize remote server
	remoteServer = new RemoteServer(provider, context.extensionUri, context);
	provider.setRemoteServer(remoteServer);
	context.subscriptions.push({
		dispose: () => {
			remoteServer?.stop();
		},
	});

	// Start Remote Access (LAN) command
	const startRemoteLanCmd = vscode.commands.registerCommand(
		"tasksync.startRemoteLan",
		async () => {
			if (remoteServer?.isRunning()) {
				vscode.window.showInformationMessage(
					`Remote server already running on port ${remoteServer.getPort()}`,
				);
				return;
			}

			try {
				const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
				const port = config.get<number>("remotePort", DEFAULT_REMOTE_PORT);
				const result = await remoteServer!.start(port);

				let message = `Remote Access: ${result.localUrl}`;
				if (result.pin) {
					message += ` (PIN: ${result.pin})`;
				}

				const action = await vscode.window.showInformationMessage(
					message,
					"Copy URL",
					"Show QR Code",
				);

				if (action === "Copy URL") {
					await vscode.env.clipboard.writeText(result.localUrl);
					vscode.window.showInformationMessage("URL copied to clipboard");
				} else if (action === "Show QR Code") {
					await vscode.env.clipboard.writeText(result.localUrl);
					vscode.window.showInformationMessage(
						"URL copied to clipboard (QR code coming soon)",
					);
				}
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to start remote server: ${getSafeErrorMessage(err)}`,
				);
			}
		},
	);

	// Stop Remote Access command
	const stopRemoteCmd = vscode.commands.registerCommand(
		"tasksync.stopRemote",
		() => {
			if (remoteServer?.isRunning()) {
				remoteServer.stop();
				vscode.window.showInformationMessage("Remote server stopped");
			} else {
				vscode.window.showInformationMessage("Remote server is not running");
			}
		},
	);

	// Go Remote command (unified entry point)
	const goRemoteCmd = vscode.commands.registerCommand(
		"tasksync.goRemote",
		async () => {
			// If server is running, show current status
			if (remoteServer?.isRunning()) {
				const info = remoteServer.getConnectionInfo();
				const directUrl = info.pin ? `${info.url}#pin=${info.pin}` : info.url;

				const items: vscode.QuickPickItem[] = [
					{
						label: "$(copy) Copy URL",
						description: directUrl,
					},
					{
						label: "$(close) Stop Remote Access",
						description: "Disconnect all clients",
					},
				];

				if (info.pin) {
					items.unshift({
						label: `$(key) PIN: ${info.pin}`,
						description: "Tap to copy",
					});
				}

				const pick = await vscode.window.showQuickPick(items, {
					title: `Remote Access Active`,
					placeHolder: directUrl,
				});

				if (pick?.label.includes("Copy URL")) {
					await vscode.env.clipboard.writeText(directUrl);
					vscode.window.showInformationMessage("URL copied to clipboard");
				} else if (pick?.label.includes("PIN:")) {
					await vscode.env.clipboard.writeText(info.pin || "");
					vscode.window.showInformationMessage("PIN copied to clipboard");
				} else if (pick?.label.includes("Stop")) {
					remoteServer.stop();
					vscode.window.showInformationMessage("Remote server stopped");
				}
				return;
			}

			// Server not running - show options to start
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: "$(broadcast) Start Remote Access",
						description: "LAN mode, PIN required",
						detail:
							"Connect from any device on your local network. Use Tailscale for internet access.",
					},
				],
				{
					title: "Start Remote Access",
					placeHolder: "Start remote access server",
				},
			);

			if (!choice) return;

			try {
				const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
				const port = config.get<number>("remotePort", DEFAULT_REMOTE_PORT);

				const result = await remoteServer!.start(port);

				// Generate URL with PIN embedded as fragment (not query param)
				// Fragments are not sent in HTTP requests, preventing PIN leakage
				const directUrl = result.pin
					? `${result.localUrl}#pin=${result.pin}`
					: result.localUrl;

				// Show connection info in a QuickPick for easy copying
				const infoItems: vscode.QuickPickItem[] = [
					{
						label: `$(link) ${directUrl}`,
						description: "Tap to copy (includes PIN)",
					},
				];

				if (result.pin) {
					infoItems.push({
						label: `$(key) PIN: ${result.pin}`,
						description: "Tap to copy PIN only",
					});
				}

				infoItems.push(
					{
						label: "$(globe) Access from anywhere with Tailscale",
						description: "Free VPN mesh — tailscale.com/download",
					},
					{
						label: "$(check) Done",
						description: "",
					},
				);

				const infoPick = await vscode.window.showQuickPick(infoItems, {
					title: "Remote Access Started",
					placeHolder: `Open ${directUrl} on your phone`,
				});

				if (infoPick?.label.includes(directUrl)) {
					await vscode.env.clipboard.writeText(directUrl);
					vscode.window.showInformationMessage("URL copied!");
				} else if (infoPick?.label.includes("PIN:")) {
					await vscode.env.clipboard.writeText(result.pin || "");
					vscode.window.showInformationMessage("PIN copied!");
				} else if (infoPick?.label.includes("Tailscale")) {
					vscode.env.openExternal(
						vscode.Uri.parse("https://tailscale.com/download"),
					);
				}
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to start remote: ${getSafeErrorMessage(err)}`,
				);
			}
		},
	);

	context.subscriptions.push(
		startMcpCmd,
		sendMessageCmd,
		restartMcpCmd,
		showMcpConfigCmd,
		openHistoryCmd,
		newSessionCmd,
		openSettingsCmd,
		startRemoteLanCmd,
		stopRemoteCmd,
		goRemoteCmd,
	);
}

export async function deactivate(): Promise<void> {
	// Stop remote server
	if (remoteServer) {
		remoteServer.stop();
		remoteServer = undefined;
	}

	// Save current tool call history to persisted history before deactivating
	if (webviewProvider) {
		webviewProvider.saveCurrentSessionToHistory();
		webviewProvider = undefined;
	}

	if (mcpServer) {
		await mcpServer.dispose();
		mcpServer = undefined;
	}
}
