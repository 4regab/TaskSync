import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';

let mcpServer: McpServerManager | undefined;
let webviewProvider: TaskSyncWebviewProvider | undefined;
let mcpStatusBarItem: vscode.StatusBarItem | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 */
function hasExternalMcpClients(): boolean {
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
                    return true;
                }
            }
        } catch {
            // Ignore parse errors
        }
    }
    return false;
}

/**
 * Update MCP status bar item
 */
function updateMcpStatusBar(running: boolean): void {
    if (!mcpStatusBarItem) return;

    if (running) {
        mcpStatusBarItem.text = '$(broadcast) MCP';
        mcpStatusBarItem.tooltip = 'TaskSync MCP Server: Running\nClick to restart';
        mcpStatusBarItem.backgroundColor = undefined;
    } else {
        mcpStatusBarItem.text = '$(circle-slash) MCP';
        mcpStatusBarItem.tooltip = 'TaskSync MCP Server: Stopped\nClick to start';
        mcpStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('TaskSync Extension is now active!');

    const provider = new TaskSyncWebviewProvider(context.extensionUri, context);
    webviewProvider = provider;

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TaskSyncWebviewProvider.viewType, provider)
    );

    // Register VS Code LM Tools (always available for Copilot)
    registerTools(context, provider);

    // Create MCP status bar item
    mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    mcpStatusBarItem.command = 'tasksync.restartMcp';
    context.subscriptions.push(mcpStatusBarItem);

    // Initialize MCP server manager (but don't start yet)
    mcpServer = new McpServerManager(context, provider);

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
        updateMcpStatusBar(true);
        mcpStatusBarItem.show();
    } else {
        updateMcpStatusBar(false);
        // Only show status bar if user might want MCP (has the setting visible)
        if (mcpEnabled !== undefined) {
            mcpStatusBarItem.show();
        }
    }

    // Start MCP server command
    const startMcpCmd = vscode.commands.registerCommand('tasksync.startMcp', async () => {
        if (mcpServer && !mcpServer.isRunning()) {
            await mcpServer.start();
            updateMcpStatusBar(true);
            mcpStatusBarItem?.show();
            vscode.window.showInformationMessage('TaskSync MCP Server started');
        } else if (mcpServer?.isRunning()) {
            vscode.window.showInformationMessage('TaskSync MCP Server is already running');
        }
    });

    // Restart MCP server command
    const restartMcpCmd = vscode.commands.registerCommand('tasksync.restartMcp', async () => {
        if (mcpServer) {
            await mcpServer.restart();
            updateMcpStatusBar(true);
            mcpStatusBarItem?.show();
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

    context.subscriptions.push(startMcpCmd, restartMcpCmd, showMcpConfigCmd, openHistoryCmd);
}

export async function deactivate() {
    // Save current session to persisted history before deactivating
    if (webviewProvider) {
        webviewProvider.saveSessionToHistory();
        webviewProvider = undefined;
    }

    if (mcpServer) {
        await mcpServer.dispose();
        mcpServer = undefined;
    }
}
