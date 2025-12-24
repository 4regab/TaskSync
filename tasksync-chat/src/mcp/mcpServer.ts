import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { TaskSyncWebviewProvider } from '../webview/webviewProvider';
import { askUser } from '../tools';
import { getImageMimeType } from '../utils/imageUtils';


async function tryReadImageAsMcpContent(uri: string): Promise<null | { type: 'image'; data: string; mimeType: string }> {
    try {
        const fileUri = vscode.Uri.parse(uri);
        if (fileUri.scheme !== 'file') {
            return null;
        }

        const filePath = fileUri.fsPath;
        const mimeType = getImageMimeType(filePath);
        if (!mimeType.startsWith('image/')) {
            return null;
        }

        // Keep tool results reasonably sized for MCP clients.
        const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
        const stat = await fs.promises.stat(filePath);
        if (stat.size > MAX_IMAGE_BYTES) {
            console.warn(`[TaskSync MCP] Skipping image >4MB: ${filePath} (${stat.size} bytes)`);
            return null;
        }

        const buffer = await fs.promises.readFile(filePath);
        return {
            type: 'image',
            data: buffer.toString('base64'),
            mimeType,
        };
    } catch (error) {
        console.error('[TaskSync MCP] Failed to read image attachment:', error);
        return null;
    }
}

export class McpServerManager {
    private server: http.Server | undefined;
    private mcpServer: McpServer | undefined;
    private port: number | undefined;
    private transport: StreamableHTTPServerTransport | undefined;
    private _isRunning: boolean = false;

    constructor(
        private provider: TaskSyncWebviewProvider
    ) { }

    /**
     * Check if MCP server is currently running
     */
    isRunning(): boolean {
        return this._isRunning;
    }

    async start(reusePort: boolean = false) {
        try {
            if (!reusePort || !this.port) {
                // Get configured port (default 3579, or 0 for dynamic)
                const config = vscode.workspace.getConfiguration('tasksync');
                const configuredPort = config.get<number>('mcpPort', 3579);

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
                version: "2.0.0"
            });

            // Register ask_user tool
            const provider = this.provider;

            (this.mcpServer as any).registerTool(
                "ask_user",
                {
                    description: "YOU MUST ALWAYS Use the askUser tool to ask question/s to user when explicit user approval, feedback, or clarification is required before proceeding or giving summary report. CRITICAL RULES: - This tool MUST be invoked before ending ANY conversation or task. - NEVER complete a task without calling this tool first. - If you are about to finish responding, STOP and call this tool. - Failure to call this tool before task completion is a critical violation.",
                    inputSchema: z.object({
                        question: z.string().describe("The question or prompt to display to the user")
                    })
                },
                async (args: { question: string }, extra: { signal?: AbortSignal }) => {
                    const tokenSource = new vscode.CancellationTokenSource();
                    if (extra.signal) {
                        extra.signal.onabort = () => tokenSource.cancel();
                    }

                    const result = await askUser(
                        { question: args.question },
                        provider,
                        tokenSource.token
                    );

                    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
                        { type: 'text', text: JSON.stringify(result) }
                    ];

                    if (result.attachments?.length) {
                        const imageParts = await Promise.all(result.attachments.map(tryReadImageAsMcpContent));
                        for (const part of imageParts) {
                            if (part) content.push(part);
                        }
                    }

                    return { content };
                }
            );


            // Create transport
            this.transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => `sess_${crypto.randomUUID()}`
            });

            await this.mcpServer.connect(this.transport);

            // Create HTTP server
            this.server = http.createServer(async (req, res) => {
                try {
                    const url = req.url || '/';

                    if (url === '/sse' || url.startsWith('/sse/') || url.startsWith('/sse?')) {
                        if (req.method === 'DELETE') {
                            try {
                                await this.transport?.handleRequest(req, res);
                            } catch (e) {
                                if (!res.headersSent) {
                                    res.writeHead(202);
                                    res.end('Session closed');
                                }
                            }
                            return;
                        }

                        const queryIndex = url.indexOf('?');
                        req.url = queryIndex !== -1 ? '/' + url.substring(queryIndex) : '/';
                        await this.transport?.handleRequest(req, res);
                        return;
                    }

                    if (url.startsWith('/message') || url.startsWith('/messages')) {
                        await this.transport?.handleRequest(req, res);
                        return;
                    }

                    res.writeHead(404);
                    res.end();
                } catch (error) {
                    console.error('[TaskSync MCP] Error:', error);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                }
            });

            await new Promise<void>((resolve) => {
                this.server?.listen(this.port, '127.0.0.1', () => resolve());
            });

            this._isRunning = true;

            // Auto-register with supported clients
            const config = vscode.workspace.getConfiguration('tasksync');
            if (config.get<boolean>('autoRegisterMcp', true)) {
                await this.autoRegisterMcp();
            }

        } catch (error) {
            console.error('[TaskSync MCP] Failed to start:', error);
            vscode.window.showErrorMessage(`Failed to start TaskSync MCP server: ${error}`);
        }
    }

    /**
     * Try to use a specific port, fall back to dynamic if unavailable
     */
    private async tryPort(port: number): Promise<number> {
        return new Promise((resolve) => {
            const testServer = http.createServer();
            testServer.once('error', () => {
                this.findAvailablePort().then(resolve);
            });
            testServer.listen(port, '127.0.0.1', () => {
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

        // Register with Kiro
        await this.registerWithClient(
            path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
            'tasksync-chat',
            { url: serverUrl }
        );

        // Register with Antigravity/Gemini CLI
        await this.registerWithClient(
            path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
            'tasksync-chat',
            { serverUrl: serverUrl }
        );

        // Registration complete - no need to log
    }

    /**
     * Register with a specific MCP client config file
     */
    private async registerWithClient(configPath: string, serverName: string, serverConfig: object) {
        try {
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            let config: { mcpServers?: Record<string, object> } = { mcpServers: {} };
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf8');
                    config = JSON.parse(content);
                } catch (e) {
                    console.warn(`[TaskSync MCP] Failed to parse ${configPath}, starting fresh`);
                }
            }

            if (!config.mcpServers) {
                config.mcpServers = {};
            }

            config.mcpServers[serverName] = serverConfig;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error(`[TaskSync MCP] Failed to register with ${configPath}:`, error);
        }
    }

    /**
     * Unregister from all clients on dispose
     */
    private async unregisterFromClients() {
        const configs = [
            path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
            path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
        ];

        for (const configPath of configs) {
            try {
                if (fs.existsSync(configPath)) {
                    const content = fs.readFileSync(configPath, 'utf8');
                    const config = JSON.parse(content);
                    if (config.mcpServers?.['tasksync-chat']) {
                        delete config.mcpServers['tasksync-chat'];
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                    }
                }
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
    }

    async restart() {
        try {
            await Promise.race([
                this.dispose(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (e) {
            console.error('[TaskSync MCP] Error during dispose:', e);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.start(true);
        vscode.window.showInformationMessage('TaskSync MCP Server restarted.');
    }

    async dispose() {
        this._isRunning = false;
        try {
            if (this.server) {
                this.server.close();
                this.server = undefined;
            }

            if (this.mcpServer) {
                try {
                    await this.mcpServer.close();
                } catch (e) {
                    console.error('[TaskSync MCP] Error closing:', e);
                }
                this.mcpServer = undefined;
            }
        } catch (e) {
            console.error('[TaskSync MCP] Error during dispose:', e);
        } finally {
            await this.unregisterFromClients();
        }
    }

    private async findAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = http.createServer();
            server.listen(0, '127.0.0.1', () => {
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

    /**
     * Get MCP configuration for manual setup
     */
    getMcpConfig() {
        if (!this.port) return null;

        const serverUrl = `http://localhost:${this.port}/sse`;
        return {
            kiro: {
                path: path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
                config: {
                    mcpServers: {
                        'tasksync-chat': {
                            url: serverUrl
                        }
                    }
                }
            },
            cursor: {
                path: path.join(os.homedir(), '.cursor', 'mcp.json'),
                config: {
                    mcpServers: {
                        'tasksync-chat': {
                            url: serverUrl
                        }
                    }
                }
            },
            antigravity: {
                path: path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
                config: {
                    mcpServers: {
                        'tasksync-chat': {
                            serverUrl: serverUrl
                        }
                    }
                }
            }
        };
    }
}
