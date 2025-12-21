import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Queued prompt interface
export interface QueuedPrompt {
    id: string;
    prompt: string;
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

// Parsed choice from question
export interface ParsedChoice {
    label: string;      // Display text (e.g., "1" or "Test functionality")
    value: string;      // Response value to send (e.g., "1" or full text)
    shortLabel?: string; // Short version for button (e.g., "1" for numbered)
}

// Message types
type ToWebviewMessage =
    | { type: 'updateQueue'; queue: QueuedPrompt[]; enabled: boolean }
    | { type: 'toolCallPending'; id: string; prompt: string; isApprovalQuestion: boolean; choices?: ParsedChoice[] }
    | { type: 'toolCallCompleted'; entry: ToolCallEntry }
    | { type: 'updateCurrentSession'; history: ToolCallEntry[] }
    | { type: 'updatePersistedHistory'; history: ToolCallEntry[] }
    | { type: 'fileSearchResults'; files: FileSearchResult[] }
    | { type: 'updateAttachments'; attachments: AttachmentInfo[] }
    | { type: 'imageSaved'; attachment: AttachmentInfo };

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

export class TaskSyncWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
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

    // Map for O(1) lookup of tool calls by ID (synced with _currentSessionCalls array)
    private _currentSessionCallsMap: Map<string, ToolCallEntry> = new Map();

    // Disposables to clean up
    private _disposables: vscode.Disposable[] = [];

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

    /**
     * Clean up resources when the provider is disposed
     */
    public dispose(): void {
        // Clear debounce timer
        if (this._queueSaveTimer) {
            clearTimeout(this._queueSaveTimer);
            this._queueSaveTimer = null;
        }

        // Clear file search cache
        this._fileSearchCache.clear();

        // Clear session calls map (O(1) lookup cache)
        this._currentSessionCallsMap.clear();

        // Clear pending requests (reject any waiting promises)
        this._pendingRequests.clear();

        // Clear session data
        this._currentSessionCalls = [];
        this._attachments = [];

        // Dispose all registered disposables
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];

        this._view = undefined;
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

        // Register message handler (disposable is tracked via this._disposables)
        webviewView.webview.onDidReceiveMessage(
            (message: FromWebviewMessage) => this._handleWebviewMessage(message),
            undefined,
            this._disposables
        );

        // Clean up when webview is disposed
        webviewView.onDidDispose(() => {
            this._webviewReady = false;
            this._view = undefined;
            // Clear file search cache when view is hidden
            this._fileSearchCache.clear();
        }, null, this._disposables);

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

        // Parse choices from question and determine if it's an approval question
        const choices = this._parseChoices(question);
        const isApproval = choices.length === 0 && this._isApprovalQuestion(question);

        // Send pending tool call to webview (or queue if not ready)
        if (this._webviewReady) {
            this._view.webview.postMessage({
                type: 'toolCallPending',
                id: toolCallId,
                prompt: question,
                isApprovalQuestion: isApproval,
                choices: choices.length > 0 ? choices : undefined
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
     * Check if queue is enabled
     */
    public isQueueEnabled(): boolean {
        return this._queueEnabled;
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

        // If there's a pending tool call message that was never sent, send it now
        if (this._pendingToolCallMessage) {
            const prompt = this._pendingToolCallMessage.prompt;
            const choices = this._parseChoices(prompt);
            const isApproval = choices.length === 0 && this._isApprovalQuestion(prompt);
            this._view?.webview.postMessage({
                type: 'toolCallPending',
                id: this._pendingToolCallMessage.id,
                prompt: prompt,
                isApprovalQuestion: isApproval,
                choices: choices.length > 0 ? choices : undefined
            });
            this._pendingToolCallMessage = null;
        }
        // BUG FIX #2: If there's an active pending request (webview was hidden/recreated while waiting),
        // re-send the pending tool call message so the user sees the question again
        else if (this._currentToolCallId && this._pendingRequests.has(this._currentToolCallId)) {
            // Find the pending entry to get the prompt
            const pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId);
            if (pendingEntry && pendingEntry.status === 'pending') {
                const prompt = pendingEntry.prompt;
                const choices = this._parseChoices(prompt);
                const isApproval = choices.length === 0 && this._isApprovalQuestion(prompt);
                this._view?.webview.postMessage({
                    type: 'toolCallPending',
                    id: this._currentToolCallId,
                    prompt: prompt,
                    isApprovalQuestion: isApproval,
                    choices: choices.length > 0 ? choices : undefined
                });
            }
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
                    prompt: value.trim()
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
            prompt: trimmed
        };
        this._promptQueue.push(queuedPrompt);
        this._saveQueueToDisk();
        this._updateQueueUI();

        // Auto-respond with the newly added prompt if there's a pending request
        if (this._queueEnabled && this._currentToolCallId && this._pendingRequests.has(this._currentToolCallId)) {
            // Find and remove the prompt we just added by its specific ID (not pop() which could be wrong)
            const promptIndex = this._promptQueue.findIndex(p => p.id === queuedPrompt.id);
            if (promptIndex === -1) return; // Prompt was somehow removed already

            const consumedPrompt = this._promptQueue.splice(promptIndex, 1)[0];
            const resolve = this._pendingRequests.get(this._currentToolCallId);
            if (!resolve) return;

            // Update the pending entry to completed
            const pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId);

            let completedEntry: ToolCallEntry;
            if (pendingEntry && pendingEntry.status === 'pending') {
                pendingEntry.response = consumedPrompt.prompt;
                pendingEntry.status = 'completed';
                pendingEntry.isFromQueue = true;
                pendingEntry.timestamp = Date.now();
                completedEntry = pendingEntry;
            } else {
                completedEntry = {
                    id: this._currentToolCallId,
                    prompt: 'Tool call',
                    response: consumedPrompt.prompt,
                    timestamp: Date.now(),
                    isFromQueue: true,
                    status: 'completed',
                    sessionId: this._sessionId
                };
                this._currentSessionCalls.unshift(completedEntry);
                this._currentSessionCallsMap.set(completedEntry.id, completedEntry);
            }

            // Send toolCallCompleted to webview
            this._view?.webview.postMessage({
                type: 'toolCallCompleted',
                entry: completedEntry
            } as ToWebviewMessage);

            this._updateCurrentSessionUI();
            this._saveQueueToDisk();
            this._updateQueueUI();

            resolve({ value: consumedPrompt.prompt, queue: true, attachments: [] });
            this._pendingRequests.delete(this._currentToolCallId);
            this._currentToolCallId = null;
        }
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
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'TS-logo.svg'));
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;">
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
                    <img src="${logoUri}" alt="TaskSync Logo" width="48" height="48" class="welcome-logo">
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
            <div class="input-row">
                <textarea id="chat-input" placeholder="Message TaskSync... (paste image or use #)" rows="1"></textarea>
                <button id="send-btn" title="Send message">
                    <span class="codicon codicon-arrow-up"></span>
                </button>
            </div>
            <div class="actions-bar">
                <div class="actions-left">
                    <button id="attach-btn" class="icon-btn" title="Add attachment (+)">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <div class="mode-selector" id="mode-selector">
                        <button id="mode-btn" class="mode-btn" title="Select mode">
                            <span id="mode-label">Queue</span>
                            <span class="codicon codicon-chevron-down"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <!-- Mode Dropdown - positioned outside input-container to avoid clipping -->
        <div class="mode-dropdown hidden" id="mode-dropdown">
            <div class="mode-option" data-mode="normal">
                <span>Normal</span>
            </div>
            <div class="mode-option" data-mode="queue">
                <span>Queue</span>
            </div>
        </div>
        </div><!-- End input-wrapper -->
        </div><!-- End input-area-container -->
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

    /**
     * Parse choices from a question text.
     * Detects numbered lists (1. 2. 3.), lettered options (A. B. C.), and Option X: patterns.
     * Only detects choices near the LAST question mark "?" to avoid false positives from
     * earlier numbered/lettered content in the text.
     * 
     * @param text - The question text to parse
     * @returns Array of parsed choices, empty if no choices detected
     */
    private _parseChoices(text: string): ParsedChoice[] {
        const choices: ParsedChoice[] = [];
        let match;

        // DEBUG: Log input
        console.log('[TaskSync] _parseChoices called with text length:', text.length);

        // FIX: Search the ENTIRE text for numbered/lettered lists, not just after the last "?"
        // The previous approach failed when examples within the text contained "?" characters
        // (e.g., "Example: What's your favorite language?")

        // Strategy: Find the FIRST major numbered/lettered list that starts early in the text
        // These are the actual choices, not examples or descriptions within the text

        // DEBUG: Enhanced logging
        console.log('[TaskSync] _parseChoices - Full text:', text.substring(0, 200));

        // Split entire text into lines for multi-line patterns
        const lines = text.split('\n');
        console.log('[TaskSync] Total lines:', lines.length);
        const numberedLines: { index: number; num: string; numValue: number; text: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(numberedLinePattern);
            if (m && m[2].trim().length >= 3) {
                // Clean up markdown bold markers from text
                const cleanText = m[2].replace(/\*\*/g, '').trim();
                numberedLines.push({
                    index: i,
                    num: m[1],
                    numValue: parseInt(m[1], 10),
                    text: cleanText
                });
            }
        }

        // Find the last contiguous sequence by detecting number restarts
        // FIX: Changed to find the FIRST contiguous list (which contains the main choices)
        // Previously used LAST list which missed choices when examples appeared later in text
        if (numberedLines.length >= 2) {
            // Find all list boundaries by detecting restarts
            const listBoundaries: number[] = [0]; // First list starts at index 0

            for (let i = 1; i < numberedLines.length; i++) {
                const prevNum = numberedLines[i - 1].numValue;
                const currNum = numberedLines[i].numValue;
                const lineGap = numberedLines[i].index - numberedLines[i - 1].index;

                // Detect a new list if:
                // 1. Number resets (e.g., 2 -> 1, or any case where current < previous)
                // 2. Large gap between lines (> 5 lines typically means different section)
                if (currNum <= prevNum || lineGap > 5) {
                    listBoundaries.push(i);
                }
            }

            // FIX: Get the FIRST list (the main choices list), not the last
            // The first numbered list is typically the actual choices
            // Later lists are often examples or descriptions within each choice
            const firstListEnd = listBoundaries.length > 1 ? listBoundaries[1] : numberedLines.length;
            const firstGroup = numberedLines.slice(0, firstListEnd);

            console.log('[TaskSync] numberedLines:', numberedLines.length, 'listBoundaries:', listBoundaries, 'firstGroup:', firstGroup.length);

            // DEBUG: Show what we found
            if (firstGroup.length > 0) {
                console.log('[TaskSync] First choice:', firstGroup[0]);
            }

            if (firstGroup.length >= 2) {
                for (const m of firstGroup) {
                    let cleanText = m.text.replace(/[?!]+$/, '').trim();
                    const displayText = cleanText.length > 40 ? cleanText.substring(0, 37) + '...' : cleanText;
                    choices.push({
                        label: displayText,
                        value: m.num,
                        shortLabel: m.num
                    });
                }
                console.log('[TaskSync] Returning', choices.length, 'choices from Pattern 1');
                return choices;
            }
        }

        // Pattern 1b: Inline numbered lists "1. option 2. option 3. option" or "1 - option 2 - option"
        const inlineNumberedPattern = /(\d+)(?:[.):]|\s+-)\s+([^0-9]+?)(?=\s+\d+(?:[.):]|\s+-)|$)/g;
        const inlineNumberedMatches: { num: string; text: string }[] = [];

        // Only try inline if no multi-line matches found
        // Use full text converted to single line
        const singleLine = text.replace(/\n/g, ' ');
        while ((match = inlineNumberedPattern.exec(singleLine)) !== null) {
            const optionText = match[2].trim();
            if (optionText.length >= 3) {
                inlineNumberedMatches.push({ num: match[1], text: optionText });
            }
        }

        if (inlineNumberedMatches.length >= 2) {
            for (const m of inlineNumberedMatches) {
                let cleanText = m.text.replace(/[?!]+$/, '').trim();
                const displayText = cleanText.length > 40 ? cleanText.substring(0, 37) + '...' : cleanText;
                choices.push({
                    label: displayText,
                    value: m.num,
                    shortLabel: m.num
                });
            }
            return choices;
        }

        // Pattern 2: Lettered options - lines starting with "A." or "A)" or "**A)" through Z
        // Also match bold lettered options like "**A) Option**"
        // FIX: Search entire text, not just after question mark
        const letteredLinePattern = /^\s*\*{0,2}([A-Za-z])[.)]\s*\*{0,2}\s*(.+)$/;
        const letteredLines: { index: number; letter: string; text: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(letteredLinePattern);
            if (m && m[2].trim().length >= 3) {
                // Clean up markdown bold markers from text
                const cleanText = m[2].replace(/\*\*/g, '').trim();
                letteredLines.push({ index: i, letter: m[1].toUpperCase(), text: cleanText });
            }
        }

        if (letteredLines.length >= 2) {
            // FIX: Find FIRST contiguous group instead of last
            // Find all list boundaries by detecting letter restarts or gaps
            const listBoundaries: number[] = [0];

            for (let i = 1; i < letteredLines.length; i++) {
                const gap = letteredLines[i].index - letteredLines[i - 1].index;
                // Detect new list if gap > 3 lines
                if (gap > 3) {
                    listBoundaries.push(i);
                }
            }

            // Get the FIRST list (the main choices list)
            const firstListEnd = listBoundaries.length > 1 ? listBoundaries[1] : letteredLines.length;
            const firstGroup = letteredLines.slice(0, firstListEnd);

            if (firstGroup.length >= 2) {
                for (const m of firstGroup) {
                    let cleanText = m.text.replace(/[?!]+$/, '').trim();
                    const displayText = cleanText.length > 40 ? cleanText.substring(0, 37) + '...' : cleanText;
                    choices.push({
                        label: displayText,
                        value: m.letter,
                        shortLabel: m.letter
                    });
                }
                return choices;
            }
        }

        // Pattern 2b: Inline lettered "A. option B. option C. option"
        // Only match single uppercase letters to avoid false positives
        const inlineLetteredPattern = /\b([A-Z])[.)]\s+([^A-Z]+?)(?=\s+[A-Z][.)]|$)/g;
        const inlineLetteredMatches: { letter: string; text: string }[] = [];

        while ((match = inlineLetteredPattern.exec(singleLine)) !== null) {
            const optionText = match[2].trim();
            if (optionText.length >= 3) {
                inlineLetteredMatches.push({ letter: match[1], text: optionText });
            }
        }

        if (inlineLetteredMatches.length >= 2) {
            for (const m of inlineLetteredMatches) {
                let cleanText = m.text.replace(/[?!]+$/, '').trim();
                const displayText = cleanText.length > 40 ? cleanText.substring(0, 37) + '...' : cleanText;
                choices.push({
                    label: displayText,
                    value: m.letter,
                    shortLabel: m.letter
                });
            }
            return choices;
        }

        // Pattern 3: "Option A:" or "Option 1:" style
        // Search entire text for this pattern
        const optionPattern = /option\s+([A-Za-z1-9])\s*:\s*([^O\n]+?)(?=\s*Option\s+[A-Za-z1-9]|\s*$|\n)/gi;
        const optionMatches: { id: string; text: string }[] = [];

        while ((match = optionPattern.exec(text)) !== null) {
            const optionText = match[2].trim();
            if (optionText.length >= 3) {
                optionMatches.push({ id: match[1].toUpperCase(), text: optionText });
            }
        }

        if (optionMatches.length >= 2) {
            for (const m of optionMatches) {
                let cleanText = m.text.replace(/[?!]+$/, '').trim();
                const displayText = cleanText.length > 40 ? cleanText.substring(0, 37) + '...' : cleanText;
                choices.push({
                    label: displayText,
                    value: `Option ${m.id}`,
                    shortLabel: m.id
                });
            }
            return choices;
        }

        return choices;
    }

    /**
     * Detect if a question is an approval/confirmation type that warrants quick action buttons.
     * Uses NLP patterns to identify yes/no questions, permission requests, and confirmations.
     * 
     * @param text - The question text to analyze
     * @returns true if the question is an approval-type question
     */
    private _isApprovalQuestion(text: string): boolean {
        const lowerText = text.toLowerCase();

        // NEGATIVE patterns - questions that require specific input (NOT approval questions)
        const requiresSpecificInput = [
            // Generic "select/choose an option" prompts - these need specific choice, not yes/no
            /please (?:select|choose|pick) (?:an? )?option/i,
            /select (?:an? )?option/i,
            // Open-ended requests for feedback/information
            /let me know/i,
            /tell me (?:what|how|when|if|about)/i,
            /waiting (?:for|on) (?:your|the)/i,
            /ready to (?:hear|see|get|receive)/i,
            // Questions asking for specific information
            /what (?:is|are|should|would)/i,
            /which (?:one|file|option|method|approach)/i,
            /where (?:should|would|is|are)/i,
            /how (?:should|would|do|can)/i,
            /when (?:should|would)/i,
            /who (?:should|would)/i,
            // Questions asking for names, values, content
            /(?:enter|provide|specify|give|type|input|write)\s+(?:a|the|your)/i,
            /what.*(?:name|value|path|url|content|text|message)/i,
            /please (?:enter|provide|specify|give|type)/i,
            // Open-ended questions
            /describe|explain|elaborate|clarify/i,
            /tell me (?:about|more|how)/i,
            /what do you (?:think|want|need|prefer)/i,
            /any (?:suggestions|recommendations|preferences|thoughts)/i,
            // Questions with multiple choice indicators (not binary)
            /choose (?:from|between|one of)/i,
            /select (?:from|one of|which)/i,
            /pick (?:one|from|between)/i,
            // Numbered options (1. 2. 3. or 1) 2) 3))
            /\n\s*[1-9][.)]\s+\S/i,
            // Lettered options (A. B. C. or a) b) c) or Option A/B/C)
            /\n\s*[a-d][.)]\s+\S/i,
            /option\s+[a-d]\s*:/i,
            // "Would you like me to:" followed by list
            /would you like (?:me to|to):\s*\n/i,
            // ASCII art boxes/mockups (common patterns)
            /[┌├└│┐┤┘─╔╠╚║╗╣╝═]/,
            /\[.+\]\s+\[.+\]/i,  // Multiple bracketed options like [Approve] [Reject]
            // "Something else?" at the end of a list typically means multi-choice
            /\d+[.)]\s+something else\??/i
        ];

        // Check if question requires specific input - if so, NOT an approval question
        for (const pattern of requiresSpecificInput) {
            if (pattern.test(lowerText)) {
                return false;
            }
        }

        // Also check for numbered lists anywhere in text (strong indicator of multi-choice)
        const numberedListCount = (text.match(/\n\s*\d+[.)]\s+/g) || []).length;
        if (numberedListCount >= 2) {
            return false; // Multiple numbered items = multi-choice question
        }

        // POSITIVE patterns - approval/confirmation questions
        const approvalPatterns = [
            // Direct yes/no question patterns
            /^(?:shall|should|can|could|may|would|will|do|does|did|is|are|was|were|have|has|had)\s+(?:i|we|you|it|this|that)\b/i,
            // Permission/confirmation phrases
            /(?:proceed|continue|go ahead|start|begin|execute|run|apply|commit|save|delete|remove|create|add|update|modify|change|overwrite|replace)/i,
            /(?:ok|okay|alright|ready|confirm|approve|accept|allow|enable|disable|skip|ignore|dismiss|close|cancel|abort|stop|exit|quit)/i,
            // Question endings that suggest yes/no
            /\?$/,
            /(?:right|correct|yes|no)\s*\?$/i,
            /(?:is that|does that|would that|should that)\s+(?:ok|okay|work|help|be\s+(?:ok|fine|good|acceptable))/i,
            // Explicit approval requests
            /(?:do you want|would you like|shall i|should i|can i|may i|could i)/i,
            /(?:want me to|like me to|need me to)/i,
            /(?:approve|confirm|authorize|permit|allow)\s+(?:this|the|these)/i,
            // Binary choice indicators
            /(?:yes or no|y\/n|yes\/no|\[y\/n\]|\(y\/n\))/i,
            // Action confirmation patterns
            /(?:are you sure|do you confirm|please confirm|confirm that)/i,
            /(?:this will|this would|this is going to)/i
        ];

        // Check if any approval pattern matches
        for (const pattern of approvalPatterns) {
            if (pattern.test(lowerText)) {
                return true;
            }
        }

        // Additional heuristic: short questions (< 100 chars) ending with ? are likely yes/no
        if (lowerText.length < 100 && lowerText.trim().endsWith('?')) {
            // But exclude questions with interrogative words that typically need specific answers
            const interrogatives = /^(?:what|which|where|when|why|how|who|whom|whose)\b/i;
            if (!interrogatives.test(lowerText.trim())) {
                return true;
            }
        }

        return false;
    }
}
