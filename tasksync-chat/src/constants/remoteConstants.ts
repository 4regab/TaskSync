/**
 * Shared constants for remote server functionality (SSOT)
 * Used by both remoteServer.ts and webviewProvider.ts
 */

// Extension configuration section name
export const CONFIG_SECTION = "tasksync";

// Server configuration
export const DEFAULT_REMOTE_PORT = 3580;
export const WS_MAX_PAYLOAD = 1024 * 1024; // 1MB WebSocket message limit
export const WS_PROTOCOL_VERSION = 1; // Increment on breaking WS protocol changes

// Response and input limits
export const MAX_RESPONSE_LENGTH = 100000; // 100KB for tool call responses
export const MAX_QUEUE_PROMPT_LENGTH = 100000; // 100KB max prompt length in queue
export const MAX_QUEUE_SIZE = 100; // Maximum queue items
export const MAX_DIFF_SIZE = 500000; // 500KB max git diff size (truncate large diffs)
export const MAX_COMMIT_MESSAGE_LENGTH = 5000;
export const MAX_REMOTE_HISTORY_ITEMS = 20; // Max tool call history items sent to remote clients

// Error codes for WebSocket error responses
export const ErrorCode = {
	INVALID_INPUT: "INVALID_INPUT",
	ALREADY_ANSWERED: "ALREADY_ANSWERED",
	QUEUE_FULL: "QUEUE_FULL",
	ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
	GIT_UNAVAILABLE: "GIT_UNAVAILABLE",
} as const;

// Attachment limits
export const MAX_ATTACHMENTS = 20; // Maximum attachments per message
export const MAX_ATTACHMENT_URI_LENGTH = 1000;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;

// File/path limits
export const MAX_FILE_PATH_LENGTH = 1024; // Max git file path length
export const MAX_SEARCH_QUERY_LENGTH = 200; // Max git search query length

// Image size limits (intentionally different per entry point)
export const MAX_IMAGE_PASTE_BYTES = 10 * 1024 * 1024; // 10MB — webview paste/drop

// Settings defaults
export const DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES = 5;
export const MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT = 100; // upper clamp for user setting
export const DEFAULT_REMOTE_MAX_DEVICES = 1;
export const MIN_REMOTE_MAX_DEVICES = 1;
export const DEFAULT_SESSION_WARNING_HOURS = 2;
export const SESSION_WARNING_HOURS_MIN = 0;
export const SESSION_WARNING_HOURS_MAX = 8;

// Human-like delay defaults & validation ranges
export const DEFAULT_HUMAN_LIKE_DELAY_MIN = 2; // seconds
export const DEFAULT_HUMAN_LIKE_DELAY_MAX = 6; // seconds
export const HUMAN_DELAY_MIN_LOWER = 1; // minimum allowed for "min delay" input
export const HUMAN_DELAY_MIN_UPPER = 30; // maximum allowed for "min delay" input
export const HUMAN_DELAY_MAX_LOWER = 2; // minimum allowed for "max delay" input
export const HUMAN_DELAY_MAX_UPPER = 60; // maximum allowed for "max delay" input

// Superseded ask_user directive — returned as normal tool result (not CancellationError)
// so the ToolCallingLoop keeps running. Instructs the LLM to re-ask the same question.
export const ASKUSER_SUPERSEDED_MESSAGE =
	"[CANCELLED: This ask_user request was superseded internally. When you call ask_user again, re-ask the exact same question — do not rephrase or summarize differently.]";

// Shared askUser prompt fragments (used by both local and remote session starts)
export const ASKUSER_VISIBILITY_TEXT =
	"The user can ONLY see messages you send via the #askUser tool — your normal chat responses are invisible to them.";
export const ASKUSER_LOOP_TEXT =
	"Do the work, then call #askUser to report results. NEVER end your turn without calling #askUser.";
export const AUTO_APPEND_DEFAULT_TEXT =
	"REQUIRED: The user CANNOT see your response unless you call #askUser. You MUST call #askUser after completing this task. NEVER end your turn without calling #askUser.";

// Default query when a remote session starts without an explicit prompt
export const DEFAULT_REMOTE_SESSION_QUERY = `${ASKUSER_VISIBILITY_TEXT} Start by calling #askUser to greet the user and ask what they need. After receiving their response, do the work, then call #askUser again with results. Continue this loop indefinitely — NEVER end your turn without calling #askUser.`;

/** Build a session-start query when an explicit user request is available. */
export function buildAskUserRequestQuery(request: string): string {
	return `${ASKUSER_VISIBILITY_TEXT} Their request: "${request}". ${ASKUSER_LOOP_TEXT}`;
}

/** Build a follow-up query after a user sends another message. */
export function buildAskUserFollowUpQuery(message: string): string {
	return `The user sent this follow-up: "${message}". ${ASKUSER_VISIBILITY_TEXT} Call #askUser to respond. NEVER end your turn without calling #askUser.`;
}

// Default VS Code command for opening chat from remote sessions
export const DEFAULT_REMOTE_CHAT_COMMAND = "workbench.action.chat.open";

// Response timeout configuration (minutes)
export const RESPONSE_TIMEOUT_ALLOWED_VALUES = new Set<number>([
	0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240,
	300, 360, 420, 480,
]);
export const RESPONSE_TIMEOUT_DEFAULT_MINUTES = 60;
// Threshold above which users see a risk warning (minutes)
export const RESPONSE_TIMEOUT_RISK_THRESHOLD = 240;

// Queue ID validation
export const VALID_QUEUE_ID_PATTERN = /^q_\d+_[a-z0-9]+$/;

/** Check if a value is a valid queue ID (type guard). */
export function isValidQueueId(id: unknown): id is string {
	return typeof id === "string" && VALID_QUEUE_ID_PATTERN.test(id);
}

/**
 * Truncate a diff string to MAX_DIFF_SIZE with a notice appended.
 */
export function truncateDiff(diff: string): string {
	if (diff.length > MAX_DIFF_SIZE) {
		return (
			diff.substring(0, MAX_DIFF_SIZE) +
			"\n\n... (diff truncated, exceeded 500KB limit)"
		);
	}
	return diff;
}
