import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { copilotPrompt } from './copilot-prompt';

interface LogEntry {
    timestamp: string;
    type: 'user' | 'system' | 'task' | 'ai';
    content: string;
    category?: string;
}

interface TaskSubmission {
    task: string;
    category: string;
    overwrite?: boolean;
    files?: string[];
}

class TaskSyncBackend {
    private server?: http.Server;
    private wss?: WebSocketServer;
    private clients: Set<NodeWebSocket> = new Set();
    private logWatcher?: fs.FSWatcher;
    private tasksyncDir: string;
    private logPath: string;
    private tasksPath: string;
    private lastLogContent: string = '';
    private onLogUpdate?: (entries: LogEntry[]) => void;
    
    constructor(workspaceRoot: string, onLogUpdate?: (entries: LogEntry[]) => void) {
        this.tasksyncDir = path.join(workspaceRoot, 'tasksync');
        this.logPath = path.join(this.tasksyncDir, 'log.md');
        this.tasksPath = path.join(this.tasksyncDir, 'tasks.md');
        this.onLogUpdate = onLogUpdate;
    }
    
    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer();
            this.wss = new WebSocketServer({ server: this.server });
            
            this.wss.on('connection', (ws: NodeWebSocket) => {
                this.clients.add(ws);
                console.log('Client connected to TaskSync backend');
                
                // Send initial log content
                this.sendLogUpdate(ws);
                
                ws.on('message', async (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        await this.handleMessage(message);
                    } catch (error) {
                        console.error('Error handling message:', error);
                    }
                });
                
                ws.on('close', () => {
                    this.clients.delete(ws);
                    console.log('Client disconnected from TaskSync backend');
                });
            });
            
            this.server.listen(0, 'localhost', () => {
                const address = this.server!.address();
                const port = typeof address === 'object' && address ? address.port : 8000;
                console.log(`TaskSync backend started on port ${port}`);
                this.startLogWatcher();
                resolve(port);
            });
            
            this.server.on('error', reject);
        });
    }
    
    private async handleMessage(message: any) {
        if (message.type === 'task_submission') {
            await this.handleTaskSubmission(message.data);
        }
    }
    
    public async handleTaskSubmission(data: TaskSubmission) {
        try {
            console.log('TaskSyncBackend: handleTaskSubmission called with data:', { 
                task: data.task, 
                category: data.category, 
                files: data.files,
                filesCount: data.files ? data.files.length : 0,
                overwrite: data.overwrite 
            });
            
            console.log('TaskSyncBackend: tasksPath =', this.tasksPath);
            console.log('TaskSyncBackend: logPath =', this.logPath);
            
            // Build properly formatted task content for tasks.md
            let taskContent = `# Task\n${data.task}`;
            
            // Add file references if provided
            if (data.files && data.files.length > 0) {
                console.log('TaskSyncBackend: Adding file references:', data.files);
                taskContent += '\n\n# File reference:\n';
                data.files.forEach(file => {
                    taskContent += `${file}\n`;
                });
            }
            
            console.log('TaskSyncBackend: Final task content to write to tasks.md:', JSON.stringify(taskContent));
            
            // Always write to tasks.md with proper formatting
            await fs.promises.writeFile(this.tasksPath, taskContent + '\n', 'utf8');
            console.log('TaskSyncBackend: Task written to tasks.md successfully');
            
            // Verify the file was written
            const writtenContent = await fs.promises.readFile(this.tasksPath, 'utf8');
            console.log('TaskSyncBackend: Verified tasks.md content:', JSON.stringify(writtenContent));
            
            // Do not write user input to log.md - only AI agents should write to log.md
            console.log('TaskSyncBackend: User input not written to log.md (AI agents only)');
            
        } catch (error) {
            console.error('TaskSyncBackend: Error handling task submission:', error);
        }
    }
    
    private async writeTaskToLog(data: TaskSubmission) {
        try {
            const timestamp = new Date().toLocaleString();
            let logEntry = `\n## ${timestamp}\n\n**Type:** user\n**Task:** ${data.task}\n**Category:** ${data.category || 'General'}`;
            
            // Add file references to log if provided
            if (data.files && data.files.length > 0) {
                logEntry += '\n**Files:**\n';
                data.files.forEach(file => {
                    logEntry += `- ${file}\n`;
                });
            }
            
            logEntry += '\n\n';
            
            await fs.promises.appendFile(this.logPath, logEntry, 'utf8');
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }
    
    private startLogWatcher() {
        if (fs.existsSync(this.logPath)) {
            this.lastLogContent = fs.readFileSync(this.logPath, 'utf8');
        }
        
        this.logWatcher = fs.watch(this.logPath, (eventType) => {
            if (eventType === 'change') {
                this.handleLogChange();
            }
        });
    }
    
    private handleLogChange() {
        try {
            const currentContent = fs.readFileSync(this.logPath, 'utf8');
            if (currentContent !== this.lastLogContent) {
                this.lastLogContent = currentContent;
                this.broadcastLogUpdate();
                if (this.onLogUpdate) {
                    const logEntries = this.parseLogContent();
                    this.onLogUpdate(logEntries);
                }
            }
        } catch (error) {
            console.error('Error reading log file:', error);
        }
    }
    
    private sendLogUpdate(ws: NodeWebSocket) {
        try {
            const logEntries = this.parseLogContent();
            ws.send(JSON.stringify({
                type: 'log_update',
                data: { logEntries }
            }));
        } catch (error) {
            console.error('Error sending log update:', error);
        }
    }
    
    private broadcastLogUpdate() {
        const logEntries = this.parseLogContent();
        const message = JSON.stringify({
            type: 'log_update',
            data: { logEntries }
        });
        
        this.clients.forEach(client => {
                    if (client.readyState === NodeWebSocket.OPEN) {
                        client.send(message);
                    }
                });
    }
    
    public parseLogContent(): LogEntry[] {
        try {
            console.log('🔍 parseLogContent: Starting to parse log content');
            if (!fs.existsSync(this.logPath)) {
                console.log('🔍 parseLogContent: Log file does not exist at path:', this.logPath);
                return [];
            }

            const content = fs.readFileSync(this.logPath, 'utf8');
            console.log('🔍 parseLogContent: Raw log file content:', JSON.stringify(content));
            const entries: LogEntry[] = [];
            const logBlocks = content.split('## ').slice(1);
            console.log('🔍 parseLogContent: Found', logBlocks.length, 'formatted blocks');

            // If we have formatted blocks, parse them normally
            if (logBlocks.length > 0) {
                console.log('🔍 parseLogContent: Processing formatted blocks');
                for (const block of logBlocks) {
                    const lines = block.split('\n').filter(line => line.trim() !== '');
                    if (lines.length < 3) continue;

                    const timestamp = lines[0].trim();
                    const typeLine = lines.find(line => line.startsWith('**Type:**'));
                    const typeLineIndex = lines.findIndex(line => line.startsWith('**Type:**'));

                    if (typeLine) {
                        const type = typeLine.replace('**Type:**', '').trim() as LogEntry['type'];
                        // The content is assumed to be the rest of the block after the type line
                        const content = lines.slice(typeLineIndex + 1).join('\n').trim();

                        if (content) {
                            entries.push({
                                timestamp,
                                type,
                                content,
                            });
                        }
                    }
                }
            } else {
                // Fallback: treat each non-empty line as a separate message
                console.log('🔍 parseLogContent: Using fallback parsing for plain text');
                const lines = content.split('\n').filter(line => line.trim());
                console.log('🔍 parseLogContent: Found', lines.length, 'non-empty lines:', lines);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line.startsWith('#')) { // Skip markdown headers
                        const entry = { 
                            timestamp: new Date().toISOString().split('T')[0], 
                            type: 'system' as LogEntry['type'], 
                            content: line.trim() 
                        };
                        console.log(`🔍 parseLogContent: Adding fallback entry ${i + 1}:`, entry);
                        entries.push(entry);
                    }
                }
            }
            console.log('🔍 parseLogContent: Final entries array length:', entries.length);
            console.log('🔍 parseLogContent: Final entries array:', JSON.stringify(entries, null, 2));
            return entries;
        } catch (error) {
            console.error('🔍 parseLogContent: Error parsing log content:', error);
            return [];
        }
    }
    
    stop() {
        if (this.logWatcher) {
            this.logWatcher.close();
        }
        if (this.wss) {
            this.wss.close();
        }
        if (this.server) {
            this.server.close();
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Extension activated!');
    const provider = new TaskSyncChatProvider(context.extensionUri);
    
    // Register the webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tasksyncChat', provider)
    );
    
    // Register command to open chat
    context.subscriptions.push(
        vscode.commands.registerCommand('tasksync.openChat', () => {
            const panel = vscode.window.createWebviewPanel(
                'tasksyncChat',
                'TaskSync Chat',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    enableCommandUris: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [context.extensionUri]
                }
            );
            
            panel.webview.html = provider.getWebviewContent(panel.webview);
            provider.setupWebviewMessageHandling(panel.webview);
        })
    );
}

class TaskSyncChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _ws?: any; // Browser WebSocket will be used in webview context
    private _logEntries: LogEntry[] = [];
    private _connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
    private _backend?: TaskSyncBackend;
    private _backendPort?: number;
    private _selectedFiles: string[] = [];
    
    constructor(private readonly _extensionUri: vscode.Uri) {
        console.log('🔧 TaskSyncChatProvider: Constructor called');
        this.initializeTaskSync();
    }
    
    private async initializeTaskSync() {
        console.log('🚀 TaskSyncChatProvider: initializeTaskSync started');
        await this.ensureTaskSyncStructure();
        console.log('📁 TaskSyncChatProvider: ensureTaskSyncStructure completed');
        await this.startBackend();
        console.log('⚡ TaskSyncChatProvider: startBackend completed');
        this.connectToBackend();
        console.log('🔗 TaskSyncChatProvider: connectToBackend completed');
        console.log('✅ TaskSyncChatProvider: initializeTaskSync finished');
    }
    
    private async startBackend() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.log('TaskSyncChatProvider: No workspace folder found');
            return;
        }
        
        console.log('TaskSyncChatProvider: Using workspace folder:', workspaceFolder.uri.fsPath);
        console.log('TaskSyncChatProvider: All workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));
        
        try {
            // Create backend with log update callback
            this._backend = new TaskSyncBackend(workspaceFolder.uri.fsPath, (newEntries: LogEntry[]) => {
                console.log(`🔍 onLogUpdate: Received ${newEntries.length} entries from backend`);
                console.log(`🔍 onLogUpdate: Current _logEntries count: ${this._logEntries.length}`);
                
                // Replace all entries instead of merging to avoid sync issues
                this._logEntries = [...newEntries];
                
                console.log(`🔍 onLogUpdate: Updated _logEntries count: ${this._logEntries.length}`);
                console.log(`🔍 onLogUpdate: Calling updateWebview`);
                this.updateWebview();
            });
            this._backendPort = await this._backend.start();
            console.log(`TaskSync backend started on port ${this._backendPort}`);
        } catch (error) {
            console.error('Error starting TaskSync backend:', error);
            vscode.window.showErrorMessage(`Failed to start TaskSync backend: ${error}`);
        }
    }
    
    private async ensureTaskSyncStructure(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('No workspace folder found. Please open a folder to use TaskSync.');
            return;
        }

        const tasksyncDir = path.join(workspaceFolder.uri.fsPath, 'tasksync');
        const tasksPath = path.join(tasksyncDir, 'tasks.md');
        const logPath = path.join(tasksyncDir, 'log.md');

        try {
            // Create tasksync directory if it doesn't exist
            if (!fs.existsSync(tasksyncDir)) {
                fs.mkdirSync(tasksyncDir, { recursive: true });
                vscode.window.showInformationMessage('Created tasksync directory structure.');
            }

            // Create tasks.md if it doesn't exist (empty file)
            if (!fs.existsSync(tasksPath)) {
                await fs.promises.writeFile(tasksPath, '', 'utf8');
                vscode.window.showInformationMessage('Created tasks.md file.');
            }

            // Create log.md if it doesn't exist
            if (!fs.existsSync(logPath)) {
                const logContent = `# TaskSync Log\n\nThis file contains the activity log for TaskSync.\n\n`;
                await fs.promises.writeFile(logPath, logContent, 'utf8');
                vscode.window.showInformationMessage('Created log.md file.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error creating TaskSync structure: ${error}`);
        }
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('🖥️ TaskSyncChatProvider: resolveWebviewView called');
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: [this._extensionUri]
        };
        
        console.log('📄 TaskSyncChatProvider: Setting webview HTML content');
        webviewView.webview.html = this.getWebviewContent(webviewView.webview);
        console.log('🔧 TaskSyncChatProvider: Setting up webview message handling');
        this.setupWebviewMessageHandling(webviewView.webview);
        console.log('✅ TaskSyncChatProvider: resolveWebviewView completed');
    }
    
    public setupWebviewMessageHandling(webview: vscode.Webview) {
        webview.onDidReceiveMessage(async (message) => {
            console.log('🔍 DEBUG: Message received in setupWebviewMessageHandling:', message);
            console.log('🔍 DEBUG: Message command:', message.command);
            console.log('🔍 DEBUG: Message data:', message.data);
            
            switch (message.command) {
                case 'submitTask':
                    console.log('🔍 DEBUG: Calling handleTaskSubmission from message handler');
                    await this.handleTaskSubmission(message.data);
                    break;
                case 'clearLog':
                    console.log('🔍 DEBUG: Calling clearLog from message handler');
                    await this.clearLog();
                    break;
                case 'getInitialData':
                    console.log('🔍 DEBUG: Calling sendInitialData from message handler');
                    this.sendInitialData(webview);
                    break;
                case 'showFileSelector':
                    console.log('🔍 DEBUG: Calling showFileSelector from message handler');
                    await this.showFileSelector(webview);
                    break;
                case 'openCopilotChat':
                    console.log('🔍 DEBUG: Calling openCopilotChat from message handler');
                    await this.openCopilotChat(message.data.prompt);
                    break;
                case 'extractUrlData':
                    console.log('🔍 DEBUG: Calling extractUrlData from message handler');
                    await this.extractUrlData(message.data.url, webview);
                    break;
                default:
                    console.log('🔍 DEBUG: Unknown command received:', message.command);
            }
        });
    }
    
    private async handleTaskSubmission(data: TaskSubmission) {
        console.log('🔍 DEBUG: handleTaskSubmission called with data:', data);
        if (!this._view) {
            console.log('🔍 DEBUG: No view available, returning');
            return;
        }

        const userEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            type: 'user',
            content: data.task,
            category: data.category,
        };

        this._logEntries.push(userEntry);
        this.updateWebview(); // Update UI immediately

        // Acknowledge receipt to re-enable UI
        this._view.webview.postMessage({ command: 'taskReceived' });

        try {
            console.log('🔍 DEBUG: Checking _selectedFiles.length:', this._selectedFiles.length);
            console.log('🔍 DEBUG: _selectedFiles contents:', this._selectedFiles);
            
            // First, submit to backend to create/update tasks.md
            console.log('🔍 DEBUG: About to call backend.handleTaskSubmission');
            if (this._backend) {
                await this._backend.handleTaskSubmission(data);
                console.log('🔍 DEBUG: backend.handleTaskSubmission completed');
            } else {
                console.error('TaskSyncChatProvider: Backend not available!');
                vscode.window.showWarningMessage('Backend not available. Please restart the extension.');
                return;
            }
            
            // Then, if there are selected files, add them to tasks.md AFTER backend submission
            if (this._selectedFiles.length > 0) {
                console.log('🔍 DEBUG: Processing selected files...');
                const fileCount = this._selectedFiles.length;
                console.log('🔍 DEBUG: About to call handleFileReferences with:', this._selectedFiles);
                await this.handleFileReferences(this._selectedFiles);
                console.log('🔍 DEBUG: handleFileReferences completed');
                
                // Clear selected files after writing to tasks.md
                this._selectedFiles = [];
                console.log('🔍 DEBUG: _selectedFiles cleared');
                
                // Notify webview that files were added to tasks.md
                this._view.webview.postMessage({
                    command: 'fileReferencesAdded',
                    count: fileCount
                });
                console.log('🔍 DEBUG: fileReferencesAdded message sent to webview');
            } else {
                console.log('🔍 DEBUG: No selected files to process');
            }
        } catch (error) {
            console.error('🔍 DEBUG: Error in handleTaskSubmission:', error);
            console.error('TaskSyncChatProvider: Error in handleTaskSubmission:', error);
            vscode.window.showErrorMessage(`Error submitting task: ${error}`);
        }
    }
    
    private async clearLog() {
        this._logEntries = [];
        this.updateWebview();
        
        // Ensure directory structure exists
        await this.ensureTaskSyncStructure();
        
        // Clear log file
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const logPath = path.join(workspaceFolder.uri.fsPath, 'tasksync', 'log.md');
            try {
                await fs.promises.writeFile(logPath, '# TaskSync Log\n\nThis file contains the activity log for TaskSync.\n\n');
            } catch (error) {
                console.error('Error clearing log file:', error);
            }
        }
    }
    
    private connectToBackend() {
        console.log('🔗 TaskSyncChatProvider: connectToBackend called');
        // Direct backend connection - no WebSocket needed
        if (this._backend) {
            console.log('✅ TaskSyncChatProvider: Backend available, parsing log content');
            this._connectionStatus = 'connected';
            // Load initial log entries
            this._logEntries = this._backend.parseLogContent();
            console.log(`📊 TaskSyncChatProvider: Parsed ${this._logEntries.length} log entries:`, this._logEntries);
        } else {
            console.log('❌ TaskSyncChatProvider: Backend not available');
            this._connectionStatus = 'disconnected';
        }
        console.log('📤 TaskSyncChatProvider: Calling updateWebview from connectToBackend');
        this.updateWebview();
    }
    

    
    private sendInitialData(webview: vscode.Webview) {
        console.log('📤 TaskSyncChatProvider: sendInitialData called');
        console.log(`📊 TaskSyncChatProvider: Sending ${this._logEntries.length} log entries to webview:`, this._logEntries);
        console.log(`🔗 TaskSyncChatProvider: Connection status: ${this._connectionStatus}`);
        webview.postMessage({
            command: 'initialData',
            data: {
                logEntries: this._logEntries,
                connectionStatus: this._connectionStatus
            }
        });
        console.log('✅ TaskSyncChatProvider: initialData message sent to webview');
    }
    
    private async writeToLogFile(entry: LogEntry) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        
        const logPath = path.join(workspaceFolder.uri.fsPath, 'tasksync', 'log.md');
        
        try {
            const timestamp = new Date().toLocaleString();
            const logEntry = `\n## ${timestamp}\n\n**Type:** ${entry.type}\n**Task:** ${entry.content}\n**Category:** ${entry.category}\n\n`;
            
            await fs.promises.appendFile(logPath, logEntry, 'utf8');
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }
    
    private updateWebview() {
        console.log(`🔍 updateWebview: Called with ${this._logEntries.length} entries`);
        console.log(`🔍 updateWebview: Connection status: ${this._connectionStatus}`);
        if (this._view) {
            console.log(`🔍 updateWebview: Sending updateData message to webview`);
            this._view.webview.postMessage({
                command: 'updateData',
                data: {
                    logEntries: this._logEntries,
                    connectionStatus: this._connectionStatus
                }
            });
            console.log(`🔍 updateWebview: Message sent successfully`);
        } else {
            console.log(`🔍 updateWebview: No webview available`);
        }
    }
    
    private async openCopilotChat(prompt: string) {
        try {
            console.log('🤖 TaskSyncChatProvider: Opening Copilot Chat with prompt');
            // Execute VS Code command to open Copilot Chat with the prompt
            await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
            console.log('✅ TaskSyncChatProvider: Copilot Chat opened successfully');
        } catch (error) {
            console.error('❌ TaskSyncChatProvider: Error opening Copilot Chat:', error);
            vscode.window.showErrorMessage(`Failed to open Copilot Chat: ${error}`);
        }
    }

    private async handleFileReferences(filePaths: string[]) {
        console.log('🔍 DEBUG: handleFileReferences called with filePaths:', filePaths);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('🔍 DEBUG: No workspace folder found');
                vscode.window.showWarningMessage('No workspace folder found');
                return;
            }
            
            const tasksPath = path.join(workspaceFolder.uri.fsPath, 'tasksync', 'tasks.md');
            console.log('🔍 DEBUG: tasksPath:', tasksPath);
            
            // Read current tasks.md content
            let currentContent = '';
            try {
                currentContent = await fs.promises.readFile(tasksPath, 'utf8');
                console.log('🔍 DEBUG: Read existing tasks.md content, length:', currentContent.length);
            } catch (error) {
                // File doesn't exist, start with empty content
                console.log('🔍 DEBUG: tasks.md does not exist, will create new file');
            }
            
            // Check if file references section already exists
            let updatedContent: string;
            if (currentContent.includes('# File reference:')) {
                console.log('🔍 DEBUG: File reference section exists, replacing');
                // Replace existing file references
                const lines = currentContent.split('\n');
                const fileRefIndex = lines.findIndex(line => line.trim() === '# File reference:');
                
                if (fileRefIndex !== -1) {
                    // Remove existing file references (everything after "# File reference:")
                    const beforeFileRef = lines.slice(0, fileRefIndex).join('\n');
                    updatedContent = beforeFileRef + '\n\n# File reference:\n';
                    filePaths.forEach(filePath => {
                        updatedContent += `${filePath}\n`;
                    });
                } else {
                    // Shouldn't happen, but fallback
                    console.log('🔍 DEBUG: File reference section found but index not found, using fallback');
                    updatedContent = currentContent + '\n\n# File reference:\n';
                    filePaths.forEach(filePath => {
                        updatedContent += `${filePath}\n`;
                    });
                }
            } else {
                console.log('🔍 DEBUG: No file reference section exists, adding new');
                // Add new file references section
                updatedContent = currentContent + '\n\n# File reference:\n';
                filePaths.forEach(filePath => {
                    updatedContent += `${filePath}\n`;
                });
            }
            
            console.log('🔍 DEBUG: About to write to tasks.md, updatedContent length:', updatedContent.length);
            // Write updated content to tasks.md
            await fs.promises.writeFile(tasksPath, updatedContent, 'utf8');
            console.log('🔍 DEBUG: Successfully wrote to tasks.md');
            
            console.log(`🔍 DEBUG: Added ${filePaths.length} file references to tasks.md:`, filePaths);
            vscode.window.showInformationMessage(`Added ${filePaths.length} file reference(s) to tasks.md`);
            
        } catch (error) {
            console.error('🔍 DEBUG: Error in handleFileReferences:', error);
            console.error('Error handling file references:', error);
            vscode.window.showErrorMessage(`Error adding file references: ${error}`);
        }
    }

    private async showFileSelector(webview: vscode.Webview) {
        console.log('🔍 DEBUG: showFileSelector called');
        console.log('🔍 DEBUG: Current _selectedFiles before selection:', this._selectedFiles);
        console.log('🔍 DEBUG: Current _selectedFiles.length before selection:', this._selectedFiles.length);
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.log('🔍 DEBUG: No workspace folder found in showFileSelector');
            vscode.window.showWarningMessage('No workspace folder found');
            return;
        }
        console.log('🔍 DEBUG: Workspace folder found:', workspaceFolder.uri.fsPath);
        
        try {
            // Get all files and directories in the workspace
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 500);
            
            // Get directories by checking parent directories of files
            const directories = new Set<string>();
            files.forEach(file => {
                const relativePath = vscode.workspace.asRelativePath(file);
                const pathParts = relativePath.split(path.sep);
                for (let i = 1; i < pathParts.length; i++) {
                    const dirPath = pathParts.slice(0, i).join(path.sep);
                    directories.add(dirPath);
                }
            });
            
            // Create quick pick items with relative paths
            const quickPickItems: vscode.QuickPickItem[] = [];
            
            // Add directories first
            Array.from(directories).sort().forEach(dir => {
                quickPickItems.push({
                    label: `${dir}/`,
                    description: 'Directory',
                    detail: path.join(workspaceFolder.uri.fsPath, dir)
                });
            });
            
            // Add files
            files.forEach(file => {
                const relativePath = vscode.workspace.asRelativePath(file);
                quickPickItems.push({
                    label: relativePath,
                    description: 'File',
                    detail: file.fsPath
                });
            });
            
            if (quickPickItems.length === 0) {
                vscode.window.showInformationMessage('No files found in workspace');
                return;
            }
            
            // Show multi-select quick pick dialog
            const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select files and folders to reference in your task (use Ctrl/Cmd to select multiple)',
                matchOnDescription: true,
                canPickMany: true
            });
            
            if (selectedItems && selectedItems.length > 0) {
                // Store selected files temporarily - they will be written to tasks.md when user submits
                this._selectedFiles = selectedItems.map(item => item.label);
                console.log('🔍 DEBUG: Files stored in _selectedFiles:', this._selectedFiles);
                console.log('🔍 DEBUG: _selectedFiles.length:', this._selectedFiles.length);
                
                // Notify webview that files were selected
                webview.postMessage({
                    command: 'filesSelected',
                    count: selectedItems.length,
                    files: this._selectedFiles
                });
                console.log('🔍 DEBUG: filesSelected message sent to webview');
            } else {
                console.log('🔍 DEBUG: No files selected or selection cancelled');
            }
        } catch (error) {
            console.error('🔍 DEBUG: Error in showFileSelector:', error);
            vscode.window.showErrorMessage(`Error loading files: ${error}`);
        }
    }

    private async extractUrlData(url: string, webview: vscode.Webview) {
        console.log('🔍 DEBUG: extractUrlData called with URL:', url);
        
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            vscode.window.showErrorMessage('Invalid URL. Please provide a valid HTTP or HTTPS URL.');
            webview.postMessage({
                command: 'urlExtractionComplete',
                success: false,
                error: 'Invalid URL format'
            });
            return;
        }

        try {
            // Show progress notification
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Extracting data from ${url}...`,
                cancellable: false
            }, async () => {
                const data = await this.fetchUrlData(url);
                
                // Create a log entry for the extracted data
                const extractedEntry: LogEntry = {
                    timestamp: new Date().toISOString(),
                    type: 'system',
                    content: `Successfully extracted data from: ${url}\n\nData Preview:\n${data.substring(0, 500)}${data.length > 500 ? '...' : ''}\n\nTotal length: ${data.length} characters`
                };
                
                this._logEntries.push(extractedEntry);
                this.updateWebview();
                
                // Save the full extracted data to a file
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const extractedDataPath = path.join(workspaceFolder.uri.fsPath, 'tasksync', 'extracted-data.txt');
                    await fs.promises.writeFile(extractedDataPath, data, 'utf8');
                    
                    // Also write to log.md
                    const logPath = path.join(workspaceFolder.uri.fsPath, 'tasksync', 'log.md');
                    const logEntry = `\n\n---\n**[${new Date().toISOString()}] URL Data Extraction**\n\nExtracted from: ${url}\n\nData saved to: tasksync/extracted-data.txt\nTotal size: ${data.length} characters\n\nPreview:\n\`\`\`\n${data.substring(0, 1000)}${data.length > 1000 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
                    await fs.promises.appendFile(logPath, logEntry, 'utf8');
                    
                    vscode.window.showInformationMessage(`Data extracted successfully! Saved to: tasksync/extracted-data.txt`);
                }
                
                webview.postMessage({
                    command: 'urlExtractionComplete',
                    success: true,
                    data: data
                });
            });
        } catch (error) {
            console.error('🔍 DEBUG: Error in extractUrlData:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to extract data: ${errorMessage}`);
            
            webview.postMessage({
                command: 'urlExtractionComplete',
                success: false,
                error: errorMessage
            });
        }
    }

    private async fetchUrlData(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https://') ? https : http;
            
            const request = protocol.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }, (response) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    if (response.headers.location) {
                        console.log('Following redirect to:', response.headers.location);
                        this.fetchUrlData(response.headers.location).then(resolve).catch(reject);
                        return;
                    }
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                let data = '';
                response.on('data', (chunk) => {
                    data += chunk.toString();
                });

                response.on('end', () => {
                    resolve(data);
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
    

    
    public getWebviewContent(webview: vscode.Webview): string {

        // Get the URI for the external JavaScript file
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview.js')
        );
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TaskSync Chat</title>
    <style>
        :root {
            /* Colors */
            --primary-50: #f0f9ff;
            --primary-100: #e0f2fe;
            --primary-200: #bae6fd;
            --primary-300: #7dd3fc;
            --primary-400: #38bdf8;
            --primary-500: #0ea5e9;
            --primary-600: #0284c7;
            --primary-700: #0369a1;
            --primary-800: #075985;
            --primary-900: #0c4a6e;
            
            --gray-50: #f9fafb;
            --gray-100: #f3f4f6;
            --gray-200: #e5e7eb;
            --gray-300: #d1d5db;
            --gray-400: #9ca3af;
            --gray-500: #6b7280;
            --gray-600: #4b5563;
            --gray-700: #374151;
            --gray-800: #1f2937;
            --gray-900: #111827;
            
            /* Surfaces */
            --surface-primary: #0f172a;
            --surface-secondary: #1e293b;
            --surface-tertiary: #334155;
            --surface-elevated: #475569;
            --surface-overlay: rgba(15, 23, 42, 0.95);
            
            /* Status */
            --status-success: #10b981;
            --status-warning: #f59e0b;
            --status-error: #ef4444;
            --status-info: #3b82f6;
            
            /* Interactive */
            --interactive-primary: var(--primary-500);
            --interactive-primary-hover: var(--primary-600);
            --interactive-secondary: var(--surface-tertiary);
            --interactive-secondary-hover: var(--surface-elevated);
            
            /* Text */
            --text-primary: #f8fafc;
            --text-secondary: #cbd5e1;
            --text-tertiary: #94a3b8;
            --text-inverse: var(--gray-900);
            
            /* Borders */
            --border-primary: var(--surface-tertiary);
            --border-secondary: var(--surface-elevated);
            --border-focus: var(--primary-500);
            
            /* Elevation System - Material Design Inspired */
            --elevation-0: none;
            --elevation-1: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
            --elevation-2: 0 3px 6px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.23);
            --elevation-3: 0 10px 20px rgba(0, 0, 0, 0.19), 0 6px 6px rgba(0, 0, 0, 0.23);
            --elevation-4: 0 14px 28px rgba(0, 0, 0, 0.25), 0 10px 10px rgba(0, 0, 0, 0.22);
            --elevation-5: 0 19px 38px rgba(0, 0, 0, 0.30), 0 15px 12px rgba(0, 0, 0, 0.22);
            
            /* Legacy shadow variables for compatibility */
            --shadow-sm: var(--elevation-1);
            --shadow-md: var(--elevation-2);
            --shadow-lg: var(--elevation-3);
            --shadow-xl: var(--elevation-4);
            
            /* Gradients */
            --gradient-primary: linear-gradient(135deg, var(--primary-600) 0%, var(--primary-700) 100%);
            --gradient-surface: linear-gradient(135deg, var(--surface-secondary) 0%, var(--surface-tertiary) 100%);
            
            /* Typography */
            --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            --font-family-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
            
            /* Responsive Breakpoints - Mobile First */
            --breakpoint-sm: 640px;
            --breakpoint-md: 768px;
            --breakpoint-lg: 1024px;
            --breakpoint-xl: 1280px;
            
            /* Modular Spacing Scale - 8pt Grid System */
            --space-0: 0;
            --space-1: 0.25rem;    /* 4px */
            --space-2: 0.5rem;     /* 8px */
            --space-3: 0.75rem;    /* 12px */
            --space-4: 1rem;       /* 16px - Base unit */
            --space-5: 1.25rem;    /* 20px */
            --space-6: 1.5rem;     /* 24px */
            --space-8: 2rem;       /* 32px */
            --space-10: 2.5rem;    /* 40px */
            --space-12: 3rem;      /* 48px */
            --space-16: 4rem;      /* 64px */
            --space-20: 5rem;      /* 80px */
            
            /* Typography Scale - Perfect Fourth (1.333) */
            --text-xs: 0.75rem;     /* 12px */
            --text-sm: 0.875rem;    /* 14px */
            --text-base: 1rem;      /* 16px - Base */
            --text-lg: 1.125rem;    /* 18px */
            --text-xl: 1.25rem;     /* 20px */
            --text-2xl: 1.5rem;     /* 24px */
            --text-3xl: 1.875rem;   /* 30px */
            --text-4xl: 2.25rem;    /* 36px */
            
            /* Line Heights - Optimal Readability */
            --leading-none: 1;
            --leading-tight: 1.25;
            --leading-snug: 1.375;
            --leading-normal: 1.5;
            --leading-relaxed: 1.625;
            --leading-loose: 2;
            
            /* Border Radius - Consistent Rounding */
            --radius-none: 0;
            --radius-sm: 0.375rem;
            --radius-md: 0.5rem;
            --radius-lg: 0.75rem;
            --radius-xl: 1rem;
            --radius-2xl: 1.5rem;
            --radius-full: 9999px;
            
            /* Transitions - Performance Optimized */
            --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-bounce: 500ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
            
            /* Touch Targets - WCAG AA Compliance */
            --touch-target: 44px;     /* Minimum for accessibility */
            --touch-target-sm: 36px;  /* Small but still accessible */
            --touch-target-lg: 48px;  /* Comfortable for all users */
            
            /* Z-Index Scale - Consistent Layering */
            --z-base: 0;
            --z-dropdown: 10;
            --z-sticky: 20;
            --z-fixed: 30;
            --z-modal: 40;
            --z-popover: 50;
            --z-tooltip: 60;
            --z-toast: 70;
            
            /* Focus Ring - Accessibility */
            --focus-ring: 0 0 0 3px rgba(14, 165, 233, 0.2);
            --focus-ring-offset: 2px;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            height: 100vh;
            display: flex;
            flex-direction: column;
            line-height: 1.5;
            font-size: 14px;
        }
        
        .header {
            background: #2d2d2d;
            border-bottom: 1px solid #333333;
            padding: 16px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
            position: sticky;
            top: 0;
            z-index: 50;
        }
        
        .header h1 {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
            color: #ffffff;
            text-transform: uppercase;
        }
        
        .reload-btn {
            background-color: #007aff;
            border: none;
            border-radius: 6px;
            color: white;
            cursor: pointer;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .reload-btn:hover {
            background-color: #0056b3;
        }
        
        .reload-btn svg {
            width: 16px;
            height: 16px;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            min-height: 0;
            position: relative;
            box-sizing: border-box;
        }
        

        
        .messages {
            flex: 1;
            padding: 8px 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
            overflow-y: auto;
            max-height: calc(100vh - 120px);
        }
        
        /* Modern, thin, and auto-hiding scrollbar */
        .messages::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        .messages::-webkit-scrollbar-track {
            background: transparent; /* Ensure track is invisible */
        }

        .messages::-webkit-scrollbar-thumb {
            background-color: transparent; /* Fully transparent by default */
            border-radius: 4px;
            border: 2px solid transparent;
            background-clip: content-box;
            transition: background-color 0.3s ease-in-out;
        }

        .messages:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.5); /* Visible on hover */
        }

        .messages {
            scrollbar-width: thin;
            scrollbar-color: transparent transparent; /* Fully transparent by default for Firefox */
        }

        .messages:hover {
            scrollbar-color: rgba(255, 255, 255, 0.5) transparent; /* Visible on hover for Firefox */
        }
        
        /* Responsive Utilities */
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
        
        .truncate {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .break-words {
            overflow-wrap: break-word;
            word-break: break-word;
        }
        
        /* Mobile-specific utilities */
        @media (max-width: 639px) {
            .hidden-mobile {
                display: none !important;
            }
            
            .text-mobile-center {
                text-align: center;
            }
        }
        
        /* Tablet and up utilities */
        @media (min-width: 640px) {
            .hidden-tablet {
                display: none !important;
            }
        }
        
        /* Desktop utilities */
        @media (min-width: 1024px) {
            .hidden-desktop {
                display: none !important;
            }
        }
        
        /* Animations */
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }
        
        @keyframes slideInFromRight {
            from {
                opacity: 0;
                transform: translateX(20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes slideInFromLeft {
            from {
                opacity: 0;
                transform: translateX(-20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        /* Reduced motion preferences */
        @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        }
        
        /* High contrast mode support */
        @media (prefers-contrast: high) {
            .message-bubble {
                border: 2px solid;
            }
            
            .btn {
                border: 2px solid;
            }
            
            .input-field {
                border: 2px solid;
            }
        }
        
        .message {
            display: flex;
            flex-direction: column;
            margin-bottom: 16px;
            animation: slideInFromLeft 0.3s ease-out;
        }
        
        .message.user {
            align-items: flex-end;
            animation: slideInFromRight 0.3s ease-out;
        }
        
        .message.ai,
        .message.system,
        .message-system {
            align-items: flex-start;
        }
        
        .message-bubble {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
            line-height: 1.4;
        }
        
        .message.user .message-bubble {
            background: var(--interactive-primary);
            color: var(--text-primary);
            border-bottom-right-radius: 4px;
        }
        
        .message.ai .message-bubble,
        .message.log-message .message-bubble,
        .message.system .message-bubble,
        .message-system .message-bubble {
            background: var(--surface-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-primary);
            border-bottom-left-radius: 4px;
        }
        
        .message-content {
            margin: 0;
            font-size: 14px;
        }
        

        
        .input-container {
            display: flex;
            flex-direction: column;
            padding: 12px;
            border: 1px solid #3a3a3a;
            background-color: #2a2a2a;
            border-radius: 6px;
            position: sticky;
            bottom: 10px;
            margin: 0 0 10px 0;
        }
        
        /* Responsive design */
        @media (max-width: 600px) {
            .input-container {
                padding: 6px 8px;
                margin: 0;
            }
            .input-bar {
                padding: 4px 6px;
                gap: 4px;
                min-height: 32px;
            }
            .chat-container {
                padding: 2px 0;
            }
            .messages {
                padding: 2px 0;
                gap: 4px;
            }
            .message-bubble {
                max-width: 95%;
            }
            .header {
                padding: 12px 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .header h1 {
                font-size: 16px;
                margin: 0;
            }
            .reload-btn {
                background-color: #007aff;
                border: none;
                border-radius: 6px;
                color: white;
                cursor: pointer;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 500;
                transition: background-color 0.2s;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .reload-btn:hover {
                background-color: #0056b3;
            }
            .reload-btn svg {
                width: 14px;
                height: 14px;
            }
            .category-dropdown {
                 font-size: 11px;
                 padding: 3px 4px;
                 min-width: 50px;
                 height: 22px;
             }
        }

        .category-selector {
            display: flex;
            align-items: center;
            flex-shrink: 0;
            margin-right: 8px;
        }

        .category-dropdown {
            -webkit-appearance: none;
            appearance: none;
            background-color: transparent;
            border: none;
            color: #888888;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            padding: 0 4px 0 0;
            margin: 0;
            text-align: right;
            direction: rtl;
        }

        .input-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .actions-left, .actions-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .icon {
            color: #888888;
            cursor: pointer;
            padding: 2px;
            margin: 0;
            transition: color 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border-radius: 3px;
        }
        
        .icon:hover {
            color: #ffffff;
        }

        #submitBtn {
            background-color: #007aff;
            color: white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #submitBtn:hover {
            background-color: #0056b3;
        }



        .task-input {
            flex-grow: 1;
            border: none;
            background-color: transparent;
            color: #ffffff;
            padding: 5px;
            resize: none;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            margin-bottom: 8px;
        }

        .task-input::placeholder {
            color: #888888;
        }

        .task-input:focus {
            outline: none;
        }
        
        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 32px;
            color: #888888;
        }
        
        .empty-state h3 {
            margin: 0 0 8px 0;
            font-size: 18px;
            font-weight: 600;
            color: #ffffff;
        }
        
        .empty-state p {
            margin: 0;
            font-size: 14px;
            max-width: 400px;
        }
        
        #fileDisplay {
            display: none;
            margin: 0 12px 8px 12px;
            padding: 8px;
            background-color: #2a2a2a;
            border-radius: 8px;
            border: 1px solid #3a3a3a;
        }
        
        .file-tag {
            display: inline-block;
            background-color: #007aff;
            color: white;
            padding: 4px 8px;
            margin: 2px;
            border-radius: 12px;
            font-size: 12px;
        }
        
        .file-tag button {
            background: none;
            border: none;
            color: white;
            margin-left: 4px;
            cursor: pointer;
            font-size: 14px;
            padding: 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>tasksync</h1>
        <button class="reload-btn" id="reloadBtn" title="Copilot">
            <svg viewBox="0 0 512 416" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><path d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z" fill-rule="nonzero"/><path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/></svg>
        </button>
    </div>
    
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="empty-state">
                <h3>Welcome to TaskSync</h3>
                <p>Submit your first task below to get started</p>
            </div>
        </div>
    </div>
    
    <div class="input-container">
        <div id="fileDisplay"></div>
        <textarea id="taskInput" class="task-input" placeholder="What would you like me to help you with?" rows="1"></textarea>
        <div class="input-actions">
            <div class="actions-left">
                <div class="icon" id="fileIcon" title="Attach File">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                </div>
                <div class="icon" id="urlIcon" title="Extract URL Data">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                </div>
            </div>
            <div class="actions-right">
                <div class="category-selector">
                    <select class="category-dropdown" id="categorySelect">
                        <option value="Task">Task</option>
                        <option value="Bug">Bug</option>
                        <option value="Feature">Feature</option>
                        <option value="Research">Research</option>
                        <option value="Documentation">Documentation</option>
                        <option value="Meeting">Meeting</option>
                        <option value="Review">Review</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div class="icon" id="submitBtn" title="Send Message">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const copilotPromptContent = ${JSON.stringify(copilotPrompt)};
    </script>
    <script src="${scriptUri}"></script>

</body>
</html>`;
    }
}

export function deactivate() {
    // Extension cleanup if needed
}