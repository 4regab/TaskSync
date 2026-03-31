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
import { startNewSessionChat } from "../utils/chatSessionUtils";
import { ChatSessionManager } from "./chatSessionManager";
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
	type ChatSession,
	type FileSearchResult,
	type FromWebviewMessage,
	type QueuedPrompt,
	type ReusablePrompt,
	type ToolCallEntry,
	type ToWebviewMessage,
	type UserResponseResult,
	VIEW_TYPE,
} from "./webviewTypes";
import {
	debugLog,
	markSessionTerminated,
	mergeAndDedup,
	notifyQueueChanged,
} from "./webviewUtils";

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
	//
	// MIRROR FIELD CONVENTION:
	// Fields marked "Mirrors the ACTIVE session's ..." are copies of the active
	// ChatSession's state. They are kept in sync so the webview and handler
	// modules can read them without reaching into _sessionManager. The canonical
	// source of truth is always the ChatSession object in _sessionManager. When a handler writes to both the session field
	// AND the mirror field, call _syncActiveSessionState() afterward to ensure
	// consistency. If only the session was updated, _syncActiveSessionState()
	// will copy the new value into the mirror field automatically.
	_view?: vscode.WebviewView;

	// Multi-session orchestration manager
	_sessionManager: ChatSessionManager = new ChatSessionManager();

	_pendingRequests: Map<string, (result: UserResponseResult) => void> =
		new Map();

	// Maps each toolCallId → session_id so cancelSupersededPendingRequest
	// can avoid cancelling pending calls that belong to a DIFFERENT session.
	_toolCallSessionMap: Map<string, string> = new Map();

	// Prompt queue state
	// Mirrors the ACTIVE session's queue for the current webview.
	_promptQueue: QueuedPrompt[] = [];
	_queueVersion: number = 0; // Monotonic counter for remote sync
	_queueEnabled: boolean = true; // Mirrors the ACTIVE session's queue mode

	// Attachments state
	// Mirrors the ACTIVE session's attachments/composer state.
	_attachments: AttachmentInfo[] = [];

	// Current session tool calls (memory only - not persisted during session)
	// Mirrors the ACTIVE session's history for the current webview.
	_currentSessionCalls: ToolCallEntry[] = [];

	// Persisted history from past sessions (loaded from disk)
	_persistedHistory: ToolCallEntry[] = [];
	// Mirrors the ACTIVE session's pending tool call id.
	_currentToolCallId: string | null = null;

	// Tracks whether the AI is actively working (between user response and next askUser call)
	_aiTurnActive: boolean = false;

	// Last known chat model name (fetched from VS Code LM API)
	_lastKnownModel: string = "";

	// Webview ready state - prevents race condition on first message
	_webviewReady: boolean = false;
	_pendingToolCallMessage: {
		id: string;
		sessionId: string;
		prompt: string;
	} | null = null;

	// Debounce timer for queue persistence
	_queueSaveTimer: ReturnType<typeof setTimeout> | null = null;

	readonly _QUEUE_SAVE_DEBOUNCE_MS = 300;

	// Debounce timer for session persistence
	_sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
	readonly _SESSION_SAVE_DEBOUNCE_MS = 500;

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
	// Mirrors the ACTIVE session's Auto Append state.
	_autoAppendEnabled: boolean = false;
	_autoAppendText: string = "";
	// Global AskUser reminder toggle.
	_alwaysAppendReminder: boolean = false;

	readonly _AUTOPILOT_DEFAULT_TEXT =
		"You are temporarily in autonomous mode and must now make your own decision. If another question arises, be sure to ask it, as autonomous mode is temporary.";
	readonly _SESSION_TERMINATION_TEXT =
		"Session terminated. Do not use askUser tool again.";

	// Mirrors the ACTIVE session's Autopilot enabled state.
	_autopilotEnabled: boolean = false;

	// Autopilot fallback text used when no session prompts are configured.
	_autopilotText: string = "";

	// Mirrors the ACTIVE session's Autopilot prompt cycle.
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

	// Response timeout tracking is session-owned. Each pending ask_user gets its own timer.
	_responseTimeoutTimers: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
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
		// Load persisted state async to avoid blocking activation.
		this._loadQueueFromDiskAsync()
			.catch((err) => {
				console.error("[TaskSync] Failed to load queue:", err);
			})
			.finally(() => {
				this._loadSessionsFromDiskAsync().catch((err) => {
					console.error("[TaskSync] Failed to load sessions:", err);
				});
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
					e.affectsConfiguration(
						`${CONFIG_SECTION}.alwaysAppendAskUserReminder`,
					) ||
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

	public _getSession(sessionId: string): ChatSession | undefined {
		return this._sessionManager.getSession(sessionId);
	}

	private _sessionDefaults(): Partial<ChatSession> {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const autoAppendText = settingsH.normalizeAutoAppendText(
			config.get<string>("autoAppendText", "") ?? "",
		);
		return {
			queueEnabled: this._queueEnabled,
			autopilotEnabled: false,
			autopilotPrompts: [],
			autoAppendEnabled: false,
			autoAppendText,
		};
	}

	public _ensureSession(
		sessionId: string,
		title: string = this._sessionManager.getNextAgentTitle(),
	): ChatSession {
		const session = this._sessionManager.ensureSession(
			sessionId,
			title,
			this._sessionDefaults(),
		);
		for (const entry of session.history) {
			entry.sessionId ??= session.id;
			this._currentSessionCallsMap.set(entry.id, entry);
		}
		return session;
	}

	public _getSessionForToolCall(toolCallId: string): ChatSession | undefined {
		const directSessionId = this._toolCallSessionMap.get(toolCallId);
		if (directSessionId) {
			return this._sessionManager.getSession(directSessionId);
		}

		for (const session of this._sessionManager.getAllSessions()) {
			if (session.pendingToolCallId === toolCallId) {
				return session;
			}
			if (session.history.some((entry) => entry.id === toolCallId)) {
				return session;
			}
		}
		return undefined;
	}

	public _setActiveSession(sessionId: string | null): boolean {
		const switched = this._sessionManager.setActiveSession(sessionId);
		if (switched) {
			this._syncActiveSessionState();
			// Keep remote clients in sync with the newly active session
			this._remoteServer?.broadcast("state", this.getRemoteState());
		}
		return switched;
	}

	public _syncActiveSessionState(): void {
		const activeSession = this._sessionManager.getActiveSession();

		if (activeSession) {
			for (const entry of activeSession.history) {
				entry.sessionId ??= activeSession.id;
				this._currentSessionCallsMap.set(entry.id, entry);
			}
			this._currentSessionCalls = activeSession.history;
			this._promptQueue = activeSession.queue;
			this._attachments = activeSession.attachments;
			this._queueEnabled = activeSession.queueEnabled;
			this._currentToolCallId = activeSession.pendingToolCallId;
			this._autopilotEnabled = activeSession.autopilotEnabled;
			this._sessionStartTime = activeSession.sessionStartTime;
			this._sessionFrozenElapsed = activeSession.sessionFrozenElapsed;
			this._sessionTerminated = activeSession.sessionTerminated;
			this._sessionWarningShown = activeSession.sessionWarningShown;
			this._aiTurnActive = activeSession.aiTurnActive;
			this._consecutiveAutoResponses = activeSession.consecutiveAutoResponses;
			this._autopilotIndex = activeSession.autopilotIndex;
		} else {
			this._currentSessionCalls = [];
			this._promptQueue = [];
			this._attachments = [];
			this._currentToolCallId = null;
			this._sessionStartTime = null;
			this._sessionFrozenElapsed = null;
			this._sessionTerminated = false;
			this._sessionWarningShown = false;
			this._aiTurnActive = false;
			this._consecutiveAutoResponses = 0;
			this._autopilotIndex = 0;
		}

		if (
			this._sessionStartTime !== null &&
			this._sessionFrozenElapsed === null
		) {
			this._startSessionTimerInterval();
		} else {
			this._stopSessionTimerInterval();
		}

		this._updateViewTitle();
		this._updateCurrentSessionUI();
		this._updateQueueUI();
		this._updateAttachmentsUI();
		this._loadSettings();
		this._updateSettingsUI();
	}

	public _bindSession(sessionId: string): ChatSession {
		return this._ensureSession(
			sessionId,
			this._sessionManager.getNextAgentTitle(),
		);
	}

	public createSessionForMissingId(): ChatSession {
		const session = this._sessionManager.createSession(
			this._sessionManager.getNextAgentTitle(),
			this._sessionManager.getNextSessionId(),
			this._sessionDefaults(),
			false,
		);
		this._updateSessionsUI();
		this._saveSessionsToDisk();
		return session;
	}

	public _clearResponseTimeoutTimer(
		toolCallId: string | null | undefined,
	): void {
		if (!toolCallId) return;
		const timer = this._responseTimeoutTimers.get(toolCallId);
		if (timer) {
			clearTimeout(timer);
			this._responseTimeoutTimers.delete(toolCallId);
		}
	}

	public startNewSession(): void {
		lifecycle.startNewSession(this);
	}

	public async startNewSessionAndResetCopilotChat(options?: {
		initialPrompt?: string;
		useQueuedPrompt?: boolean;
		stopCurrentSession?: boolean;
	}): Promise<void> {
		const previousActiveSession = this._sessionManager.getActiveSession();
		let queuedPromptFromPrevious: QueuedPrompt | undefined;
		const useQueuedPrompt = options?.useQueuedPrompt;

		if (useQueuedPrompt !== false && previousActiveSession?.queue.length) {
			queuedPromptFromPrevious = previousActiveSession.queue.shift();
			if (
				previousActiveSession.id === this._sessionManager.getActiveSessionId()
			) {
				notifyQueueChanged(this);
			}
		}

		if (options?.stopCurrentSession && previousActiveSession) {
			if (previousActiveSession.pendingToolCallId) {
				this.cancelPendingToolCall(
					"[Session stopped by user]",
					previousActiveSession.id,
				);
			}
			markSessionTerminated(this, previousActiveSession);
			this._saveSessionsToDisk();
		}

		const chatSession = this._sessionManager.createSession(
			this._sessionManager.getNextAgentTitle(),
			undefined,
			this._sessionDefaults(),
		);
		this._syncActiveSessionState();
		this._saveSessionsToDisk();
		this._updateSessionsUI();
		this._view?.webview.postMessage({
			type: "clear",
			statusMessage: NEW_SESSION_STATUS_MESSAGE,
		} satisfies ToWebviewMessage);
		this._remoteServer?.broadcast("newSession", {
			statusMessage: NEW_SESSION_STATUS_MESSAGE,
		});

		let chatQuery: string;
		const trimmedPrompt = options?.initialPrompt?.trim();

		if (trimmedPrompt) {
			// User typed a prompt in the modal — use it directly (clamped to max length)
			chatQuery = buildAskUserRequestQuery(
				trimmedPrompt.slice(0, MAX_QUEUE_PROMPT_LENGTH),
			);
		} else if (useQueuedPrompt !== false) {
			// Optionally bootstrap the new session from the previously active
			// session's next queued prompt.
			const queuedPrompt = queuedPromptFromPrevious?.prompt.slice(
				0,
				MAX_QUEUE_PROMPT_LENGTH,
			);
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

		// Use session-aware chat starter to inject session_id into Copilot
		await startNewSessionChat(
			chatSession.id,
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

	public toggleSplitView(): void {
		this._view?.webview.postMessage({
			type: "toggleSplitView",
		} satisfies ToWebviewMessage);
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
		sessionId: string,
		toolCallId: string,
		value: string,
		attachments: AttachmentInfo[],
	): boolean {
		return remote.resolveRemoteResponse(
			this,
			sessionId,
			toolCallId,
			value,
			attachments,
		);
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

	public cancelPendingToolCall(reason?: string, sessionId?: string): boolean {
		return remote.cancelPendingToolCall(this, reason, sessionId);
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
		sessionId?: string,
	): Promise<UserResponseResult> {
		return toolCall.waitForUserResponse(this, question, sessionId);
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
	 * Push multi-session state to the webview (threads list, active session)
	 * and broadcast lightweight session summaries to remote clients.
	 */
	_updateSessionsUI(): void {
		const data = this._sessionManager.toJSON();
		this._view?.webview.postMessage({
			type: "updateSessions",
			sessions: data.sessions,
			activeSessionId: data.activeSessionId,
		} satisfies ToWebviewMessage);
		this._remoteServer?.broadcast("updateSessions", {
			sessions: remote.getRemoteSessionSummaries(this),
			activeSessionId: data.activeSessionId,
		});
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
		await persist.loadPersistedHistoryFromDiskAsync(this);
		// Push loaded history to the webview if it's ready
		if (this._webviewReady) {
			this._updatePersistedHistoryUI();
		}
	}

	_savePersistedHistoryToDisk(): void {
		persist.savePersistedHistoryToDisk(this);
	}

	private _savePersistedHistoryToDiskSync(): void {
		persist.savePersistedHistoryToDiskSync(this);
	}

	private async _loadSessionsFromDiskAsync(): Promise<void> {
		await persist.loadSessionsFromDiskAsync(this);
		// Clear stale pending state: after a reload, Promise resolvers are gone
		// so any persisted pendingToolCallId can never be resolved.
		for (const session of this._sessionManager.getAllSessions()) {
			if (
				session.pendingToolCallId &&
				!this._pendingRequests.has(session.pendingToolCallId)
			) {
				session.pendingToolCallId = null;
				session.waitingOnUser = false;
				session.aiTurnActive = false;
			}
			// Transition stale "pending" history entries to "completed" —
			// their tool-call Promises are gone so they can never resolve.
			for (const entry of session.history) {
				if (entry.status === "pending") {
					entry.status = "completed";
					entry.response ??= "[Session interrupted]";
				}
			}
		}
		this._syncActiveSessionState();
		this._updateSessionsUI();
	}

	_saveSessionsToDisk(): void {
		persist.saveSessionsToDisk(this);
	}
}

/** Internal type alias for handler modules — provides compile-time safety via P. */
export type ProviderInternal = TaskSyncWebviewProvider;
