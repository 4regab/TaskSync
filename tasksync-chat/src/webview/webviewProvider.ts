import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Queued prompt interface
export interface QueuedPrompt {
    id: string;
    prompt: string;
    createdAt: number;
}

// Attachment info
export interface AttachmentInfo {
    id: string;
    name: string;
    uri: string;
    isTemporary?: boolean;
    isFolder?: boolean;
    isTextReference?: boolean;
}

// File search result
export interface FileSearchResult {
    name: string;
    path: string;
    uri: string;
    icon: string;
    isFolder?: boolean;
}

// User response result
export interface UserResponseResult {
    value: string;
    queue: boolean;
    attachments: AttachmentInfo[];
}

// Tool call history entry
export interface ToolCallEntry {
    id: string;
    prompt: string;
    response: string;
    timestamp: number;
    isFromQueue: boolean;
    status: 'pending' | 'completed';
    sessionId?: string; // Track which session this belongs to
}

// Message types
type ToWebviewMessage =
    | { type: 'updateQueue'; queue: QueuedPrompt[]; enabled: boolean }
    | { type: 'systemMessage'; text: string }
    | { type: 'toolCallPending'; id: string; prompt: string }
    | { type: 'toolCallCompleted'; entry: ToolCallEntry }
    | { type: 'updateCurrentSession'; history: ToolCallEntry[] }
    | { type: 'updatePersistedHistory'; history: ToolCallEntry[] }
    | { type: 'fileSearchResults'; files: FileSearchResult[] }
    | { type: 'updateAttachments'; attachments: AttachmentInfo[] }
    | { type: 'imageSaved'; attachment: AttachmentInfo }
    | { type: 'clear' };

type FromWebviewMessage =
    | { type: 'submit'; value: string; attachments: AttachmentInfo[] }
    | { type: 'addQueuePrompt'; prompt: string; id: string }
    | { type: 'removeQueuePrompt'; promptId: string }
    | { type: 'editQueuePrompt'; promptId: string; newPrompt: string }
    | { type: 'reorderQueue'; fromIndex: number; toIndex: number }
    | { type: 'toggleQueue'; enabled: boolean }
    | { type: 'clearQueue' }
    | { type: 'addAttachment' }
    | { type: 'removeAttachment'; attachmentId: string }
    | { type: 'removeHistoryItem'; callId: string }
    | { type: 'clearPersistedHistory' }
    | { type: 'openHistoryModal' }
    | { type: 'searchFiles'; query: string }
    | { type: 'saveImage'; data: string; mimeType: string }
    | { type: 'addFileReference'; file: FileSearchResult }
    | { type: 'webviewReady' };

export class TaskSyncWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'taskSyncView';
    
    private _view?: vscode.WebviewView;
    private _pendingRequests: Map<string, (result: UserResponseResult) => void> = new Map();
    
    // Prompt queue state
    private _promptQueue: QueuedPrompt[] = [];
    private _queueEnabled: boolean = true; // Default to queue mode
    
    // Attachments state
    private _attachments: AttachmentInfo[] = [];
    
    // Current session tool calls (memory only - not persisted during session)
    private _currentSessionCalls: ToolCallEntry[] = [];
    // Map for O(1) lookup by ID
    private _currentSessionCallsMap: Map<string, ToolCallEntry> = new Map();
    // Persisted history from past sessions (loaded from disk)
    private _persistedHistory: ToolCallEntry[] = [];
    private _currentToolCallId: string | null = null;
    // Session ID to track current session
    private _sessionId: string = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Webview ready state - prevents race condition on first message
    private _webviewReady: boolean = false;
    private _pendingToolCallMessage: { id: string; prompt: string } | null = null;
    
    // Debounce timer for queue persistence
    private _queueSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _QUEUE_SAVE_DEBOUNCE_MS = 300;
    
    // Performance limits
    private readonly _MAX_HISTORY_ENTRIES = 100;
    private readonly _MAX_FILE_SEARCH_RESULTS = 500;
    
    // File search cache with TTL
    private _fileSearchCache: Map<string, { results: FileSearchResult[], timestamp: number }> = new Map();
    private readonly _FILE_CACHE_TTL_MS = 5000;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        // Load both queue and history async to not block activation
        this._loadQueueFromDiskAsync().catch(err => {
            console.error('Failed to load queue:', err);
        });
        this._loadPersistedHistoryFromDiskAsync().catch(err => {
            console.error('Failed to load history:', err);
        });
    }

    /**
     * Save current session to persisted history (called on deactivate)
     */
    public saveSessionToHistory(): void {
        // Only save completed calls from current session
        const completedCalls = this._currentSessionCalls.filter(tc => tc.status === 'completed');
        if (completedCalls.length > 0) {
            // Prepend current session calls to persisted history, enforce max limit
            this._persistedHistory = [...completedCalls, ...this._persistedHistory].slice(0, this._MAX_HISTORY_ENTRIES);
            this._savePersistedHistoryToDisk();
        }
    }

    /**
     * Open history modal (called from view title bar button)
     */
    public openHistoryModal(): void {
        this._view?.webview.postMessage({ type: 'openHistoryModal' });
        this._updatePersistedHistoryUI();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        this._webviewReady = false; // Reset ready state when view is resolved

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (message: FromWebviewMessage) => this._handleWebviewMessage(message),
            undefined,
            []
        );

        // Don't send initial state here - wait for webviewReady message
        // This prevents race condition where messages are sent before JS is initialized
    }

    /**
     * Wait for user response
     */
    public async waitForUserResponse(question: string): Promise<UserResponseResult> {
        if (!this._view) {
            throw new Error('Webview not visible');
        }

        const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        this._currentToolCallId = toolCallId;

        // Check if queue is enabled and has prompts - auto-respond
        if (this._queueEnabled && this._promptQueue.length > 0) {
            const queuedPrompt = this._promptQueue.shift();
            if (queuedPrompt) {
                this._saveQueueToDisk();
                this._updateQueueUI();
                
                // Create completed tool call entry for queue response
                const entry: ToolCallEntry = {
                    id: toolCallId,
                    prompt: question,
                    response: queuedPrompt.prompt,
                    timestamp: Date.now(),
                    isFromQueue: true,
                    status: 'completed',
                    sessionId: this._sessionId
                };
                this._currentSessionCalls.unshift(entry);
                this._currentSessionCallsMap.set(entry.id, entry); // BUG FIX: Add to Map for O(1) lookup
                this._updateCurrentSessionUI();
                this._currentToolCallId = null;
                
                return {
                    value: queuedPrompt.prompt,
                    queue: true,
                    attachments: []
                };
            }
        }

        this._view.show(true);
        
        // Add pending entry to current session (so we have the prompt when completing)
        const pendingEntry: ToolCallEntry = {
            id: toolCallId,
            prompt: question,
            response: '',
            timestamp: Date.now(),
            isFromQueue: false,
            status: 'pending',
            sessionId: this._sessionId
        };
        this._currentSessionCalls.unshift(pendingEntry);
        this._currentSessionCallsMap.set(toolCallId, pendingEntry); // O(1) lookup
        
        // Send pending tool call to webview (or queue if not ready)
        if (this._webviewReady) {
            this._view.webview.postMessage({ 
                type: 'toolCallPending', 
                id: toolCallId,
                prompt: question 
            });
        } else {
            // Webview JS not initialized yet - queue the message
            this._pendingToolCallMessage = { id: toolCallId, prompt: question };
        }
        this._updateCurrentSessionUI();

        return new Promise<UserResponseResult>((resolve) => {
            this._pendingRequests.set(toolCallId, resolve);
        });
    }

    /**
     * Get the prompt queue
     */
    public getPromptQueue(): QueuedPrompt[] {
        return [...this._promptQueue];
    }

    /**
     * Check if queue is enabled
     */
    public isQueueEnabled(): boolean {
        return this._queueEnabled;
    }

    /**
     * Consume next prompt from queue
     */
    public consumeNextPrompt(): QueuedPrompt | undefined {
        if (!this._queueEnabled || this._promptQueue.length === 0) {
            return undefined;
        }
        const prompt = this._promptQueue.shift();
        this._saveQueueToDisk();
        this._updateQueueUI();
        return prompt;
    }

    /**
     * Handle messages from webview
     */
    private _handleWebviewMessage(message: FromWebviewMessage): void {
        switch (message.type) {
            case 'submit':
                this._handleSubmit(message.value, message.attachments || []);
                break;
            case 'addQueuePrompt':
                this._handleAddQueuePrompt(message.prompt, message.id);
                break;
            case 'removeQueuePrompt':
                this._handleRemoveQueuePrompt(message.promptId);
                break;
            case 'editQueuePrompt':
                this._handleEditQueuePrompt(message.promptId, message.newPrompt);
                break;
            case 'reorderQueue':
                this._handleReorderQueue(message.fromIndex, message.toIndex);
                break;
            case 'toggleQueue':
                this._handleToggleQueue(message.enabled);
                break;
            case 'clearQueue':
                this._handleClearQueue();
                break;
            case 'addAttachment':
                this._handleAddAttachment();
                break;
            case 'removeAttachment':
                this._handleRemoveAttachment(message.attachmentId);
                break;
            case 'removeHistoryItem':
                this._handleRemoveHistoryItem(message.callId);
                break;
            case 'clearPersistedHistory':
                this._handleClearPersistedHistory();
                break;
            case 'openHistoryModal':
                this._handleOpenHistoryModal();
                break;
            case 'searchFiles':
                this._handleSearchFiles(message.query);
                break;
            case 'saveImage':
                this._handleSaveImage(message.data, message.mimeType);
                break;
            case 'addFileReference':
                this._handleAddFileReference(message.file);
                break;
            case 'webviewReady':
                this._handleWebviewReady();
                break;
        }
    }

    /**
     * Handle webview ready signal - send initial state and any pending messages
     */
    private _handleWebviewReady(): void {
        this._webviewReady = true;
        
        // Send initial queue state and current session (not persisted history - that's for modal)
        this._updateQueueUI();
        this._updateCurrentSessionUI();
        
        // If there's a pending tool call message, send it now
        if (this._pendingToolCallMessage) {
            this._view?.webview.postMessage({ 
                type: 'toolCallPending', 
                id: this._pendingToolCallMessage.id,
                prompt: this._pendingToolCallMessage.prompt 
            });
            this._pendingToolCallMessage = null;
        }
    }

    /**
     * Handle submit from webview
     */
    private _handleSubmit(value: string, attachments: AttachmentInfo[]): void {
        if (this._pendingRequests.size > 0 && this._currentToolCallId) {
            const resolve = this._pendingRequests.get(this._currentToolCallId);
            if (resolve) {
                // O(1) lookup using Map instead of O(n) findIndex
                const pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId);
                
                let completedEntry: ToolCallEntry;
                if (pendingEntry && pendingEntry.status === 'pending') {
                    // Update existing pending entry
                    pendingEntry.response = value;
                    pendingEntry.status = 'completed';
                    pendingEntry.timestamp = Date.now();
                    completedEntry = pendingEntry;
                } else {
                    // Create new completed entry (shouldn't happen normally)
                    completedEntry = {
                        id: this._currentToolCallId,
                        prompt: 'Tool call',
                        response: value,
                        timestamp: Date.now(),
                        isFromQueue: false,
                        status: 'completed',
                        sessionId: this._sessionId
                    };
                    this._currentSessionCalls.unshift(completedEntry);
                    this._currentSessionCallsMap.set(completedEntry.id, completedEntry);
                }
                
                // Send toolCallCompleted to trigger "Working...." state in webview
                this._view?.webview.postMessage({
                    type: 'toolCallCompleted',
                    entry: completedEntry
                } as ToWebviewMessage);
                
                this._updateCurrentSessionUI();
                resolve({ value, queue: this._queueEnabled, attachments });
                this._pendingRequests.delete(this._currentToolCallId);
                this._currentToolCallId = null;
            }
        } else {
            // No pending tool call - add message to queue for later use
            if (value && value.trim()) {
                const queuedPrompt: QueuedPrompt = {
                    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    prompt: value.trim(),
                    createdAt: Date.now()
                };
                this._promptQueue.push(queuedPrompt);
                // Auto-switch to queue mode so user sees their message went to queue
                this._queueEnabled = true;
                this._saveQueueToDisk();
                this._updateQueueUI();
            }
        }
        // Clear attachments after submit
        this._attachments = [];
    }

    /**
     * Handle adding attachment via file picker
     */
    private async _handleAddAttachment(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000);
        
        if (files.length === 0) {
            vscode.window.showInformationMessage('No files found in workspace');
            return;
        }

        const items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = files.map(uri => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            const fileName = path.basename(uri.fsPath);
            return {
                label: `$(file) ${fileName}`,
                description: relativePath,
                uri: uri
            };
        }).sort((a, b) => a.label.localeCompare(b.label));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select files to attach',
            matchOnDescription: true
        });

        if (selected && selected.length > 0) {
            for (const item of selected) {
                const labelMatch = item.label.match(/\$\([^)]+\)\s*(.+)/);
                const cleanName = labelMatch ? labelMatch[1] : item.label;
                const attachment: AttachmentInfo = {
                    id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    name: cleanName,
                    uri: item.uri.toString()
                };
                this._attachments.push(attachment);
            }
            this._updateAttachmentsUI();
        }
    }

    /**
     * Handle removing attachment
     */
    private _handleRemoveAttachment(attachmentId: string): void {
        this._attachments = this._attachments.filter(a => a.id !== attachmentId);
        this._updateAttachmentsUI();
    }

    /**
     * Handle file search for autocomplete
     */
    private async _handleSearchFiles(query: string): Promise<void> {
        try {
            const queryLower = query.toLowerCase();
            const cacheKey = queryLower || '__all__';
            
            // Check cache first (TTL-based)
            const cached = this._fileSearchCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this._FILE_CACHE_TTL_MS) {
                this._view?.webview.postMessage({
                    type: 'fileSearchResults',
                    files: cached.results
                } as ToWebviewMessage);
                return;
            }
            
            // Exclude common unwanted files/folders for cleaner search results
            const excludePattern = '{**/node_modules/**,**/.vscode/**,**/*.log,**/.env,**/.env.*,**/*instructions.md,**/dist/**,**/.git/**,**/build/**,**/*.vsix}';
            // Reduced from 2000 to _MAX_FILE_SEARCH_RESULTS for better performance
            const allFiles = await vscode.workspace.findFiles('**/*', excludePattern, this._MAX_FILE_SEARCH_RESULTS);

            const seenFolders = new Set<string>();
            const folderResults: FileSearchResult[] = [];

            for (const uri of allFiles) {
                const relativePath = vscode.workspace.asRelativePath(uri);
                const dirPath = path.dirname(relativePath);

                if (dirPath && dirPath !== '.' && !seenFolders.has(dirPath)) {
                    seenFolders.add(dirPath);
                    const folderName = path.basename(dirPath);

                    if (!queryLower || folderName.toLowerCase().includes(queryLower) || dirPath.toLowerCase().includes(queryLower)) {
                        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.workspace.workspaceFolders![0].uri;
                        folderResults.push({
                            name: folderName,
                            path: dirPath,
                            uri: vscode.Uri.joinPath(workspaceFolder, dirPath).toString(),
                            icon: 'folder',
                            isFolder: true
                        });
                    }
                }
            }

            const fileResults: FileSearchResult[] = allFiles
                .map(uri => {
                    const relativePath = vscode.workspace.asRelativePath(uri);
                    const fileName = path.basename(uri.fsPath);
                    return {
                        name: fileName,
                        path: relativePath,
                        uri: uri.toString(),
                        icon: this._getFileIcon(fileName),
                        isFolder: false
                    };
                })
                .filter(file => !queryLower || file.name.toLowerCase().includes(queryLower) || file.path.toLowerCase().includes(queryLower));

            const allResults = [...folderResults, ...fileResults]
                .sort((a, b) => {
                    if (a.isFolder && !b.isFolder) return -1;
                    if (!a.isFolder && b.isFolder) return 1;
                    const aExact = a.name.toLowerCase().startsWith(queryLower);
                    const bExact = b.name.toLowerCase().startsWith(queryLower);
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    return a.name.localeCompare(b.name);
                })
                .slice(0, 50);
            
            // Cache results
            this._fileSearchCache.set(cacheKey, { results: allResults, timestamp: Date.now() });
            // Limit cache size to prevent memory bloat
            if (this._fileSearchCache.size > 20) {
                const firstKey = this._fileSearchCache.keys().next().value;
                if (firstKey) this._fileSearchCache.delete(firstKey);
            }

            this._view?.webview.postMessage({
                type: 'fileSearchResults',
                files: allResults
            } as ToWebviewMessage);
        } catch (error) {
            console.error('File search error:', error);
            this._view?.webview.postMessage({
                type: 'fileSearchResults',
                files: []
            } as ToWebviewMessage);
        }
    }

    /**
     * Handle saving pasted/dropped image
     */
    private async _handleSaveImage(dataUrl: string, mimeType: string): Promise<void> {
        const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

        try {
            const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
            if (!base64Match) {
                vscode.window.showWarningMessage('Invalid image format');
                return;
            }

            const base64Data = base64Match[1];
            
            // SECURITY FIX: Validate base64 size BEFORE decoding to prevent memory spike
            // Base64 encoding increases size by ~33%, so decoded size ≈ base64Length * 0.75
            const estimatedSize = Math.ceil(base64Data.length * 0.75);
            if (estimatedSize > MAX_IMAGE_SIZE_BYTES) {
                const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
                vscode.window.showWarningMessage(`Image too large (~${sizeMB}MB). Max 10MB.`);
                return;
            }
            
            const buffer = Buffer.from(base64Data, 'base64');

            if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
                const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
                vscode.window.showWarningMessage(`Image too large (${sizeMB}MB). Max 10MB.`);
                return;
            }

            const validMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
            if (!validMimeTypes.includes(mimeType)) {
                vscode.window.showWarningMessage(`Unsupported image type: ${mimeType}`);
                return;
            }

            const extMap: Record<string, string> = {
                'image/png': '.png',
                'image/jpeg': '.jpg',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'image/bmp': '.bmp'
            };
            const ext = extMap[mimeType] || '.png';

            const storageUri = this._context.storageUri;
            if (!storageUri) {
                throw new Error('Storage URI not available');
            }

            const tempDir = path.join(storageUri.fsPath, 'temp-images');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const existingImages = this._attachments.filter(a => a.isTemporary).length;
            let fileName = existingImages === 0 ? `image-pasted${ext}` : `image-pasted-${existingImages}${ext}`;
            let filePath = path.join(tempDir, fileName);

            let counter = existingImages;
            while (fs.existsSync(filePath)) {
                counter++;
                fileName = `image-pasted-${counter}${ext}`;
                filePath = path.join(tempDir, fileName);
            }

            fs.writeFileSync(filePath, buffer);

            const attachment: AttachmentInfo = {
                id: `img_${Date.now()}`,
                name: fileName,
                uri: vscode.Uri.file(filePath).toString(),
                isTemporary: true
            };

            this._attachments.push(attachment);

            this._view?.webview.postMessage({
                type: 'imageSaved',
                attachment
            } as ToWebviewMessage);

            this._updateAttachmentsUI();
        } catch (error) {
            console.error('Failed to save image:', error);
            vscode.window.showErrorMessage('Failed to save pasted image');
        }
    }

    /**
     * Handle adding file reference from autocomplete
     */
    private _handleAddFileReference(file: FileSearchResult): void {
        const attachment: AttachmentInfo = {
            id: `${file.isFolder ? 'folder' : 'file'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            name: file.name,
            uri: file.uri,
            isFolder: file.isFolder,
            isTextReference: true
        };
        this._attachments.push(attachment);
        this._updateAttachmentsUI();
    }

    /**
     * Update attachments UI
     */
    private _updateAttachmentsUI(): void {
        this._view?.webview.postMessage({
            type: 'updateAttachments',
            attachments: this._attachments
        } as ToWebviewMessage);
    }

    /**
     * Get file icon based on extension
     */
    private _getFileIcon(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const iconMap: Record<string, string> = {
            'ts': 'file-code', 'tsx': 'file-code', 'js': 'file-code', 'jsx': 'file-code',
            'py': 'file-code', 'java': 'file-code', 'c': 'file-code', 'cpp': 'file-code',
            'html': 'file-code', 'css': 'file-code', 'scss': 'file-code',
            'json': 'json', 'yaml': 'file-code', 'yml': 'file-code',
            'md': 'markdown', 'txt': 'file-text',
            'png': 'file-media', 'jpg': 'file-media', 'jpeg': 'file-media', 'gif': 'file-media', 'svg': 'file-media',
            'sh': 'terminal', 'bash': 'terminal', 'ps1': 'terminal',
            'zip': 'file-zip', 'tar': 'file-zip', 'gz': 'file-zip'
        };
        return iconMap[ext] || 'file';
    }

    /**
     * Handle adding a prompt to queue
     */
    private _handleAddQueuePrompt(prompt: string, id: string): void {
        const trimmed = prompt.trim();
        if (!trimmed || trimmed.length > 10000) return;
        
        const queuedPrompt: QueuedPrompt = {
            id: id || `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            prompt: trimmed,
            createdAt: Date.now()
        };
        this._promptQueue.push(queuedPrompt);
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle removing a prompt from queue
     */
    private _handleRemoveQueuePrompt(promptId: string): void {
        this._promptQueue = this._promptQueue.filter(p => p.id !== promptId);
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle editing a prompt in queue
     */
    private _handleEditQueuePrompt(promptId: string, newPrompt: string): void {
        const trimmed = newPrompt.trim();
        if (!trimmed || trimmed.length > 10000) return;
        
        const prompt = this._promptQueue.find(p => p.id === promptId);
        if (prompt) {
            prompt.prompt = trimmed;
            this._saveQueueToDisk();
            this._updateQueueUI();
        }
    }

    /**
     * Handle reordering queue
     */
    private _handleReorderQueue(fromIndex: number, toIndex: number): void {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        if (fromIndex < 0 || toIndex < 0) return;
        if (fromIndex >= this._promptQueue.length || toIndex >= this._promptQueue.length) return;

        const [removed] = this._promptQueue.splice(fromIndex, 1);
        this._promptQueue.splice(toIndex, 0, removed);
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle toggling queue enabled state
     */
    private _handleToggleQueue(enabled: boolean): void {
        this._queueEnabled = enabled;
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle clearing the queue
     */
    private _handleClearQueue(): void {
        this._promptQueue = [];
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle removing a history item from persisted history (modal only)
     */
    private _handleRemoveHistoryItem(callId: string): void {
        this._persistedHistory = this._persistedHistory.filter(tc => tc.id !== callId);
        this._updatePersistedHistoryUI();
        this._savePersistedHistoryToDisk();
    }

    /**
     * Handle clearing all persisted history
     */
    private _handleClearPersistedHistory(): void {
        this._persistedHistory = [];
        this._updatePersistedHistoryUI();
        this._savePersistedHistoryToDisk();
    }

    /**
     * Handle opening history modal - send persisted history to webview
     */
    private _handleOpenHistoryModal(): void {
        this._updatePersistedHistoryUI();
    }

    /**
     * Update queue UI in webview
     */
    private _updateQueueUI(): void {
        this._view?.webview.postMessage({
            type: 'updateQueue',
            queue: this._promptQueue,
            enabled: this._queueEnabled
        } as ToWebviewMessage);
    }

    /**
     * Update current session UI in webview (cards in chat)
     */
    private _updateCurrentSessionUI(): void {
        this._view?.webview.postMessage({
            type: 'updateCurrentSession',
            history: this._currentSessionCalls
        } as ToWebviewMessage);
    }

    /**
     * Update persisted history UI in webview (for modal)
     */
    private _updatePersistedHistoryUI(): void {
        this._view?.webview.postMessage({
            type: 'updatePersistedHistory',
            history: this._persistedHistory
        } as ToWebviewMessage);
    }

    /**
     * Load queue from disk
     */
    private async _loadQueueFromDiskAsync(): Promise<void> {
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            const queuePath = path.join(storagePath, 'queue.json');

            // Check if file exists using async
            try {
                await fs.promises.access(queuePath, fs.constants.F_OK);
            } catch {
                // File doesn't exist, use defaults
                this._promptQueue = [];
                this._queueEnabled = true;
                return;
            }

            const data = await fs.promises.readFile(queuePath, 'utf8');
            const parsed = JSON.parse(data);
            this._promptQueue = Array.isArray(parsed.queue) ? parsed.queue : [];
            this._queueEnabled = parsed.enabled === true;
        } catch (error) {
            console.error('Failed to load queue:', error);
            this._promptQueue = [];
            this._queueEnabled = true; // Default to queue mode
        }
    }

    /**
     * Save queue to disk (debounced)
     */
    private _saveQueueToDisk(): void {
        if (this._queueSaveTimer) {
            clearTimeout(this._queueSaveTimer);
        }
        this._queueSaveTimer = setTimeout(() => {
            this._saveQueueToDiskAsync();
        }, this._QUEUE_SAVE_DEBOUNCE_MS);
    }

    /**
     * Actually persist queue to disk
     */
    private async _saveQueueToDiskAsync(): Promise<void> {
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            const queuePath = path.join(storagePath, 'queue.json');

            if (!fs.existsSync(storagePath)) {
                await fs.promises.mkdir(storagePath, { recursive: true });
            }

            const data = JSON.stringify({
                queue: this._promptQueue,
                enabled: this._queueEnabled
            }, null, 2);

            await fs.promises.writeFile(queuePath, data, 'utf8');
        } catch (error) {
            console.error('Failed to save queue:', error);
        }
    }

    /**
     * Load persisted history from disk (past sessions only) - ASYNC to not block activation
     */
    private async _loadPersistedHistoryFromDiskAsync(): Promise<void> {
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            const historyPath = path.join(storagePath, 'tool-history.json');

            // Check if file exists using async stat
            try {
                await fs.promises.access(historyPath, fs.constants.F_OK);
            } catch {
                // File doesn't exist, use empty history
                this._persistedHistory = [];
                return;
            }

            const data = await fs.promises.readFile(historyPath, 'utf8');
            const parsed = JSON.parse(data);
            // Only load completed entries from past sessions, enforce max limit
            this._persistedHistory = Array.isArray(parsed.history) 
                ? parsed.history
                    .filter((entry: ToolCallEntry) => entry.status === 'completed')
                    .slice(0, this._MAX_HISTORY_ENTRIES)
                : [];
        } catch (error) {
            console.error('Failed to load persisted history:', error);
            this._persistedHistory = [];
        }
    }

    /**
     * Save persisted history to disk (called on deactivate or when clearing)
     */
    private _savePersistedHistoryToDisk(): void {
        this._savePersistedHistoryToDiskSync();
    }

    /**
     * Actually persist history to disk (synchronous for deactivate)
     */
    private _savePersistedHistoryToDiskSync(): void {
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            const historyPath = path.join(storagePath, 'tool-history.json');

            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
            }

            // Only save completed entries
            const completedHistory = this._persistedHistory.filter(entry => entry.status === 'completed');

            const data = JSON.stringify({
                history: completedHistory
            }, null, 2);

            fs.writeFileSync(historyPath, data, 'utf8');
        } catch (error) {
            console.error('Failed to save persisted history:', error);
        }
    }

    /**
     * Generate HTML content for webview
     */
    private _getHtmlContent(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>TaskSync Chat</title>
</head>
<body>
    <div class="main-container">
        <!-- Chat Container -->
        <div class="chat-container" id="chat-container">
            <!-- Welcome Section - Let's build -->
            <div class="welcome-section" id="welcome-section">
                <div class="welcome-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="19" cy="5" r="2" fill="currentColor"/>
                        <circle cx="5" cy="5" r="1.5" fill="currentColor"/>
                    </svg>
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

                <div class="welcome-tips" id="welcome-tips">
                    <div class="tips-label">Great for:</div>
                    <ul class="tips-list">
                        <li>Automating repetitive AI interactions</li>
                        <li>Batch processing multiple prompts</li>
                        <li>Hands-free workflow execution</li>
                    </ul>
                </div>
            </div>

            <!-- Tool Call History Area -->
            <div class="tool-history-area" id="tool-history-area"></div>

            <!-- Pending Tool Call Message -->
            <div class="pending-message hidden" id="pending-message"></div>
        </div>

        <!-- Combined Input Wrapper (Queue + Input) -->
        <div class="input-area-container" id="input-area-container">
            <!-- File Autocomplete Dropdown - positioned outside input-wrapper to avoid clipping -->
            <div class="autocomplete-dropdown hidden" id="autocomplete-dropdown">
                <div class="autocomplete-list" id="autocomplete-list"></div>
                <div class="autocomplete-empty hidden" id="autocomplete-empty">No files found</div>
            </div>
            <div class="input-wrapper" id="input-wrapper">
            <!-- Prompt Queue Section - Integrated above input -->
            <div class="queue-section" id="queue-section">
                <div class="queue-header" id="queue-header">
                    <div class="accordion-icon">
                        <span class="codicon codicon-chevron-down"></span>
                    </div>
                    <span class="queue-header-title">Prompt Queue</span>
                    <span class="queue-count" id="queue-count">0</span>
                </div>
                <div class="queue-list" id="queue-list">
                    <div class="queue-empty">No prompts in queue</div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="input-container" id="input-container">
            <!-- Attachment Chips INSIDE input container -->
            <div class="chips-container hidden" id="chips-container"></div>
            <textarea id="chat-input" placeholder="Message TaskSync... (paste image or use #)" rows="1"></textarea>
            <div class="actions-bar">
                <div class="actions-left">
                    <button id="attach-btn" class="icon-btn" title="Add attachment (+)">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <div class="mode-selector" id="mode-selector">
                        <button id="mode-btn" class="mode-btn" title="Select mode">
                            <span class="codicon codicon-chevron-down"></span>
                            <span id="mode-label">Queue</span>
                        </button>
                        <div class="mode-dropdown hidden" id="mode-dropdown">
                            <div class="mode-option" data-mode="normal">
                                <span class="mode-check hidden" id="check-normal"><span class="codicon codicon-check"></span></span>
                                <span>Normal</span>
                            </div>
                            <div class="mode-option" data-mode="queue">
                                <span class="mode-check" id="check-queue"><span class="codicon codicon-check"></span></span>
                                <span>Queue</span>
                            </div>
                        </div>
                    </div>
                </div>
                <button id="send-btn" title="Send message">
                    <span class="codicon codicon-send"></span>
                </button>
            </div>
        </div>
        </div><!-- End input-wrapper -->
        </div><!-- End input-area-container -->

        <!-- Drop Zone Overlay -->
        <div class="drop-zone hidden" id="drop-zone">
            <div class="drop-zone-content">
                <span class="codicon codicon-file-media"></span>
                <span>Drop image here</span>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
