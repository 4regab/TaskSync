// ==================== Shared Constants (SSOT) ====================
// Use shared constants if available (remote mode), otherwise define inline (VS Code mode)
const SESSION_KEYS =
	typeof TASKSYNC_SESSION_KEYS !== "undefined"
		? TASKSYNC_SESSION_KEYS
		: {
				STATE: "taskSyncState",
				PIN: "taskSyncPin",
				CONNECTED: "taskSyncConnected",
				SESSION_TOKEN: "taskSyncSessionToken",
			};

const MAX_RECONNECT_ATTEMPTS =
	typeof TASKSYNC_MAX_RECONNECT_ATTEMPTS !== "undefined"
		? TASKSYNC_MAX_RECONNECT_ATTEMPTS
		: 20;

const MAX_RECONNECT_DELAY_MS =
	typeof TASKSYNC_MAX_RECONNECT_DELAY_MS !== "undefined"
		? TASKSYNC_MAX_RECONNECT_DELAY_MS
		: 30000; // 30 seconds max reconnect delay

const getWsProtocol =
	typeof getTaskSyncWsProtocol !== "undefined"
		? getTaskSyncWsProtocol
		: function () {
				return location.protocol === "https:" ? "wss:" : "ws:";
			};

// Auto Append instruction text (SSOT from remoteConstants.ts)
const AUTO_APPEND_DEFAULT_TEXT =
	typeof TASKSYNC_AUTO_APPEND_DEFAULT_TEXT !== "undefined"
		? TASKSYNC_AUTO_APPEND_DEFAULT_TEXT
		: "REQUIRED: The user CANNOT see your response unless you call #askUser. You MUST call #askUser after completing this task. NEVER end your turn without calling #askUser.";

const PROCESSING_POLL_INTERVAL_MS = 5000; // Delay before polling server for state after tool call
