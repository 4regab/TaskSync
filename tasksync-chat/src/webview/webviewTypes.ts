import type { ProviderInternal } from "./webviewProvider";

/**
 * WebviewProvider instance type — used by extracted handler modules.
 * Re-exported from webviewProvider.ts to avoid circular value imports.
 * This gives full compile-time type checking for all 67 accessed members.
 */
export type P = ProviderInternal;

/** View type identifier — the SSOT for "taskSyncView" used across the extension */
export const VIEW_TYPE = "taskSyncView";

// Queued prompt interface
export interface QueuedPrompt {
	id: string;
	prompt: string;
	attachments?: AttachmentInfo[]; // Optional attachments (images, files) included with the prompt
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

// File search result (also used for context items like #terminal, #problems and tools)
export interface FileSearchResult {
	name: string;
	path: string;
	uri: string;
	icon: string;
	isFolder?: boolean;
	isContext?: boolean; // true for #terminal, #problems context items
	isTool?: boolean; // true for LM tool references
}

// User response result
export interface UserResponseResult {
	value: string;
	queue: boolean;
	attachments: AttachmentInfo[];
	cancelled?: boolean; // Indicates if the request was superseded by a new one
	directive?: AskUserDirective;
}

export interface AskUserDirective {
	kind: "bootstrap" | "cancelled" | "rejected";
	reason:
		| "auto_assigned_session"
		| "superseded"
		| "missing_session_id"
		| "deleted_session"
		| "terminated_session";
	action:
		| "call_ask_user_again"
		| "call_ask_user_again_with_auto_session"
		| "pass_exact_session_id"
		| "start_new_chat_with_new_session_id";
	sessionId?: string;
	reaskExactSameQuestion?: boolean;
}

// Tool call history entry
export interface ToolCallEntry {
	id: string;
	sessionId?: string;
	prompt: string;
	response: string;
	timestamp: number;
	isFromQueue: boolean;
	status: "pending" | "completed" | "cancelled";
	attachments?: AttachmentInfo[];
}

// Parsed choice from question
export interface ParsedChoice {
	label: string; // Display text (e.g., "1" or "Test functionality")
	value: string; // Response value to send (e.g., "1" or full text)
	shortLabel?: string; // Short version for button (e.g., "1" for numbered)
}

// Reusable prompt interface
export interface ReusablePrompt {
	id: string;
	name: string; // Short name for /slash command (e.g., "fix", "test", "refactor")
	prompt: string; // Full prompt text
}

// Chat session for multi-session orchestration
export interface ChatSession {
	id: string;
	title: string;
	status: "active" | "archived";
	queue: QueuedPrompt[];
	queueEnabled: boolean;
	history: ToolCallEntry[];
	attachments: AttachmentInfo[];
	autopilotEnabled: boolean;
	/** Per-session fallback text when Autopilot is enabled without prompts. */
	autopilotText?: string;
	/** Per-session Autopilot prompt cycle. */
	autopilotPrompts?: string[];
	/** Per-session Auto Append toggle. */
	autoAppendEnabled?: boolean;
	/** Per-session Auto Append text. */
	autoAppendText?: string;
	waitingOnUser: boolean;
	/** True while a non-open session has an unseen actionable pending prompt. */
	unread: boolean;
	createdAt: number;
	/** The toolCallId currently pending for THIS session (null if not waiting) */
	pendingToolCallId: string | null;
	sessionStartTime: number | null;
	sessionFrozenElapsed: number | null;
	sessionTerminated: boolean;
	sessionWarningShown: boolean;
	aiTurnActive: boolean;
	consecutiveAutoResponses: number;
	autopilotIndex: number;
}

// Message types sent from extension to webview
export type ToWebviewMessage =
	| { type: "updateQueue"; queue: QueuedPrompt[]; enabled: boolean }
	| {
			type: "toolCallPending";
			id: string;
			sessionId: string;
			prompt: string;
			isApproval: boolean;
			choices?: ParsedChoice[];
	  }
	| {
			type: "toolCallCompleted";
			entry: ToolCallEntry;
			sessionTerminated?: boolean;
	  }
	| { type: "updateCurrentSession"; history: ToolCallEntry[] }
	| { type: "updatePersistedHistory"; history: ToolCallEntry[] }
	| { type: "fileSearchResults"; files: FileSearchResult[] }
	| { type: "updateAttachments"; attachments: AttachmentInfo[] }
	| { type: "imageSaved"; attachment: AttachmentInfo }
	| { type: "openSettingsModal" }
	| {
			type: "updateSettings";
			soundEnabled: boolean;
			interactiveApprovalEnabled: boolean;
			agentOrchestrationEnabled: boolean;
			autoAppendEnabled: boolean;
			autoAppendText: string;
			autopilotEnabled: boolean;
			autopilotText: string;
			autopilotPrompts: string[];
			reusablePrompts: ReusablePrompt[];
			responseTimeout: number;
			sessionWarningHours: number;
			maxConsecutiveAutoResponses: number;
			remoteMaxDevices: number;
			humanLikeDelayEnabled: boolean;
			humanLikeDelayMin: number;
			humanLikeDelayMax: number;
			sendWithCtrlEnter: boolean;
			queueEnabled: boolean;
	  }
	| { type: "slashCommandResults"; prompts: ReusablePrompt[] }
	| { type: "playNotificationSound" }
	| {
			type: "contextSearchResults";
			suggestions: Array<{
				type: string;
				label: string;
				description: string;
				detail: string;
			}>;
	  }
	| {
			type: "contextReferenceAdded";
			reference: { id: string; type: string; label: string; content: string };
	  }
	| { type: "clear"; statusMessage?: string }
	| {
			type: "updateSessionTimer";
			startTime: number | null;
			frozenElapsed: number | null;
	  }
	| { type: "triggerSendFromShortcut" }
	| { type: "openHistoryModal" }
	| { type: "openNewSessionModal" }
	| { type: "openResetSessionModal" }
	| { type: "toggleSplitView" }
	| { type: "clearPendingState" }
	| {
			type: "updateSessions";
			sessions: ChatSession[];
			activeSessionId: string | null;
	  }
	| {
			type: "sessionSettingsState";
			autopilotEnabled: boolean;
			autopilotPrompts: string[];
			autoAppendEnabled: boolean;
			autoAppendText: string;
			/** Workspace-level default text for auto-append (for dirty-check in UI). */
			workspaceDefaultAutoAppendText: string;
			/** True when all values match TaskSync's per-session defaults. */
			isDefault: boolean;
	  };

// Message types sent from webview to extension
export type FromWebviewMessage =
	| {
			type: "submit";
			sessionId: string | null;
			toolCallId?: string | null;
			value: string;
			attachments: AttachmentInfo[];
	  }
	| {
			type: "addQueuePrompt";
			prompt: string;
			id: string;
			attachments?: AttachmentInfo[];
	  }
	| { type: "removeQueuePrompt"; promptId: string }
	| { type: "editQueuePrompt"; promptId: string; newPrompt: string }
	| { type: "reorderQueue"; fromIndex: number; toIndex: number }
	| { type: "toggleQueue"; enabled: boolean }
	| { type: "clearQueue" }
	| { type: "addAttachment" }
	| { type: "removeAttachment"; attachmentId: string }
	| { type: "removeHistoryItem"; callId: string }
	| { type: "clearPersistedHistory" }
	| { type: "openHistoryModal" }
	| {
			type: "newSession";
			initialPrompt?: string;
			useQueuedPrompt?: boolean;
			stopCurrentSession?: boolean;
	  }
	| { type: "resetSession" }
	| { type: "searchFiles"; query: string }
	| { type: "saveImage"; data: string; mimeType: string }
	| { type: "addFileReference"; file: FileSearchResult }
	| { type: "webviewReady" }
	| { type: "openSettingsModal" }
	| { type: "updateSoundSetting"; enabled: boolean }
	| { type: "updateInteractiveApprovalSetting"; enabled: boolean }
	| { type: "updateAgentOrchestrationSetting"; enabled: boolean }
	| { type: "disableAgentOrchestrationAndStopSessions" }
	| { type: "updateAutoAppendSetting"; enabled: boolean }
	| { type: "updateAutoAppendText"; text: string }
	| { type: "updateAlwaysAppendReminderSetting"; enabled: boolean }
	| { type: "updateAutopilotSetting"; enabled: boolean }
	| { type: "updateAutopilotText"; text: string }
	| { type: "addAutopilotPrompt"; prompt: string }
	| { type: "editAutopilotPrompt"; index: number; prompt: string }
	| { type: "removeAutopilotPrompt"; index: number }
	| { type: "reorderAutopilotPrompts"; fromIndex: number; toIndex: number }
	| { type: "saveAutopilotPrompts"; prompts: string[] }
	| { type: "addReusablePrompt"; name: string; prompt: string }
	| { type: "editReusablePrompt"; id: string; name: string; prompt: string }
	| { type: "removeReusablePrompt"; id: string }
	| { type: "searchSlashCommands"; query: string }
	| { type: "openExternal"; url: string }
	| { type: "openFileLink"; target: string }
	| { type: "updateResponseTimeout"; value: number }
	| { type: "updateSessionWarningHours"; value: number }
	| { type: "updateMaxConsecutiveAutoResponses"; value: number }
	| { type: "updateRemoteMaxDevices"; value: number }
	| { type: "updateHumanDelaySetting"; enabled: boolean }
	| { type: "updateHumanDelayMin"; value: number }
	| { type: "updateHumanDelayMax"; value: number }
	| { type: "updateSendWithCtrlEnterSetting"; enabled: boolean }
	| { type: "searchContext"; query: string }
	| {
			type: "selectContextReference";
			contextType: string;
			options?: Record<string, unknown>;
	  }
	| { type: "copyToClipboard"; text: string }
	| { type: "switchSession"; sessionId: string | null }
	| { type: "archiveSession"; sessionId: string }
	| { type: "deleteSession"; sessionId: string }
	| { type: "updateSessionTitle"; sessionId: string; title: string }
	| {
			type: "updateSessionSettings";
			autopilotEnabled?: boolean;
			autopilotPrompts?: string[];
			autoAppendEnabled?: boolean;
			autoAppendText?: string;
	  }
	| { type: "resetSessionSettings" }
	| { type: "requestSessionSettings" }
	| { type: "saveAutoAppendAsWorkspaceDefault" };
