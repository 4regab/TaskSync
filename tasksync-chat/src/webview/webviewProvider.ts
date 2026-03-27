import * as vscode from "vscode";
import {
	buildAskUserRequestQuery,
	CONFIG_SECTION,
	DEFAULT_HUMAN_LIKE_DELAY_MAX,
	DEFAULT_HUMAN_LIKE_DELAY_MIN,
	DEFAULT_REMOTE_CHAT_COMMAND,
	DEFAULT_REMOTE_SESSION_QUERY,
	DEFAULT_SESSION_WARNING_HOURS,
	MAX_QUEUE_PROMPT_LENGTH,
} from "../constants/remoteConstants";
import { ContextManager, ContextReferenceType } from "../context";
import type { RemoteServer } from "../server/remoteServer";
import { startFreshCopilotChatWithQuery } from "../utils/chatSessionUtils";
import * as fileH from "./fileHandlers";
import * as lifecycle from "./lifecycleHandlers";
import * as router from "./messageRouter";
import * as persist from "./persistence";
import * as remote from "./remoteApiHandlers";
import * as session from "./sessionManager";
import * as settingsH from "./settingsHandlers";
import * as toolCall from "./toolCallHandler";
import {
	type AttachmentInfo,
	type FileSearchResult,
	type FromWebviewMessage,
	type QueuedPrompt,
	type ReusablePrompt,
	type ToolCallEntry,
	type ToWebviewMessage,
	type UserResponseResult,
	VIEW_TYPE,
} from "./webviewTypes";
import { debugLog, mergeAndDedup, notifyQueueChanged } from "./webviewUtils";

const NEW_SESSION_STATUS_MESSAGE = "New session started — waiting for AI";

// Re-export types for external consumers
export type {
	AttachmentInfo,
	FileSearchResult,
	ParsedChoice,
	QueuedPrompt,
	ReusablePrompt,
	ToolCallEntry,
	UserResponseResult,
} from "./webviewTypes";

export class TaskSyncWebviewProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = VIEW_TYPE;

	// All underscore-prefixed members are "internal" by convention but public
	// for handler module access. See webviewTypes.ts P type.
	_view?: vscode.WebviewView;
	_pendingRequests: Map<string, (result: UserResponseResult) => void> =
		new Map();

	// Prompt queue state
	_promptQueue: QueuedPrompt[] = [];
	_queueVersion: number = 0; // Monotonic counter for remote sync
	_queueEnabled: boolean = true; // Default to queue mode

	// Attachments state
	_attachments: AttachmentInfo[] = [];

	// Current session tool calls (memory only - not persisted during session)
	_currentSessionCalls: ToolCallEntry[] = [];

	// Persisted history from past sessions (loaded from disk)
	_persistedHistory: ToolCallEntry[] = [];
	_currentToolCallId: string | null = null;

	// Tracks whether the AI is actively working (between user response and next askUser call)
	_aiTurnActive: boolean = false;

	// Last known chat model name (fetched from VS Code LM API)
	_lastKnownModel: string = "";

	// Webview ready state - prevents race condition on first message
	_webviewReady: boolean = false;
	_pendingToolCallMessage: {
		id: string;
		prompt: string;
	} | null = null;

	// Debounce timer for queue persistence
	_queueSaveTimer: ReturnType<typeof setTimeout> | null = null;

	readonly _QUEUE_SAVE_DEBOUNCE_MS = 300;

	// Debounce timer for history persistence (async background saves)
	_historySaveTimer: ReturnType<typeof setTimeout> | null = null;
	readonly _HISTORY_SAVE_DEBOUNCE_MS = 2000; // 2 seconds debounce
	_historyDirty: boolean = false; // Track if history needs saving

	// Performance limits (SSOT: MAX_QUEUE_PROMPT_LENGTH, MAX_QUEUE_SIZE, MAX_RESPONSE_LENGTH imported from remoteConstants.ts)
	readonly _MAX_HISTORY_ENTRIES = 100;
	readonly _MAX_FILE_SEARCH_RESULTS = 500;
	readonly _MAX_FOLDER_SEARCH_RESULTS = 1000;
	readonly _VIEW_OPEN_TIMEOUT_MS = 5000;
	readonly _VIEW_OPEN_POLL_INTERVAL_MS = 100;

	// File search cache with TTL
	_fileSearchCache: Map<
		string,
		{ results: FileSearchResult[]; timestamp: number }
	> = new Map();
	readonly _FILE_CACHE_TTL_MS = 5000;

	// Map for O(1) lookup of tool calls by ID (synced with _currentSessionCalls array)
	_currentSessionCallsMap: Map<string, ToolCallEntry> = new Map();

	// Reusable prompts (loaded from VS Code settings)
	_reusablePrompts: ReusablePrompt[] = [];

	// Notification sound enabled (loaded from VS Code settings)
	_soundEnabled: boolean = true;

	// Interactive approval buttons enabled (loaded from VS Code settings)
	_interactiveApprovalEnabled: boolean = true;
	// Auto Append setting controls whether shared guidance is appended to ask_user responses.
	_autoAppendEnabled: boolean = false;
	_autoAppendText: string = "";
	// Force askUser reminder even with custom autoAppendText (for GPT 5.4)
	_alwaysAppendReminder: boolean = false;

	readonly _AUTOPILOT_DEFAULT_TEXT =
		"You are temporarily in autonomous mode and must now make your own decision. If another question arises, be sure to ask it, as autonomous mode is temporary.";
	readonly _SESSION_TERMINATION_TEXT =
		"Session terminated. Do not use askUser tool again.";

	// Autopilot enabled (loaded from VS Code settings)
	_autopilotEnabled: boolean = false;

	// Autopilot fallback text used when no autopilot prompts are configured.
	_autopilotText: string = "";

	// Autopilot prompts array (cycles through in order)
	_autopilotPrompts: string[] = [];

	// Current index in autopilot prompts cycle (resets on new session)
	_autopilotIndex: number = 0;

	// Human-like delay settings: adds random jitter before auto-responses.
	// Simulates natural human reading/typing time for a more realistic workflow.
	_humanLikeDelayEnabled: boolean = true;
	_humanLikeDelayMin: number = DEFAULT_HUMAN_LIKE_DELAY_MIN;
	_humanLikeDelayMax: number = DEFAULT_HUMAN_LIKE_DELAY_MAX;

	// Session warning threshold (hours). 0 disables the warning.
	_sessionWarningHours: number = DEFAULT_SESSION_WARNING_HOURS;

	// Allowed timeout values now imported from remoteConstants.ts (SSOT)
	// RESPONSE_TIMEOUT_ALLOWED_VALUES, RESPONSE_TIMEOUT_DEFAULT_MINUTES

	// Send behavior: false => Enter, true => Ctrl/Cmd+Enter
	_sendWithCtrlEnter: boolean = false;

	// Flag to prevent config reload during our own updates (avoids race condition)
	_isUpdatingConfig: boolean = false;

	// Disposables to clean up
	_disposables: vscode.Disposable[] = [];

	// Context manager for #terminal, #problems references
	readonly _contextManager: ContextManager;

	// Response timeout tracking
	_responseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
	_consecutiveAutoResponses: number = 0;

	// Session timer (resets on new session)
	_sessionStartTime: number | null = null; // timestamp when first tool call occurred
	_sessionFrozenElapsed: number | null = null; // frozen elapsed ms when session terminated
	_sessionTimerInterval: ReturnType<typeof setInterval> | null = null;
	// Flag indicating the session was terminated (next tool call auto-starts new session)
	_sessionTerminated: boolean = false;
	// Flag to ensure the 2-hour session warning is only shown once per session
	_sessionWarningShown: boolean = false;

	// Remote server reference for broadcasting state changes
	_remoteServer: RemoteServer | null = null;

	constructor(
		public readonly _extensionUri: vscode.Uri,
		public readonly _context: vscode.ExtensionContext,
		contextManager: ContextManager,
	) {
		this._contextManager = contextManager;
		// Load both queue and history async to not block activation
		this._loadQueueFromDiskAsync().catch((err) => {
			console.error("[TaskSync] Failed to load queue:", err);
		});
		this._loadPersistedHistoryFromDiskAsync().catch((err) => {
			console.error("[TaskSync] Failed to load history:", err);
		});
		// Load settings (sync - fast operation)
		this._loadSettings();

		// Fetch the current chat model name asynchronously
		this.refreshChatModel();

		// Re-fetch models when the available model list changes
		this._disposables.push(
			vscode.lm.onDidChangeChatModels(() => {
				debugLog("[TaskSync] onDidChangeChatModels — refreshing model info");
				this.refreshChatModel();
			}),
		);

		// Listen for settings changes
		this._disposables.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				// Skip reload if we're the ones updating config (prevents race condition)
				if (this._isUpdatingConfig) {
					return;
				}
				if (
					e.affectsConfiguration(`${CONFIG_SECTION}.notificationSound`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.interactiveApproval`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.autoAppendEnabled`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.autoAppendText`) ||
					e.affectsConfiguration(
						`${CONFIG_SECTION}.alwaysAppendAskUserReminder`,
					) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.askUserVerbosePayload`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.autopilot`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.autopilotText`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.autopilotPrompts`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.reusablePrompts`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.responseTimeout`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.remoteMaxDevices`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.sessionWarningHours`) ||
					e.affectsConfiguration(
						`${CONFIG_SECTION}.maxConsecutiveAutoResponses`,
					) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.humanLikeDelay`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.humanLikeDelayMin`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.humanLikeDelayMax`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.sendWithCtrlEnter`)
				) {
					this._loadSettings();
					this._updateSettingsUI();
					// Broadcast all settings to remote clients
					settingsH.broadcastAllSettingsToRemote(this);
				}
			}),
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
		const completedCalls = this._currentSessionCalls.filter(
			(tc) => tc.status === "completed",
		);
		debugLog(
			`[TaskSync] saveCurrentSessionToHistory — completedCalls: ${completedCalls.length}, persistedHistory: ${this._persistedHistory.length}`,
		);
		if (completedCalls.length > 0) {
			this._persistedHistory = mergeAndDedup(
				completedCalls,
				this._persistedHistory,
				this._MAX_HISTORY_ENTRIES,
			);
			this._historyDirty = true;
		}

		// Force sync save on deactivation (async operations can't complete in deactivate)
		this._savePersistedHistoryToDiskSync();
	}

	public openHistoryModal(): void {
		this._view?.webview.postMessage({
			type: "openHistoryModal",
		} satisfies ToWebviewMessage);
		this._updatePersistedHistoryUI();
	}

	public openSettingsModal(): void {
		this._view?.webview.postMessage({
			type: "openSettingsModal",
		} satisfies ToWebviewMessage);
		this._updateSettingsUI();
	}

	public triggerSendFromShortcut(): void {
		this._view?.webview.postMessage({
			type: "triggerSendFromShortcut",
		} satisfies ToWebviewMessage);
	}

	public startNewSession(): void {
		lifecycle.startNewSession(this);
	}

	public async startNewSessionAndResetCopilotChat(
		initialPrompt?: string,
		useQueuedPrompt?: boolean,
	): Promise<void> {
		lifecycle.startNewSession(this, {
			remoteEventType: "newSession",
			statusMessage: NEW_SESSION_STATUS_MESSAGE,
		});

		let chatQuery: string;
		const trimmedPrompt = initialPrompt?.trim();

		if (trimmedPrompt) {
			// User typed a prompt in the modal — use it directly
			chatQuery = buildAskUserRequestQuery(trimmedPrompt);
		} else if (useQueuedPrompt !== false) {
			// Dequeue first item if available (default behavior when no explicit prompt)
			const first = this._promptQueue[0];
			const queuedPrompt = first?.prompt.slice(0, MAX_QUEUE_PROMPT_LENGTH);
			if (first) {
				this._promptQueue.shift();
				notifyQueueChanged(this);
			}
			chatQuery = queuedPrompt
				? buildAskUserRequestQuery(queuedPrompt)
				: DEFAULT_REMOTE_SESSION_QUERY;
		} else {
			chatQuery = DEFAULT_REMOTE_SESSION_QUERY;
		}

		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const chatCommand = config.get<string>(
			"remoteChatCommand",
			DEFAULT_REMOTE_CHAT_COMMAND,
		);

		await startFreshCopilotChatWithQuery(
			chatCommand,
			chatQuery,
			DEFAULT_REMOTE_CHAT_COMMAND,
		);
	}

	public playNotificationSound(): void {
		if (this._soundEnabled) {
			this._view?.webview.postMessage({
				type: "playNotificationSound",
			} satisfies ToWebviewMessage);
		}
	}

	async _applyHumanLikeDelay(label?: string): Promise<void> {
		return session.applyHumanLikeDelay(this, label);
	}

	public openNewSessionModal(): boolean {
		if (!this._view) return false;
		this._view.webview.postMessage({
			type: "openNewSessionModal",
		} satisfies ToWebviewMessage);
		return true;
	}

	public openResetSessionModal(): boolean {
		if (!this._view) return false;
		this._view.webview.postMessage({
			type: "openResetSessionModal",
		} satisfies ToWebviewMessage);
		return true;
	}

	_updateViewTitle(): void {
		session.updateViewTitle(this);
	}
	_startSessionTimerInterval(): void {
		session.startSessionTimerInterval(this);
	}
	_stopSessionTimerInterval(): void {
		session.stopSessionTimerInterval(this);
	}

	_loadSettings(): void {
		settingsH.loadSettings(this);
	}

	/**
	 * Update settings UI in webview
	 */
	_updateSettingsUI(): void {
		settingsH.updateSettingsUI(this);
	}

	// ==================== Remote Server Integration ====================

	/**
	 * Fetch the current chat model name from VS Code LM API (used by remote API).
	 */
	async refreshChatModel(): Promise<void> {
		try {
			const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
			if (models.length > 0) {
				this._lastKnownModel =
					models[0].name || models[0].family || models[0].id;
				debugLog(
					`[TaskSync] refreshChatModel — found ${models.length} models, first: ${this._lastKnownModel}`,
				);
			}
		} catch {
			// LM API not available — leave blank
		}
	}

	/**
	 * Set the remote server reference for broadcasting state changes
	 */
	public setRemoteServer(server: RemoteServer): void {
		debugLog("[TaskSync] setRemoteServer — remote server attached");
		this._remoteServer = server;
	}

	/**
	 * Get current state for remote clients
	 */
	public getRemoteState(): ReturnType<typeof remote.getRemoteState> {
		return remote.getRemoteState(this);
	}

	public resolveRemoteResponse(
		toolCallId: string,
		value: string,
		attachments: AttachmentInfo[],
	): boolean {
		return remote.resolveRemoteResponse(this, toolCallId, value, attachments);
	}

	public addToQueueFromRemote(
		prompt: string,
		attachments: AttachmentInfo[],
	): { error?: string; code?: string } {
		return remote.addToQueueFromRemote(this, prompt, attachments);
	}

	public removeFromQueueById(id: string): void {
		remote.removeFromQueueById(this, id);
	}

	public editQueuePromptFromRemote(
		promptId: string,
		newPrompt: string,
	): { error?: string; code?: string } {
		return remote.editQueuePromptFromRemote(this, promptId, newPrompt);
	}

	public reorderQueueFromRemote(fromIndex: number, toIndex: number): void {
		remote.reorderQueueFromRemote(this, fromIndex, toIndex);
	}

	public clearQueueFromRemote(): void {
		remote.clearQueueFromRemote(this);
	}

	public async setAutopilotEnabled(enabled: boolean): Promise<void> {
		return remote.setAutopilotEnabled(this, enabled);
	}

	public async searchFilesForRemote(
		query: string,
	): Promise<FileSearchResult[]> {
		return remote.searchFilesForRemote(this, query);
	}

	public setQueueEnabled(enabled: boolean): void {
		remote.setQueueEnabled(this, enabled);
	}

	public async setResponseTimeoutFromRemote(timeout: number): Promise<void> {
		return remote.setResponseTimeoutFromRemote(this, timeout);
	}

	public cancelPendingToolCall(reason?: string): boolean {
		return remote.cancelPendingToolCall(this, reason);
	}

	// ==================== End Remote Server Integration ====================

	public dispose(): void {
		lifecycle.disposeProvider(this);
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		debugLog("[TaskSync] resolveWebviewView — setting up webview");
		lifecycle.setupWebviewView(this, webviewView);
	}

	public async waitForUserResponse(
		question: string,
	): Promise<UserResponseResult> {
		return toolCall.waitForUserResponse(this, question);
	}

	_handleWebviewMessage(message: FromWebviewMessage): void {
		router.handleWebviewMessage(this, message);
	}

	_updateAttachmentsUI(): void {
		fileH.updateAttachmentsUI(this);
	}

	/**
	 * Resolve context content from a context URI
	 * URI format: context://type/id
	 */
	public async resolveContextContent(uri: string): Promise<string | undefined> {
		try {
			const parsed = vscode.Uri.parse(uri);
			if (parsed.scheme !== "context") return undefined;

			const type = parsed.authority as ContextReferenceType;
			const contextRef = await this._contextManager.getContextContent(type);
			return contextRef?.content;
		} catch (error) {
			console.error("[TaskSync] Error resolving context content:", error);
			return undefined;
		}
	}

	/**
	 * Update queue UI in webview
	 */
	_updateQueueUI(): void {
		this._view?.webview.postMessage({
			type: "updateQueue",
			queue: this._promptQueue,
			enabled: this._queueEnabled,
		} satisfies ToWebviewMessage);
	}

	/**
	 * Update current session UI in webview (cards in chat)
	 */
	_updateCurrentSessionUI(): void {
		this._view?.webview.postMessage({
			type: "updateCurrentSession",
			history: this._currentSessionCalls,
		} satisfies ToWebviewMessage);
	}

	/**
	 * Update persisted history UI in webview (for modal)
	 * Includes completed calls from the current session so they're visible
	 * without waiting for session end / extension deactivation.
	 */
	_updatePersistedHistoryUI(): void {
		const currentCompleted = this._currentSessionCalls.filter(
			(tc) => tc.status === "completed",
		);
		const seen = new Set<string>();
		const combined = [...currentCompleted, ...this._persistedHistory]
			.filter((entry) => {
				if (seen.has(entry.id)) return false;
				seen.add(entry.id);
				return true;
			})
			.slice(0, this._MAX_HISTORY_ENTRIES);
		this._view?.webview.postMessage({
			type: "updatePersistedHistory",
			history: combined,
		} satisfies ToWebviewMessage);
	}

	private async _loadQueueFromDiskAsync(): Promise<void> {
		return persist.loadQueueFromDiskAsync(this);
	}

	_saveQueueToDisk(): void {
		persist.saveQueueToDisk(this);
	}

	private async _loadPersistedHistoryFromDiskAsync(): Promise<void> {
		return persist.loadPersistedHistoryFromDiskAsync(this);
	}

	_savePersistedHistoryToDisk(): void {
		persist.savePersistedHistoryToDisk(this);
	}

	private _savePersistedHistoryToDiskSync(): void {
		persist.savePersistedHistoryToDiskSync(this);
	}
}

/** Internal type alias for handler modules — provides compile-time safety via P. */
export type ProviderInternal = TaskSyncWebviewProvider;
