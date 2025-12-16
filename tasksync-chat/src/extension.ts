import * as vscode from 'vscode';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';

let mcpServer: McpServerManager | undefined;
let webviewProvider: TaskSyncWebviewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('TaskSync Extension is now active!');

    const provider = new TaskSyncWebviewProvider(context.extensionUri, context);
    webviewProvider = provider;

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TaskSyncWebviewProvider.viewType, provider)
    );

    // Register VS Code LM Tools
    registerTools(context, provider);

    // Start MCP Server
    mcpServer = new McpServerManager(context, provider);
    mcpServer.start();

    // Manual test command
    const getFeedbackCmd = vscode.commands.registerCommand('tasksync.getFeedback', async () => {
        try {
            const response = await provider.waitForUserResponse('Manual Trigger: Test Question?');
            vscode.window.showInformationMessage(`User said: ${response.value}`);
        } catch (e) {
            vscode.window.showErrorMessage('Failed to get response');
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

    context.subscriptions.push(getFeedbackCmd, restartMcpCmd, showMcpConfigCmd, openHistoryCmd);
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
