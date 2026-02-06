import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FILE_EXCLUSION_PATTERNS, FILE_SEARCH_EXCLUSION_PATTERNS, formatExcludePattern } from '../constants/fileExclusions';
import { ContextManager, ContextReferenceType, ContextReference } from '../context';

// Queued prompt interface
export interface QueuedPrompt {
    id: string;
    prompt: string;
    attachments?: AttachmentInfo[];  // Optional attachments (images, files) included with the prompt
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

// File search result (also used for context items like #terminal, #problems)
export interface FileSearchResult {
    name: string;
    path: string;
    uri: string;
    icon: string;
    isFolder?: boolean;
    isContext?: boolean; // true for #terminal, #problems context items
}

// User response result
export interface UserResponseResult {
    value: string;
    queue: boolean;
    attachments: AttachmentInfo[];
    cancelled?: boolean;  // Indicates if the request was superseded by a new one
}

// Tool call history entry
export interface ToolCallEntry {
    id: string;
    prompt: string;
    response: string;
    timestamp: number;
    isFromQueue: boolean;
    status: 'pending' | 'completed' | 'cancelled';
    attachments?: AttachmentInfo[];
}

// Parsed choice from question
export interface ParsedChoice {
    label: string;      // Display text (e.g., "1" or "Test functionality")
    value: string;      // Response value to send (e.g., "1" or full text)
    shortLabel?: string; // Short version for button (e.g., "1" for numbered)
}

// Reusable prompt interface
export interface ReusablePrompt {
    id: string;
    name: string;       // Short name for /slash command (e.g., "fix", "test", "refactor")
    prompt: string;     // Full prompt text
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
    | { type: 'imageSaved'; attachment: AttachmentInfo }
    | { type: 'openSettingsModal' }
    | { type: 'updateSettings'; soundEnabled: boolean; interactiveApprovalEnabled: boolean; autoAnswerEnabled: boolean; autoAnswerText: string; reusablePrompts: ReusablePrompt[] }
    | { type: 'slashCommandResults'; prompts: ReusablePrompt[] }
    | { type: 'playNotificationSound' }
    | { type: 'contextSearchResults'; suggestions: Array<{ type: string; label: string; description: string; detail: string }> }
    | { type: 'contextReferenceAdded'; reference: { id: string; type: string; label: string; content: string } };

type FromWebviewMessage =
    | { type: 'submit'; value: string; attachments: AttachmentInfo[] }
    | { type: 'addQueuePrompt'; prompt: string; id: string; attachments?: AttachmentInfo[] }
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
    | { type: 'webviewReady' }
    | { type: 'openSettingsModal' }
    | { type: 'updateSoundSetting'; enabled: boolean }
    | { type: 'updateInteractiveApprovalSetting'; enabled: boolean }
    | { type: 'updateAutoAnswerSetting'; enabled: boolean }
    | { type: 'updateAutoAnswerText'; text: string }
    | { type: 'addReusablePrompt'; name: string; prompt: string }
    | { type: 'editReusablePrompt'; id: string; name: string; prompt: string }
    | { type: 'removeReusablePrompt'; id: string }
    | { type: 'searchSlashCommands'; query: string }
    | { type: 'openExternal'; url: string }
    | { type: 'searchContext'; query: string }
    | { type: 'selectContextReference'; contextType: string; options?: Record<string, unknown> };


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

    // Webview ready state - prevents race condition on first message
    private _webviewReady: boolean = false;
    private _pendingToolCallMessage: { id: string; prompt: string } | null = null;

    // Debounce timer for queue persistence
    private _queueSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _QUEUE_SAVE_DEBOUNCE_MS = 300;

    // Debounce timer for history persistence (async background saves)
    private _historySaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly _HISTORY_SAVE_DEBOUNCE_MS = 2000; // 2 seconds debounce
    private _historyDirty: boolean = false; // Track if history needs saving

    // Performance limits
    private readonly _MAX_HISTORY_ENTRIES = 100;
    private readonly _MAX_FILE_SEARCH_RESULTS = 500;
    private readonly _MAX_QUEUE_PROMPT_LENGTH = 100000; // 100KB for queue prompts
    private readonly _MAX_FOLDER_SEARCH_RESULTS = 1000;
    private readonly _VIEW_OPEN_TIMEOUT_MS = 5000;
    private readonly _VIEW_OPEN_POLL_INTERVAL_MS = 100;
    private readonly _SHORT_QUESTION_THRESHOLD = 100; // chars for approval heuristic

    // File search cache with TTL
    private _fileSearchCache: Map<string, { results: FileSearchResult[], timestamp: number }> = new Map();
    private readonly _FILE_CACHE_TTL_MS = 5000;

    // Map for O(1) lookup of tool calls by ID (synced with _currentSessionCalls array)
    private _currentSessionCallsMap: Map<string, ToolCallEntry> = new Map();

    // Reusable prompts (loaded from VS Code settings)
    private _reusablePrompts: ReusablePrompt[] = [];

    // Notification sound enabled (loaded from VS Code settings)
    private _soundEnabled: boolean = true;

    // Interactive approval buttons enabled (loaded from VS Code settings)
    private _interactiveApprovalEnabled: boolean = true;

    private readonly _AUTO_ANSWER_DEFAULT_TEXT = 'You are in autonomous mode and must make all decisions on your own.';

    // Auto answer enabled (loaded from VS Code settings)
    private _autoAnswerEnabled: boolean = false;

    // Auto answer text (loaded from VS Code settings)
    private _autoAnswerText: string = '';

    // Flag to prevent config reload during our own updates (avoids race condition)
    private _isUpdatingConfig: boolean = false;

    // Disposables to clean up
    private _disposables: vscode.Disposable[] = [];

    // Context manager for #terminal, #problems references
    private readonly _contextManager: ContextManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        contextManager: ContextManager
    ) {
        this._contextManager = contextManager;
        // Load both queue and history async to not block activation
        this._loadQueueFromDiskAsync().catch(err => {
            console.error('Failed to load queue:', err);
        });
        this._loadPersistedHistoryFromDiskAsync().catch(err => {
            console.error('Failed to load history:', err);
        });
        // Load settings (sync - fast operation)
        this._loadSettings();

        // Listen for settings changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                // Skip reload if we're the ones updating config (prevents race condition)
                if (this._isUpdatingConfig) {
                    return;
                }
                if (e.affectsConfiguration('tasksync.notificationSound') ||
                    e.affectsConfiguration('tasksync.interactiveApproval') ||
                    e.affectsConfiguration('tasksync.autoAnswer') ||
                    e.affectsConfiguration('tasksync.autoAnswerText') ||
                    e.affectsConfiguration('tasksync.reusablePrompts')) {
                    this._loadSettings();
                    this._updateSettingsUI();
                }
            })
        );
    }

    /**
     * Save current tool call history to persisted history (called on deactivate)
     * Uses synchronous save because deactivate cannot await async operations
     */
    public saveCurrentSessionToHistory(): void {
        // Cancel any pending debounced saves
        if (this._historySaveTimer) {
            clearTimeout(this._historySaveTimer);
            this._historySaveTimer = null;
        }

        // Only save completed calls from current session
        const completedCalls = this._currentSessionCalls.filter(tc => tc.status === 'completed');
        if (completedCalls.length > 0) {
            // Prepend current session calls to persisted history, enforce max limit
            this._persistedHistory = [...completedCalls, ...this._persistedHistory].slice(0, this._MAX_HISTORY_ENTRIES);
            this._historyDirty = true;
        }

        // Force sync save on deactivation (async operations can't complete in deactivate)
        this._savePersistedHistoryToDiskSync();
    }

    /**
     * Open history modal (called from view title bar button)
     */
    public openHistoryModal(): void {
        this._view?.webview.postMessage({ type: 'openHistoryModal' });
        this._updatePersistedHistoryUI();
    }

    /**
     * Open settings modal (called from view title bar button)
     */
    public openSettingsModal(): void {
        this._view?.webview.postMessage({ type: 'openSettingsModal' } as ToWebviewMessage);
        this._updateSettingsUI();
    }

    /**
     * Clear current session tool calls (called from view title bar button)
     * Preserves any pending tool call entry so responses don't lose their prompt
     * Cleans up temporary images associated with cleared entries
     */
    public clearCurrentSession(): void {
        // Preserve pending entry if there is one
        let pendingEntry: ToolCallEntry | undefined;
        if (this._currentToolCallId) {
            pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId);
        }

        // Clean up temp images from entries being cleared (except pending)
        const entriesToClear = pendingEntry
            ? this._currentSessionCalls.filter(e => e.id !== pendingEntry!.id)
            : this._currentSessionCalls;
        this._cleanupTempImagesFromEntries(entriesToClear);

        // Clear all entries
        this._currentSessionCalls = [];
        this._currentSessionCallsMap.clear();

        // Restore pending entry if we had one
        if (pendingEntry) {
            this._currentSessionCalls.push(pendingEntry);
            this._currentSessionCallsMap.set(pendingEntry.id, pendingEntry);
        }

        this._updateCurrentSessionUI();
    }

    /**
     * Play notification sound (called when ask_user tool is triggered)
     * Works even when webview is not visible by using system sound
     */
    public playNotificationSound(): void {
        if (this._soundEnabled) {
            // Play system sound from extension host (works even when webview is hidden)
            this._playSystemSound();

            // Also try webview audio if visible (better quality)
            this._view?.webview.postMessage({ type: 'playNotificationSound' } as ToWebviewMessage);
        }
    }

    /**
     * Play system sound using OS-native methods
     * Works even when webview is minimized or hidden
     */
    private _playSystemSound(): void {
        const { exec } = require('child_process');
        const platform = process.platform;

        try {
            if (platform === 'win32') {
                // Windows: Use PowerShell to play system exclamation sound
                exec('[System.Media.SystemSounds]::Exclamation.Play()', { shell: 'powershell.exe' });
            } else if (platform === 'darwin') {
                // macOS: Use afplay with system sound
                exec('afplay /System/Library/Sounds/Tink.aiff 2>/dev/null || printf "\\a"');
            } else {
                // Linux: Try multiple methods
                exec('paplay /usr/share/sounds/freedesktop/stereo/message.oga 2>/dev/null || printf "\\a"');
            }
        } catch (e) {
            // Sound playing failed - not critical
        }
    }

    /**
     * Load settings from VS Code configuration
     */
    private _getAutoAnswerDefaultText(config?: vscode.WorkspaceConfiguration): string {
        const settings = config ?? vscode.workspace.getConfiguration('tasksync');
        const inspected = settings.inspect<string>('autoAnswerText');
        const defaultValue = typeof inspected?.defaultValue === 'string' ? inspected.defaultValue : '';
        return defaultValue.trim().length > 0 ? defaultValue : this._AUTO_ANSWER_DEFAULT_TEXT;
    }

    private _normalizeAutoAnswerText(text: string, config?: vscode.WorkspaceConfiguration): string {
        const defaultAutoAnswerText = this._getAutoAnswerDefaultText(config);
        return text.trim().length > 0 ? text : defaultAutoAnswerText;
    }

    private _loadSettings(): void {
        const config = vscode.workspace.getConfiguration('tasksync');
        this._soundEnabled = config.get<boolean>('notificationSound', true);
        this._interactiveApprovalEnabled = config.get<boolean>('interactiveApproval', true);
        this._autoAnswerEnabled = config.get<boolean>('autoAnswer', false);
        const defaultAutoAnswerText = this._getAutoAnswerDefaultText(config);
        const configuredAutoAnswerText = config.get<string>('autoAnswerText', defaultAutoAnswerText);
        this._autoAnswerText = this._normalizeAutoAnswerText(configuredAutoAnswerText, config);

        // Load reusable prompts from settings
        const savedPrompts = config.get<Array<{ name: string; prompt: string }>>('reusablePrompts', []);
        this._reusablePrompts = savedPrompts.map((p, index) => ({
            id: `rp_${index}_${Date.now()}`,
            name: p.name,
            prompt: p.prompt
        }));
    }

    /**
     * Save reusable prompts to VS Code configuration
     */
    private async _saveReusablePrompts(): Promise<void> {
        this._isUpdatingConfig = true;
        try {
            const config = vscode.workspace.getConfiguration('tasksync');
            const promptsToSave = this._reusablePrompts.map(p => ({
                name: p.name,
                prompt: p.prompt
            }));
            await config.update('reusablePrompts', promptsToSave, vscode.ConfigurationTarget.Global);
        } finally {
            this._isUpdatingConfig = false;
        }
    }

    /**
     * Update settings UI in webview
     */
    private _updateSettingsUI(): void {
        this._view?.webview.postMessage({
            type: 'updateSettings',
            soundEnabled: this._soundEnabled,
            interactiveApprovalEnabled: this._interactiveApprovalEnabled,
            autoAnswerEnabled: this._autoAnswerEnabled,
            autoAnswerText: this._autoAnswerText,
            reusablePrompts: this._reusablePrompts
        } as ToWebviewMessage);
    }

    /**
     * Clean up resources when the provider is disposed
     */
    public dispose(): void {
        // Save session history BEFORE clearing arrays
        // This ensures tool calls are persisted when VS Code reloads
        this.saveCurrentSessionToHistory();

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

        // Clean up temp images from current session before clearing
        this._cleanupTempImagesFromEntries(this._currentSessionCalls);

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
            // Save current session to persisted history when view is disposed
            this.saveCurrentSessionToHistory();
        }, null, this._disposables);

        // Save history when webview visibility changes (backup for reload)
        webviewView.onDidChangeVisibility(() => {
            if (!webviewView.visible) {
                // Save current session when switching away
                this.saveCurrentSessionToHistory();
            }
        }, null, this._disposables);

        // Don't send initial state here - wait for webviewReady message
        // This prevents race condition where messages are sent before JS is initialized
    }

    /**
     * Wait for user response
     */
    private _cancelSupersededPendingRequest(): void {
        if (!this._currentToolCallId || !this._pendingRequests.has(this._currentToolCallId)) {
            return;
        }

        const oldToolCallId = this._currentToolCallId;
        const oldResolve = this._pendingRequests.get(oldToolCallId);
        if (oldResolve) {
            // Resolve the orphaned promise with a cancellation indicator
            oldResolve({
                value: '[CANCELLED: New request superseded this one]',
                queue: this._queueEnabled && this._promptQueue.length > 0,
                attachments: [],
                cancelled: true
            });
            this._pendingRequests.delete(oldToolCallId);

            // Update the old entry status to indicate it was superseded
            const oldEntry = this._currentSessionCallsMap.get(oldToolCallId);
            if (oldEntry && oldEntry.status === 'pending') {
                oldEntry.status = 'cancelled';
                oldEntry.response = '[Superseded by new request]';
                this._updateCurrentSessionUI();
            }
            console.warn(`[TaskSync] Previous request ${oldToolCallId} was superseded by new request`);
        }
    }

    public async waitForUserResponse(question: string): Promise<UserResponseResult> {
        if (this._autoAnswerEnabled && !(this._queueEnabled && this._promptQueue.length > 0)) {
            // Race condition prevention: If there's already a pending request, cancel it
            // This prevents orphaned promises when waitForUserResponse is called multiple times
            this._cancelSupersededPendingRequest();

            const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            this._currentToolCallId = toolCallId;

            const effectiveText = this._normalizeAutoAnswerText(this._autoAnswerText);
            const entry: ToolCallEntry = {
                id: toolCallId,
                prompt: question,
                response: effectiveText,
                timestamp: Date.now(),
                isFromQueue: false,
                status: 'completed'
            };
            this._currentSessionCalls.unshift(entry);
            this._currentSessionCallsMap.set(entry.id, entry);
            this._updateCurrentSessionUI();
            this._currentToolCallId = null;

            return {
                value: effectiveText,
                queue: this._queueEnabled && this._promptQueue.length > 0,
                attachments: []
            };
        }

        // If view is not available, open the sidebar first
        if (!this._view) {
            // Open the TaskSync sidebar view
            await vscode.commands.executeCommand('taskSyncView.focus');

            // Wait for view to be resolved (up to configured timeout)
            let waited = 0;
            while (!this._view && waited < this._VIEW_OPEN_TIMEOUT_MS) {
                await new Promise(resolve => setTimeout(resolve, this._VIEW_OPEN_POLL_INTERVAL_MS));
                waited += this._VIEW_OPEN_POLL_INTERVAL_MS;
            }

            if (!this._view) {
                console.error(`[TaskSync] Failed to open sidebar view after waiting ${this._VIEW_OPEN_TIMEOUT_MS}ms`);
                throw new Error(`Failed to open TaskSync sidebar after ${this._VIEW_OPEN_TIMEOUT_MS}ms. The webview may not be properly initialized.`);
            }
        }

        // Race condition prevention: If there's already a pending request, cancel it
        // This prevents orphaned promises when waitForUserResponse is called multiple times
        this._cancelSupersededPendingRequest();

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
                    status: 'completed'
                };
                this._currentSessionCalls.unshift(entry);
                this._currentSessionCallsMap.set(entry.id, entry); // Maintain O(1) lookup map
                this._updateCurrentSessionUI();
                this._currentToolCallId = null;

                return {
                    value: queuedPrompt.prompt,
                    queue: this._queueEnabled && this._promptQueue.length > 0,
                    attachments: queuedPrompt.attachments || []  // Return stored attachments
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
            status: 'pending'
        };
        this._currentSessionCalls.unshift(pendingEntry);
        this._currentSessionCallsMap.set(toolCallId, pendingEntry); // O(1) lookup

        // Parse choices from question and determine if it's an approval question
        const choices = this._parseChoices(question);
        const isApproval = choices.length === 0 && this._isApprovalQuestion(question);

        // Wait for webview to be ready (JS initialized) before sending message
        if (!this._webviewReady) {
            // Wait for webview JS to initialize (up to 3 seconds)
            const maxWaitMs = 3000;
            const pollIntervalMs = 50;
            let waited = 0;
            while (!this._webviewReady && waited < maxWaitMs) {
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                waited += pollIntervalMs;
            }
        }

        // Send pending tool call to webview
        if (this._webviewReady && this._view) {
            this._view.webview.postMessage({
                type: 'toolCallPending',
                id: toolCallId,
                prompt: question,
                isApprovalQuestion: isApproval,
                choices: choices.length > 0 ? choices : undefined
            });
            // Play notification sound when AI triggers ask_user
            this.playNotificationSound();
        } else {
            // Fallback: queue the message (should rarely happen now)
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
                this._handleAddQueuePrompt(message.prompt, message.id, message.attachments || []);
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
            case 'openSettingsModal':
                this._handleOpenSettingsModal();
                break;
            case 'updateSoundSetting':
                this._handleUpdateSoundSetting(message.enabled);
                break;
            case 'updateInteractiveApprovalSetting':
                this._handleUpdateInteractiveApprovalSetting(message.enabled);
                break;
            case 'updateAutoAnswerSetting':
                this._handleUpdateAutoAnswerSetting(message.enabled);
                break;
            case 'updateAutoAnswerText':
                this._handleUpdateAutoAnswerText(message.text);
                break;
            case 'addReusablePrompt':
                this._handleAddReusablePrompt(message.name, message.prompt);
                break;
            case 'editReusablePrompt':
                this._handleEditReusablePrompt(message.id, message.name, message.prompt);
                break;
            case 'removeReusablePrompt':
                this._handleRemoveReusablePrompt(message.id);
                break;
            case 'searchSlashCommands':
                this._handleSearchSlashCommands(message.query);
                break;
            case 'openExternal':
                if (message.url) {
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                break;
            case 'searchContext':
                this._handleSearchContext(message.query);
                break;
            case 'selectContextReference':
                this._handleSelectContextReference(message.contextType, message.options);
                break;
        }
    }

    /**
     * Handle webview ready signal - send initial state and any pending messages
     */
    private _handleWebviewReady(): void {
        this._webviewReady = true;

        // Send settings
        this._updateSettingsUI();
        // Send initial queue state and current session history
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
        // If there's an active pending request (webview was hidden/recreated while waiting),
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
                    pendingEntry.attachments = attachments;
                    pendingEntry.status = 'completed';
                    pendingEntry.timestamp = Date.now();
                    completedEntry = pendingEntry;
                } else {
                    // Create new completed entry (shouldn't happen normally)
                    completedEntry = {
                        id: this._currentToolCallId,
                        prompt: 'Tool call',
                        response: value,
                        attachments: attachments,
                        timestamp: Date.now(),
                        isFromQueue: false,
                        status: 'completed'
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
                resolve({ value, queue: this._queueEnabled && this._promptQueue.length > 0, attachments });
                this._pendingRequests.delete(this._currentToolCallId);
                this._currentToolCallId = null;
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
            // NOTE: Temp images are NOT cleaned up here anymore.
            // They are stored in the ToolCallEntry.attachments and will be cleaned up when:
            // 1. clearCurrentSession() is called
            // 2. dispose() is called (extension deactivation)
            // This ensures images are available for the entire session duration.

            // Clear attachments after submit and sync with webview
            this._attachments = [];
            this._updateAttachmentsUI();
        }
    }

    /**
     * Clean up temporary image files from disk by URI list
     */
    private _cleanupTempImagesByUri(uris: string[]): void {
        for (const uri of uris) {
            try {
                const filePath = vscode.Uri.parse(uri).fsPath;
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.error('[TaskSync] Failed to cleanup temp image:', error);
            }
        }
    }

    /**
     * Clean up temporary images from tool call entries
     * Called when entries are removed from current session or on dispose
     */
    private _cleanupTempImagesFromEntries(entries: ToolCallEntry[]): void {
        const tempUris: string[] = [];
        for (const entry of entries) {
            if (entry.attachments) {
                for (const att of entry.attachments) {
                    // Only clean up temporary attachments (pasted/dropped images)
                    if (att.isTemporary && att.uri) {
                        tempUris.push(att.uri);
                    }
                }
            }
        }
        if (tempUris.length > 0) {
            this._cleanupTempImagesByUri(tempUris);
        }
    }

    /**
     * Handle adding attachment via file picker
     */
    private async _handleAddAttachment(): Promise<void> {
        // Use shared exclude pattern
        const excludePattern = formatExcludePattern(FILE_EXCLUSION_PATTERNS);
        const files = await vscode.workspace.findFiles('**/*', excludePattern, this._MAX_FOLDER_SEARCH_RESULTS);

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
     * Handle file search for autocomplete (also includes #terminal, #problems context)
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

            // First, get context suggestions (#terminal, #problems)
            const contextResults: FileSearchResult[] = [];

            // Check if query matches "terminal"
            if (!queryLower || 'terminal'.includes(queryLower)) {
                const commands = this._contextManager.terminal.formatCommandListForAutocomplete();
                const description = commands.length > 0
                    ? `${commands.length} recent commands`
                    : 'No commands yet';
                contextResults.push({
                    name: 'terminal',
                    path: description,
                    uri: 'context://terminal',
                    icon: 'terminal',
                    isFolder: false,
                    isContext: true
                });
            }

            // Check if query matches "problems"
            if (!queryLower || 'problems'.includes(queryLower)) {
                const problemsInfo = this._contextManager.problems.formatForAutocomplete();
                contextResults.push({
                    name: 'problems',
                    path: problemsInfo.description,
                    uri: 'context://problems',
                    icon: 'error',
                    isFolder: false,
                    isContext: true
                });
            }

            // Exclude common unwanted files/folders for cleaner search results
            // Includes: package managers, virtual envs, build outputs, hidden/config files
            const excludePattern = formatExcludePattern(FILE_SEARCH_EXCLUSION_PATTERNS);
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

            // Combine: context results first, then folders, then files
            const fileAndFolderResults = [...folderResults, ...fileResults]
                .sort((a, b) => {
                    if (a.isFolder && !b.isFolder) return -1;
                    if (!a.isFolder && b.isFolder) return 1;
                    const aExact = a.name.toLowerCase().startsWith(queryLower);
                    const bExact = b.name.toLowerCase().startsWith(queryLower);
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    return a.name.localeCompare(b.name);
                })
                .slice(0, 48); // Leave room for context items

            // Context results go first, then files/folders
            const allResults = [...contextResults, ...fileAndFolderResults];

            // Cache results (don't cache context results as they're dynamic)
            this._fileSearchCache.set(cacheKey, { results: fileAndFolderResults, timestamp: Date.now() });
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

            // Use storageUri if available (workspace-specific), otherwise fallback to globalStorageUri
            const storageUri = this._context.storageUri || this._context.globalStorageUri;
            if (!storageUri) {
                throw new Error('VS Code extension storage URI not available. Cannot save temporary images without storage access.');
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
    private _handleAddQueuePrompt(prompt: string, id: string, attachments: AttachmentInfo[]): void {
        const trimmed = prompt.trim();
        if (!trimmed || trimmed.length > this._MAX_QUEUE_PROMPT_LENGTH) return;

        const queuedPrompt: QueuedPrompt = {
            id: id || `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            prompt: trimmed,
            attachments: attachments.length > 0 ? [...attachments] : undefined  // Store attachments if any
        };

        // Check if we should auto-respond BEFORE adding to queue (race condition fix)
        // This prevents the window between push and findIndex where queue could be modified
        const shouldAutoRespond = this._queueEnabled &&
            this._currentToolCallId &&
            this._pendingRequests.has(this._currentToolCallId);

        if (shouldAutoRespond) {
            // Don't add to queue - consume directly for the pending request
            const resolve = this._pendingRequests.get(this._currentToolCallId!);
            if (!resolve) return;

            // Update the pending entry to completed
            const pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId!);

            let completedEntry: ToolCallEntry;
            if (pendingEntry && pendingEntry.status === 'pending') {
                pendingEntry.response = queuedPrompt.prompt;
                pendingEntry.attachments = queuedPrompt.attachments;
                pendingEntry.status = 'completed';
                pendingEntry.isFromQueue = true;
                pendingEntry.timestamp = Date.now();
                completedEntry = pendingEntry;
            } else {
                completedEntry = {
                    id: this._currentToolCallId!,
                    prompt: 'Tool call',
                    response: queuedPrompt.prompt,
                    attachments: queuedPrompt.attachments,
                    timestamp: Date.now(),
                    isFromQueue: true,
                    status: 'completed'
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

            resolve({ value: queuedPrompt.prompt, queue: this._queueEnabled && this._promptQueue.length > 0, attachments: queuedPrompt.attachments || [] });
            this._pendingRequests.delete(this._currentToolCallId!);
            this._currentToolCallId = null;
        } else {
            // No pending request - add to queue normally
            this._promptQueue.push(queuedPrompt);
            this._saveQueueToDisk();
            this._updateQueueUI();
        }

        // Clear attachments after adding to queue (they're now stored with the queue item)
        // This prevents old images from reappearing when pasting new images
        this._attachments = [];
        this._updateAttachmentsUI();
    }

    /**
     * Validate queue prompt ID format (defense in depth)
     */
    private _isValidQueueId(id: unknown): id is string {
        return typeof id === 'string' && /^q_\d+_[a-z0-9]+$/.test(id);
    }

    /**
     * Handle removing a prompt from queue
     */
    private _handleRemoveQueuePrompt(promptId: string): void {
        if (!this._isValidQueueId(promptId)) return;
        this._promptQueue = this._promptQueue.filter(p => p.id !== promptId);
        this._saveQueueToDisk();
        this._updateQueueUI();
    }

    /**
     * Handle editing a prompt in queue
     */
    private _handleEditQueuePrompt(promptId: string, newPrompt: string): void {
        if (!this._isValidQueueId(promptId)) return;
        const trimmed = newPrompt.trim();
        if (!trimmed || trimmed.length > this._MAX_QUEUE_PROMPT_LENGTH) return;

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
     * Handle opening settings modal - send settings to webview
     */
    private _handleOpenSettingsModal(): void {
        this._updateSettingsUI();
    }

    /**
     * Handle updating sound setting
     */
    private async _handleUpdateSoundSetting(enabled: boolean): Promise<void> {
        this._soundEnabled = enabled;
        this._isUpdatingConfig = true;
        try {
            const config = vscode.workspace.getConfiguration('tasksync');
            await config.update('notificationSound', enabled, vscode.ConfigurationTarget.Global);
            // Reload settings after update to ensure consistency
            this._loadSettings();
            // Update UI to reflect the saved state
            this._updateSettingsUI();
        } finally {
            this._isUpdatingConfig = false;
        }
    }

    /**
     * Handle updating interactive approval setting
     */
    private async _handleUpdateInteractiveApprovalSetting(enabled: boolean): Promise<void> {
        this._interactiveApprovalEnabled = enabled;
        this._isUpdatingConfig = true;
        try {
            const config = vscode.workspace.getConfiguration('tasksync');
            await config.update('interactiveApproval', enabled, vscode.ConfigurationTarget.Global);
            // Reload settings after update to ensure consistency
            this._loadSettings();
            // Update UI to reflect the saved state
            this._updateSettingsUI();
        } finally {
            this._isUpdatingConfig = false;
        }
    }

    /**
     * Handle updating auto answer setting
     */
    private async _handleUpdateAutoAnswerSetting(enabled: boolean): Promise<void> {
        this._autoAnswerEnabled = enabled;
        this._isUpdatingConfig = true;
        try {
            const config = vscode.workspace.getConfiguration('tasksync');
            await config.update('autoAnswer', enabled, vscode.ConfigurationTarget.Global);
            // Reload settings after update to ensure consistency
            this._loadSettings();
            // Update UI to reflect the saved state
            this._updateSettingsUI();
        } finally {
            this._isUpdatingConfig = false;
        }
    }

    /**
     * Handle updating auto answer text
     */
    private async _handleUpdateAutoAnswerText(text: string): Promise<void> {
        this._isUpdatingConfig = true;
        try {
            const config = vscode.workspace.getConfiguration('tasksync');
            const normalizedText = this._normalizeAutoAnswerText(text, config);
            this._autoAnswerText = normalizedText;
            await config.update('autoAnswerText', normalizedText, vscode.ConfigurationTarget.Global);
            // Reload settings after update to ensure consistency
            this._loadSettings();
            // Update UI to reflect the saved state
            this._updateSettingsUI();
        } finally {
            this._isUpdatingConfig = false;
        }
    }

    /**
     * Handle adding a reusable prompt
     */
    private async _handleAddReusablePrompt(name: string, prompt: string): Promise<void> {
        const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '-');
        const trimmedPrompt = prompt.trim();

        if (!trimmedName || !trimmedPrompt) return;

        // Check for duplicate names
        if (this._reusablePrompts.some(p => p.name.toLowerCase() === trimmedName)) {
            vscode.window.showWarningMessage(`A prompt with name "/${trimmedName}" already exists.`);
            return;
        }

        const newPrompt: ReusablePrompt = {
            id: `rp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            name: trimmedName,
            prompt: trimmedPrompt
        };

        this._reusablePrompts.push(newPrompt);
        await this._saveReusablePrompts();
        this._updateSettingsUI();
    }

    /**
     * Handle editing a reusable prompt
     */
    private async _handleEditReusablePrompt(id: string, name: string, prompt: string): Promise<void> {
        const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '-');
        const trimmedPrompt = prompt.trim();

        if (!trimmedName || !trimmedPrompt) return;

        const existingPrompt = this._reusablePrompts.find(p => p.id === id);
        if (!existingPrompt) return;

        // Check for duplicate names (excluding current prompt)
        if (this._reusablePrompts.some(p => p.id !== id && p.name.toLowerCase() === trimmedName)) {
            vscode.window.showWarningMessage(`A prompt with name "/${trimmedName}" already exists.`);
            return;
        }

        existingPrompt.name = trimmedName;
        existingPrompt.prompt = trimmedPrompt;

        await this._saveReusablePrompts();
        this._updateSettingsUI();
    }

    /**
     * Handle removing a reusable prompt
     */
    private async _handleRemoveReusablePrompt(id: string): Promise<void> {
        this._reusablePrompts = this._reusablePrompts.filter(p => p.id !== id);
        await this._saveReusablePrompts();
        this._updateSettingsUI();
    }

    /**
     * Handle searching slash commands for autocomplete
     */
    private _handleSearchSlashCommands(query: string): void {
        const queryLower = query.toLowerCase();
        const matchingPrompts = this._reusablePrompts.filter(p =>
            p.name.toLowerCase().includes(queryLower) ||
            p.prompt.toLowerCase().includes(queryLower)
        );

        this._view?.webview.postMessage({
            type: 'slashCommandResults',
            prompts: matchingPrompts
        } as ToWebviewMessage);
    }

    /**
     * Handle searching context references (#terminal, #problems) - deprecated, now handled via file search
     */
    private async _handleSearchContext(query: string): Promise<void> {
        try {
            const suggestions = await this._contextManager.getContextSuggestions(query);
            this._view?.webview.postMessage({
                type: 'contextSearchResults',
                suggestions: suggestions.map(s => ({
                    type: s.type,
                    label: s.label,
                    description: s.description,
                    detail: s.detail
                }))
            } as ToWebviewMessage);
        } catch (error) {
            console.error('[TaskSync] Error searching context:', error);
            this._view?.webview.postMessage({
                type: 'contextSearchResults',
                suggestions: []
            } as ToWebviewMessage);
        }
    }

    /**
     * Handle selecting a context reference to add as attachment
     */
    private async _handleSelectContextReference(contextType: string, options?: Record<string, unknown>): Promise<void> {
        try {
            const reference = await this._contextManager.getContextContent(
                contextType as ContextReferenceType,
                options
            );

            if (reference) {
                // Add context reference as a special attachment
                const contextAttachment: AttachmentInfo = {
                    id: reference.id,
                    name: reference.label,
                    uri: `context://${reference.type}/${reference.id}`,
                    isTextReference: true
                };
                this._attachments.push(contextAttachment);
                this._updateAttachmentsUI();

                // Also send the reference content so it can be displayed
                this._view?.webview.postMessage({
                    type: 'contextReferenceAdded',
                    reference: {
                        id: reference.id,
                        type: reference.type,
                        label: reference.label,
                        content: reference.content
                    }
                } as ToWebviewMessage);
            } else {
                // Still add a placeholder attachment showing it was selected but empty
                const emptyId = `ctx_empty_${Date.now()}`;
                const friendlyType = contextType.replace(':', ' ');
                const contextAttachment: AttachmentInfo = {
                    id: emptyId,
                    name: `#${friendlyType} (no content)`,
                    uri: `context://${contextType}/${emptyId}`,
                    isTextReference: true
                };
                this._attachments.push(contextAttachment);
                this._updateAttachmentsUI();

                // Show info message
                vscode.window.showInformationMessage(`No ${contextType} content available yet`);
            }
        } catch (error) {
            console.error('[TaskSync] Error selecting context reference:', error);
            vscode.window.showErrorMessage(`Failed to get ${contextType} content`);
        }
    }

    /**
     * Resolve context content from a context URI
     * URI format: context://type/id
     */
    public async resolveContextContent(uri: string): Promise<string | undefined> {
        try {
            const parsed = vscode.Uri.parse(uri);
            if (parsed.scheme !== 'context') return undefined;

            const type = parsed.authority as ContextReferenceType;
            // id is likely in path, e.g. /id
            const id = parsed.path.startsWith('/') ? parsed.path.substring(1) : parsed.path;

            const contextRef = await this._contextManager.getContextContent(type);
            return contextRef?.content;

        } catch (error) {
            console.error('[TaskSync] Error resolving context content:', error);
            return undefined;
        }
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
            console.error('[TaskSync] Failed to load persisted history:', error);
            this._persistedHistory = [];
        }
    }

    /**
     * Save persisted history to disk with debounced async write
     * Uses background async saves to avoid blocking the main thread
     */
    private _savePersistedHistoryToDisk(): void {
        this._historyDirty = true;

        // Cancel any pending save
        if (this._historySaveTimer) {
            clearTimeout(this._historySaveTimer);
        }

        // Schedule debounced async save
        this._historySaveTimer = setTimeout(() => {
            this._savePersistedHistoryToDiskAsync();
        }, this._HISTORY_SAVE_DEBOUNCE_MS);
    }

    /**
     * Async save persisted history (non-blocking background save)
     */
    private async _savePersistedHistoryToDiskAsync(): Promise<void> {
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            const historyPath = path.join(storagePath, 'tool-history.json');

            // Use async fs operations from fs/promises
            const fsPromises = await import('fs/promises');

            try {
                await fsPromises.access(storagePath);
            } catch {
                await fsPromises.mkdir(storagePath, { recursive: true });
            }

            // Only save completed entries
            const completedHistory = this._persistedHistory.filter(entry => entry.status === 'completed');

            const data = JSON.stringify({
                history: completedHistory
            }, null, 2);

            await fsPromises.writeFile(historyPath, data, 'utf8');
            this._historyDirty = false;
        } catch (error) {
            console.error('[TaskSync] Failed to save persisted history (async):', error);
        }
    }

    /**
     * Actually persist history to disk (synchronous - only for deactivate)
     * Called during extension deactivation when async operations cannot complete
     */
    private _savePersistedHistoryToDiskSync(): void {
        // Only save if there are pending changes
        if (!this._historyDirty) return;

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
            this._historyDirty = false;
        } catch (error) {
            console.error('[TaskSync] Failed to save persisted history:', error);
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
        const notificationSoundUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'notification.wav'));
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; media-src ${webview.cspSource} data:;">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>TaskSync Chat</title>
    <audio id="notification-sound" preload="auto" src="${notificationSoundUri}"></audio>
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

                <div class="welcome-auto-answer" id="welcome-auto-answer">
                    <div class="welcome-auto-answer-text">
                        <div class="welcome-auto-answer-label">
                            <span class="codicon codicon-rocket"></span>
                            <span class="welcome-auto-answer-title">Auto answer</span>
                        </div>
                        <p class="welcome-auto-answer-desc">Useful if you need to temporarily provide autonomy for an agent.</p>
                    </div>
                    <div class="toggle-switch" id="auto-answer-main-toggle" role="switch" aria-checked="false" aria-label="Enable auto answer" tabindex="0"></div>
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
            <!-- Slash Command Autocomplete Dropdown -->
            <div class="slash-dropdown hidden" id="slash-dropdown">
                <div class="slash-list" id="slash-list"></div>
                <div class="slash-empty hidden" id="slash-empty">No prompts found. Add prompts in Settings.</div>
            </div>
            <div class="input-wrapper" id="input-wrapper">
            <!-- Prompt Queue Section - Integrated above input -->
            <div class="queue-section" id="queue-section" role="region" aria-label="Prompt queue">
                <div class="queue-header" id="queue-header" role="button" tabindex="0" aria-expanded="true" aria-controls="queue-list">
                    <div class="accordion-icon" aria-hidden="true">
                        <span class="codicon codicon-chevron-down"></span>
                    </div>
                    <span class="queue-header-title">Prompt Queue</span>
                    <span class="queue-count" id="queue-count" aria-live="polite">0</span>
                </div>
                <div class="queue-list" id="queue-list" role="list" aria-label="Queued prompts">
                    <div class="queue-empty" role="status">No prompts in queue</div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="input-container" id="input-container">
            <!-- Attachment Chips INSIDE input container -->
            <div class="chips-container hidden" id="chips-container"></div>
            <div class="input-row">
                <div class="input-highlighter-wrapper">
                    <div class="input-highlighter" id="input-highlighter" aria-hidden="true"></div>
                    <textarea id="chat-input" placeholder="Reply to tool call. (use # for files, / for prompts)" rows="1" aria-label="Message input. Use # for file references, / for saved prompts"></textarea>
                </div>
            </div>
            <div class="actions-bar">
                <div class="actions-left">
                    <button id="attach-btn" class="icon-btn" title="Add attachment (+)" aria-label="Add attachment">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <div class="mode-selector" id="mode-selector">
                        <button id="mode-btn" class="mode-btn" title="Select mode" aria-label="Select mode">
                            <span id="mode-label">Queue</span>
                            <span class="codicon codicon-chevron-down"></span>
                        </button>
                    </div>
                </div>
                <div class="actions-right">
                    <button id="send-btn" title="Send message" aria-label="Send message">
                        <span class="codicon codicon-arrow-up"></span>
                    </button>
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

        // Search the ENTIRE text for numbered/lettered lists, not just after the last "?"
        // The previous approach failed when examples within the text contained "?" characters
        // (e.g., "Example: What's your favorite language?")

        // Strategy: Find the FIRST major numbered/lettered list that starts early in the text
        // These are the actual choices, not examples or descriptions within the text

        // Split entire text into lines for multi-line patterns
        const lines = text.split('\n');

        // Pattern 1: Numbered options - lines starting with "1." or "1)" through 9
        // Also match bold numbered options like "**1. Option**"
        const numberedLinePattern = /^\s*\*{0,2}(\d+)[.)]\s*\*{0,2}\s*(.+)$/;
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

        // Find the FIRST contiguous list (which contains the main choices)
        // Previously used LAST list which missed choices when examples appeared later in text
        if (numberedLines.length >= 2) {
            // Find all list boundaries by detecting number restarts
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

            // Get the FIRST list (the main choices list)
            // The first numbered list is typically the actual choices
            // Later lists are often examples or descriptions within each choice
            const firstListEnd = listBoundaries.length > 1 ? listBoundaries[1] : numberedLines.length;
            const firstGroup = numberedLines.slice(0, firstListEnd);

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

        // Additional heuristic: short questions ending with ? are likely yes/no
        if (lowerText.length < this._SHORT_QUESTION_THRESHOLD && lowerText.trim().endsWith('?')) {
            // But exclude questions with interrogative words that typically need specific answers
            const interrogatives = /^(?:what|which|where|when|why|how|who|whom|whose)\b/i;
            if (!interrogatives.test(lowerText.trim())) {
                return true;
            }
        }

        return false;
    }
}
