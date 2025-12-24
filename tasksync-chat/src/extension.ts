import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';

let mcpServer: McpServerManager | undefined;
let webviewProvider: TaskSyncWebviewProvider | undefined;

// Memoized result for external MCP client check (only checked once per activation)
let _hasExternalMcpClientsResult: boolean | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 * Result is memoized to avoid repeated file system reads
 */
function hasExternalMcpClients(): boolean {
    // Return cached result if available
    if (_hasExternalMcpClientsResult !== undefined) {
        return _hasExternalMcpClientsResult;
    }

    const configPaths = [
        path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
        path.join(os.homedir(), '.cursor', 'mcp.json'),
        path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
    ];

    for (const configPath of configPaths) {
        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);
                // Check if tasksync-chat is registered
                if (config.mcpServers?.['tasksync-chat']) {
                    _hasExternalMcpClientsResult = true;
                    return true;
                }
            }
        } catch {
            // Ignore parse errors
        }
    }
    _hasExternalMcpClientsResult = false;
    return false;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new TaskSyncWebviewProvider(context.extensionUri, context);
    webviewProvider = provider;

    // Register the provider and add it to disposables for proper cleanup
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TaskSyncWebviewProvider.viewType, provider),
        provider // Provider implements Disposable for cleanup
    );

    // Register VS Code LM Tools (always available for Copilot)
    registerTools(context, provider);

    // Initialize MCP server manager (but don't start yet)
    mcpServer = new McpServerManager(provider);

    // Check if MCP should auto-start based on settings and external client configs
    const config = vscode.workspace.getConfiguration('tasksync');
    const mcpEnabled = config.get<boolean>('mcpEnabled', false);
    const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);

    // Start MCP server only if:
    // 1. Explicitly enabled in settings, OR
    // 2. Auto-start is enabled AND external clients are configured
    const shouldStart = mcpEnabled || (autoStartIfClients && hasExternalMcpClients());

    if (shouldStart) {
        mcpServer.start();
    }

    // Start MCP server command
    const startMcpCmd = vscode.commands.registerCommand('tasksync.startMcp', async () => {
        if (mcpServer && !mcpServer.isRunning()) {
            await mcpServer.start();
            vscode.window.showInformationMessage('TaskSync MCP Server started');
        } else if (mcpServer?.isRunning()) {
            vscode.window.showInformationMessage('TaskSync MCP Server is already running');
        }
    });

    // Restart MCP server command
    const restartMcpCmd = vscode.commands.registerCommand('tasksync.restartMcp', async () => {
        if (mcpServer) {
            await mcpServer.restart();
        }
    });

    // Show MCP configuration command
    const showMcpConfigCmd = vscode.commands.registerCommand('tasksync.showMcpConfig', async () => {
        const config = (mcpServer as any).getMcpConfig?.();
        if (!config) {
            vscode.window.showErrorMessage('MCP server not running');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            [
                { label: 'Kiro', description: 'Kiro IDE', value: 'kiro' },
                { label: 'Cursor', description: 'Cursor Editor', value: 'cursor' },
                { label: 'Antigravity', description: 'Gemini CLI', value: 'antigravity' }
            ],
            { placeHolder: 'Select MCP client to configure' }
        );

        if (!selected) return;

        const cfg = config[selected.value];
        const configJson = JSON.stringify(cfg.config, null, 2);

        const message = `Add this to ${cfg.path}:\n\n${configJson}`;
        const action = await vscode.window.showInformationMessage(message, 'Copy to Clipboard', 'Open File');

        if (action === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(configJson);
            vscode.window.showInformationMessage('Configuration copied to clipboard');
        } else if (action === 'Open File') {
            const uri = vscode.Uri.file(cfg.path);
            await vscode.commands.executeCommand('vscode.open', uri);
        }
    });

    // Open history modal command (triggered from view title bar)
    const openHistoryCmd = vscode.commands.registerCommand('tasksync.openHistory', () => {
        provider.openHistoryModal();
    });

    // Clear current session command (triggered from view title bar)
    const clearSessionCmd = vscode.commands.registerCommand('tasksync.clearCurrentSession', async () => {
        const result = await vscode.window.showWarningMessage(
            'Clear all tool calls from current session?',
            { modal: true },
            'Clear'
        );
        if (result === 'Clear') {
            provider.clearCurrentSession();
        }
    });

    // Open settings modal command (triggered from view title bar)
    const openSettingsCmd = vscode.commands.registerCommand('tasksync.openSettings', () => {
        provider.openSettingsModal();
    });

    context.subscriptions.push(startMcpCmd, restartMcpCmd, showMcpConfigCmd, openHistoryCmd, clearSessionCmd, openSettingsCmd);
}

export async function deactivate() {
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
