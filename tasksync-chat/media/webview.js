/**
 * TaskSync Extension - Webview Script
 * Handles tool call history, prompt queue, attachments, and file autocomplete
 * 
 * Supports both VS Code webview (postMessage) and Remote PWA (WebSocket) modes
 * 
 * Built from src/webview-ui/ — DO NOT EDIT DIRECTLY
 */
(function () {
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
// ==================== Communication Adapter ====================
// Provides unified API for VS Code postMessage or WebSocket communication
const isRemoteMode = typeof acquireVsCodeApi === "undefined";
// Debug mode: enable via localStorage.setItem('TASKSYNC_DEBUG', 'true')
const REMOTE_DEBUG =
	isRemoteMode && localStorage.getItem("TASKSYNC_DEBUG") === "true";
/** Detect Safari (excludes Chrome/Chromium-based and iOS alternative browsers). */
const isRemoteSafari =
	isRemoteMode &&
	/Safari/.test(navigator.userAgent) &&
	!/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS)/.test(navigator.userAgent);
function debugLog(...args) {
	if (REMOTE_DEBUG) console.log("[TaskSync Debug]", ...args);
}
let ws = null;
let wsReconnectAttempt = 0;
let wsState = {}; // Persisted state for remote mode
let wsConnecting = false; // Debounce flag to prevent rapid reconnect attempts
let pendingCriticalMessage = null; // Critical message awaiting send (tool responses)
let pendingOutboundMessages = []; // Non-critical messages queued while disconnected
const MAX_PENDING_OUTBOUND_MESSAGES = 100;
const REPLACEABLE_OUTBOUND_TYPES = new Set([
	"toggleQueue",
	"toggleAutopilot",
	"updateResponseTimeout",
	"updateRemoteMaxDevices",
	"searchFiles",
	"getState",
	"chatCancel",
]);
let processingCheckTimer = null; // Timer to poll server when "Working..." is shown
let wsReconnectTimer = null; // Timer for scheduled reconnect

function queueOutboundMessage(remoteMsg) {
	if (!remoteMsg || !remoteMsg.type) return;

	if (REPLACEABLE_OUTBOUND_TYPES.has(remoteMsg.type)) {
		for (var i = pendingOutboundMessages.length - 1; i >= 0; i--) {
			if (pendingOutboundMessages[i].type === remoteMsg.type) {
				pendingOutboundMessages[i] = remoteMsg;
				return;
			}
		}
	}

	if (pendingOutboundMessages.length >= MAX_PENDING_OUTBOUND_MESSAGES) {
		pendingOutboundMessages.shift();
	}
	pendingOutboundMessages.push(remoteMsg);
}

function flushQueuedOutboundMessages() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;

	if (pendingOutboundMessages.length > 0) {
		debugLog(
			"Flushing queued outbound messages:",
			pendingOutboundMessages.length,
		);
		while (
			pendingOutboundMessages.length > 0 &&
			ws &&
			ws.readyState === WebSocket.OPEN
		) {
			ws.send(JSON.stringify(pendingOutboundMessages.shift()));
		}
	}

	if (pendingCriticalMessage && ws && ws.readyState === WebSocket.OPEN) {
		if (pendingToolCall && pendingCriticalMessage.id === pendingToolCall.id) {
			ws.send(JSON.stringify(pendingCriticalMessage));
		} else if (!pendingToolCall) {
			ws.send(JSON.stringify(pendingCriticalMessage));
		} else {
			// Stale queued critical message — drop silently
		}
		pendingCriticalMessage = null;
	}
}

// Create adapter that works in both environments
const vscode = isRemoteMode ? createRemoteAdapter() : acquireVsCodeApi();

function createRemoteAdapter() {
	debugLog("Creating remote adapter");
	// Load state from sessionStorage for remote mode
	try {
		const saved = sessionStorage.getItem(SESSION_KEYS.STATE);
		if (saved) wsState = JSON.parse(saved);
	} catch (e) {
		wsState = {};
	}

	return {
		postMessage: function (msg) {
			debugLog("postMessage called:", msg.type);
			const remoteMsg = mapToRemoteMessage(msg);
			if (!remoteMsg) return;

			const isCritical = remoteMsg.type === "respond";
			const wsReady = ws && ws.readyState === WebSocket.OPEN;

			if (wsReady) {
				ws.send(JSON.stringify(remoteMsg));
				if (isCritical) pendingCriticalMessage = null;
			} else if (isCritical) {
				pendingCriticalMessage = remoteMsg;
			} else {
				queueOutboundMessage(remoteMsg);
			}
		},
		getState: function () {
			return wsState;
		},
		setState: function (state) {
			wsState = state;
			try {
				sessionStorage.setItem(SESSION_KEYS.STATE, JSON.stringify(state));
			} catch (e) {
				console.error("[TaskSync] Failed to save state:", e);
			}
		},
	};
}

function mapToRemoteMessage(msg) {
	// Map VS Code webview messages to remote server messages
	switch (msg.type) {
		case "submit":
			// Response to a pending tool call
			if (pendingToolCall) {
				return {
					type: "respond",
					sessionId:
						msg.sessionId || pendingToolCall.sessionId || activeSessionId || "",
					id: pendingToolCall.id,
					value: msg.value,
					attachments: msg.attachments || [],
				};
			}
			// No pending tool call — add to queue instead (matches VS Code behavior)
			return {
				type: "addToQueue",
				prompt: msg.value,
				attachments: msg.attachments || [],
			};
		case "addQueuePrompt":
			return {
				type: "addToQueue",
				prompt: msg.prompt,
				attachments: msg.attachments || [],
			};
		case "removeQueuePrompt":
			return { type: "removeFromQueue", id: msg.promptId };
		case "editQueuePrompt":
			return {
				type: "editQueuePrompt",
				promptId: msg.promptId,
				newPrompt: msg.newPrompt,
			};
		case "reorderQueue":
			return {
				type: "reorderQueue",
				fromIndex: msg.fromIndex,
				toIndex: msg.toIndex,
			};
		case "clearQueue":
			return { type: "clearQueue" };
		case "toggleQueue":
			return { type: "toggleQueue", enabled: msg.enabled };
		case "updateAutopilotSetting":
			return { type: "toggleAutopilot", enabled: msg.enabled };
		case "updateResponseTimeout":
			return { type: "updateResponseTimeout", timeout: msg.value };
		case "newSession":
			return { type: "newSession" };
		case "resetSession":
			return { type: "resetSession" };
		case "chatMessage":
			return { type: "chatMessage", content: msg.content };
		case "chatFollowUp":
			return { type: "chatFollowUp", content: msg.content };
		case "chatCancel":
			return {
				type: "chatCancel",
				sessionId: pendingToolCall ? pendingToolCall.sessionId : "",
			};
		case "startSession":
			return { type: "startSession", prompt: msg.prompt || "" };
		case "webviewReady":
			return { type: "getState" };
		// Messages that don't apply to remote (VS Code specific)
		case "openExternal":
			// Open external links in new tab in remote mode
			if (msg.url) {
				window.open(msg.url, "_blank", "noopener,noreferrer");
			}
			return null;
		case "addAttachment":
		case "openLink":
		case "openHistoryModal":
		case "openSettingsModal":
			return null; // Handle locally or ignore
		case "searchFiles":
			return { type: "searchFiles", query: msg.query };
		// VS Code-only settings/UI messages — not applicable to remote
		case "updateSoundSetting":
		case "updateInteractiveApprovalSetting":
		case "updateAutoAppendSetting":
		case "updateAutoAppendText":
		case "updateSendWithCtrlEnterSetting":
		case "updateHumanDelaySetting":
		case "updateHumanDelayMin":
		case "updateHumanDelayMax":
		case "updateSessionWarningHours":
		case "updateMaxConsecutiveAutoResponses":
		case "updateRemoteMaxDevices":
		case "addAutopilotPrompt":
		case "editAutopilotPrompt":
		case "removeAutopilotPrompt":
		case "reorderAutopilotPrompts":
		case "addReusablePrompt":
		case "editReusablePrompt":
		case "removeReusablePrompt":
		case "updateAutopilotText":
		case "searchSlashCommands":
			return msg; // Forward settings to server
		case "addFileReference":
		case "copyToClipboard":
		case "saveImage":
		case "removeHistoryItem":
		case "clearPersistedHistory":
		case "openFileLink":
		case "searchContext":
		case "selectContextReference":
			return null;
		// Multi-session operations — forward to server as-is
		case "switchSession":
			return { type: "switchSession", sessionId: msg.sessionId || "" };
		case "deleteSession":
			return { type: "deleteSession", sessionId: msg.sessionId || "" };
		case "archiveSession":
			return { type: "archiveSession", sessionId: msg.sessionId || "" };
		case "updateSessionTitle":
			return {
				type: "updateSessionTitle",
				sessionId: msg.sessionId || "",
				title: msg.title || "",
			};
		default:
			// Pass through unknown messages
			return msg;
	}
}

let serverShutdown = false; // Track if server was intentionally stopped

// Update connection status indicator in remote header
function updateRemoteConnectionStatus(status, reason) {
	let indicator = document.getElementById("remote-connection-status");
	if (indicator) {
		indicator.className = "remote-status " + status;
		if (status === "connected") {
			indicator.title = "Connected";
		} else if (reason === "shutdown") {
			indicator.title = "Server stopped";
		} else if (reason === "max-attempts") {
			indicator.title = isRemoteSafari
				? "Connection failed \u2014 Safari may block WebSocket when Private Relay is on. Disable it in Settings \u2192 Safari \u2192 Privacy, or use Chrome."
				: "Connection failed - server unreachable";
		} else {
			indicator.title = "Disconnected - reconnecting...";
		}
	}
}

// Initialize WebSocket for remote mode
if (isRemoteMode) {
	connectRemoteWebSocket();
	// Cleanup on page unload to prevent reconnection attempts during teardown
	window.addEventListener("beforeunload", function () {
		clearTimeout(wsReconnectTimer);
		clearTimeout(processingCheckTimer);
		if (remoteSessionTimerInterval) {
			clearInterval(remoteSessionTimerInterval);
			remoteSessionTimerInterval = null;
		}
		serverShutdown = true; // Prevent reconnection
	});
}

function connectRemoteWebSocket() {
	if (wsConnecting) return;
	wsConnecting = true;

	// Close any existing connection before creating new one
	if (ws) {
		try {
			ws.close();
		} catch (e) {
			console.error("[TaskSync] Failed to close WebSocket:", e);
		}
		ws = null;
	}
	serverShutdown = false;

	ws = new WebSocket(`${getWsProtocol()}//${location.host}`);

	ws.onopen = function () {
		wsConnecting = false;
		wsReconnectAttempt = 0;
		const sessionToken =
			sessionStorage.getItem(SESSION_KEYS.SESSION_TOKEN) || "";
		const pin = sessionStorage.getItem(SESSION_KEYS.PIN) || "";
		ws.send(
			JSON.stringify({ type: "auth", pin: pin, sessionToken: sessionToken }),
		);
	};

	ws.onmessage = function (e) {
		try {
			const msg = JSON.parse(e.data);
			debugLog("WS received:", msg.type, msg);
			handleRemoteMessage(msg);
		} catch (err) {
			console.error("[TaskSync Remote] Message error:", err);
		}
	};

	ws.onclose = function (event) {
		wsConnecting = false;
		clearTimeout(processingCheckTimer);
		if (serverShutdown) {
			updateRemoteConnectionStatus("disconnected", "shutdown");
			// Don't reconnect - server was intentionally stopped
			return;
		}
		// 1013 = Try Again Later (server at capacity)
		if (event.code === 1013) {
			updateRemoteConnectionStatus(
				"disconnected",
				"Server at capacity — retry later",
			);
			return;
		}
		updateRemoteConnectionStatus("disconnected");
		scheduleRemoteReconnect();
	};

	ws.onerror = function () {
		wsConnecting = false;
		updateRemoteConnectionStatus("disconnected");
	};
}

function scheduleRemoteReconnect() {
	if (serverShutdown) {
		debugLog("Reconnect skipped (server shutdown)");
		return;
	}
	wsReconnectAttempt++;
	debugLog("Scheduling reconnect attempt:", wsReconnectAttempt);
	if (wsReconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
		updateRemoteConnectionStatus("disconnected", "max-attempts");
		console.error("[TaskSync Remote] Max reconnection attempts reached.");
		return;
	}
	const delay = Math.min(
		1000 * Math.pow(1.5, wsReconnectAttempt),
		MAX_RECONNECT_DELAY_MS,
	);
	debugLog("Reconnect in", delay, "ms");
	wsReconnectTimer = setTimeout(connectRemoteWebSocket, delay);
}

function handleRemoteMessage(msg) {
	debugLog("Handling message:", msg.type);
	switch (msg.type) {
		case "serverShutdown":
			debugLog("Server shutdown received");
			serverShutdown = true;
			updateRemoteConnectionStatus("disconnected", "shutdown");
			if (editingPromptId) exitEditMode();
			// Show user-friendly message
			alert(
				"Server stopped: " +
					(msg.reason || "The remote server has been stopped."),
			);
			return;
		case "connected":
		case "authSuccess":
			if (
				msg.protocolVersion !== undefined &&
				msg.protocolVersion !== TASKSYNC_PROTOCOL_VERSION
			)
				console.error(
					"[TaskSync Remote] Protocol version mismatch: server=" +
						msg.protocolVersion +
						" client=" +
						TASKSYNC_PROTOCOL_VERSION,
				);
			debugLog(
				"Auth success, hasState:",
				!!msg.state,
				"hasSessionToken:",
				!!msg.sessionToken,
			);
			if (msg.state) applyServerState(msg.state);
			if (msg.sessionToken)
				sessionStorage.setItem(SESSION_KEYS.SESSION_TOKEN, msg.sessionToken);
			updateRemoteConnectionStatus("connected");
			flushQueuedOutboundMessages();
			break;
		case "authFailed":
			debugLog("Auth failed, redirecting to login");
			sessionStorage.removeItem(SESSION_KEYS.CONNECTED);
			sessionStorage.removeItem(SESSION_KEYS.PIN);
			sessionStorage.removeItem(SESSION_KEYS.STATE);
			sessionStorage.removeItem(SESSION_KEYS.SESSION_TOKEN);
			window.location.href = "index.html";
			break;
		case "requireAuth":
			// Server sends this before auth is processed — handled by onopen auth flow
			break;
		case "toolCallPending":
			if (!msg.data) break;
			debugLog(
				"toolCallPending:",
				msg.data.id,
				"isApproval:",
				msg.data.isApproval,
			);
			if (typeof updateRemoteSessionTimerState === "function") {
				updateRemoteSessionTimerState(
					typeof msg.data.sessionStartTime === "number"
						? msg.data.sessionStartTime
						: remoteSessionStartTime,
					typeof msg.data.sessionFrozenElapsed === "number"
						? msg.data.sessionFrozenElapsed
						: remoteSessionFrozenElapsed,
				);
			}
			clearTimeout(processingCheckTimer);
			showPendingToolCall(
				msg.data.id,
				msg.data.sessionId,
				msg.data.prompt,
				msg.data.isApproval,
				msg.data.choices,
			);
			if (typeof playNotificationSound === "function") playNotificationSound();
			break;
		case "toolCallCompleted":
			if (!msg.data) break;
			debugLog(
				"toolCallCompleted:",
				msg.data.entry?.id,
				"sessionTerminated:",
				msg.data.sessionTerminated,
			);
			document.body.classList.remove("has-pending-toolcall");
			if (typeof hideApprovalModal === "function") hideApprovalModal();
			if (typeof hideChoicesBar === "function") hideChoicesBar();
			if (msg.data.entry) {
				if (!msg.data.entry.status) msg.data.entry.status = "completed";
				currentSessionCalls = currentSessionCalls.filter(function (tc) {
					return tc.id !== msg.data.entry.id;
				});
				currentSessionCalls = [msg.data.entry, ...currentSessionCalls].slice(
					0,
					MAX_DISPLAY_HISTORY,
				);
				renderCurrentSession();
			}
			pendingToolCall = null;
			if (typeof scrollToBottom === "function") scrollToBottom();
			if (msg.data.sessionTerminated) {
				isProcessingResponse = false;
				if (pendingMessage) {
					pendingMessage.classList.remove("hidden");
					pendingMessage.innerHTML =
						'<div class="new-session-prompt"><span>Session terminated</span>' +
						'<button class="new-session-btn" id="remote-terminated-new-session-btn">' +
						'<span class="codicon codicon-add"></span> Start new session</button></div>';
					var tBtn = document.getElementById(
						"remote-terminated-new-session-btn",
					);
					if (tBtn)
						tBtn.addEventListener("click", function () {
							openNewSessionModal();
						});
				}
			} else {
				isProcessingResponse = true;
				updatePendingUI();
				clearTimeout(processingCheckTimer);
				processingCheckTimer = setTimeout(function () {
					if (
						isProcessingResponse &&
						!pendingToolCall &&
						ws &&
						ws.readyState === WebSocket.OPEN
					)
						ws.send(JSON.stringify({ type: "getState" }));
				}, PROCESSING_POLL_INTERVAL_MS);
			}
			break;
		case "queueChanged":
			if (!msg.data) break;
			// Update queue version for optimistic concurrency control
			if (msg.data.queueVersion !== undefined) {
				queueVersion = msg.data.queueVersion;
			}
			promptQueue = msg.data.queue || [];
			renderQueue();
			if (typeof updateCardSelection === "function") updateCardSelection();
			updateQueueVisibility();
			break;
		case "settingsChanged":
			if (!msg.data) break;
			debugLog("settingsChanged:", Object.keys(msg.data));
			applySettingsData(msg.data);
			break;
		case "newSession":
			debugLog("newSession received - clearing state");
			clearRemoteSessionState(msg.data && msg.data.statusMessage);
			debugLog("newSession complete - state cleared");
			break;
		case "resetSession":
			debugLog("resetSession received - clearing state");
			clearRemoteSessionState();
			debugLog("resetSession complete - state cleared");
			break;
		case "fileSearchResults":
			showAutocomplete(msg.files || []);
			break;
		case "slashCommandResults":
			if (typeof showSlashDropdown === "function")
				showSlashDropdown(msg.prompts || []);
			break;
		case "state":
			debugLog(
				"Full state refresh:",
				msg.data ? Object.keys(msg.data) : "no data",
			);
			if (msg.data) applyServerState(msg.data);
			break;
		case "updateSessions":
			if (msg.data) {
				sessions = Array.isArray(msg.data.sessions) ? msg.data.sessions : [];
				activeSessionId = msg.data.activeSessionId || null;
				if (typeof renderSessionsList === "function") renderSessionsList();
				if (typeof updateWelcomeSectionVisibility === "function")
					updateWelcomeSectionVisibility();
			}
			break;
		case "changes":
			if (typeof applyChangesState === "function") {
				applyChangesState(msg.data || { staged: [], unstaged: [] });
			}
			break;
		case "changesUpdated":
			if (typeof applyChangesState === "function") {
				applyChangesState(msg.data || { staged: [], unstaged: [] });
			}
			break;
		case "diff":
			if (typeof applyChangeDiff === "function") {
				applyChangeDiff(msg.file || "", msg.data || "");
			}
			break;
		case "staged":
		case "unstaged":
		case "stagedAll":
		case "discarded":
		case "committed":
		case "pushed":
			if (typeof refreshChangesState === "function") {
				refreshChangesState();
			}
			break;
		case "error":
			// Error messages can come from broadcast (wrapped in {type, data}) or sendWsError (top-level)
			var errMsg = msg.message || (msg.data && msg.data.message);
			var errCode = msg.code || (msg.data && msg.data.code);
			console.error("[TaskSync Remote] Server error:", errMsg);
			if (errMsg === "Not authenticated") {
				sessionStorage.removeItem(SESSION_KEYS.CONNECTED);
				window.location.href = "index.html";
			} else if (
				changesPanelVisible &&
				typeof renderChangesPanel === "function"
			) {
				changesError = errMsg || "Operation failed";
				renderChangesPanel();
			} else if (
				errCode === "ALREADY_ANSWERED" ||
				errCode === "ITEM_NOT_FOUND" ||
				errCode === "QUEUE_FULL" ||
				errCode === "INVALID_INPUT"
			) {
				alert(errMsg);
			}
			break;
	}
}

function clearRemoteSessionState(statusMessage) {
	clearTimeout(processingCheckTimer);
	if (typeof updateRemoteSessionTimerState === "function") {
		updateRemoteSessionTimerState(null, null);
	}
	pendingCriticalMessage = null;
	currentSessionCalls = [];
	pendingToolCall = null;
	lastPendingContentHtml = "";
	isProcessingResponse = false;
	if (chatStreamArea) {
		chatStreamArea.innerHTML = "";
		chatStreamArea.classList.add("hidden");
	}
	document.body.classList.remove("has-pending-toolcall");
	if (typeof hideApprovalModal === "function") hideApprovalModal();
	if (typeof hideChoicesBar === "function") hideChoicesBar();
	renderCurrentSession();
	if (pendingMessage) {
		var nextStatusMessage =
			typeof statusMessage === "string" && statusMessage ? statusMessage : "";
		if (nextStatusMessage) {
			pendingMessage.classList.remove("hidden");
			pendingMessage.innerHTML =
				'<div class="session-started-notice">' +
				'<span class="codicon codicon-check"></span> ' +
				nextStatusMessage +
				"</div>";
		} else {
			pendingMessage.classList.add("hidden");
			pendingMessage.innerHTML = "";
		}
	}
	if (typeof updateWelcomeSectionVisibility === "function")
		updateWelcomeSectionVisibility();
}

// ——— Server state application (SSOT) ———

// Apply settings data from either settingsChanged broadcast or getState response (SSOT)
function applySettingsData(s) {
	if (s.autopilotEnabled !== undefined) autopilotEnabled = s.autopilotEnabled;
	if (s.queueEnabled !== undefined) {
		queueEnabled = s.queueEnabled;
		updateQueueVisibility();
	}
	if (s.autoAppendEnabled !== undefined) {
		autoAppendEnabled = s.autoAppendEnabled;
	}
	if (typeof s.autoAppendText === "string") {
		autoAppendText = s.autoAppendText;
	}
	if (s.alwaysAppendReminder !== undefined) {
		alwaysAppendReminder = s.alwaysAppendReminder;
	}
	if (s.responseTimeout !== undefined) responseTimeout = s.responseTimeout;
	if (s.soundEnabled !== undefined) soundEnabled = s.soundEnabled;
	if (s.interactiveApprovalEnabled !== undefined)
		interactiveApprovalEnabled = s.interactiveApprovalEnabled;
	if (s.sendWithCtrlEnter !== undefined)
		sendWithCtrlEnter = s.sendWithCtrlEnter;
	if (s.sessionWarningHours !== undefined)
		sessionWarningHours = s.sessionWarningHours;
	if (s.maxConsecutiveAutoResponses !== undefined)
		maxConsecutiveAutoResponses = s.maxConsecutiveAutoResponses;
	if (s.remoteMaxDevices !== undefined) remoteMaxDevices = s.remoteMaxDevices;
	if (s.humanLikeDelayEnabled !== undefined)
		humanLikeDelayEnabled = s.humanLikeDelayEnabled;
	if (s.humanLikeDelayMin !== undefined)
		humanLikeDelayMin = s.humanLikeDelayMin;
	if (s.humanLikeDelayMax !== undefined)
		humanLikeDelayMax = s.humanLikeDelayMax;
	if (s.autopilotPrompts !== undefined) autopilotPrompts = s.autopilotPrompts;
	if (s.reusablePrompts !== undefined) reusablePrompts = s.reusablePrompts;
	updateModeUI();
	applySettingsToUI();
}

// Apply server state (SSOT - single function for all state updates)
function applyServerState(state) {
	if (state.queue) {
		promptQueue = state.queue;
		renderQueue();
	}
	if (state.queueVersion !== undefined) {
		queueVersion = state.queueVersion;
	}
	if (state.pending) {
		handlePendingToolCall(state.pending);
	} else {
		// No pending tool call — clear any stale pending state
		pendingToolCall = null;
		document.body.classList.remove("has-pending-toolcall");
		if (typeof hideApprovalModal === "function") hideApprovalModal();
		if (typeof hideChoicesBar === "function") hideChoicesBar();
	}
	// Use server processing flag or pending inference
	isProcessingResponse = state.isProcessing ?? state.pending !== null;
	if (state.history) {
		currentSessionCalls = state.history;
		renderCurrentSession();
	}
	if (state.settings) applySettingsData(state.settings);
	if (state.session && typeof updateRemoteSessionTimerState === "function") {
		updateRemoteSessionTimerState(
			typeof state.session.startTime === "number"
				? state.session.startTime
				: null,
			typeof state.session.frozenElapsed === "number"
				? state.session.frozenElapsed
				: null,
		);
	}
	updatePendingUI();
	if (typeof updateCardSelection === "function") updateCardSelection();
	if (typeof updateWelcomeSectionVisibility === "function")
		updateWelcomeSectionVisibility();
	// Multi-session state (sessions list + active session ID)
	if (Array.isArray(state.sessions)) {
		sessions = state.sessions;
		activeSessionId = state.activeSessionId || null;
		if (typeof renderSessionsList === "function") renderSessionsList();
	}
}

function handlePendingToolCall(data) {
	debugLog(
		"handlePendingToolCall — id:",
		data.id,
		"promptLength:",
		data.prompt ? data.prompt.length : 0,
	);
	if (typeof showPendingToolCall === "function") {
		showPendingToolCall(
			data.id,
			data.sessionId,
			data.prompt,
			data.isApproval,
			data.choices,
		);
	} else {
		pendingToolCall = data;
		isApprovalQuestion = data.isApproval || false;
		currentChoices = (data.choices || []).map(function (c) {
			return typeof c === "string" ? { label: c, value: c, shortLabel: c } : c;
		});
		isProcessingResponse = false;
		updatePendingUI();
	}
}

let wasProcessing = false; // Track processing→idle transition
function updatePendingUI() {
	if (!pendingMessage) return;

	if (pendingToolCall) {
		wasProcessing = false;
		pendingMessage.classList.remove("hidden");
		let pendingHtml =
			'<div class="pending-ai-question">' +
			(typeof formatMarkdown === "function"
				? formatMarkdown(pendingToolCall.prompt || "")
				: escapeHtml(pendingToolCall.prompt || "")) +
			"</div>";
		debugLog("Remote pending HTML set — totalLength:", pendingHtml.length);
		lastPendingContentHtml = pendingHtml;
		pendingMessage.innerHTML = pendingHtml;
	} else if (isProcessingResponse) {
		wasProcessing = true;
		// AI is processing the response — show the same indicator as the main chat UI
		pendingMessage.classList.remove("hidden");
		pendingMessage.innerHTML =
			'<div class="working-indicator">Processing your response</div>';
	} else if (wasProcessing && currentSessionCalls.length > 0) {
		wasProcessing = false;
		// AI was working but stopped without calling askUser — show idle notice
		pendingMessage.classList.remove("hidden");
		pendingMessage.innerHTML =
			'<div class="working-indicator idle-notice">Agent finished \u2014 type a message to continue</div>';
	} else {
		wasProcessing = false;
		pendingMessage.classList.add("hidden");
		pendingMessage.innerHTML = "";
	}
}

/** Refresh all settings toggle/input UI from current state variables. */
function applySettingsToUI() {
	updateSoundToggleUI();
	updateInteractiveApprovalToggleUI();
	updateAutoAppendToggleUI();
	updateAutoAppendTextUI();
	updateSendWithCtrlEnterToggleUI();
	updateAutopilotToggleUI();
	updateResponseTimeoutUI();
	updateSessionWarningHoursUI();
	updateMaxAutoResponsesUI();
	updateRemoteMaxDevicesUI();
	updateHumanDelayUI();
	renderAutopilotPromptsList();
	renderPromptsList();
	updateQueueVisibility();
}

// ==================== End Communication Adapter ====================
// Restore persisted state (survives sidebar switch)
const previousState = vscode.getState() || {};

// Settings defaults & validation ranges — use shared constants if available (remote mode)
// Keep timeout options aligned with select values to avoid invalid UI state.
const RESPONSE_TIMEOUT_ALLOWED_VALUES =
	typeof TASKSYNC_RESPONSE_TIMEOUT_ALLOWED !== "undefined"
		? new Set(TASKSYNC_RESPONSE_TIMEOUT_ALLOWED)
		: new Set([
				0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210,
				240, 300, 360, 420, 480,
			]);
const RESPONSE_TIMEOUT_DEFAULT =
	typeof TASKSYNC_RESPONSE_TIMEOUT_DEFAULT !== "undefined"
		? TASKSYNC_RESPONSE_TIMEOUT_DEFAULT
		: 60;
// Threshold above which users see a risk warning (minutes)
const RESPONSE_TIMEOUT_RISK_THRESHOLD =
	typeof TASKSYNC_RESPONSE_TIMEOUT_RISK_THRESHOLD !== "undefined"
		? TASKSYNC_RESPONSE_TIMEOUT_RISK_THRESHOLD
		: 240;
const MAX_DISPLAY_HISTORY = 20; // Client-side display limit (matches MAX_REMOTE_HISTORY_ITEMS)

const DEFAULT_SESSION_WARNING_HOURS =
	typeof TASKSYNC_DEFAULT_SESSION_WARNING_HOURS !== "undefined"
		? TASKSYNC_DEFAULT_SESSION_WARNING_HOURS
		: 2;
const SESSION_WARNING_HOURS_MAX =
	typeof TASKSYNC_SESSION_WARNING_HOURS_MAX !== "undefined"
		? TASKSYNC_SESSION_WARNING_HOURS_MAX
		: 8;
const DEFAULT_MAX_AUTO_RESPONSES =
	typeof TASKSYNC_DEFAULT_MAX_AUTO_RESPONSES !== "undefined"
		? TASKSYNC_DEFAULT_MAX_AUTO_RESPONSES
		: 5;
const DEFAULT_REMOTE_MAX_DEVICES =
	typeof TASKSYNC_DEFAULT_REMOTE_MAX_DEVICES !== "undefined"
		? TASKSYNC_DEFAULT_REMOTE_MAX_DEVICES
		: 1;
const MIN_REMOTE_MAX_DEVICES =
	typeof TASKSYNC_MIN_REMOTE_MAX_DEVICES !== "undefined"
		? TASKSYNC_MIN_REMOTE_MAX_DEVICES
		: 1;
const MAX_AUTO_RESPONSES_LIMIT =
	typeof TASKSYNC_MAX_AUTO_RESPONSES_LIMIT !== "undefined"
		? TASKSYNC_MAX_AUTO_RESPONSES_LIMIT
		: 100;
const DEFAULT_HUMAN_DELAY_MIN =
	typeof TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MIN !== "undefined"
		? TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MIN
		: 2;
const DEFAULT_HUMAN_DELAY_MAX =
	typeof TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MAX !== "undefined"
		? TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MAX
		: 6;
const HUMAN_DELAY_MIN_LOWER =
	typeof TASKSYNC_HUMAN_DELAY_MIN_LOWER !== "undefined"
		? TASKSYNC_HUMAN_DELAY_MIN_LOWER
		: 1;
const HUMAN_DELAY_MIN_UPPER =
	typeof TASKSYNC_HUMAN_DELAY_MIN_UPPER !== "undefined"
		? TASKSYNC_HUMAN_DELAY_MIN_UPPER
		: 30;
const HUMAN_DELAY_MAX_LOWER =
	typeof TASKSYNC_HUMAN_DELAY_MAX_LOWER !== "undefined"
		? TASKSYNC_HUMAN_DELAY_MAX_LOWER
		: 2;
const HUMAN_DELAY_MAX_UPPER =
	typeof TASKSYNC_HUMAN_DELAY_MAX_UPPER !== "undefined"
		? TASKSYNC_HUMAN_DELAY_MAX_UPPER
		: 60;

// State
let promptQueue = [];
let queueVersion = 0; // Optimistic concurrency control for queue operations
let queueEnabled = true; // Default to true (Queue mode ON by default)
let dropdownOpen = false;
let currentAttachments = previousState.attachments || []; // Restore attachments
let selectedCard = "queue";
let changesPanelVisible = false;
let changesLoading = false;
let changesError = "";
let selectedChangeFile = "";
let selectedChangeDiff = "";
let changesState = { staged: [], unstaged: [] };
let changeStatsByFile = {};
let changeStatsRequestToken = 0;
let changeStatsInFlight = {};
let remoteSessionStartTime = null;
let remoteSessionFrozenElapsed = null;
let remoteSessionTimerInterval = null;
let currentSessionCalls = []; // Current session tool calls (shown in chat)
let persistedHistory = []; // Past sessions history (shown in modal)
let sessions = []; // Multi-session orchestration: all sessions
let activeSessionId = null; // Currently focused session ID
let splitViewEnabled = previousState.splitViewEnabled || false; // Split view: sessions list + thread side by side
let splitRatio = previousState.splitRatio || 38; // Hub panel width percentage (default 38%)
let lastContextMenuTarget = null; // Tracks where right-click was triggered for copy fallback behavior
let lastContextMenuTimestamp = 0; // Ensures stale right-click targets are not reused for copy
let pendingToolCall = null;
let isProcessingResponse = false; // True when AI is processing user's response
let isApprovalQuestion = false; // True when current pending question is an approval-type question
let currentChoices = []; // Parsed choices from multi-choice questions
let lastPendingContentHtml = "";

// Settings state (initialized from constants to maintain SSOT)
let soundEnabled = true;
let interactiveApprovalEnabled = true;
let autoAppendEnabled = false;
let autoAppendText = ""; // Custom text appended to responses (defaults to askUser reminder)
let alwaysAppendReminder = false; // Force askUser reminder even with custom text (for GPT 5.4)
let sendWithCtrlEnter = false;
let autopilotEnabled = false;
let autopilotText = "";
let autopilotPrompts = [];
let responseTimeout = RESPONSE_TIMEOUT_DEFAULT;
let sessionWarningHours = DEFAULT_SESSION_WARNING_HOURS;
let maxConsecutiveAutoResponses = DEFAULT_MAX_AUTO_RESPONSES;
let remoteMaxDevices = DEFAULT_REMOTE_MAX_DEVICES;

// Human-like delay: random jitter simulates natural reading/typing time
let humanLikeDelayEnabled = true;
let humanLikeDelayMin = DEFAULT_HUMAN_DELAY_MIN;
let humanLikeDelayMax = DEFAULT_HUMAN_DELAY_MAX;
const CONTEXT_MENU_COPY_MAX_AGE_MS = 30000;

// Tracks local edits to prevent stale settings overwriting user input mid-typing.
let reusablePrompts = [];
let audioUnlocked = false; // Track if audio playback has been unlocked by user gesture
let sessionComposerState = previousState.sessionComposerState || {};

// Slash command autocomplete state
let slashDropdownVisible = false;
let slashResults = [];
let selectedSlashIndex = -1;
let slashStartPos = -1;
let slashDebounceTimer = null;

// Persisted input value (restored from state)
let persistedInputValue = previousState.inputValue || "";

// Input history recall state (Up/Down arrow to cycle through past responses)
let historyIndex = -1; // -1 = not navigating; 0..N = position in filtered history
let historyDraft = ""; // Saves in-progress text when user starts navigating history

// Edit mode state
let editingPromptId = null;
let editingOriginalPrompt = null;
let savedInputValue = ""; // Save input value when entering edit mode

// Autocomplete state
let autocompleteVisible = false;
let autocompleteResults = [];
let selectedAutocompleteIndex = -1;
let autocompleteStartPos = -1;
let searchDebounceTimer = null;

// DOM Elements
let chatInput, sendBtn, attachBtn, modeBtn, modeDropdown, modeLabel;
let inputHighlighter; // Overlay for syntax highlighting in input
let queueSection, queueHeader, queueList, queueCount;
let chatContainer,
	chipsContainer,
	autocompleteDropdown,
	autocompleteList,
	autocompleteEmpty;
let inputContainer, inputAreaContainer, welcomeSection;
let cardVibe, cardSpec, toolHistoryArea, pendingMessage;
let hubNewSessionBtn, hubHistoryBtn, hubSettingsBtn;
let threadBackBtn, threadHistoryBtn, threadSettingsBtn;
let changesSection,
	changesRefreshBtn,
	changesCloseBtn,
	changesSummary,
	changesStatus,
	changesUnstagedGroup,
	changesUnstagedList,
	changesDiffTitle,
	changesDiffMeta,
	changesDiffOutput,
	remoteSessionTimerEl;
let chatStreamArea; // DOM container for remote user message bubbles
let historyModal,
	historyModalOverlay,
	historyModalList,
	historyModalClose,
	historyModalClearAll;

// Edit mode elements
let actionsLeft,
	actionsBar,
	editActionsContainer,
	editCancelBtn,
	editConfirmBtn;
// Approval modal elements
let approvalModal, approvalContinueBtn, approvalNoBtn;
// Slash command elements
let slashDropdown, slashList, slashEmpty;
// Timeout warning modal for extended timeouts (>4h)
let timeoutWarningModalOverlay = null;
let pendingTimeoutValue = null;
// Settings modal elements
let settingsModal, settingsModalOverlay, settingsModalClose;
let soundToggle,
	interactiveApprovalToggle,
	autoAppendToggle,
	autoAppendTextRow,
	autoAppendTextInput,
	sendShortcutToggle,
	autopilotToggle,
	promptsList,
	addPromptBtn,
	addPromptForm;
let autopilotPromptsList,
	autopilotAddBtn,
	addAutopilotPromptForm,
	autopilotPromptInput,
	saveAutopilotPromptBtn,
	cancelAutopilotPromptBtn;
let responseTimeoutSelect, sessionWarningHoursSelect, maxAutoResponsesInput;
let remoteMaxDevicesInput;
let humanDelayToggle,
	humanDelayRangeContainer,
	humanDelayMinInput,
	humanDelayMaxInput;
// Session settings mini-modal elements
let sessionSettingsOverlay,
	sessionSettingsModal,
	ssAutopilotToggle,
	ssAutoAppendToggle,
	ssAutoAppendTextInput,
	ssAlwaysAppendReminderToggle,
	ssAutopilotPromptsList,
	ssAddAutopilotPromptBtn,
	ssAddAutopilotPromptForm,
	ssAutopilotPromptInput,
	ssSaveAutopilotPromptBtn,
	ssCancelAutopilotPromptBtn;
// Session-level override state (undefined = inherit workspace)
let sessionSettingsHasOverrides = false;
function init() {
	try {
		cacheDOMElements();
		createHistoryModal();
		createEditModeUI();
		createApprovalModal();
		createSettingsModal();
		initWorkspacePromptListUI();
		createSessionSettingsModal();
		initSessionPromptListUI();
		createNewSessionModal();
		createResetSessionModal();
		createTimeoutWarningModal();
		bindEventListeners();
		unlockAudioOnInteraction(); // Enable audio after first user interaction

		// Remote mode: bind header buttons and hide VS Code-only UI
		if (isRemoteMode) {
			var changesBtn = document.getElementById("remote-changes-btn");
			if (changesBtn)
				changesBtn.addEventListener("click", function (e) {
					e.stopPropagation();
					toggleChangesPanel();
				});
			var newSessionBtn = document.getElementById("remote-new-session-btn");
			if (newSessionBtn)
				newSessionBtn.addEventListener("click", function (e) {
					e.stopPropagation();
					openNewSessionModal();
				});
			var resetSessionBtn = document.getElementById("remote-reset-session-btn");
			if (resetSessionBtn)
				resetSessionBtn.addEventListener("click", function (e) {
					e.stopPropagation();
					openResetSessionModal();
				});
			var settingsBtn = document.getElementById("remote-settings-btn");
			if (settingsBtn)
				settingsBtn.addEventListener("click", function () {
					openSettingsModal();
				});
			// Hide attach button (VS Code-only)
			var attachBtn = document.getElementById("attach-btn");
			if (attachBtn) attachBtn.style.display = "none";
		}
		renderQueue();
		updateModeUI();
		updateQueueVisibility();
		initCardSelection();
		initChangesPanel();

		restoreActiveSessionComposerState();

		// Restore split view state
		if (splitViewEnabled) {
			var container = document.querySelector(".main-container.orch");
			if (container) container.classList.add("split-view");
		}
		initSplitResizer();

		// Restore attachments display
		if (currentAttachments.length > 0) {
			updateChipsDisplay();
		}

		// Signal to extension that webview is ready to receive messages
		// In remote mode, state comes via authSuccess after WebSocket connects — skip webviewReady
		if (!isRemoteMode) {
			vscode.postMessage({ type: "webviewReady" });
		}
	} catch (err) {
		console.error("[TaskSync] Init error:", err);
	}
}

/**
 * Save webview state to persist across sidebar visibility changes
 */
function saveWebviewState() {
	saveActiveSessionComposerState();
	vscode.setState({
		inputValue: chatInput ? chatInput.value : "",
		attachments: currentAttachments.filter(function (a) {
			return !a.isTemporary;
		}), // Don't persist temp images
		sessionComposerState: sessionComposerState,
		splitViewEnabled: splitViewEnabled,
		splitRatio: splitRatio,
	});
}

function getComposerStateKey() {
	return activeSessionId || "__hub__";
}

function saveActiveSessionComposerState() {
	var key = getComposerStateKey();
	sessionComposerState[key] = {
		inputValue: chatInput ? chatInput.value : "",
	};
}

function restoreActiveSessionComposerState() {
	if (!chatInput) return;
	var key = getComposerStateKey();
	var saved = sessionComposerState[key];
	var nextValue =
		saved && typeof saved.inputValue === "string"
			? saved.inputValue
			: !activeSessionId && persistedInputValue
				? persistedInputValue
				: "";
	chatInput.value = nextValue;
	autoResizeTextarea();
	updateInputHighlighter();
	updateSendButtonState();
}

function cacheDOMElements() {
	chatInput = document.getElementById("chat-input");
	inputHighlighter = document.getElementById("input-highlighter");
	sendBtn = document.getElementById("send-btn");
	attachBtn = document.getElementById("attach-btn");
	modeBtn = document.getElementById("mode-btn");
	modeDropdown = document.getElementById("mode-dropdown");
	modeLabel = document.getElementById("mode-label");

	queueSection = document.getElementById("queue-section");
	queueHeader = document.getElementById("queue-header");
	queueList = document.getElementById("queue-list");
	queueCount = document.getElementById("queue-count");
	chatContainer = document.getElementById("chat-container");
	chipsContainer = document.getElementById("chips-container");
	autocompleteDropdown = document.getElementById("autocomplete-dropdown");
	autocompleteList = document.getElementById("autocomplete-list");
	autocompleteEmpty = document.getElementById("autocomplete-empty");
	inputContainer = document.getElementById("input-container");
	inputAreaContainer = document.getElementById("input-area-container");
	welcomeSection = document.getElementById("welcome-section");
	cardVibe = document.getElementById("card-vibe");
	cardSpec = document.getElementById("card-spec");
	changesSection = document.getElementById("changes-section");
	changesRefreshBtn = document.getElementById("changes-refresh-btn");
	changesCloseBtn = document.getElementById("changes-close-btn");
	changesSummary = document.getElementById("changes-summary");
	changesStatus = document.getElementById("changes-status");
	changesUnstagedGroup = document.getElementById("changes-unstaged-group");
	changesUnstagedList = document.getElementById("changes-unstaged-list");
	changesDiffTitle = document.getElementById("changes-diff-title");
	changesDiffMeta = document.getElementById("changes-diff-meta");
	changesDiffOutput = document.getElementById("changes-diff-output");
	hubNewSessionBtn = document.getElementById("hub-new-session-btn");
	hubHistoryBtn = document.getElementById("hub-history-btn");
	hubSettingsBtn = document.getElementById("hub-settings-btn");
	threadBackBtn = document.getElementById("thread-back-btn");
	threadHistoryBtn = document.getElementById("thread-history-btn");
	threadSettingsBtn = document.getElementById("thread-settings-btn");
	remoteSessionTimerEl =
		document.getElementById("remote-session-timer") ||
		document.getElementById("stage-sub");
	if (!remoteSessionTimerEl && isRemoteMode) {
		var remoteHeaderLeft = document.querySelector(".remote-header-left");
		if (remoteHeaderLeft) {
			var timerSpan = document.createElement("span");
			timerSpan.id = "remote-session-timer";
			timerSpan.className = "remote-session-timer inactive";
			timerSpan.textContent = "0s";
			timerSpan.title = "Session timer (idle)";
			remoteHeaderLeft.appendChild(timerSpan);
			remoteSessionTimerEl = timerSpan;
		}
	}
	autopilotToggle = document.getElementById("autopilot-toggle");
	toolHistoryArea = document.getElementById("tool-history-area");
	chatStreamArea = document.getElementById("chat-stream-area");
	pendingMessage = document.getElementById("pending-message");
	// Slash command dropdown
	slashDropdown = document.getElementById("slash-dropdown");
	slashList = document.getElementById("slash-list");
	slashEmpty = document.getElementById("slash-empty");
	// Get actions bar elements for edit mode
	actionsBar = document.querySelector(".actions-bar");
	actionsLeft = document.querySelector(".actions-left");
}

function createHistoryModal() {
	// Create modal overlay
	historyModalOverlay = document.createElement("div");
	historyModalOverlay.className = "history-modal-overlay hidden";
	historyModalOverlay.id = "history-modal-overlay";

	// Create modal container
	historyModal = document.createElement("div");
	historyModal.className = "history-modal";
	historyModal.id = "history-modal";
	historyModal.setAttribute("role", "dialog");
	historyModal.setAttribute("aria-modal", "true");
	historyModal.setAttribute("aria-label", "Session History");

	// Modal header
	let modalHeader = document.createElement("div");
	modalHeader.className = "history-modal-header";

	let titleSpan = document.createElement("span");
	titleSpan.className = "history-modal-title";
	titleSpan.textContent = "History";
	modalHeader.appendChild(titleSpan);

	// Info text - left aligned after title
	let infoSpan = document.createElement("span");
	infoSpan.className = "history-modal-info";
	infoSpan.textContent =
		"History is stored in VS Code globalStorage/tool-history.json";
	modalHeader.appendChild(infoSpan);

	// Clear all button (icon only)
	historyModalClearAll = document.createElement("button");
	historyModalClearAll.className = "history-modal-clear-btn";
	historyModalClearAll.innerHTML =
		'<span class="codicon codicon-trash"></span>';
	historyModalClearAll.title = "Clear all history";
	modalHeader.appendChild(historyModalClearAll);

	// Close button
	historyModalClose = document.createElement("button");
	historyModalClose.className = "history-modal-close-btn";
	historyModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
	historyModalClose.title = "Close";
	modalHeader.appendChild(historyModalClose);

	// Modal body (list)
	historyModalList = document.createElement("div");
	historyModalList.className = "history-modal-list";
	historyModalList.id = "history-modal-list";

	// Assemble modal
	historyModal.appendChild(modalHeader);
	historyModal.appendChild(historyModalList);
	historyModalOverlay.appendChild(historyModal);

	// Add to DOM
	document.body.appendChild(historyModalOverlay);
}

function createEditModeUI() {
	// Create edit actions container (hidden by default)
	editActionsContainer = document.createElement("div");
	editActionsContainer.className = "edit-actions-container hidden";
	editActionsContainer.id = "edit-actions-container";

	// Edit mode label
	let editLabel = document.createElement("span");
	editLabel.className = "edit-mode-label";
	editLabel.textContent = "Editing prompt";

	// Cancel button (X)
	editCancelBtn = document.createElement("button");
	editCancelBtn.className = "icon-btn edit-cancel-btn";
	editCancelBtn.title = "Cancel edit (Esc)";
	editCancelBtn.setAttribute("aria-label", "Cancel editing");
	editCancelBtn.innerHTML = '<span class="codicon codicon-close"></span>';

	// Confirm button (✓)
	editConfirmBtn = document.createElement("button");
	editConfirmBtn.className = "icon-btn edit-confirm-btn";
	editConfirmBtn.title = "Confirm edit (Enter)";
	editConfirmBtn.setAttribute("aria-label", "Confirm edit");
	editConfirmBtn.innerHTML = '<span class="codicon codicon-check"></span>';

	// Assemble edit actions
	editActionsContainer.appendChild(editLabel);
	let btnGroup = document.createElement("div");
	btnGroup.className = "edit-btn-group";
	btnGroup.appendChild(editCancelBtn);
	btnGroup.appendChild(editConfirmBtn);
	editActionsContainer.appendChild(btnGroup);

	// Insert into actions bar (will be shown/hidden as needed)
	if (actionsBar) {
		actionsBar.appendChild(editActionsContainer);
	}
}

function createApprovalModal() {
	// Create approval bar that appears at the top of input-wrapper (inside the border)
	approvalModal = document.createElement("div");
	approvalModal.className = "approval-bar hidden";
	approvalModal.id = "approval-bar";
	approvalModal.setAttribute("role", "toolbar");
	approvalModal.setAttribute("aria-label", "Quick approval options");

	// Left side label
	let labelSpan = document.createElement("span");
	labelSpan.className = "approval-label";
	labelSpan.textContent = "Waiting on your input..";

	// Right side buttons container
	let buttonsContainer = document.createElement("div");
	buttonsContainer.className = "approval-buttons";

	// No/Reject button (secondary action - text only)
	approvalNoBtn = document.createElement("button");
	approvalNoBtn.className = "approval-btn approval-reject-btn";
	approvalNoBtn.setAttribute(
		"aria-label",
		"Reject and provide custom response",
	);
	approvalNoBtn.textContent = "No";

	// Continue/Accept button (primary action)
	approvalContinueBtn = document.createElement("button");
	approvalContinueBtn.className = "approval-btn approval-accept-btn";
	approvalContinueBtn.setAttribute("aria-label", "Yes and continue");
	approvalContinueBtn.textContent = "Yes";

	// Assemble buttons
	buttonsContainer.appendChild(approvalNoBtn);
	buttonsContainer.appendChild(approvalContinueBtn);

	// Assemble bar
	approvalModal.appendChild(labelSpan);
	approvalModal.appendChild(buttonsContainer);

	// Insert at top of input-wrapper (inside the border)
	let inputWrapper = document.getElementById("input-wrapper");
	if (inputWrapper) {
		inputWrapper.insertBefore(approvalModal, inputWrapper.firstChild);
	}
}

function createSettingsModal() {
	// Create modal overlay
	settingsModalOverlay = document.createElement("div");
	settingsModalOverlay.className = "settings-modal-overlay hidden";
	settingsModalOverlay.id = "settings-modal-overlay";

	// Create modal container
	settingsModal = document.createElement("div");
	settingsModal.className = "settings-modal";
	settingsModal.id = "settings-modal";
	settingsModal.setAttribute("role", "dialog");
	settingsModal.setAttribute("aria-labelledby", "settings-modal-title");

	// Modal header
	let modalHeader = document.createElement("div");
	modalHeader.className = "settings-modal-header";

	let titleSpan = document.createElement("span");
	titleSpan.className = "settings-modal-title";
	titleSpan.id = "settings-modal-title";
	titleSpan.textContent = "Settings";
	modalHeader.appendChild(titleSpan);

	// Header buttons container
	let headerButtons = document.createElement("div");
	headerButtons.className = "settings-modal-header-buttons";

	// Report Issue button
	let reportBtn = document.createElement("button");
	reportBtn.className = "settings-modal-header-btn";
	reportBtn.innerHTML = '<span class="codicon codicon-report"></span>';
	reportBtn.title = "Report Issue";
	reportBtn.setAttribute("aria-label", "Report an issue on GitHub");
	reportBtn.addEventListener("click", function () {
		vscode.postMessage({
			type: "openExternal",
			url: "https://github.com/4regab/TaskSync/issues/new",
		});
	});
	headerButtons.appendChild(reportBtn);

	// Close button
	settingsModalClose = document.createElement("button");
	settingsModalClose.className = "settings-modal-header-btn";
	settingsModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
	settingsModalClose.title = "Close";
	settingsModalClose.setAttribute("aria-label", "Close settings");
	headerButtons.appendChild(settingsModalClose);

	modalHeader.appendChild(headerButtons);

	// Modal content
	let modalContent = document.createElement("div");
	modalContent.className = "settings-modal-content";

	// Sound section - simplified, toggle right next to header
	let soundSection = document.createElement("div");
	soundSection.className = "settings-section";
	soundSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-unmute"></span> Notifications</div>' +
		'<div class="toggle-switch active" id="sound-toggle" role="switch" aria-checked="true" aria-label="Enable notification sound" tabindex="0"></div>' +
		"</div>";
	modalContent.appendChild(soundSection);

	// Interactive approval section - toggle interactive Yes/No + choices UI
	let approvalSection = document.createElement("div");
	approvalSection.className = "settings-section";
	approvalSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-checklist"></span> Interactive Approvals</div>' +
		'<div class="toggle-switch active" id="interactive-approval-toggle" role="switch" aria-checked="true" aria-label="Enable interactive approval and choice buttons" tabindex="0"></div>' +
		"</div>";
	modalContent.appendChild(approvalSection);

	// Send shortcut section - switch between Enter and Ctrl/Cmd+Enter send
	let sendShortcutSection = document.createElement("div");
	sendShortcutSection.className = "settings-section";
	sendShortcutSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-keyboard"></span> Ctrl/Cmd+Enter to Send</div>' +
		'<div class="toggle-switch" id="send-shortcut-toggle" role="switch" aria-checked="false" aria-label="Use Ctrl/Cmd+Enter to send messages" tabindex="0"></div>' +
		"</div>";
	modalContent.appendChild(sendShortcutSection);

	// Auto Append section - appends configured guidance to every ask_user response.
	let autoAppendSection = document.createElement("div");
	autoAppendSection.className = "settings-section";
	autoAppendSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-symbol-structure"></span> Auto Append' +
		'<span class="settings-info-icon" title="When enabled, TaskSync appends this text directly to every ask_user response (manual, queue, autopilot, timeout).\n\nThis increases context usage, so keep it concise.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		'<div class="toggle-switch" id="auto-append-toggle" role="switch" aria-checked="false" aria-label="Enable Auto Append" tabindex="0"></div>' +
		"</div>" +
		'<div class="form-row hidden" id="auto-append-text-row">' +
		'<label class="form-label" for="auto-append-text-input">Auto Append Text</label>' +
		'<textarea class="form-input form-textarea" id="auto-append-text-input" placeholder="Text appended to every ask_user response" maxlength="2000"></textarea>' +
		'<div class="auto-append-reminder-row">' +
		'<label class="form-label-inline" for="always-append-reminder-toggle">Always append askUser reminder' +
		'<span class="settings-info-icon-inline" title="Auto Append = YOUR custom rules (e.g. &quot;follow SOLID principles&quot;). If empty, nothing is appended.\n\nAuto Reminder = predefined instruction that tells the AI to call askUser. Enable this if your AI keeps ending without asking for feedback (common with GPT 5.4).\n\nBoth can be ON together.">' +
		'<span class="codicon codicon-question"></span></span></label>' +
		'<div class="toggle-switch-small" id="always-append-reminder-toggle" role="switch" aria-checked="false" aria-label="Always append askUser reminder" tabindex="0"></div>' +
		"</div>" +
		"</div>";
	modalContent.appendChild(autoAppendSection);

	// Human-Like Delay section - toggle + min/max inputs
	let humanDelaySection = document.createElement("div");
	humanDelaySection.className = "settings-section";
	humanDelaySection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-pulse"></span> Human-Like Delay' +
		'<span class="settings-info-icon" title="Add random delays (2-6s by default) before auto-responses. Simulates natural pacing for automated responses.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		'<div class="toggle-switch active" id="human-delay-toggle" role="switch" aria-checked="true" aria-label="Toggle Human-Like Delay" tabindex="0"></div>' +
		"</div>" +
		'<div class="form-row human-delay-range" id="human-delay-range">' +
		'<label class="form-label-inline">Min (s):</label>' +
		'<input type="number" class="form-input form-input-small" id="human-delay-min-input" min="' +
		HUMAN_DELAY_MIN_LOWER +
		'" max="' +
		HUMAN_DELAY_MIN_UPPER +
		'" value="' +
		DEFAULT_HUMAN_DELAY_MIN +
		'" />' +
		'<label class="form-label-inline">Max (s):</label>' +
		'<input type="number" class="form-input form-input-small" id="human-delay-max-input" min="' +
		HUMAN_DELAY_MAX_LOWER +
		'" max="' +
		HUMAN_DELAY_MAX_UPPER +
		'" value="' +
		DEFAULT_HUMAN_DELAY_MAX +
		'" />' +
		"</div>";
	modalContent.appendChild(humanDelaySection);

	// Remote Max Devices section - number input
	let remoteMaxDevicesSection = document.createElement("div");
	remoteMaxDevicesSection.className = "settings-section";
	remoteMaxDevicesSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-broadcast"></span> Remote Max Devices' +
		'<span class="settings-info-icon" title="Maximum number of devices that can be connected to the remote server at the same time. Minimum: 1.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		"</div>" +
		'<div class="form-row">' +
		'<input type="number" class="form-input" id="remote-max-devices-input" min="' +
		MIN_REMOTE_MAX_DEVICES +
		'" value="' +
		DEFAULT_REMOTE_MAX_DEVICES +
		'" />' +
		"</div>";
	modalContent.appendChild(remoteMaxDevicesSection);

	// Autopilot section with cycling prompts list
	let autopilotSection = document.createElement("div");
	autopilotSection.className = "settings-section";
	autopilotSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-rocket"></span> Autopilot Prompts' +
		'<span class="settings-info-icon" title="Prompts cycle in order (1→2→3→1...) with human-like delay.\n\nHow it works:\n• The agent calls ask_user → Autopilot sends the next prompt in sequence\n• Add multiple prompts to alternate between different instructions\n• Drag to reorder, edit or delete individual prompts\n\nQueue Priority:\n• Queued prompts ALWAYS take priority over Autopilot\n• Autopilot only activates when the queue is empty">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		'<button class="add-prompt-btn-inline" id="autopilot-add-btn" title="Add Autopilot prompt" aria-label="Add Autopilot prompt"><span class="codicon codicon-add"></span></button>' +
		"</div>" +
		'<div class="autopilot-prompts-list" id="autopilot-prompts-list"></div>' +
		'<div class="add-autopilot-prompt-form hidden" id="add-autopilot-prompt-form">' +
		'<div class="form-row">' +
		'<textarea class="form-input form-textarea" id="autopilot-prompt-input" placeholder="Enter Autopilot prompt text..." maxlength="2000"></textarea>' +
		"</div>" +
		'<div class="form-actions">' +
		'<button class="form-btn form-btn-cancel" id="cancel-autopilot-prompt-btn">Cancel</button>' +
		'<button class="form-btn form-btn-save" id="save-autopilot-prompt-btn">Save</button>' +
		"</div>" +
		"</div>";
	modalContent.appendChild(autopilotSection);

	// Response Timeout section - dropdown for 10-120 minutes
	let timeoutSection = document.createElement("div");
	timeoutSection.className = "settings-section";
	// Generate options from SSOT constant
	let timeoutOptions = Array.from(RESPONSE_TIMEOUT_ALLOWED_VALUES)
		.sort(function (a, b) {
			return a - b;
		})
		.map(function (val) {
			let label = val === 0 ? "Disabled" : val + " minutes";
			if (val === RESPONSE_TIMEOUT_DEFAULT) label += " (default)";
			if (val >= 120 && val % 60 === 0)
				label = val + " minutes (" + val / 60 + "h)";
			else if (val >= 90 && val % 30 === 0 && val !== 90)
				label = val + " minutes (" + (val / 60).toFixed(1) + "h)";
			return '<option value="' + val + '">' + label + "</option>";
		})
		.join("");
	timeoutSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-clock"></span> Response Timeout' +
		'<span class="settings-info-icon" title="If no response is received within this time, it will automatically send the session termination message.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		"</div>" +
		'<div class="form-row">' +
		'<select class="form-input form-select" id="response-timeout-select">' +
		timeoutOptions +
		"</select>" +
		"</div>";
	modalContent.appendChild(timeoutSection);

	// Session Warning section - warning threshold in hours
	let sessionWarningSection = document.createElement("div");
	sessionWarningSection.className = "settings-section";
	sessionWarningSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-watch"></span> Session Warning' +
		'<span class="settings-info-icon" title="Show a one-time warning after this many hours in the same session. Set to 0 to disable.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		"</div>" +
		'<div class="form-row">' +
		'<select class="form-input form-select" id="session-warning-hours-select">' +
		Array.from({ length: SESSION_WARNING_HOURS_MAX + 1 }, function (_, i) {
			return (
				'<option value="' +
				i +
				'">' +
				(i === 0 ? "Disabled" : i + " hour" + (i > 1 ? "s" : "")) +
				"</option>"
			);
		}).join("") +
		"</select>" +
		"</div>";
	modalContent.appendChild(sessionWarningSection);

	// Max Consecutive Auto-Responses section - number input
	let maxAutoSection = document.createElement("div");
	maxAutoSection.className = "settings-section";
	maxAutoSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-stop-circle"></span> Max Auto-Responses' +
		'<span class="settings-info-icon" title="Maximum consecutive auto-responses using Autopilot before pausing and requiring manual input. Prevents infinite loops.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		"</div>" +
		'<div class="form-row">' +
		'<input type="number" class="form-input" id="max-auto-responses-input" min="1" max="' +
		MAX_AUTO_RESPONSES_LIMIT +
		'" value="' +
		DEFAULT_MAX_AUTO_RESPONSES +
		'" />' +
		"</div>";
	modalContent.appendChild(maxAutoSection);

	// Reusable Prompts section - plus button next to title
	let promptsSection = document.createElement("div");
	promptsSection.className = "settings-section";
	promptsSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-symbol-keyword"></span> Reusable Prompts</div>' +
		'<button class="add-prompt-btn-inline" id="add-prompt-btn" title="Add Prompt" aria-label="Add reusable prompt"><span class="codicon codicon-add"></span></button>' +
		"</div>" +
		'<div class="prompts-list" id="prompts-list"></div>' +
		'<div class="add-prompt-form hidden" id="add-prompt-form">' +
		'<div class="form-row"><label class="form-label" for="prompt-name-input">Name (used as /command)</label>' +
		'<input type="text" class="form-input" id="prompt-name-input" placeholder="e.g., fix, test, refactor" maxlength="30"></div>' +
		'<div class="form-row"><label class="form-label" for="prompt-text-input">Prompt Text</label>' +
		'<textarea class="form-input form-textarea" id="prompt-text-input" placeholder="Enter the full prompt text..." maxlength="2000"></textarea></div>' +
		'<div class="form-actions">' +
		'<button class="form-btn form-btn-cancel" id="cancel-prompt-btn">Cancel</button>' +
		'<button class="form-btn form-btn-save" id="save-prompt-btn">Save</button></div></div>';
	modalContent.appendChild(promptsSection);

	// Assemble modal
	settingsModal.appendChild(modalHeader);
	settingsModal.appendChild(modalContent);
	settingsModalOverlay.appendChild(settingsModal);

	// Add to DOM
	document.body.appendChild(settingsModalOverlay);

	// Cache inner elements
	soundToggle = document.getElementById("sound-toggle");
	interactiveApprovalToggle = document.getElementById(
		"interactive-approval-toggle",
	);
	autoAppendToggle = document.getElementById("auto-append-toggle");
	autoAppendTextRow = document.getElementById("auto-append-text-row");
	autoAppendTextInput = document.getElementById("auto-append-text-input");
	alwaysAppendReminderToggle = document.getElementById(
		"always-append-reminder-toggle",
	);
	sendShortcutToggle = document.getElementById("send-shortcut-toggle");
	autopilotPromptsList = document.getElementById("autopilot-prompts-list");
	autopilotAddBtn = document.getElementById("autopilot-add-btn");
	addAutopilotPromptForm = document.getElementById("add-autopilot-prompt-form");
	autopilotPromptInput = document.getElementById("autopilot-prompt-input");
	saveAutopilotPromptBtn = document.getElementById("save-autopilot-prompt-btn");
	cancelAutopilotPromptBtn = document.getElementById(
		"cancel-autopilot-prompt-btn",
	);
	responseTimeoutSelect = document.getElementById("response-timeout-select");
	sessionWarningHoursSelect = document.getElementById(
		"session-warning-hours-select",
	);
	maxAutoResponsesInput = document.getElementById("max-auto-responses-input");
	remoteMaxDevicesInput = document.getElementById("remote-max-devices-input");
	humanDelayToggle = document.getElementById("human-delay-toggle");
	humanDelayRangeContainer = document.getElementById("human-delay-range");
	humanDelayMinInput = document.getElementById("human-delay-min-input");
	humanDelayMaxInput = document.getElementById("human-delay-max-input");
	promptsList = document.getElementById("prompts-list");
	addPromptBtn = document.getElementById("add-prompt-btn");
	addPromptForm = document.getElementById("add-prompt-form");
}

// ===== SESSION SETTINGS MINI-MODAL =====

function createSessionSettingsModal() {
	sessionSettingsOverlay = document.createElement("div");
	sessionSettingsOverlay.className = "settings-modal-overlay hidden";
	sessionSettingsOverlay.id = "session-settings-overlay";

	sessionSettingsModal = document.createElement("div");
	sessionSettingsModal.className = "settings-modal session-settings-modal";
	sessionSettingsModal.id = "session-settings-modal";
	sessionSettingsModal.setAttribute("role", "dialog");
	sessionSettingsModal.setAttribute(
		"aria-labelledby",
		"session-settings-title",
	);

	// Modal header
	var ssHeader = document.createElement("div");
	ssHeader.className = "settings-modal-header";

	var ssTitleSpan = document.createElement("span");
	ssTitleSpan.className = "settings-modal-title";
	ssTitleSpan.id = "session-settings-title";
	ssTitleSpan.textContent = "Session Settings";
	ssHeader.appendChild(ssTitleSpan);

	var ssHeaderBtns = document.createElement("div");
	ssHeaderBtns.className = "settings-modal-header-buttons";

	var ssResetBtn = document.createElement("button");
	ssResetBtn.className = "settings-modal-header-btn";
	ssResetBtn.innerHTML = '<span class="codicon codicon-discard"></span>';
	ssResetBtn.title = "Reset to workspace defaults";
	ssResetBtn.setAttribute(
		"aria-label",
		"Reset session settings to workspace defaults",
	);
	ssResetBtn.id = "ss-reset-btn";
	ssHeaderBtns.appendChild(ssResetBtn);

	var ssCloseBtn = document.createElement("button");
	ssCloseBtn.className = "settings-modal-header-btn";
	ssCloseBtn.innerHTML = '<span class="codicon codicon-close"></span>';
	ssCloseBtn.title = "Close";
	ssCloseBtn.setAttribute("aria-label", "Close session settings");
	ssCloseBtn.id = "ss-close-btn";
	ssHeaderBtns.appendChild(ssCloseBtn);

	ssHeader.appendChild(ssHeaderBtns);

	// Modal content
	var ssContent = document.createElement("div");
	ssContent.className = "settings-modal-content";

	// Description
	var ssDesc = document.createElement("div");
	ssDesc.className = "session-settings-desc";
	ssDesc.textContent = "Override workspace settings for this session only.";
	ssContent.appendChild(ssDesc);

	// Autopilot toggle section
	var ssAutopilotSection = document.createElement("div");
	ssAutopilotSection.className = "settings-section";
	ssAutopilotSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-rocket"></span> Autopilot</div>' +
		'<div class="toggle-switch" id="ss-autopilot-toggle" role="switch" aria-checked="false" aria-label="Enable Autopilot for this session" tabindex="0"></div>' +
		"</div>";
	ssContent.appendChild(ssAutopilotSection);

	// Autopilot Prompts section
	var ssPromptsSection = document.createElement("div");
	ssPromptsSection.className = "settings-section";
	ssPromptsSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title"><span class="codicon codicon-list-ordered"></span> Autopilot Prompts</div>' +
		'<button class="add-prompt-btn-inline" id="ss-autopilot-add-btn" title="Add Autopilot prompt" aria-label="Add Autopilot prompt"><span class="codicon codicon-add"></span></button>' +
		"</div>" +
		'<div class="autopilot-prompts-list" id="ss-autopilot-prompts-list"></div>' +
		'<div class="add-autopilot-prompt-form hidden" id="ss-add-autopilot-prompt-form">' +
		'<div class="form-row">' +
		'<textarea class="form-input form-textarea" id="ss-autopilot-prompt-input" placeholder="Enter Autopilot prompt text..." maxlength="2000"></textarea>' +
		"</div>" +
		'<div class="form-actions">' +
		'<button class="form-btn form-btn-cancel" id="ss-cancel-autopilot-prompt-btn">Cancel</button>' +
		'<button class="form-btn form-btn-save" id="ss-save-autopilot-prompt-btn">Save</button>' +
		"</div>" +
		"</div>";
	ssContent.appendChild(ssPromptsSection);

	// Auto Append section
	var ssAutoAppendSection = document.createElement("div");
	ssAutoAppendSection.className = "settings-section";
	ssAutoAppendSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-symbol-structure"></span> Auto Append' +
		"</div>" +
		'<div class="toggle-switch" id="ss-auto-append-toggle" role="switch" aria-checked="false" aria-label="Enable Auto Append for this session" tabindex="0"></div>' +
		"</div>" +
		'<div class="form-row hidden" id="ss-auto-append-text-row">' +
		'<textarea class="form-input form-textarea" id="ss-auto-append-text-input" placeholder="Text appended to every ask_user response" maxlength="2000"></textarea>' +
		'<div class="auto-append-reminder-row">' +
		'<label class="form-label-inline" for="ss-always-append-reminder-toggle">Always append askUser reminder</label>' +
		'<div class="toggle-switch-small" id="ss-always-append-reminder-toggle" role="switch" aria-checked="false" aria-label="Always append askUser reminder for this session" tabindex="0"></div>' +
		"</div>" +
		"</div>";
	ssContent.appendChild(ssAutoAppendSection);

	// Assemble
	sessionSettingsModal.appendChild(ssHeader);
	sessionSettingsModal.appendChild(ssContent);
	sessionSettingsOverlay.appendChild(sessionSettingsModal);
	document.body.appendChild(sessionSettingsOverlay);

	// Cache inner elements
	ssAutopilotToggle = document.getElementById("ss-autopilot-toggle");
	ssAutoAppendToggle = document.getElementById("ss-auto-append-toggle");
	ssAutoAppendTextInput = document.getElementById("ss-auto-append-text-input");
	ssAlwaysAppendReminderToggle = document.getElementById(
		"ss-always-append-reminder-toggle",
	);
	ssAutopilotPromptsList = document.getElementById("ss-autopilot-prompts-list");
	ssAddAutopilotPromptBtn = document.getElementById("ss-autopilot-add-btn");
	ssAddAutopilotPromptForm = document.getElementById(
		"ss-add-autopilot-prompt-form",
	);
	ssAutopilotPromptInput = document.getElementById("ss-autopilot-prompt-input");
	ssSaveAutopilotPromptBtn = document.getElementById(
		"ss-save-autopilot-prompt-btn",
	);
	ssCancelAutopilotPromptBtn = document.getElementById(
		"ss-cancel-autopilot-prompt-btn",
	);
}

// ===== NEW SESSION MODAL =====

var newSessionModalOverlay = null;
var resetSessionModalOverlay = null;

function createSessionActionModal(config) {
	var overlay = document.createElement("div");
	overlay.className = "settings-modal-overlay hidden";
	overlay.id = config.overlayId;

	var modal = document.createElement("div");
	modal.className = "settings-modal new-session-modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-labelledby", config.titleId);

	var header = document.createElement("div");
	header.className = "settings-modal-header";
	var title = document.createElement("span");
	title.className = "settings-modal-title";
	title.id = config.titleId;
	title.textContent = config.title;
	header.appendChild(title);
	var headerBtns = document.createElement("div");
	headerBtns.className = "settings-modal-header-buttons";
	var closeBtn = document.createElement("button");
	closeBtn.className = "settings-modal-header-btn";
	closeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
	closeBtn.title = "Cancel";
	closeBtn.setAttribute("aria-label", "Cancel");
	closeBtn.addEventListener("click", function () {
		closeSessionActionModal(overlay);
	});
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);

	var content = document.createElement("div");
	content.className = "settings-modal-content new-session-modal-content";

	if (config.noteHtml) {
		var note = document.createElement("p");
		note.className = "new-session-note";
		note.innerHTML = config.noteHtml;
		content.appendChild(note);
	}

	var warning = document.createElement("p");
	warning.className = "new-session-warning";
	warning.textContent = config.warningText;
	content.appendChild(warning);

	// Insert extra content (e.g. textarea, checkbox) before the button row
	if (config.extraContent) {
		content.appendChild(config.extraContent);
	}

	var btnRow = document.createElement("div");
	btnRow.className = "new-session-btn-row";
	var cancelBtn = document.createElement("button");
	cancelBtn.className = "form-btn form-btn-cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", function () {
		closeSessionActionModal(overlay);
	});
	btnRow.appendChild(cancelBtn);

	var confirmBtn = document.createElement("button");
	confirmBtn.className = "form-btn form-btn-save";
	confirmBtn.textContent = config.confirmLabel;
	confirmBtn.addEventListener("click", function () {
		closeSessionActionModal(overlay);
		if (config.onConfirm) {
			config.onConfirm();
		} else {
			vscode.postMessage({ type: config.messageType });
		}
	});
	btnRow.appendChild(confirmBtn);
	content.appendChild(btnRow);

	modal.appendChild(header);
	modal.appendChild(content);
	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	overlay.addEventListener("click", function (e) {
		if (e.target === overlay) closeSessionActionModal(overlay);
	});

	return overlay;
}

function openSessionActionModal(overlay) {
	if (!overlay) return;
	overlay.classList.remove("hidden");
}

function closeSessionActionModal(overlay) {
	if (!overlay) return;
	overlay.classList.add("hidden");
}

function createNewSessionModal() {
	// Build extra content: textarea + queue checkbox
	var extra = document.createElement("div");
	extra.className = "new-session-extra";

	var textarea = document.createElement("textarea");
	textarea.id = "new-session-prompt";
	textarea.className = "new-session-prompt-input";
	textarea.placeholder = "Enter initial task or prompt (optional)";
	textarea.rows = 3;
	textarea.setAttribute("aria-label", "Initial task or prompt (optional)");
	textarea.maxLength = 100000;
	extra.appendChild(textarea);

	var queueCheckboxRow = document.createElement("label");
	queueCheckboxRow.className = "new-session-queue-checkbox hidden";
	queueCheckboxRow.id = "new-session-queue-row";
	var checkbox = document.createElement("input");
	checkbox.type = "checkbox";
	checkbox.id = "new-session-use-queue";
	checkbox.checked = true;
	queueCheckboxRow.appendChild(checkbox);
	var queueLabel = document.createElement("span");
	queueLabel.id = "new-session-queue-label";
	queueLabel.textContent = "Use next queued prompt";
	queueCheckboxRow.appendChild(queueLabel);
	extra.appendChild(queueCheckboxRow);

	newSessionModalOverlay = createSessionActionModal({
		overlayId: "new-session-modal-overlay",
		titleId: "new-session-modal-title",
		title: "New Session",
		noteHtml:
			'<span class="codicon codicon-info"></span> Please check the model and agent preselected in VS Code Chat before starting.',
		warningText:
			"This will clear the current session history and start a fresh Copilot chat session.",
		confirmLabel: "New Session",
		extraContent: extra,
		onConfirm: function () {
			var promptInput = document.getElementById("new-session-prompt");
			var queueCheckbox = document.getElementById("new-session-use-queue");
			var initialPrompt = promptInput ? promptInput.value.trim() : "";
			var useQueuedPrompt = queueCheckbox ? queueCheckbox.checked : false;
			var msg = { type: "newSession" };
			if (initialPrompt) {
				msg.initialPrompt = initialPrompt;
			}
			if (promptQueue.length > 0) {
				msg.useQueuedPrompt = useQueuedPrompt;
			}
			vscode.postMessage(msg);
			// Clear textarea for next open
			if (promptInput) promptInput.value = "";
		},
	});
}

function openNewSessionModal() {
	if (!newSessionModalOverlay) return;
	// Refresh queue checkbox visibility and label based on current queue state
	var queueRow = document.getElementById("new-session-queue-row");
	var queueLabel = document.getElementById("new-session-queue-label");
	var queueCheckbox = document.getElementById("new-session-use-queue");
	if (queueRow) {
		if (promptQueue.length > 0) {
			queueRow.classList.remove("hidden");
			if (queueLabel) {
				var preview = promptQueue[0].prompt;
				if (preview.length > 60) preview = preview.slice(0, 60) + "…";
				queueLabel.textContent = "Use next queued prompt: " + preview;
			}
			if (queueCheckbox) queueCheckbox.checked = true;
		} else {
			queueRow.classList.add("hidden");
		}
	}
	// Clear textarea on open
	var promptInput = document.getElementById("new-session-prompt");
	if (promptInput) promptInput.value = "";
	openSessionActionModal(newSessionModalOverlay);
}

function createResetSessionModal() {
	resetSessionModalOverlay = createSessionActionModal({
		overlayId: "reset-session-modal-overlay",
		titleId: "reset-session-modal-title",
		title: "Reset Session",
		warningText:
			"This will clear the current session history without starting a fresh Copilot chat.",
		confirmLabel: "Reset Session",
		messageType: "resetSession",
	});
}

function openResetSessionModal() {
	openSessionActionModal(resetSessionModalOverlay);
}

// ==================== Timeout Warning Modal ====================

/**
 * Create the timeout warning modal for risky timeout settings.
 * Shows different warnings for disabled (0) vs extended (>4 hours) timeouts.
 */
function createTimeoutWarningModal() {
	timeoutWarningModalOverlay = document.createElement("div");
	timeoutWarningModalOverlay.className = "settings-modal-overlay hidden";
	timeoutWarningModalOverlay.id = "timeout-warning-modal-overlay";

	var modal = document.createElement("div");
	modal.className = "settings-modal timeout-warning-modal";
	modal.setAttribute("role", "alertdialog");
	modal.setAttribute("aria-modal", "true");
	modal.setAttribute("aria-labelledby", "timeout-warning-modal-title");
	modal.setAttribute("aria-describedby", "timeout-warning-modal-desc");
	modal.id = "timeout-warning-modal";

	// Header with warning icon
	var header = document.createElement("div");
	header.className = "settings-modal-header timeout-warning-header";
	var title = document.createElement("span");
	title.className = "settings-modal-title timeout-warning-title";
	title.id = "timeout-warning-modal-title";
	// Title will be updated dynamically in showTimeoutWarning
	title.innerHTML =
		'<span class="codicon codicon-warning"></span> <span id="timeout-warning-title-text">Warning</span>';
	header.appendChild(title);

	// Content
	var content = document.createElement("div");
	content.className = "settings-modal-content timeout-warning-content";
	content.id = "timeout-warning-modal-desc";

	var warningText = document.createElement("p");
	warningText.className = "timeout-warning-text";
	warningText.id = "timeout-warning-text";
	// Text will be updated dynamically in showTimeoutWarning
	content.appendChild(warningText);

	var riskList = document.createElement("ul");
	riskList.className = "timeout-warning-list";
	riskList.id = "timeout-warning-list";
	// List will be updated dynamically in showTimeoutWarning
	content.appendChild(riskList);

	var disclaimer = document.createElement("p");
	disclaimer.className = "timeout-warning-disclaimer";
	var disclaimerStrong = document.createElement("strong");
	disclaimerStrong.textContent =
		"You assume full responsibility for any consequences.";
	disclaimer.appendChild(disclaimerStrong);
	content.appendChild(disclaimer);

	// Button row
	var btnRow = document.createElement("div");
	btnRow.className = "new-session-btn-row";

	var cancelBtn = document.createElement("button");
	cancelBtn.className = "form-btn form-btn-cancel";
	cancelBtn.id = "timeout-warning-cancel-btn";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", cancelTimeoutWarning);
	btnRow.appendChild(cancelBtn);

	var confirmBtn = document.createElement("button");
	confirmBtn.className = "form-btn form-btn-danger";
	confirmBtn.id = "timeout-warning-confirm-btn";
	confirmBtn.textContent = "I Understand, Proceed";
	confirmBtn.addEventListener("click", confirmTimeoutWarning);
	btnRow.appendChild(confirmBtn);

	content.appendChild(btnRow);
	modal.appendChild(header);
	modal.appendChild(content);
	timeoutWarningModalOverlay.appendChild(modal);
	document.body.appendChild(timeoutWarningModalOverlay);

	// Close on overlay click (treat as cancel)
	timeoutWarningModalOverlay.addEventListener("click", function (e) {
		if (e.target === timeoutWarningModalOverlay) cancelTimeoutWarning();
	});

	// Keyboard handling: Escape to cancel
	timeoutWarningModalOverlay.addEventListener("keydown", function (e) {
		if (e.key === "Escape") {
			cancelTimeoutWarning();
		}
	});
}

/**
 * Helper to populate risk list items using DOM methods (no innerHTML)
 */
function populateRiskList(listElement, items) {
	listElement.innerHTML = "";
	for (var i = 0; i < items.length; i++) {
		var li = document.createElement("li");
		li.textContent = items[i];
		listElement.appendChild(li);
	}
}

function showTimeoutWarning(value) {
	if (!timeoutWarningModalOverlay) {
		// Modal failed to create - apply value immediately and revert dropdown
		if (responseTimeoutSelect) {
			responseTimeoutSelect.value = String(responseTimeout);
		}
		return;
	}
	pendingTimeoutValue = value;

	// Update modal content based on warning type
	var titleText = document.getElementById("timeout-warning-title-text");
	var warningText = document.getElementById("timeout-warning-text");
	var riskList = document.getElementById("timeout-warning-list");

	if (value === 0) {
		// Disabled - infinite wait warning
		if (titleText) titleText.textContent = "Disabled Timeout Warning";
		if (warningText)
			warningText.textContent =
				"Disabling the response timeout means the agent will wait indefinitely for your response. This may result in:";
		if (riskList)
			populateRiskList(riskList, [
				"Agent stalling forever if you forget to respond",
				"Session resources held indefinitely",
				"Unexpected behavior if connection is lost",
			]);
	} else {
		// Extended timeout warning - derive threshold from constant
		var thresholdHours = RESPONSE_TIMEOUT_RISK_THRESHOLD / 60;
		if (titleText) titleText.textContent = "Extended Timeout Risk";
		if (warningText)
			warningText.textContent =
				"Setting a response timeout longer than " +
				thresholdHours +
				" hours may result in:";
		if (riskList)
			populateRiskList(riskList, [
				"Account rate limiting or temporary bans",
				"Excessive API usage charges",
				"Runaway autonomous operations",
			]);
	}

	timeoutWarningModalOverlay.classList.remove("hidden");

	// Focus the cancel button for accessibility
	var cancelBtn = document.getElementById("timeout-warning-cancel-btn");
	if (cancelBtn) cancelBtn.focus();
}

function cancelTimeoutWarning() {
	pendingTimeoutValue = null;
	if (timeoutWarningModalOverlay) {
		timeoutWarningModalOverlay.classList.add("hidden");
	}
	// Revert dropdown to current value and restore focus
	if (responseTimeoutSelect) {
		responseTimeoutSelect.value = String(responseTimeout);
		responseTimeoutSelect.focus();
	}
}

function confirmTimeoutWarning() {
	if (pendingTimeoutValue !== null) {
		responseTimeout = pendingTimeoutValue;
		vscode.postMessage({
			type: "updateResponseTimeout",
			value: pendingTimeoutValue,
		});
	}
	pendingTimeoutValue = null;
	if (timeoutWarningModalOverlay) {
		timeoutWarningModalOverlay.classList.add("hidden");
	}
	// Restore focus to dropdown
	if (responseTimeoutSelect) {
		responseTimeoutSelect.focus();
	}
}
// ==================== Event Listeners ====================

function bindEventListeners() {
	if (chatInput) {
		chatInput.addEventListener("input", handleTextareaInput);
		chatInput.addEventListener("keydown", handleTextareaKeydown);
		chatInput.addEventListener("paste", handlePaste);
		// Sync scroll between textarea and highlighter
		chatInput.addEventListener("scroll", function () {
			if (inputHighlighter) {
				inputHighlighter.scrollTop = chatInput.scrollTop;
			}
		});
	}
	if (sendBtn) sendBtn.addEventListener("click", handleSend);
	if (attachBtn) attachBtn.addEventListener("click", handleAttach);
	if (modeBtn) modeBtn.addEventListener("click", toggleModeDropdown);

	document
		.querySelectorAll(".mode-option[data-mode]")
		.forEach(function (option) {
			option.addEventListener("click", function () {
				setMode(option.getAttribute("data-mode"), true);
				closeModeDropdown();
			});
		});

	document.addEventListener("click", function (e) {
		let markdownLink =
			e.target && e.target.closest
				? e.target.closest("a.markdown-link[data-link-target]")
				: null;
		if (markdownLink) {
			e.preventDefault();
			let markdownLinksApi = window.TaskSyncMarkdownLinks;
			let encodedTarget = markdownLink.getAttribute("data-link-target");
			if (
				encodedTarget &&
				markdownLinksApi &&
				typeof markdownLinksApi.toWebviewMessage === "function"
			) {
				const linkMessage = markdownLinksApi.toWebviewMessage(encodedTarget);
				if (linkMessage) {
					vscode.postMessage(linkMessage);
				}
			}
			return;
		}

		if (
			dropdownOpen &&
			!e.target.closest(".mode-selector") &&
			!e.target.closest(".mode-dropdown")
		)
			closeModeDropdown();
		if (
			autocompleteVisible &&
			!e.target.closest(".autocomplete-dropdown") &&
			!e.target.closest("#chat-input")
		)
			hideAutocomplete();
		if (
			slashDropdownVisible &&
			!e.target.closest(".slash-dropdown") &&
			!e.target.closest("#chat-input")
		)
			hideSlashDropdown();
	});

	// Remember right-click target so context-menu Copy can resolve the exact clicked message.
	document.addEventListener("contextmenu", handleContextMenu);
	// Intercept Copy when nothing is selected and copy clicked message text as-is.
	document.addEventListener("copy", handleCopy);

	if (queueHeader)
		queueHeader.addEventListener("click", handleQueueHeaderClick);
	if (historyModalClose)
		historyModalClose.addEventListener("click", closeHistoryModal);
	if (historyModalClearAll)
		historyModalClearAll.addEventListener("click", clearAllPersistedHistory);
	if (historyModalOverlay) {
		historyModalOverlay.addEventListener("click", function (e) {
			if (e.target === historyModalOverlay) closeHistoryModal();
		});
	}

	// Hub & Thread Shell events
	if (hubNewSessionBtn)
		hubNewSessionBtn.addEventListener("click", openNewSessionModal);
	if (hubHistoryBtn) hubHistoryBtn.addEventListener("click", openHistoryModal);
	if (hubSettingsBtn)
		hubSettingsBtn.addEventListener("click", openSettingsModal);
	if (threadBackBtn) {
		threadBackBtn.addEventListener("click", function () {
			vscode.postMessage({ type: "switchSession", sessionId: null });
		});
	}
	if (threadHistoryBtn)
		threadHistoryBtn.addEventListener("click", openHistoryModal);
	if (threadSettingsBtn)
		threadSettingsBtn.addEventListener("click", openSessionSettingsModal);

	// Session settings modal events
	bindSessionSettingsEvents();

	// Edit mode button events
	if (editCancelBtn) editCancelBtn.addEventListener("click", cancelEditMode);
	if (editConfirmBtn) editConfirmBtn.addEventListener("click", confirmEditMode);

	// Approval modal button events
	if (approvalContinueBtn)
		approvalContinueBtn.addEventListener("click", handleApprovalContinue);
	if (approvalNoBtn) approvalNoBtn.addEventListener("click", handleApprovalNo);

	// Settings modal events
	if (settingsModalClose)
		settingsModalClose.addEventListener("click", closeSettingsModal);
	if (settingsModalOverlay) {
		settingsModalOverlay.addEventListener("click", function (e) {
			if (e.target === settingsModalOverlay) closeSettingsModal();
		});
	}
	if (soundToggle) {
		soundToggle.addEventListener("click", toggleSoundSetting);
		soundToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleSoundSetting();
			}
		});
	}
	if (interactiveApprovalToggle) {
		interactiveApprovalToggle.addEventListener(
			"click",
			toggleInteractiveApprovalSetting,
		);
		interactiveApprovalToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleInteractiveApprovalSetting();
			}
		});
	}
	if (autoAppendToggle) {
		autoAppendToggle.addEventListener("click", toggleAutoAppendSetting);
		autoAppendToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAutoAppendSetting();
			}
		});
	}
	if (autoAppendTextInput) {
		autoAppendTextInput.addEventListener("change", handleAutoAppendTextChange);
		autoAppendTextInput.addEventListener("blur", handleAutoAppendTextChange);
	}
	if (alwaysAppendReminderToggle) {
		alwaysAppendReminderToggle.addEventListener(
			"click",
			toggleAlwaysAppendReminderSetting,
		);
		alwaysAppendReminderToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAlwaysAppendReminderSetting();
			}
		});
	}
	if (sendShortcutToggle) {
		sendShortcutToggle.addEventListener(
			"click",
			toggleSendWithCtrlEnterSetting,
		);
		sendShortcutToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleSendWithCtrlEnterSetting();
			}
		});
	}
	if (autopilotToggle) {
		autopilotToggle.addEventListener("click", toggleAutopilotSetting);
		autopilotToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAutopilotSetting();
			}
		});
	}
	// Autopilot prompts list event listeners
	if (autopilotAddBtn) {
		autopilotAddBtn.addEventListener("click", showAddAutopilotPromptForm);
	}
	if (saveAutopilotPromptBtn) {
		saveAutopilotPromptBtn.addEventListener("click", saveAutopilotPrompt);
	}
	if (cancelAutopilotPromptBtn) {
		cancelAutopilotPromptBtn.addEventListener(
			"click",
			hideAddAutopilotPromptForm,
		);
	}
	// List-level events (click, drag) are bound via initWorkspacePromptListUI()
	if (responseTimeoutSelect) {
		responseTimeoutSelect.addEventListener(
			"change",
			handleResponseTimeoutChange,
		);
	}
	if (sessionWarningHoursSelect) {
		sessionWarningHoursSelect.addEventListener(
			"change",
			handleSessionWarningHoursChange,
		);
	}
	if (maxAutoResponsesInput) {
		maxAutoResponsesInput.addEventListener(
			"change",
			handleMaxAutoResponsesChange,
		);
		maxAutoResponsesInput.addEventListener(
			"blur",
			handleMaxAutoResponsesChange,
		);
	}
	if (remoteMaxDevicesInput) {
		remoteMaxDevicesInput.addEventListener(
			"change",
			handleRemoteMaxDevicesChange,
		);
		remoteMaxDevicesInput.addEventListener(
			"blur",
			handleRemoteMaxDevicesChange,
		);
	}
	if (humanDelayToggle) {
		humanDelayToggle.addEventListener("click", toggleHumanDelaySetting);
		humanDelayToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleHumanDelaySetting();
			}
		});
	}
	if (humanDelayMinInput) {
		humanDelayMinInput.addEventListener("change", handleHumanDelayMinChange);
		humanDelayMinInput.addEventListener("blur", handleHumanDelayMinChange);
	}
	if (humanDelayMaxInput) {
		humanDelayMaxInput.addEventListener("change", handleHumanDelayMaxChange);
		humanDelayMaxInput.addEventListener("blur", handleHumanDelayMaxChange);
	}
	if (addPromptBtn) addPromptBtn.addEventListener("click", showAddPromptForm);
	// Add prompt form events (deferred - bind after modal created)
	let cancelPromptBtn = document.getElementById("cancel-prompt-btn");
	let savePromptBtn = document.getElementById("save-prompt-btn");
	if (cancelPromptBtn)
		cancelPromptBtn.addEventListener("click", hideAddPromptForm);
	if (savePromptBtn) savePromptBtn.addEventListener("click", saveNewPrompt);

	window.addEventListener("message", handleExtensionMessage);
}

function bindSessionSettingsEvents() {
	var ssCloseBtn = document.getElementById("ss-close-btn");
	var ssResetBtn = document.getElementById("ss-reset-btn");

	if (sessionSettingsOverlay) {
		sessionSettingsOverlay.addEventListener("click", function (e) {
			if (e.target === sessionSettingsOverlay) closeSessionSettingsModal();
		});
	}
	if (ssCloseBtn)
		ssCloseBtn.addEventListener("click", closeSessionSettingsModal);
	if (ssResetBtn) ssResetBtn.addEventListener("click", resetSessionSettings);
	if (ssAutopilotToggle) {
		ssAutopilotToggle.addEventListener("click", ssToggleAutopilot);
		ssAutopilotToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAutopilot();
			}
		});
	}
	if (ssAutoAppendToggle) {
		ssAutoAppendToggle.addEventListener("click", ssToggleAutoAppend);
		ssAutoAppendToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAutoAppend();
			}
		});
	}
	if (ssAlwaysAppendReminderToggle) {
		ssAlwaysAppendReminderToggle.addEventListener(
			"click",
			ssToggleAlwaysAppendReminder,
		);
		ssAlwaysAppendReminderToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAlwaysAppendReminder();
			}
		});
	}
	if (ssAddAutopilotPromptBtn)
		ssAddAutopilotPromptBtn.addEventListener("click", ssShowAddPromptForm);
	if (ssSaveAutopilotPromptBtn)
		ssSaveAutopilotPromptBtn.addEventListener("click", ssSavePrompt);
	if (ssCancelAutopilotPromptBtn)
		ssCancelAutopilotPromptBtn.addEventListener("click", ssHideAddPromptForm);
	// List-level events (click, drag) are bound via initSessionPromptListUI()
}
// ==================== History Modal ====================

function openHistoryModal() {
	if (!historyModalOverlay) return;
	// Request persisted history from extension
	vscode.postMessage({ type: "openHistoryModal" });
	historyModalOverlay.classList.remove("hidden");
}

function closeHistoryModal() {
	if (!historyModalOverlay) return;
	historyModalOverlay.classList.add("hidden");
}

function clearAllPersistedHistory() {
	if (persistedHistory.length === 0) return;
	vscode.postMessage({ type: "clearPersistedHistory" });
	persistedHistory = [];
	renderHistoryModal();
}

function initCardSelection() {
	if (cardVibe) {
		cardVibe.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			selectCard("normal", true);
		});
	}
	if (cardSpec) {
		cardSpec.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			selectCard("queue", true);
		});
	}
	// Don't set default here - wait for updateQueue message from extension
	// which contains the persisted enabled state
	updateCardSelection();
}

function selectCard(card, notify) {
	selectedCard = card;
	queueEnabled = card === "queue";
	updateCardSelection();
	updateModeUI();
	updateQueueVisibility();

	// Only notify extension if user clicked (not on init from persisted state)
	if (notify) {
		vscode.postMessage({ type: "toggleQueue", enabled: queueEnabled });
	}
}

function updateCardSelection() {
	// card-vibe = Normal mode, card-spec = Queue mode
	if (cardVibe) cardVibe.classList.toggle("selected", !queueEnabled);
	if (cardSpec) cardSpec.classList.toggle("selected", queueEnabled);
}
// ==================== Input Handling ====================

// Cached input history (invalidated when currentSessionCalls changes)
var _inputHistoryCache = null;
var _inputHistoryCacheLen = -1;

/**
 * Build a deduplicated list of past user-typed responses (newest first)
 * from the existing tool-call history. Filters out queued/autopilot responses,
 * cancelled entries, approval shortcuts, and very short responses.
 * Capped at 50 entries. Cached until session length changes.
 */
function getInputHistory() {
	var sessionLen = currentSessionCalls ? currentSessionCalls.length : 0;
	if (_inputHistoryCache && _inputHistoryCacheLen === sessionLen) {
		return _inputHistoryCache;
	}
	var all = (currentSessionCalls || []).concat(persistedHistory || []);
	var seen = Object.create(null);
	var result = [];
	for (var i = 0; i < all.length; i++) {
		if (result.length >= 50) break;
		var e = all[i];
		if (
			e.status === "completed" &&
			!e.isFromQueue &&
			e.response &&
			e.response.trim().length > 3
		) {
			var text = e.response.trim();
			if (!seen[text]) {
				seen[text] = true;
				result.push(text);
			}
		}
	}
	_inputHistoryCache = result;
	_inputHistoryCacheLen = sessionLen;
	return result;
}

/**
 * Create a hidden mirror div that replicates the textarea's text rendering.
 * Used to measure visual line positions for word-wrapped text.
 */
function createTextareaMirror() {
	var mirror = document.createElement("div");
	var cs = getComputedStyle(chatInput);
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.height = "auto";
	mirror.style.whiteSpace = cs.whiteSpace;
	mirror.style.overflowWrap = cs.overflowWrap;
	mirror.style.wordBreak = cs.wordBreak;
	mirror.style.width = chatInput.clientWidth + "px";
	mirror.style.font = cs.font;
	mirror.style.lineHeight = cs.lineHeight;
	mirror.style.letterSpacing = cs.letterSpacing;
	mirror.style.padding = cs.padding;
	mirror.style.boxSizing = "border-box";
	mirror.style.tabSize = cs.tabSize || "8";
	return mirror;
}

/**
 * Check if two character positions are on the same visual line in the textarea.
 * Renders the full text in a hidden mirror div with zero-width probes at both
 * positions, then compares their vertical offsets. Using offsetTop equality
 * avoids rounding issues that height-difference comparisons are prone to.
 */
function areSameVisualLine(posA, posB) {
	if (!chatInput) return true;
	var text = chatInput.value;
	var first = Math.min(posA, posB);
	var second = Math.max(posA, posB);

	var mirror = createTextareaMirror();
	mirror.appendChild(document.createTextNode(text.substring(0, first)));
	var probeA = document.createElement("span");
	probeA.textContent = "\u200b";
	mirror.appendChild(probeA);
	mirror.appendChild(document.createTextNode(text.substring(first, second)));
	var probeB = document.createElement("span");
	probeB.textContent = "\u200b";
	mirror.appendChild(probeB);
	mirror.appendChild(document.createTextNode(text.substring(second)));
	document.body.appendChild(mirror);

	var same = probeA.offsetTop === probeB.offsetTop;
	document.body.removeChild(mirror);
	return same;
}

/**
 * Check if the cursor is on the first visual line of the textarea.
 * Accounts for word-wrapped text, not just logical newlines.
 */
function isCursorOnFirstVisualLine() {
	if (!chatInput) return true;
	var pos = chatInput.selectionStart;
	if (pos === 0) return true;
	return areSameVisualLine(0, pos);
}

/**
 * Check if the cursor is on the last visual line of the textarea.
 * Accounts for word-wrapped text, not just logical newlines.
 */
function isCursorOnLastVisualLine() {
	if (!chatInput) return true;
	var text = chatInput.value;
	var pos = chatInput.selectionEnd;
	if (pos >= text.length) return true;
	return areSameVisualLine(pos, text.length);
}

function autoResizeTextarea() {
	if (!chatInput) return;
	chatInput.style.height = "auto";
	chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
}

/**
 * Update the input highlighter overlay to show syntax highlighting
 * for slash commands (/command) and file references (#file)
 */
function updateInputHighlighter() {
	if (!inputHighlighter || !chatInput) return;

	let text = chatInput.value;
	if (!text) {
		inputHighlighter.innerHTML = "";
		return;
	}

	// Build a list of known slash command names for exact matching
	let knownSlashNames = reusablePrompts.map(function (p) {
		return p.name;
	});
	// Also add any pending stored mappings
	let mappings = chatInput._slashPrompts || {};
	Object.keys(mappings).forEach(function (name) {
		if (knownSlashNames.indexOf(name) === -1) knownSlashNames.push(name);
	});

	// Escape HTML first
	let html = escapeHtml(text);

	// Highlight slash commands - match /word patterns
	// Only highlight if it's a known command OR any /word pattern
	html = html.replace(
		/(^|\s)(\/[a-zA-Z0-9_-]+)(\s|$)/g,
		function (match, before, slash, after) {
			let cmdName = slash.substring(1); // Remove the /
			// Highlight if it's a known command or if we have prompts defined
			if (
				knownSlashNames.length === 0 ||
				knownSlashNames.indexOf(cmdName) >= 0
			) {
				return (
					before + '<span class="slash-highlight">' + slash + "</span>" + after
				);
			}
			// Still highlight as generic slash command
			return (
				before + '<span class="slash-highlight">' + slash + "</span>" + after
			);
		},
	);

	// Highlight file references - match #word patterns
	html = html.replace(
		/(^|\s)(#[a-zA-Z0-9_.\/-]+)(\s|$)/g,
		function (match, before, hash, after) {
			return (
				before + '<span class="hash-highlight">' + hash + "</span>" + after
			);
		},
	);

	// Don't add trailing space - causes visual artifacts
	// html += '&nbsp;';

	inputHighlighter.innerHTML = html;

	// Sync scroll position
	inputHighlighter.scrollTop = chatInput.scrollTop;
}

function handleTextareaInput() {
	autoResizeTextarea();
	updateInputHighlighter();
	handleAutocomplete();
	handleSlashCommands();
	// Context items (#terminal, #problems) now handled via handleAutocomplete()
	syncAttachmentsWithText();
	updateSendButtonState();
	// Reset history position on manual edits — edited text becomes the new "draft"
	historyIndex = -1;
	// Persist input value so it survives sidebar tab switches
	saveWebviewState();
}

function updateSendButtonState() {
	if (!sendBtn || !chatInput) return;
	let hasText = chatInput.value.trim().length > 0;
	sendBtn.classList.toggle("has-text", hasText);
}

function handleTextareaKeydown(e) {
	// Handle approval modal keyboard shortcuts when visible
	if (
		isApprovalQuestion &&
		approvalModal &&
		!approvalModal.classList.contains("hidden")
	) {
		// Enter sends "Continue" when approval modal is visible and input is empty
		if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			let inputText = chatInput ? chatInput.value.trim() : "";
			if (!inputText) {
				e.preventDefault();
				handleApprovalContinue();
				return;
			}
			// If there's text, fall through to normal send behavior
		}
		// Escape dismisses approval modal
		if (e.key === "Escape") {
			e.preventDefault();
			handleApprovalNo();
			return;
		}
	}

	// Handle edit mode keyboard shortcuts
	if (editingPromptId) {
		if (e.key === "Escape") {
			e.preventDefault();
			cancelEditMode();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			confirmEditMode();
			return;
		}
		// Allow other keys in edit mode
		return;
	}

	// Handle slash command dropdown navigation
	if (slashDropdownVisible) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (selectedSlashIndex < slashResults.length - 1) {
				selectedSlashIndex++;
				updateSlashSelection();
			}
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (selectedSlashIndex > 0) {
				selectedSlashIndex--;
				updateSlashSelection();
			}
			return;
		}
		if ((e.key === "Enter" || e.key === "Tab") && selectedSlashIndex >= 0) {
			e.preventDefault();
			selectSlashItem(selectedSlashIndex);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			hideSlashDropdown();
			return;
		}
	}

	if (autocompleteVisible) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (selectedAutocompleteIndex < autocompleteResults.length - 1) {
				selectedAutocompleteIndex++;
				updateAutocompleteSelection();
			}
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (selectedAutocompleteIndex > 0) {
				selectedAutocompleteIndex--;
				updateAutocompleteSelection();
			}
			return;
		}
		if (
			(e.key === "Enter" || e.key === "Tab") &&
			selectedAutocompleteIndex >= 0
		) {
			e.preventDefault();
			selectAutocompleteItem(selectedAutocompleteIndex);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			hideAutocomplete();
			return;
		}
	}

	// Context dropdown navigation removed - context now uses # via file autocomplete

	// Up/Down arrow: cycle through past user responses when no dropdown is active
	if (e.key === "ArrowUp") {
		if (isCursorOnFirstVisualLine()) {
			var history = getInputHistory();
			if (history.length > 0) {
				e.preventDefault();
				if (historyIndex === -1) {
					// Starting navigation — save current draft
					historyDraft = chatInput ? chatInput.value : "";
					historyIndex = 0;
				} else if (historyIndex < history.length - 1) {
					historyIndex++;
				}
				if (chatInput) {
					chatInput.value = history[historyIndex];
					chatInput.selectionStart = chatInput.selectionEnd = 0;
					autoResizeTextarea();
					updateInputHighlighter();
					updateSendButtonState();
				}
				return;
			}
		}
	}

	if (
		e.key === "ArrowDown" &&
		historyIndex >= 0 &&
		isCursorOnLastVisualLine()
	) {
		e.preventDefault();
		var historyDown = getInputHistory();
		if (historyIndex > 0) {
			historyIndex--;
			if (chatInput) {
				chatInput.value = historyDown[historyIndex];
				chatInput.selectionStart = chatInput.selectionEnd = 0;
				autoResizeTextarea();
				updateInputHighlighter();
				updateSendButtonState();
			}
		} else {
			// Past newest entry — restore draft
			historyIndex = -1;
			if (chatInput) {
				chatInput.value = historyDraft;
				autoResizeTextarea();
				updateInputHighlighter();
				updateSendButtonState();
			}
		}
		return;
	}

	let isPlainEnter =
		e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;
	let isCtrlOrCmdEnter =
		e.key === "Enter" && !e.shiftKey && (e.ctrlKey || e.metaKey);

	if (!sendWithCtrlEnter && isPlainEnter) {
		e.preventDefault();
		handleSend();
		return;
	}

	if (sendWithCtrlEnter && isCtrlOrCmdEnter) {
		e.preventDefault();
		handleSend();
		return;
	}
}

/**
 * Handle send action triggered by VS Code command/keybinding.
 * Mirrors Enter behavior while avoiding sends when input is not focused.
 */
function handleSendFromShortcut() {
	if (!chatInput || document.activeElement !== chatInput) {
		return;
	}

	if (
		isApprovalQuestion &&
		approvalModal &&
		!approvalModal.classList.contains("hidden")
	) {
		let inputText = chatInput.value.trim();
		if (!inputText) {
			handleApprovalContinue();
			return;
		}
	}

	if (editingPromptId) {
		confirmEditMode();
		return;
	}

	if (slashDropdownVisible && selectedSlashIndex >= 0) {
		selectSlashItem(selectedSlashIndex);
		return;
	}

	if (autocompleteVisible && selectedAutocompleteIndex >= 0) {
		selectAutocompleteItem(selectedAutocompleteIndex);
		return;
	}

	handleSend();
}

function handleSend() {
	// Reset history navigation and invalidate cache on every send
	historyIndex = -1;
	historyDraft = "";
	_inputHistoryCache = null;

	let text = chatInput ? chatInput.value.trim() : "";
	if (!text && currentAttachments.length === 0) {
		// If choices are selected and input is empty, send the selected choices
		let choicesBar = document.getElementById("choices-bar");
		if (choicesBar && !choicesBar.classList.contains("hidden")) {
			let selectedButtons = choicesBar.querySelectorAll(".choice-btn.selected");
			if (selectedButtons.length > 0) {
				handleChoicesSend();
				return;
			}
		}
		return;
	}

	// Expand slash commands to full prompt text
	text = expandSlashCommands(text);

	// Hide approval modal when sending any response
	hideApprovalModal();

	// If processing response (AI working), auto-queue the message
	if (isProcessingResponse && text) {
		addToQueue(text);
		// This reduces friction - user's prompt is in queue, so show them queue mode
		if (!queueEnabled) {
			queueEnabled = true;
			updateModeUI();
			updateQueueVisibility();
			updateCardSelection();
			vscode.postMessage({ type: "toggleQueue", enabled: true });
		}
		if (chatInput) {
			chatInput.value = "";
			chatInput.style.height = "auto";
			updateInputHighlighter();
		}
		currentAttachments = [];
		updateChipsDisplay();
		updateSendButtonState();
		// Clear persisted state after sending
		saveWebviewState();
		return;
	}

	// In remote mode with no pending tool call and no active session,
	// bypass queue mode and use direct chat for immediate response.
	var bypassQueueForChat =
		isRemoteMode &&
		!pendingToolCall &&
		text &&
		currentSessionCalls.length === 0;
	debugLog(
		"handleSend: isRemote:",
		isRemoteMode,
		"bypass:",
		bypassQueueForChat,
		"queue:",
		queueEnabled,
		"sessions:",
		currentSessionCalls.length,
	);

	if (!bypassQueueForChat && queueEnabled && text && !pendingToolCall) {
		debugLog("handleSend: → addToQueue");
		addToQueue(text);
	} else if (isRemoteMode && !pendingToolCall && text) {
		debugLog("handleSend: → chatMessage");
		addChatStreamUserBubble(text);
		vscode.postMessage({ type: "chatMessage", content: text });
		// Show "Processing your response" immediately so the user sees the same state as the main UI
		isProcessingResponse = true;
		updatePendingUI();
	} else {
		vscode.postMessage({
			type: "submit",
			sessionId: activeSessionId,
			toolCallId: pendingToolCall ? pendingToolCall.id : null,
			value: text,
			attachments: currentAttachments,
		});
		// In remote mode, show "Processing your response" optimistically while awaiting server round-trip
		if (isRemoteMode && pendingToolCall) {
			pendingToolCall = null;
			isProcessingResponse = true;
			updatePendingUI();
		}
	}

	if (chatInput) {
		chatInput.value = "";
		chatInput.style.height = "auto";
		updateInputHighlighter();
	}
	currentAttachments = [];
	updateChipsDisplay();
	updateSendButtonState();
	// Clear persisted state after sending
	saveWebviewState();
}

function handleAttach() {
	vscode.postMessage({ type: "addAttachment" });
}

function toggleModeDropdown(e) {
	e.stopPropagation();
	if (dropdownOpen) closeModeDropdown();
	else {
		dropdownOpen = true;
		positionModeDropdown();
		modeDropdown.classList.remove("hidden");
		modeDropdown.classList.add("visible");
	}
}

function positionModeDropdown() {
	if (!modeDropdown || !modeBtn) return;
	let rect = modeBtn.getBoundingClientRect();
	modeDropdown.style.bottom = window.innerHeight - rect.top + 4 + "px";
	modeDropdown.style.left = rect.left + "px";
}

function closeModeDropdown() {
	dropdownOpen = false;
	if (modeDropdown) {
		modeDropdown.classList.remove("visible");
		modeDropdown.classList.add("hidden");
	}
}

function setMode(mode, notify) {
	queueEnabled = mode === "queue";
	updateModeUI();
	updateQueueVisibility();
	updateCardSelection();
	if (notify)
		vscode.postMessage({ type: "toggleQueue", enabled: queueEnabled });
}

function updateModeUI() {
	if (modeLabel) modeLabel.textContent = queueEnabled ? "Queue" : "Normal";
	document.querySelectorAll(".mode-option[data-mode]").forEach(function (opt) {
		opt.classList.toggle(
			"selected",
			opt.getAttribute("data-mode") === (queueEnabled ? "queue" : "normal"),
		);
	});
}

function updateQueueVisibility() {
	if (!queueSection) return;
	// Hide queue section if: not in queue mode OR queue is empty
	let shouldHide = !queueEnabled || promptQueue.length === 0;
	let wasHidden = queueSection.classList.contains("hidden");
	queueSection.classList.toggle("hidden", shouldHide);
	// Only collapse when showing for the FIRST time (was hidden, now visible)
	// Don't collapse on subsequent updates to preserve user's expanded state
	if (wasHidden && !shouldHide && promptQueue.length > 0) {
		queueSection.classList.add("collapsed");
	}
}

function handleQueueHeaderClick() {
	if (queueSection) queueSection.classList.toggle("collapsed");
}

function normalizeResponseTimeout(value) {
	if (!Number.isFinite(value)) {
		return RESPONSE_TIMEOUT_DEFAULT;
	}
	if (!RESPONSE_TIMEOUT_ALLOWED_VALUES.has(value)) {
		return RESPONSE_TIMEOUT_DEFAULT;
	}
	return value;
}
// ==================== Extension Message Handler ====================

function handleExtensionMessage(event) {
	let message = event.data;
	switch (message.type) {
		case "updateQueue":
			promptQueue = message.queue || [];
			queueEnabled = message.enabled !== false;
			renderQueue();
			updateModeUI();
			updateQueueVisibility();
			updateCardSelection();
			// Hide welcome section if we have current session calls
			updateWelcomeSectionVisibility();
			break;
		case "toolCallPending":
			showPendingToolCall(
				message.id,
				message.sessionId,
				message.prompt,
				message.isApproval,
				message.choices,
			);
			break;
		case "toolCallCompleted":
			addToolCallToCurrentSession(message.entry, message.sessionTerminated);
			_inputHistoryCache = null; // Invalidate cache when entries are added
			break;
		case "updateCurrentSession":
			currentSessionCalls = message.history || [];
			_inputHistoryCache = null; // Invalidate cache when session updates
			renderCurrentSession();
			// Hide welcome section if we have completed tool calls
			updateWelcomeSectionVisibility();
			// Auto-scroll to bottom after rendering
			scrollToBottom();
			break;
		case "updatePersistedHistory":
			persistedHistory = message.history || [];
			_inputHistoryCache = null; // Invalidate cache when history updates
			renderHistoryModal();
			break;
		case "updateSessions":
			if (typeof saveActiveSessionComposerState === "function") {
				saveActiveSessionComposerState();
			}
			sessions = Array.isArray(message.sessions) ? message.sessions : [];
			activeSessionId = message.activeSessionId || null;
			renderSessionsList();
			if (typeof restoreActiveSessionComposerState === "function") {
				restoreActiveSessionComposerState();
			}
			updateWelcomeSectionVisibility();
			break;
		case "openHistoryModal":
			openHistoryModal();
			break;
		case "openSettingsModal":
			openSettingsModal();
			break;
		case "openNewSessionModal":
			openNewSessionModal();
			break;
		case "openResetSessionModal":
			openResetSessionModal();
			break;
		case "toggleSplitView":
			toggleSplitView();
			break;
		case "updateSettings":
			soundEnabled = message.soundEnabled !== false;
			interactiveApprovalEnabled = message.interactiveApprovalEnabled !== false;
			autoAppendEnabled = message.autoAppendEnabled === true;
			autoAppendText =
				typeof message.autoAppendText === "string"
					? message.autoAppendText
					: DEFAULT_AUTO_APPEND_TEXT;
			alwaysAppendReminder = message.alwaysAppendReminder === true;
			sendWithCtrlEnter = message.sendWithCtrlEnter === true;
			autopilotEnabled = message.autopilotEnabled === true;
			autopilotText =
				typeof message.autopilotText === "string" ? message.autopilotText : "";
			autopilotPrompts = Array.isArray(message.autopilotPrompts)
				? message.autopilotPrompts
				: [];
			reusablePrompts = message.reusablePrompts || [];
			responseTimeout = normalizeResponseTimeout(message.responseTimeout);
			sessionWarningHours =
				typeof message.sessionWarningHours === "number"
					? message.sessionWarningHours
					: DEFAULT_SESSION_WARNING_HOURS;
			maxConsecutiveAutoResponses =
				typeof message.maxConsecutiveAutoResponses === "number"
					? message.maxConsecutiveAutoResponses
					: DEFAULT_MAX_AUTO_RESPONSES;
			remoteMaxDevices =
				typeof message.remoteMaxDevices === "number" &&
				Number.isFinite(message.remoteMaxDevices)
					? Math.max(
							MIN_REMOTE_MAX_DEVICES,
							Math.floor(message.remoteMaxDevices),
						)
					: DEFAULT_REMOTE_MAX_DEVICES;
			humanLikeDelayEnabled = message.humanLikeDelayEnabled !== false;
			humanLikeDelayMin =
				typeof message.humanLikeDelayMin === "number"
					? message.humanLikeDelayMin
					: DEFAULT_HUMAN_DELAY_MIN;
			humanLikeDelayMax =
				typeof message.humanLikeDelayMax === "number"
					? message.humanLikeDelayMax
					: DEFAULT_HUMAN_DELAY_MAX;
			updateSoundToggleUI();
			updateInteractiveApprovalToggleUI();
			updateAutoAppendToggleUI();
			updateAutoAppendTextUI();
			updateAlwaysAppendReminderToggleUI();
			updateSendWithCtrlEnterToggleUI();
			updateAutopilotToggleUI();
			renderAutopilotPromptsList();
			updateResponseTimeoutUI();
			updateSessionWarningHoursUI();
			updateMaxAutoResponsesUI();
			updateRemoteMaxDevicesUI();
			updateHumanDelayUI();
			renderPromptsList();
			break;
		case "slashCommandResults":
			showSlashDropdown(message.prompts || []);
			break;
		case "playNotificationSound":
			playNotificationSound();
			break;
		case "fileSearchResults":
			showAutocomplete(message.files || []);
			break;
		case "updateAttachments":
			currentAttachments = message.attachments || [];
			updateChipsDisplay();
			break;
		case "imageSaved":
			if (
				message.attachment &&
				!currentAttachments.some(function (a) {
					return a.id === message.attachment.id;
				})
			) {
				currentAttachments.push(message.attachment);
				updateChipsDisplay();
			}
			break;
		case "clear":
			currentSessionCalls = [];
			pendingToolCall = null;
			lastPendingContentHtml = "";
			isProcessingResponse = false;
			if (activeSessionId) {
				sessionComposerState[activeSessionId] = { inputValue: "" };
			}
			if (chatInput) {
				chatInput.value = "";
				chatInput.style.height = "auto";
				updateInputHighlighter();
				updateSendButtonState();
			}
			renderCurrentSession();
			if (pendingMessage) {
				if (
					typeof message.statusMessage === "string" &&
					message.statusMessage
				) {
					pendingMessage.classList.remove("hidden");
					pendingMessage.innerHTML =
						'<div class="session-started-notice">' +
						'<span class="codicon codicon-check"></span> ' +
						message.statusMessage +
						"</div>";
				} else {
					pendingMessage.classList.add("hidden");
					pendingMessage.innerHTML = "";
				}
			}
			updateWelcomeSectionVisibility();
			break;
		case "clearPendingState":
			pendingToolCall = null;
			lastPendingContentHtml = "";
			isProcessingResponse = false;
			if (pendingMessage) {
				pendingMessage.classList.add("hidden");
				pendingMessage.innerHTML = "";
			}
			hideApprovalModal();
			hideChoicesBar();
			renderCurrentSession();
			break;
		case "updateSessionTimer":
			updateRemoteSessionTimerState(
				typeof message.startTime === "number" ? message.startTime : null,
				typeof message.frozenElapsed === "number"
					? message.frozenElapsed
					: null,
			);
			break;
		case "triggerSendFromShortcut":
			handleSendFromShortcut();
			break;
		case "sessionSettingsState":
			populateSessionSettings(message);
			break;
	}
}

function updateRemoteSessionTimerState(startTime, frozenElapsed) {
	remoteSessionStartTime = typeof startTime === "number" ? startTime : null;
	remoteSessionFrozenElapsed =
		typeof frozenElapsed === "number" ? frozenElapsed : null;

	if (remoteSessionTimerInterval) {
		clearInterval(remoteSessionTimerInterval);
		remoteSessionTimerInterval = null;
	}

	renderRemoteSessionTimer();

	if (remoteSessionStartTime !== null && remoteSessionFrozenElapsed === null) {
		remoteSessionTimerInterval = setInterval(function () {
			renderRemoteSessionTimer();
		}, 1000);
	}
}

function renderRemoteSessionTimer() {
	if (!remoteSessionTimerEl) return;

	if (remoteSessionStartTime === null && remoteSessionFrozenElapsed === null) {
		remoteSessionTimerEl.textContent = "";
		remoteSessionTimerEl.classList.add("hidden");
		remoteSessionTimerEl.classList.remove("inactive", "active", "frozen");
		remoteSessionTimerEl.title = "Session timer (idle)";
		return;
	}

	remoteSessionTimerEl.classList.remove("hidden");

	var timerText = "0s";
	var timerStateClass = "inactive";

	if (remoteSessionFrozenElapsed !== null) {
		timerText = formatRemoteElapsed(remoteSessionFrozenElapsed);
		timerStateClass = "frozen";
	} else if (remoteSessionStartTime !== null) {
		timerText = formatRemoteElapsed(Date.now() - remoteSessionStartTime);
		timerStateClass = "active";
	}

	remoteSessionTimerEl.textContent = timerText;
	remoteSessionTimerEl.classList.remove("inactive", "active", "frozen");
	remoteSessionTimerEl.classList.add(timerStateClass);
	remoteSessionTimerEl.title =
		timerStateClass === "inactive" ? "Session timer (idle)" : "Session timer";
}

function formatRemoteElapsed(ms) {
	var seconds = Math.max(0, Math.floor(ms / 1000));
	var h = Math.floor(seconds / 3600);
	var m = Math.floor((seconds % 3600) / 60);
	var s = seconds % 60;
	if (h > 0) return h + "h " + m + "m " + s + "s";
	if (m > 0) return m + "m " + s + "s";
	return s + "s";
}

function showPendingToolCall(id, sessionId, prompt, isApproval, choices) {
	pendingToolCall = { id: id, sessionId: sessionId, prompt: prompt };
	isProcessingResponse = false; // AI is now asking, not processing
	isApprovalQuestion = isApproval === true;
	currentChoices = choices || [];

	if (welcomeSection) {
		welcomeSection.classList.add("hidden");
	}

	// Add pending class to disable session switching UI
	document.body.classList.add("has-pending-toolcall");

	// Show AI question as rendered markdown
	if (pendingMessage) {
		pendingMessage.classList.remove("hidden");
		let pendingHtml =
			'<div class="pending-ai-question">' + formatMarkdown(prompt) + "</div>";
		lastPendingContentHtml = pendingHtml;
		pendingMessage.innerHTML = pendingHtml;
	} else {
		console.error("[TaskSync Webview] pendingMessage element is null!");
	}

	// Re-render current session (without the pending item - it's shown separately)
	renderCurrentSession();
	// Render any mermaid diagrams in pending message
	renderMermaidDiagrams();
	// Auto-scroll to show the new pending message
	scrollToBottom();

	// Show choice buttons if we have choices, otherwise show approval modal for yes/no questions
	// Only show if interactive approval is enabled
	if (interactiveApprovalEnabled) {
		if (currentChoices.length > 0) {
			showChoicesBar();
		} else if (isApprovalQuestion) {
			showApprovalModal();
		} else {
			hideApprovalModal();
			hideChoicesBar();
		}
	} else {
		// Interactive approval disabled - just focus input for manual typing
		hideApprovalModal();
		hideChoicesBar();
		if (chatInput) {
			chatInput.focus();
		}
	}
}
// ==================== Markdown Utilities ====================
// Extracted from rendering.js: table processing and list conversion

// Constants for security and performance limits
let MARKDOWN_MAX_LENGTH = 100000; // Max markdown input length to prevent ReDoS
let MAX_TABLE_ROWS = 100; // Max table rows to process

/**
 * Process a buffer of table lines into HTML table markup (ReDoS-safe).
 * Security: Caller (formatMarkdown) must pre-escape HTML before passing lines here.
 */
function processTableBuffer(lines, maxRows) {
	if (lines.length < 2) return lines.join("\n");
	if (lines.length > maxRows) return lines.join("\n"); // Skip very large tables

	// Check if second line is separator (contains only |, -, :, spaces)
	let separatorRegex = /^\|[\s\-:|]+\|$/;
	if (!separatorRegex.test(lines[1].trim())) return lines.join("\n");

	let headerCells = lines[0].split("|").filter(function (c) {
		return c.trim() !== "";
	});
	if (headerCells.length === 0) return lines.join("\n");

	let headerHtml =
		"<tr>" +
		headerCells
			.map(function (c) {
				return "<th>" + c.trim() + "</th>";
			})
			.join("") +
		"</tr>";

	let bodyHtml = "";
	for (var i = 2; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		let cells = lines[i].split("|").filter(function (c) {
			return c.trim() !== "";
		});
		bodyHtml +=
			"<tr>" +
			cells
				.map(function (c) {
					return "<td>" + c.trim() + "</td>";
				})
				.join("") +
			"</tr>";
	}

	return (
		'<table class="markdown-table"><thead>' +
		headerHtml +
		"</thead><tbody>" +
		bodyHtml +
		"</tbody></table>"
	);
}

/**
 * Converts markdown lists (ordered/unordered) with indentation-based nesting into HTML.
 * Uses 2-space indentation as one nesting level.
 * @param {string} text - Escaped markdown text (must already be HTML-escaped by caller)
 * @returns {string} Text with markdown lists converted to nested HTML lists
 */
function convertMarkdownLists(text) {
	let listLineRegex = /^\s*(?:[-*]|\d+\.)\s.*$/;
	let lines = text.split("\n");
	let output = [];
	let listBuffer = [];

	function renderListNode(node) {
		let startAttr =
			node.type === "ol" && typeof node.start === "number" && node.start > 1
				? ' start="' + node.start + '"'
				: "";
		return (
			"<" +
			node.type +
			startAttr +
			">" +
			node.items
				.map(function (item) {
					let childrenHtml = item.children.map(renderListNode).join("");
					return "<li>" + item.text + childrenHtml + "</li>";
				})
				.join("") +
			"</" +
			node.type +
			">"
		);
	}

	function processListBuffer(buffer) {
		let listItemRegex = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
		let rootLists = [];
		let stack = [];

		buffer.forEach(function (line) {
			let match = listItemRegex.exec(line);
			if (!match) return;

			let indent = match[1].replace(/\t/g, "    ").length;
			let depth = Math.floor(indent / 2);
			let marker = match[2];
			let type = marker === "-" || marker === "*" ? "ul" : "ol";
			let text = match[3];

			while (stack.length > depth + 1) {
				stack.pop();
			}

			let entry = stack[depth];
			if (!entry || entry.type !== type) {
				const listNode = {
					type: type,
					items: [],
					start: type === "ol" ? parseInt(marker, 10) : null,
				};

				if (depth === 0) {
					rootLists.push(listNode);
				} else {
					const parentEntry = stack[depth - 1];
					if (parentEntry && parentEntry.lastItem) {
						parentEntry.lastItem.children.push(listNode);
					} else {
						rootLists.push(listNode);
					}
				}

				entry = { type: type, list: listNode, lastItem: null };
			}

			stack = stack.slice(0, depth);
			stack[depth] = entry;

			let item = { text: text, children: [] };
			entry.list.items.push(item);
			entry.lastItem = item;
			stack[depth] = entry;
		});

		return rootLists.map(renderListNode).join("");
	}

	lines.forEach(function (line) {
		if (listLineRegex.test(line)) {
			listBuffer.push(line);
			return;
		}
		if (listBuffer.length > 0) {
			output.push(processListBuffer(listBuffer));
			listBuffer = [];
		}
		output.push(line);
	});

	if (listBuffer.length > 0) {
		output.push(processListBuffer(listBuffer));
	}

	return output.join("\n");
}
// ==================== Tool Call Rendering ====================

function addToolCallToCurrentSession(entry, sessionTerminated) {
	pendingToolCall = null;
	document.body.classList.remove("has-pending-toolcall");
	hideApprovalModal();
	hideChoicesBar();

	let idx = currentSessionCalls.findIndex(function (tc) {
		return tc.id === entry.id;
	});
	if (idx >= 0) {
		currentSessionCalls[idx] = entry;
	} else {
		currentSessionCalls.unshift(entry);
	}
	renderCurrentSession();
	isProcessingResponse = true;
	if (pendingMessage) {
		pendingMessage.classList.remove("hidden");
		// Check if session terminated
		if (sessionTerminated) {
			isProcessingResponse = false;
			pendingMessage.innerHTML =
				'<div class="new-session-prompt">' +
				"<span>Session terminated</span>" +
				'<button class="new-session-btn" id="new-session-btn">' +
				'<span class="codicon codicon-add"></span> Start new session' +
				"</button></div>";
			let newSessionBtn = document.getElementById("new-session-btn");
			if (newSessionBtn) {
				newSessionBtn.addEventListener("click", function () {
					vscode.postMessage({ type: "newSession" });
				});
			}
		} else {
			pendingMessage.innerHTML =
				'<div class="working-indicator">Processing your response</div>';
		}
	}

	// Auto-scroll to show the working indicator
	scrollToBottom();
}

function renderCurrentSession() {
	if (!toolHistoryArea) return;

	// Clear old chat stream bubbles when switching/re-rendering session
	if (chatStreamArea) {
		chatStreamArea.innerHTML = "";
		chatStreamArea.classList.add("hidden");
	}

	let completedCalls = currentSessionCalls.filter(function (tc) {
		return tc.status === "completed";
	});

	if (completedCalls.length === 0) {
		toolHistoryArea.innerHTML = "";
		return;
	}

	// Reverse to show oldest first (new items stack at bottom)
	let sortedCalls = completedCalls.slice().reverse();

	let cardsHtml = sortedCalls
		.map(function (tc, index) {
			let firstSentence = tc.prompt.split(/[.!?]/)[0];
			let truncatedTitle =
				firstSentence.length > 120
					? firstSentence.substring(0, 120) + "..."
					: firstSentence;
			let queueBadge = tc.isFromQueue
				? '<span class="tool-call-badge queue">Queue</span>'
				: "";
			let isLatest = index === sortedCalls.length - 1;
			let cardHtml =
				'<div class="tool-call-card' +
				(isLatest ? " expanded" : "") +
				'" data-id="' +
				escapeHtml(tc.id) +
				'">' +
				'<div class="tool-call-header">' +
				'<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
				'<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
				'<div class="tool-call-header-wrapper">' +
				'<span class="tool-call-title">' +
				escapeHtml(truncatedTitle) +
				queueBadge +
				"</span>" +
				"</div>" +
				"</div>" +
				'<div class="tool-call-body">' +
				'<div class="tool-call-ai-response">' +
				formatMarkdown(tc.prompt) +
				"</div>" +
				'<div class="tool-call-user-section">' +
				'<div class="tool-call-user-response">' +
				escapeHtml(tc.response) +
				"</div>" +
				(tc.attachments ? renderAttachmentsHtml(tc.attachments) : "") +
				"</div>" +
				"</div></div>";
			return cardHtml;
		})
		.join("");

	toolHistoryArea.innerHTML = cardsHtml;
	toolHistoryArea
		.querySelectorAll(".tool-call-header")
		.forEach(function (header) {
			header.addEventListener("click", function (e) {
				let card = header.closest(".tool-call-card");
				if (card) card.classList.toggle("expanded");
			});
		});
	renderMermaidDiagrams();
}

// ——— User message bubble for remote chat ———
/** Add user message bubble to the chat stream area. */
function addChatStreamUserBubble(text) {
	if (!chatStreamArea) return;
	chatStreamArea.classList.remove("hidden");
	var div = document.createElement("div");
	div.className = "chat-stream-msg user";
	div.textContent = text;
	chatStreamArea.appendChild(div);
	scrollToBottom();
}

function renderHistoryModal() {
	if (!historyModalList) return;
	if (persistedHistory.length === 0) {
		historyModalList.innerHTML =
			'<div class="history-modal-empty">No history yet</div>';
		if (historyModalClearAll) historyModalClearAll.classList.add("hidden");
		return;
	}

	if (historyModalClearAll) historyModalClearAll.classList.remove("hidden");
	function renderToolCallCard(tc) {
		let firstSentence = tc.prompt.split(/[.!?]/)[0];
		let truncatedTitle =
			firstSentence.length > 80
				? firstSentence.substring(0, 80) + "..."
				: firstSentence;
		let queueBadge = tc.isFromQueue
			? '<span class="tool-call-badge queue">Queue</span>'
			: "";

		return (
			'<div class="tool-call-card history-card" data-id="' +
			escapeHtml(tc.id) +
			'">' +
			'<div class="tool-call-header">' +
			'<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
			'<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
			'<div class="tool-call-header-wrapper">' +
			'<span class="tool-call-title">' +
			escapeHtml(truncatedTitle) +
			queueBadge +
			"</span>" +
			"</div>" +
			'<button class="tool-call-remove" data-id="' +
			escapeHtml(tc.id) +
			'" title="Remove"><span class="codicon codicon-close"></span></button>' +
			"</div>" +
			'<div class="tool-call-body">' +
			'<div class="tool-call-ai-response">' +
			formatMarkdown(tc.prompt) +
			"</div>" +
			'<div class="tool-call-user-section">' +
			'<div class="tool-call-user-response">' +
			escapeHtml(tc.response) +
			"</div>" +
			(tc.attachments ? renderAttachmentsHtml(tc.attachments) : "") +
			"</div>" +
			"</div></div>"
		);
	}

	let cardsHtml = '<div class="history-items-list">';
	cardsHtml += persistedHistory.map(renderToolCallCard).join("");
	cardsHtml += "</div>";

	historyModalList.innerHTML = cardsHtml;
	historyModalList
		.querySelectorAll(".tool-call-header")
		.forEach(function (header) {
			header.addEventListener("click", function (e) {
				if (e.target.closest(".tool-call-remove")) return;
				let card = header.closest(".tool-call-card");
				if (card) card.classList.toggle("expanded");
			});
		});
	historyModalList
		.querySelectorAll(".tool-call-remove")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				let id = btn.getAttribute("data-id");
				if (id) {
					vscode.postMessage({ type: "removeHistoryItem", callId: id });
					persistedHistory = persistedHistory.filter(function (tc) {
						return tc.id !== id;
					});
					renderHistoryModal();
				}
			});
		});
}

function formatMarkdown(text) {
	if (!text) return "";

	// ReDoS prevention: truncate very long inputs before regex (OWASP mitigation)
	if (text.length > MARKDOWN_MAX_LENGTH) {
		text =
			text.substring(0, MARKDOWN_MAX_LENGTH) +
			"\n... (content truncated for display)";
	}

	// Normalize line endings (Windows \r\n to \n)
	let processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	// Store code blocks BEFORE escaping HTML to preserve backticks
	let codeBlocks = [];
	let mermaidBlocks = [];
	let inlineCodeSpans = [];

	// Extract mermaid blocks first (before HTML escaping)
	// Match ```mermaid followed by newline or just content
	processedText = processedText.replace(
		/```mermaid\s*\n([\s\S]*?)```/g,
		function (match, code) {
			let index = mermaidBlocks.length;
			mermaidBlocks.push(code.trim());
			return "%%MERMAID" + index + "%%";
		},
	);

	// Extract other code blocks (before HTML escaping)
	// Match ```lang or just ``` followed by optional newline
	processedText = processedText.replace(
		/```(\w*)\s*\n?([\s\S]*?)```/g,
		function (match, lang, code) {
			let index = codeBlocks.length;
			codeBlocks.push({ lang: lang || "", code: code.trim() });
			return "%%CODEBLOCK" + index + "%%";
		},
	);

	// Extract inline code before escaping (prevents * and _ in `code` from being parsed)
	processedText = processedText.replace(/`([^`\n]+)`/g, function (match, code) {
		let index = inlineCodeSpans.length;
		inlineCodeSpans.push(code);
		return "%%INLINECODE" + index + "%%";
	});

	// Now escape HTML on the remaining text
	let html = escapeHtml(processedText);

	// Headers (## Header) - must be at start of line
	html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// Horizontal rules (--- or ***)
	html = html.replace(/^---+$/gm, "<hr>");
	html = html.replace(/^\*\*\*+$/gm, "<hr>");

	// Blockquotes (> text) - simple single-line support
	html = html.replace(/^&gt;\s*(.*)$/gm, "<blockquote>$1</blockquote>");
	// Merge consecutive blockquotes
	html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

	// Lists (ordered/unordered, including nested indentation)
	// Security contract: html is already escaped above; list conversion must keep item text as-is.
	html = convertMarkdownLists(html);

	// Markdown tables - SAFE approach to prevent ReDoS
	// Instead of using nested quantifiers with regex (which can cause exponential backtracking),
	// we use a line-by-line processing approach for safety
	let tableLines = html.split("\n");
	let processedLines = [];
	let tableBuffer = [];
	let inTable = false;

	for (var lineIdx = 0; lineIdx < tableLines.length; lineIdx++) {
		let line = tableLines[lineIdx];
		// Check if line looks like a table row (starts and ends with |)
		let isTableRow = /^\|.+\|$/.test(line.trim());

		if (isTableRow) {
			tableBuffer.push(line);
			inTable = true;
		} else {
			if (inTable && tableBuffer.length >= 2) {
				// Process accumulated table buffer
				const tableHtml = processTableBuffer(tableBuffer, MAX_TABLE_ROWS);
				processedLines.push(tableHtml);
			}
			tableBuffer = [];
			inTable = false;
			processedLines.push(line);
		}
	}
	// Handle table at end of content
	if (inTable && tableBuffer.length >= 2) {
		processedLines.push(processTableBuffer(tableBuffer, MAX_TABLE_ROWS));
	}
	html = processedLines.join("\n");

	// Tokenize markdown links before emphasis parsing so link targets are not mutated by markdown transforms.
	let markdownLinksApi = window.TaskSyncMarkdownLinks;
	let tokenizedLinks = null;
	if (
		markdownLinksApi &&
		typeof markdownLinksApi.tokenizeMarkdownLinks === "function"
	) {
		tokenizedLinks = markdownLinksApi.tokenizeMarkdownLinks(html);
		html = tokenizedLinks.text;
	}

	// Bold (**text** or __text__)
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

	// Strikethrough (~~text~~)
	html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

	// Italic (*text* or _text_)
	// For *text*: require non-word boundaries around delimiters and alnum at content edges.
	// This avoids false-positive matches in plain prose (e.g. regex snippets, list-marker-like asterisks).
	html = html.replace(
		/(^|[^\p{L}\p{N}_*])\*([\p{L}\p{N}](?:[^*\n]*?[\p{L}\p{N}])?)\*(?=[^\p{L}\p{N}_*]|$)/gu,
		"$1<em>$2</em>",
	);
	// For _text_: require non-word boundaries (Unicode-aware) around underscore markers
	// This keeps punctuation-adjacent emphasis working while avoiding snake_case matches
	html = html.replace(
		/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?=[^\p{L}\p{N}_]|$)/gu,
		"$1<em>$2</em>",
	);

	// Restore tokenized markdown links after emphasis parsing.
	if (
		tokenizedLinks &&
		markdownLinksApi &&
		typeof markdownLinksApi.restoreTokenizedLinks === "function"
	) {
		html = markdownLinksApi.restoreTokenizedLinks(html, tokenizedLinks.links);
	} else if (
		markdownLinksApi &&
		typeof markdownLinksApi.convertMarkdownLinks === "function"
	) {
		html = markdownLinksApi.convertMarkdownLinks(html);
	}

	// Restore inline code after emphasis parsing so markdown markers inside code stay literal.
	inlineCodeSpans.forEach(function (code, index) {
		let escapedCode = escapeHtml(code);
		let replacement = '<code class="inline-code">' + escapedCode + "</code>";
		html = html.replace("%%INLINECODE" + index + "%%", replacement);
	});

	// Line breaks - but collapse multiple consecutive breaks
	// Don't add <br> after block elements
	html = html.replace(/\n{3,}/g, "\n\n");
	html = html.replace(
		/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)\n/g,
		"$1",
	);
	html = html.replace(/\n/g, "<br>");

	// Restore code blocks
	codeBlocks.forEach(function (block, index) {
		let langAttr = block.lang ? ' data-lang="' + block.lang + '"' : "";
		let escapedCode = escapeHtml(block.code);
		let replacement =
			'<pre class="code-block"' +
			langAttr +
			"><code>" +
			escapedCode +
			"</code></pre>";
		html = html.replace("%%CODEBLOCK" + index + "%%", replacement);
	});

	// Restore mermaid blocks as diagrams
	mermaidBlocks.forEach(function (code, index) {
		let mermaidId =
			"mermaid-" +
			Date.now() +
			"-" +
			index +
			"-" +
			Math.random().toString(36).substr(2, 9);
		let replacement =
			'<div class="mermaid-container" data-mermaid-id="' +
			mermaidId +
			'"><div class="mermaid" id="' +
			mermaidId +
			'">' +
			escapeHtml(code) +
			"</div></div>";
		html = html.replace("%%MERMAID" + index + "%%", replacement);
	});

	// Clean up excessive <br> around block elements
	html = html.replace(
		/(<br>)+(<pre|<div class="mermaid|<h[1-6]|<ul|<ol|<blockquote|<hr)/g,
		"$2",
	);
	html = html.replace(
		/(<\/pre>|<\/div>|<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)(<br>)+/g,
		"$1",
	);

	return html;
}

// Mermaid rendering - lazy load and render
let mermaidLoaded = false;
let mermaidLoading = false;

function loadMermaid(callback) {
	if (mermaidLoaded) {
		callback();
		return;
	}
	if (mermaidLoading) {
		// Wait for existing load (with 10s timeout)
		let checkCount = 0;
		let checkInterval = setInterval(function () {
			checkCount++;
			if (mermaidLoaded) {
				clearInterval(checkInterval);
				callback();
			} else if (checkCount > 200) {
				// 10s = 200 * 50ms
				clearInterval(checkInterval);
				console.error("Mermaid load timeout");
			}
		}, 50);
		return;
	}
	mermaidLoading = true;

	let script = document.createElement("script");
	script.src = window.__MERMAID_SRC__ || "mermaid.min.js";
	script.onload = function () {
		window.mermaid.initialize({
			startOnLoad: false,
			theme: document.body.classList.contains("vscode-light")
				? "default"
				: "dark",
			securityLevel: "strict",
			fontFamily: "var(--vscode-font-family)",
		});
		mermaidLoaded = true;
		mermaidLoading = false;
		callback();
	};
	script.onerror = function () {
		mermaidLoading = false;
		console.error("Failed to load mermaid.js");
	};
	document.head.appendChild(script);
}

function renderMermaidDiagrams() {
	let containers = document.querySelectorAll(
		".mermaid-container:not(.rendered)",
	);
	if (containers.length === 0) return;

	loadMermaid(function () {
		containers.forEach(function (container) {
			let mermaidDiv = container.querySelector(".mermaid");
			if (!mermaidDiv) return;

			let code = mermaidDiv.textContent;
			let id = mermaidDiv.id;

			try {
				window.mermaid
					.render(id + "-svg", code)
					.then(function (result) {
						mermaidDiv.innerHTML = result.svg;
						container.classList.add("rendered");
					})
					.catch(function (err) {
						// Show code block as fallback on error
						mermaidDiv.innerHTML =
							'<pre class="code-block" data-lang="mermaid"><code>' +
							escapeHtml(code) +
							"</code></pre>";
						container.classList.add("rendered", "error");
					});
			} catch (err) {
				mermaidDiv.innerHTML =
					'<pre class="code-block" data-lang="mermaid"><code>' +
					escapeHtml(code) +
					"</code></pre>";
				container.classList.add("rendered", "error");
			}
		});
	});
}

/**
 * Toggle split view mode (sessions list + thread side by side)
 */
function toggleSplitView() {
	splitViewEnabled = !splitViewEnabled;
	var container = document.querySelector(".main-container.orch");
	if (container) {
		container.classList.toggle("split-view", splitViewEnabled);
	}
	var resizer = document.getElementById("split-resizer");
	if (resizer) {
		resizer.classList.toggle("hidden", !splitViewEnabled);
	}
	if (splitViewEnabled) {
		applySplitRatio(splitRatio);
	} else {
		// Reset inline styles when exiting split view
		var hubEl = document.getElementById("workspace-hub");
		if (hubEl) hubEl.style.flex = "";
	}
	updateWelcomeSectionVisibility();
	saveWebviewState();
}

/**
 * Apply the split ratio to the hub panel width
 */
function applySplitRatio(ratio) {
	ratio = Math.min(60, Math.max(20, ratio));
	var hubEl = document.getElementById("workspace-hub");
	if (hubEl) {
		hubEl.style.flex = "0 0 " + ratio + "%";
	}
}

/**
 * Initialise the split-view drag resizer.
 * Called once from cacheDOMElements / DOMContentLoaded.
 */
function initSplitResizer() {
	var resizer = document.getElementById("split-resizer");
	if (!resizer) return;

	var container = document.querySelector(".main-container.orch");
	if (!container) return;

	var dragging = false;

	resizer.addEventListener("mousedown", function (e) {
		if (!splitViewEnabled) return;
		e.preventDefault();
		dragging = true;
		resizer.classList.add("active");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	});

	document.addEventListener("mousemove", function (e) {
		if (!dragging) return;
		var rect = container.getBoundingClientRect();
		var offset = e.clientX - rect.left;
		var pct = (offset / rect.width) * 100;
		// Clamp between 20% and 60%
		pct = Math.min(60, Math.max(20, pct));
		splitRatio = Math.round(pct);
		applySplitRatio(splitRatio);
	});

	document.addEventListener("mouseup", function () {
		if (!dragging) return;
		dragging = false;
		resizer.classList.remove("active");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		saveWebviewState();
	});

	// Restore persisted ratio on init
	if (splitViewEnabled) {
		resizer.classList.remove("hidden");
		applySplitRatio(splitRatio);
	}
}

/**
 * Update workspace visibility and toggle between Hub and Thread views
 */
function updateWelcomeSectionVisibility() {
	var hubEl = document.getElementById("workspace-hub");
	var threadEl = document.getElementById("thread-shell");
	var placeholderEl = document.getElementById("split-placeholder");
	var threadHeadEl = document.getElementById("stage-head");
	var composerEl = document.getElementById("input-area-container");

	if (splitViewEnabled) {
		// Split view: always show hub, always show thread shell
		if (hubEl) hubEl.classList.remove("hidden");
		if (threadEl) threadEl.classList.remove("hidden");

		if (activeSessionId) {
			// Session selected: show thread content, hide placeholder
			if (placeholderEl) placeholderEl.classList.add("hidden");
			if (threadHeadEl) threadHeadEl.classList.remove("hidden");
			if (composerEl) composerEl.classList.remove("hidden");
			var activeSession = (sessions || []).find(function (s) {
				return s.id === activeSessionId;
			});
			var stageTitle = document.getElementById("stage-title");
			if (activeSession && stageTitle) {
				stageTitle.textContent = activeSession.title;
			}
		} else {
			// No session: show placeholder, hide thread head + composer
			if (placeholderEl) placeholderEl.classList.remove("hidden");
			if (threadHeadEl) threadHeadEl.classList.add("hidden");
			if (composerEl) composerEl.classList.add("hidden");
		}
		return;
	}

	// Single view (default): hide placeholder, restore thread head + composer
	if (placeholderEl) placeholderEl.classList.add("hidden");
	if (threadHeadEl) threadHeadEl.classList.remove("hidden");
	if (composerEl) composerEl.classList.remove("hidden");

	// Toggle between hub and thread
	if (activeSessionId) {
		if (hubEl) hubEl.classList.add("hidden");
		if (threadEl) threadEl.classList.remove("hidden");

		// Update thread head title
		var activeSession = (sessions || []).find(function (s) {
			return s.id === activeSessionId;
		});
		var stageTitle = document.getElementById("stage-title");
		if (activeSession) {
			if (stageTitle) stageTitle.textContent = activeSession.title;
		}
	} else {
		// No active session: show the hub, hide the thread shell
		if (hubEl) hubEl.classList.remove("hidden");
		if (threadEl) threadEl.classList.add("hidden");
	}
}

/**
 * Auto-scroll chat container to bottom
 */
function scrollToBottom() {
	if (!chatContainer) return;
	requestAnimationFrame(function () {
		chatContainer.scrollTop = chatContainer.scrollHeight;
	});
}

// ==================== Multi-Session Rendering ====================

/**
 * Render the sessions list in the workspace-hub.
 * Displays each session as a clickable row.
 */
function renderSessionsList() {
	var sessionsListEl = document.getElementById("sessions-list");
	var sessionsPanelEl = document.getElementById("sessions-panel");
	if (!sessionsListEl) return;

	if (!sessions || sessions.length === 0) {
		sessionsListEl.innerHTML = "";
		if (sessionsPanelEl) sessionsPanelEl.classList.add("hidden");
		if (welcomeSection) welcomeSection.classList.remove("hidden");
		return;
	}

	if (sessionsPanelEl) sessionsPanelEl.classList.remove("hidden");
	if (welcomeSection) welcomeSection.classList.add("hidden");

	// Sort: active sessions first (newest first), then archived
	var sorted = sessions.slice().sort(function (a, b) {
		if (a.status !== b.status) {
			return a.status === "active" ? -1 : 1;
		}
		return b.createdAt - a.createdAt;
	});

	var html = sorted
		.map(function (session) {
			var isActive = session.id === activeSessionId;
			var isWaiting = session.waitingOnUser;
			var isArchived = session.status === "archived";

			var rowClass =
				"chat-row" +
				(isActive ? " active" : "") +
				(isWaiting ? " waiting" : "") +
				(isArchived ? " archived" : "");

			// Preview snippet from latest history entry (history is newest-first via unshift)
			var promptPreview = "Tap to view thread...";
			if (session.history && session.history.length > 0) {
				promptPreview = session.history[0].prompt || promptPreview;
			}
			if (isWaiting) promptPreview = "Waiting for reply: " + promptPreview;

			var formatTime = function (ts) {
				if (!ts) return "";
				var d = new Date(ts);
				return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
			};
			var timeStr = formatTime(session.createdAt);

			return (
				'<div class="' +
				rowClass +
				'" data-session-id="' +
				escapeHtml(session.id) +
				'">' +
				'<div class="chat-row-main">' +
				'<div class="chat-row-top">' +
				'<strong class="session-title">' +
				escapeHtml(session.title) +
				"</strong>" +
				"<span>" +
				escapeHtml(timeStr) +
				"</span>" +
				"</div>" +
				'<div class="chat-row-preview">' +
				escapeHtml(promptPreview).substring(0, 100) +
				"</div>" +
				"</div>" +
				'<div class="session-thread-actions">' +
				'<button class="session-action-btn session-rename-btn" data-rename-session-id="' +
				escapeHtml(session.id) +
				'" title="Rename session" aria-label="Rename session ' +
				escapeHtml(session.title) +
				'"><span class="codicon codicon-edit"></span></button>' +
				'<button class="session-action-btn session-delete-btn" data-delete-session-id="' +
				escapeHtml(session.id) +
				'" title="Delete session" aria-label="Delete session ' +
				escapeHtml(session.title) +
				'"><span class="codicon codicon-trash"></span></button>' +
				"</div>" +
				"</div>"
			);
		})
		.join("");

	sessionsListEl.innerHTML = html;

	// Bind click handlers for session switching
	sessionsListEl.querySelectorAll(".chat-row").forEach(function (item) {
		item.addEventListener("click", function () {
			var sessionId = item.getAttribute("data-session-id");
			if (sessionId) {
				vscode.postMessage({ type: "switchSession", sessionId: sessionId });
			}
		});
	});

	sessionsListEl
		.querySelectorAll(".session-delete-btn")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				var sessionId = btn.getAttribute("data-delete-session-id");
				if (sessionId) {
					vscode.postMessage({ type: "deleteSession", sessionId: sessionId });
				}
			});
		});

	sessionsListEl
		.querySelectorAll(".session-rename-btn")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				var row = btn.closest(".chat-row");
				if (!row) return;
				var sessionId = btn.getAttribute("data-rename-session-id");
				var titleEl = row.querySelector(".session-title");
				if (!titleEl || !sessionId) return;

				var currentTitle = titleEl.textContent || "";
				var input = document.createElement("input");
				input.type = "text";
				input.className = "session-rename-input";
				input.value = currentTitle;
				input.maxLength = 50;
				titleEl.replaceWith(input);
				input.focus();
				input.select();

				var committed = false;
				function commit() {
					if (committed) return;
					committed = true;
					var newTitle = input.value.trim();
					if (newTitle && newTitle !== currentTitle) {
						vscode.postMessage({
							type: "updateSessionTitle",
							sessionId: sessionId,
							title: newTitle,
						});
					} else {
						// Revert — re-render will fix it, but restore immediately for UX
						var strong = document.createElement("strong");
						strong.className = "session-title";
						strong.textContent = currentTitle;
						input.replaceWith(strong);
					}
				}

				input.addEventListener("keydown", function (ev) {
					if (ev.key === "Enter") {
						ev.preventDefault();
						commit();
					} else if (ev.key === "Escape") {
						ev.preventDefault();
						committed = true; // prevent blur from committing
						var strong = document.createElement("strong");
						strong.className = "session-title";
						strong.textContent = currentTitle;
						input.replaceWith(strong);
					}
				});
				input.addEventListener("blur", commit);
			});
		});
}
// ==================== Queue Management ====================

function addToQueue(prompt) {
	if (!prompt || !prompt.trim()) return;
	// ID format must match VALID_QUEUE_ID_PATTERN in remoteConstants.ts
	let id =
		"q_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
	// Store attachments with the queue item
	let attachmentsToStore =
		currentAttachments.length > 0 ? currentAttachments.slice() : undefined;
	promptQueue.push({
		id: id,
		prompt: prompt.trim(),
		attachments: attachmentsToStore,
	});
	renderQueue();
	// Expand queue section when adding items so user can see what was added
	if (queueSection) queueSection.classList.remove("collapsed");
	// Send to backend with attachments
	vscode.postMessage({
		type: "addQueuePrompt",
		prompt: prompt.trim(),
		id: id,
		attachments: attachmentsToStore || [],
	});
	// Clear attachments after adding to queue (they're now stored with the queue item)
	currentAttachments = [];
	updateChipsDisplay();
}

function removeFromQueue(id) {
	promptQueue = promptQueue.filter(function (item) {
		return item.id !== id;
	});
	renderQueue();
	vscode.postMessage({ type: "removeQueuePrompt", promptId: id });
}

function renderQueue() {
	if (!queueList) return;
	if (queueCount) queueCount.textContent = promptQueue.length;

	// Update visibility based on queue state
	updateQueueVisibility();

	if (promptQueue.length === 0) {
		queueList.innerHTML = '<div class="queue-empty">No prompts in queue</div>';
		return;
	}

	queueList.innerHTML = promptQueue
		.map(function (item, index) {
			let bulletClass = index === 0 ? "active" : "pending";
			let truncatedPrompt =
				item.prompt.length > 80
					? item.prompt.substring(0, 80) + "..."
					: item.prompt;
			// Show attachment indicator if this queue item has attachments
			let attachmentBadge =
				item.attachments && item.attachments.length > 0
					? '<span class="queue-item-attachment-badge" title="' +
						item.attachments.length +
						' attachment(s)" aria-label="' +
						item.attachments.length +
						' attachments"><span class="codicon codicon-file-media" aria-hidden="true"></span></span>'
					: "";
			return (
				'<div class="queue-item" data-id="' +
				escapeHtml(item.id) +
				'" data-index="' +
				index +
				'" tabindex="0" draggable="true" role="listitem" aria-label="Queue item ' +
				(index + 1) +
				": " +
				escapeHtml(truncatedPrompt) +
				'">' +
				'<span class="bullet ' +
				bulletClass +
				'" aria-hidden="true"></span>' +
				'<span class="text" title="' +
				escapeHtml(item.prompt) +
				'">' +
				(index + 1) +
				". " +
				escapeHtml(truncatedPrompt) +
				"</span>" +
				attachmentBadge +
				'<div class="queue-item-actions">' +
				'<button class="edit-btn" data-id="' +
				escapeHtml(item.id) +
				'" title="Edit" aria-label="Edit queue item ' +
				(index + 1) +
				'"><span class="codicon codicon-edit" aria-hidden="true"></span></button>' +
				'<button class="remove-btn" data-id="' +
				escapeHtml(item.id) +
				'" title="Remove" aria-label="Remove queue item ' +
				(index + 1) +
				'"><span class="codicon codicon-close" aria-hidden="true"></span></button>' +
				"</div></div>"
			);
		})
		.join("");

	queueList.querySelectorAll(".remove-btn").forEach(function (btn) {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			let id = btn.getAttribute("data-id");
			if (id) removeFromQueue(id);
		});
	});

	queueList.querySelectorAll(".edit-btn").forEach(function (btn) {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			let id = btn.getAttribute("data-id");
			if (id) startEditPrompt(id);
		});
	});

	bindDragAndDrop();
	bindKeyboardNavigation();
}

function startEditPrompt(id) {
	// Cancel any existing edit first
	if (editingPromptId && editingPromptId !== id) {
		cancelEditMode();
	}

	let item = promptQueue.find(function (p) {
		return p.id === id;
	});
	if (!item) return;

	// Save current state
	editingPromptId = id;
	editingOriginalPrompt = item.prompt;
	savedInputValue = chatInput ? chatInput.value : "";

	// Mark queue item as being edited
	let queueItem = queueList.querySelector('.queue-item[data-id="' + id + '"]');
	if (queueItem) {
		queueItem.classList.add("editing");
	}

	// Switch to edit mode UI
	enterEditMode(item.prompt);
}

function enterEditMode(promptText) {
	// Hide normal actions, show edit actions
	if (actionsLeft) actionsLeft.classList.add("hidden");
	if (sendBtn) sendBtn.classList.add("hidden");
	if (editActionsContainer) editActionsContainer.classList.remove("hidden");

	// Mark input container as in edit mode
	if (inputContainer) {
		inputContainer.classList.add("edit-mode");
		inputContainer.setAttribute("aria-label", "Editing queue prompt");
	}

	// Set input value to the prompt being edited
	if (chatInput) {
		chatInput.value = promptText;
		chatInput.setAttribute(
			"aria-label",
			"Edit prompt text. Press Enter to confirm, Escape to cancel.",
		);
		chatInput.focus();
		// Move cursor to end
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		autoResizeTextarea();
	}
}

function exitEditMode() {
	// Show normal actions, hide edit actions
	if (actionsLeft) actionsLeft.classList.remove("hidden");
	if (sendBtn) sendBtn.classList.remove("hidden");
	if (editActionsContainer) editActionsContainer.classList.add("hidden");

	// Remove edit mode class from input container
	if (inputContainer) {
		inputContainer.classList.remove("edit-mode");
		inputContainer.removeAttribute("aria-label");
	}

	// Remove editing class from queue item
	if (queueList) {
		let editingItem = queueList.querySelector(".queue-item.editing");
		if (editingItem) editingItem.classList.remove("editing");
	}

	// Restore original input value and accessibility
	if (chatInput) {
		chatInput.value = savedInputValue;
		chatInput.setAttribute("aria-label", "Message input");
		autoResizeTextarea();
	}

	// Reset edit state
	editingPromptId = null;
	editingOriginalPrompt = null;
	savedInputValue = "";
}

function confirmEditMode() {
	if (!editingPromptId) return;

	let newValue = chatInput ? chatInput.value.trim() : "";

	if (!newValue) {
		// If empty, remove the prompt
		removeFromQueue(editingPromptId);
	} else if (newValue !== editingOriginalPrompt) {
		// Update the prompt
		let item = promptQueue.find(function (p) {
			return p.id === editingPromptId;
		});
		if (item) {
			item.prompt = newValue;
			vscode.postMessage({
				type: "editQueuePrompt",
				promptId: editingPromptId,
				newPrompt: newValue,
			});
		}
	}

	// Clear saved input - we don't want to restore old value after editing
	savedInputValue = "";

	exitEditMode();
	renderQueue();
}

function cancelEditMode() {
	exitEditMode();
	renderQueue();
}

/**
 * Handle "accept" button click in approval modal
 * Sends "yes" as the response
 */
function handleApprovalContinue() {
	if (!pendingToolCall) return;

	// Hide approval modal
	hideApprovalModal();

	// Send affirmative response
	vscode.postMessage({
		type: "submit",
		sessionId: activeSessionId,
		toolCallId: pendingToolCall ? pendingToolCall.id : null,
		value: "yes",
		attachments: [],
	});
	// In remote mode, show "Processing your response" optimistically while awaiting server round-trip
	if (isRemoteMode) {
		pendingToolCall = null;
		isProcessingResponse = true;
		updatePendingUI();
	}
	if (chatInput) {
		chatInput.value = "";
		chatInput.style.height = "auto";
		updateInputHighlighter();
	}
	currentAttachments = [];
	updateChipsDisplay();
	updateSendButtonState();
	saveWebviewState();
}

/**
 * Handle "No" button click in approval modal
 * Dismisses modal and focuses input for custom response
 */
function handleApprovalNo() {
	// Hide approval modal but keep pending state
	hideApprovalModal();

	// Focus input for custom response
	if (chatInput) {
		chatInput.focus();
		// Optionally pre-fill with "No, " to help user
		if (!chatInput.value.trim()) {
			chatInput.value = "No, ";
			chatInput.setSelectionRange(
				chatInput.value.length,
				chatInput.value.length,
			);
		}
		autoResizeTextarea();
		updateInputHighlighter();
		updateSendButtonState();
		saveWebviewState();
	}
}
// ==================== Approval Modal ====================

/**
 * Show approval modal
 */
function showApprovalModal() {
	if (!approvalModal) return;
	approvalModal.classList.remove("hidden");
	// Focus chat input instead of Yes button to prevent accidental Enter approvals
	// User can still click Yes/No or use keyboard navigation
	if (chatInput) {
		chatInput.focus();
	}
}

/**
 * Hide approval modal
 */
function hideApprovalModal() {
	if (!approvalModal) return;
	approvalModal.classList.add("hidden");
	isApprovalQuestion = false;
}

/**
 * Show choices bar with toggleable multi-select buttons
 */
function showChoicesBar() {
	// Hide approval modal first
	hideApprovalModal();

	// Create or get choices bar
	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) {
		choicesBar = document.createElement("div");
		choicesBar.className = "choices-bar";
		choicesBar.id = "choices-bar";
		choicesBar.setAttribute("role", "toolbar");
		choicesBar.setAttribute("aria-label", "Quick choice options");

		// Insert at top of input-wrapper
		let inputWrapper = document.getElementById("input-wrapper");
		if (inputWrapper) {
			inputWrapper.insertBefore(choicesBar, inputWrapper.firstChild);
		}
	}

	// Build toggleable choice buttons
	let buttonsHtml = currentChoices
		.map(function (choice) {
			let shortLabel = choice.shortLabel || choice.value;
			let title = choice.label || choice.value;
			return (
				'<button class="choice-btn" data-value="' +
				escapeHtml(choice.value) +
				'" ' +
				'title="' +
				escapeHtml(title) +
				'" ' +
				'aria-pressed="false">' +
				escapeHtml(shortLabel) +
				"</button>"
			);
		})
		.join("");

	choicesBar.innerHTML =
		'<span class="choices-label">Choose:</span>' +
		'<div class="choices-buttons">' +
		buttonsHtml +
		"</div>" +
		'<div class="choices-actions">' +
		'<button class="choices-action-btn choices-all-btn" title="Select all" aria-label="Select all">All</button>' +
		'<button class="choices-action-btn choices-send-btn" title="Send selected" aria-label="Send selected choices" disabled>Send</button>' +
		"</div>";

	// Bind click events to choice buttons (toggle selection)
	choicesBar.querySelectorAll(".choice-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			handleChoiceToggle(btn);
		});
	});

	// Bind 'All' button
	let allBtn = choicesBar.querySelector(".choices-all-btn");
	if (allBtn) {
		allBtn.addEventListener("click", handleChoicesSelectAll);
	}

	// Bind 'Send' button
	let choicesSendBtn = choicesBar.querySelector(".choices-send-btn");
	if (choicesSendBtn) {
		choicesSendBtn.addEventListener("click", handleChoicesSend);
	}

	choicesBar.classList.remove("hidden");

	// Focus chat input for immediate typing
	if (chatInput) {
		chatInput.focus();
	}
}

/**
 * Hide choices bar
 */
function hideChoicesBar() {
	let choicesBar = document.getElementById("choices-bar");
	if (choicesBar) {
		choicesBar.classList.add("hidden");
	}
	currentChoices = [];
}

/**
 * Toggle a choice button's selected state
 */
function handleChoiceToggle(btn) {
	if (!pendingToolCall) return;

	let isSelected = btn.classList.toggle("selected");
	btn.setAttribute("aria-pressed", isSelected ? "true" : "false");

	updateChoicesSendButton();
}

/**
 * Toggle all choices selected/deselected
 */
function handleChoicesSelectAll() {
	if (!pendingToolCall) return;

	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let buttons = choicesBar.querySelectorAll(".choice-btn");
	let allSelected = Array.from(buttons).every(function (btn) {
		return btn.classList.contains("selected");
	});

	buttons.forEach(function (btn) {
		if (allSelected) {
			btn.classList.remove("selected");
			btn.setAttribute("aria-pressed", "false");
		} else {
			btn.classList.add("selected");
			btn.setAttribute("aria-pressed", "true");
		}
	});

	updateChoicesSendButton();
}

/**
 * Send all selected choices as a comma-separated response
 */
function handleChoicesSend() {
	if (!pendingToolCall) return;

	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let selectedButtons = choicesBar.querySelectorAll(".choice-btn.selected");
	if (selectedButtons.length === 0) return;

	let values = Array.from(selectedButtons).map(function (btn) {
		return btn.getAttribute("data-value");
	});
	let responseValue = values.join(", ");

	// Hide choices bar
	hideChoicesBar();

	// Send the response
	vscode.postMessage({
		type: "submit",
		sessionId: activeSessionId,
		toolCallId: pendingToolCall ? pendingToolCall.id : null,
		value: responseValue,
		attachments: [],
	});
	// In remote mode, show "Processing your response" optimistically while awaiting server round-trip
	if (isRemoteMode) {
		pendingToolCall = null;
		isProcessingResponse = true;
		updatePendingUI();
	}
	if (chatInput) {
		chatInput.value = "";
		chatInput.style.height = "auto";
		updateInputHighlighter();
	}
	currentAttachments = [];
	updateChipsDisplay();
	updateSendButtonState();
	saveWebviewState();
}

/**
 * Update the Send button state and All button label based on current selections
 */
function updateChoicesSendButton() {
	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let selectedCount = choicesBar.querySelectorAll(
		".choice-btn.selected",
	).length;
	let totalCount = choicesBar.querySelectorAll(".choice-btn").length;
	let choicesSendBtn = choicesBar.querySelector(".choices-send-btn");
	let allBtn = choicesBar.querySelector(".choices-all-btn");

	if (choicesSendBtn) {
		choicesSendBtn.disabled = selectedCount === 0;
		choicesSendBtn.textContent =
			selectedCount > 0 ? "Send (" + selectedCount + ")" : "Send";
	}

	if (allBtn) {
		let isAllSelected = totalCount > 0 && selectedCount === totalCount;
		allBtn.textContent = isAllSelected ? "None" : "All";
		let allBtnActionLabel = isAllSelected ? "Deselect all" : "Select all";
		allBtn.title = allBtnActionLabel;
		allBtn.setAttribute("aria-label", allBtnActionLabel);
	}
}
// Shared autopilot prompt-list UI factory.
// Both workspace settings and session settings reuse this to avoid CRUD duplication.

/**
 * Create a prompt-list UI controller bound to the given DOM elements and data hooks.
 *
 * @param {Object} opts
 * @param {function(): string[]} opts.getPrompts      - Return the current prompts array.
 * @param {function(string[]): void} opts.setPrompts   - Replace the prompts array.
 * @param {HTMLElement|null} opts.listEl               - The UL/container for prompt items.
 * @param {HTMLElement|null} opts.formEl               - The add/edit form wrapper.
 * @param {HTMLInputElement|null} opts.inputEl         - The prompt text input.
 * @param {string} opts.emptyHint                      - HTML shown when the list is empty.
 * @param {function(): void} [opts.onListChange]       - Called after any mutation (render already done).
 */
function createPromptListUI(opts) {
	var getPrompts = opts.getPrompts;
	var setPrompts = opts.setPrompts;
	var listEl = opts.listEl;
	var formEl = opts.formEl;
	var inputEl = opts.inputEl;
	var emptyHint = opts.emptyHint;
	var onListChange = opts.onListChange || function () {};

	var editingIndex = -1;
	var draggedIndex = -1;

	function render() {
		if (!listEl) return;
		var prompts = getPrompts();

		if (prompts.length === 0) {
			listEl.innerHTML =
				'<div class="empty-prompts-hint">' + emptyHint + "</div>";
			return;
		}

		listEl.innerHTML = prompts
			.map(function (prompt, index) {
				var truncated =
					prompt.length > 80 ? prompt.substring(0, 80) + "..." : prompt;
				var tooltipText =
					prompt.length > 300 ? prompt.substring(0, 300) + "..." : prompt;
				tooltipText = escapeHtml(tooltipText);
				return (
					'<div class="autopilot-prompt-item" draggable="true" data-index="' +
					index +
					'" title="' +
					tooltipText +
					'">' +
					'<span class="autopilot-prompt-drag-handle codicon codicon-grabber"></span>' +
					'<span class="autopilot-prompt-number">' +
					(index + 1) +
					".</span>" +
					'<span class="autopilot-prompt-text">' +
					escapeHtml(truncated) +
					"</span>" +
					'<div class="autopilot-prompt-actions">' +
					'<button class="prompt-item-btn edit" data-index="' +
					index +
					'" title="Edit"><span class="codicon codicon-edit"></span></button>' +
					'<button class="prompt-item-btn delete" data-index="' +
					index +
					'" title="Delete"><span class="codicon codicon-trash"></span></button>' +
					"</div></div>"
				);
			})
			.join("");
	}

	function showAddForm() {
		if (!formEl || !inputEl) return;
		editingIndex = -1;
		inputEl.value = "";
		formEl.classList.remove("hidden");
		formEl.removeAttribute("data-editing-index");
		inputEl.focus();
	}

	function hideAddForm() {
		if (!formEl || !inputEl) return;
		formEl.classList.add("hidden");
		inputEl.value = "";
		editingIndex = -1;
		formEl.removeAttribute("data-editing-index");
	}

	function save() {
		if (!inputEl) return;
		var prompt = inputEl.value.trim();
		if (!prompt) return;

		var prompts = getPrompts().slice();
		var editAttr = formEl ? formEl.getAttribute("data-editing-index") : null;
		if (editAttr !== null) {
			var idx = parseInt(editAttr, 10);
			if (idx >= 0 && idx < prompts.length) {
				prompts[idx] = prompt;
			}
		} else {
			prompts.push(prompt);
		}
		setPrompts(prompts);
		hideAddForm();
		render();
		onListChange();
	}

	function handleListClick(e) {
		var target = e.target.closest(".prompt-item-btn");
		if (!target) return;

		var index = parseInt(target.getAttribute("data-index"), 10);
		if (isNaN(index)) return;

		if (target.classList.contains("edit")) {
			editPrompt(index);
		} else if (target.classList.contains("delete")) {
			deletePrompt(index);
		}
	}

	function editPrompt(index) {
		var prompts = getPrompts();
		if (index < 0 || index >= prompts.length) return;
		if (!formEl || !inputEl) return;

		editingIndex = index;
		inputEl.value = prompts[index];
		formEl.setAttribute("data-editing-index", index);
		formEl.classList.remove("hidden");
		inputEl.focus();
	}

	function deletePrompt(index) {
		var prompts = getPrompts().slice();
		if (index < 0 || index >= prompts.length) return;
		prompts.splice(index, 1);
		setPrompts(prompts);
		render();
		onListChange();
	}

	function handleDragStart(e) {
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item) return;
		draggedIndex = parseInt(item.getAttribute("data-index"), 10);
		item.classList.add("dragging");
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", draggedIndex);
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item || !listEl) return;

		listEl.querySelectorAll(".autopilot-prompt-item").forEach(function (el) {
			el.classList.remove("drag-over-top", "drag-over-bottom");
		});

		var rect = item.getBoundingClientRect();
		var midY = rect.top + rect.height / 2;
		if (e.clientY < midY) {
			item.classList.add("drag-over-top");
		} else {
			item.classList.add("drag-over-bottom");
		}
	}

	function handleDragEnd() {
		draggedIndex = -1;
		if (!listEl) return;
		listEl.querySelectorAll(".autopilot-prompt-item").forEach(function (el) {
			el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
		});
	}

	function handleDrop(e) {
		e.preventDefault();
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item || draggedIndex < 0) return;

		var toIndex = parseInt(item.getAttribute("data-index"), 10);
		if (isNaN(toIndex) || draggedIndex === toIndex) {
			handleDragEnd();
			return;
		}

		var prompts = getPrompts().slice();
		var rect = item.getBoundingClientRect();
		var midY = rect.top + rect.height / 2;
		var insertBelow = e.clientY >= midY;

		var targetIndex = toIndex;
		if (insertBelow && toIndex < prompts.length - 1) {
			targetIndex = toIndex + 1;
		}
		if (draggedIndex < targetIndex) {
			targetIndex--;
		}
		targetIndex = Math.max(0, Math.min(targetIndex, prompts.length - 1));

		if (draggedIndex !== targetIndex) {
			var moved = prompts.splice(draggedIndex, 1)[0];
			prompts.splice(targetIndex, 0, moved);
			setPrompts(prompts);
			render();
			onListChange();
		}
		handleDragEnd();
	}

	// Bind drag events to the list element
	function bindEvents() {
		if (!listEl) return;
		listEl.addEventListener("click", handleListClick);
		listEl.addEventListener("dragstart", handleDragStart);
		listEl.addEventListener("dragover", handleDragOver);
		listEl.addEventListener("dragend", handleDragEnd);
		listEl.addEventListener("drop", handleDrop);
	}

	return {
		render: render,
		showAddForm: showAddForm,
		hideAddForm: hideAddForm,
		save: save,
		handleListClick: handleListClick,
		handleDragStart: handleDragStart,
		handleDragOver: handleDragOver,
		handleDragEnd: handleDragEnd,
		handleDrop: handleDrop,
		bindEvents: bindEvents,
	};
}
// ===== SETTINGS MODAL FUNCTIONS =====

function openSettingsModal() {
	if (!settingsModalOverlay) return;
	vscode.postMessage({ type: "openSettingsModal" });
	settingsModalOverlay.classList.remove("hidden");
}

function closeSettingsModal() {
	if (!settingsModalOverlay) return;
	settingsModalOverlay.classList.add("hidden");
	hideAddPromptForm();
}

function toggleSoundSetting() {
	soundEnabled = !soundEnabled;
	updateSoundToggleUI();
	vscode.postMessage({ type: "updateSoundSetting", enabled: soundEnabled });
}

function updateSoundToggleUI() {
	if (!soundToggle) return;
	soundToggle.classList.toggle("active", soundEnabled);
	soundToggle.setAttribute("aria-checked", soundEnabled ? "true" : "false");
}

function toggleInteractiveApprovalSetting() {
	interactiveApprovalEnabled = !interactiveApprovalEnabled;
	updateInteractiveApprovalToggleUI();
	vscode.postMessage({
		type: "updateInteractiveApprovalSetting",
		enabled: interactiveApprovalEnabled,
	});
}

function updateInteractiveApprovalToggleUI() {
	if (!interactiveApprovalToggle) return;
	interactiveApprovalToggle.classList.toggle(
		"active",
		interactiveApprovalEnabled,
	);
	interactiveApprovalToggle.setAttribute(
		"aria-checked",
		interactiveApprovalEnabled ? "true" : "false",
	);
}

function toggleAutoAppendSetting() {
	autoAppendEnabled = !autoAppendEnabled;
	updateAutoAppendToggleUI();
	vscode.postMessage({
		type: "updateAutoAppendSetting",
		enabled: autoAppendEnabled,
	});
}

function updateAutoAppendToggleUI() {
	if (!autoAppendToggle) return;
	autoAppendToggle.classList.toggle("active", autoAppendEnabled);
	autoAppendToggle.setAttribute(
		"aria-checked",
		autoAppendEnabled ? "true" : "false",
	);
	updateAutoAppendTextVisibility();
}

function updateAutoAppendTextVisibility() {
	if (!autoAppendTextRow) return;
	autoAppendTextRow.classList.toggle("hidden", !autoAppendEnabled);
	autoAppendTextRow.setAttribute(
		"aria-hidden",
		autoAppendEnabled ? "false" : "true",
	);
}

function handleAutoAppendTextChange() {
	if (!autoAppendTextInput) return;
	autoAppendText = autoAppendTextInput.value;
	vscode.postMessage({
		type: "updateAutoAppendText",
		text: autoAppendText,
	});
}

function updateAutoAppendTextUI() {
	if (!autoAppendTextInput) return;
	autoAppendTextInput.value = autoAppendText;
}

function toggleAlwaysAppendReminderSetting() {
	alwaysAppendReminder = !alwaysAppendReminder;
	updateAlwaysAppendReminderToggleUI();
	vscode.postMessage({
		type: "updateAlwaysAppendReminderSetting",
		enabled: alwaysAppendReminder,
	});
}

function updateAlwaysAppendReminderToggleUI() {
	if (!alwaysAppendReminderToggle) return;
	alwaysAppendReminderToggle.classList.toggle("active", alwaysAppendReminder);
	alwaysAppendReminderToggle.setAttribute(
		"aria-checked",
		alwaysAppendReminder ? "true" : "false",
	);
}

function toggleSendWithCtrlEnterSetting() {
	sendWithCtrlEnter = !sendWithCtrlEnter;
	updateSendWithCtrlEnterToggleUI();
	vscode.postMessage({
		type: "updateSendWithCtrlEnterSetting",
		enabled: sendWithCtrlEnter,
	});
}

function updateSendWithCtrlEnterToggleUI() {
	if (!sendShortcutToggle) return;
	sendShortcutToggle.classList.toggle("active", sendWithCtrlEnter);
	sendShortcutToggle.setAttribute(
		"aria-checked",
		sendWithCtrlEnter ? "true" : "false",
	);
}

function toggleAutopilotSetting() {
	autopilotEnabled = !autopilotEnabled;
	updateAutopilotToggleUI();
	vscode.postMessage({
		type: "updateAutopilotSetting",
		enabled: autopilotEnabled,
	});
}

function updateAutopilotToggleUI() {
	if (autopilotToggle) {
		autopilotToggle.classList.toggle("active", autopilotEnabled);
		autopilotToggle.setAttribute(
			"aria-checked",
			autopilotEnabled ? "true" : "false",
		);
	}
}

function handleResponseTimeoutChange() {
	if (!responseTimeoutSelect) return;
	let value = parseInt(responseTimeoutSelect.value, 10);
	if (isNaN(value)) return;

	// Show warning modal for risky values: disabled (0) or extended (>4 hours)
	if (value === 0 || value > RESPONSE_TIMEOUT_RISK_THRESHOLD) {
		showTimeoutWarning(value);
		return;
	}

	responseTimeout = value;
	vscode.postMessage({ type: "updateResponseTimeout", value: value });
}

function updateResponseTimeoutUI() {
	if (!responseTimeoutSelect) return;
	responseTimeoutSelect.value = String(responseTimeout);
}

function handleSessionWarningHoursChange() {
	if (!sessionWarningHoursSelect) return;

	let value = parseInt(sessionWarningHoursSelect.value, 10);
	if (!isNaN(value) && value >= 0 && value <= SESSION_WARNING_HOURS_MAX) {
		sessionWarningHours = value;
		vscode.postMessage({ type: "updateSessionWarningHours", value: value });
	}

	sessionWarningHoursSelect.value = String(sessionWarningHours);
}

function updateSessionWarningHoursUI() {
	if (!sessionWarningHoursSelect) return;
	sessionWarningHoursSelect.value = String(sessionWarningHours);
}

function handleMaxAutoResponsesChange() {
	if (!maxAutoResponsesInput) return;
	let value = parseInt(maxAutoResponsesInput.value, 10);
	if (!isNaN(value) && value >= 1 && value <= MAX_AUTO_RESPONSES_LIMIT) {
		maxConsecutiveAutoResponses = value;
		vscode.postMessage({
			type: "updateMaxConsecutiveAutoResponses",
			value: value,
		});
	} else {
		// Reset to valid value
		maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
	}
}

function updateMaxAutoResponsesUI() {
	if (!maxAutoResponsesInput) return;
	maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
}

function handleRemoteMaxDevicesChange() {
	if (!remoteMaxDevicesInput) return;
	let value = parseInt(remoteMaxDevicesInput.value, 10);
	if (!isNaN(value) && value >= MIN_REMOTE_MAX_DEVICES) {
		remoteMaxDevices = Math.max(MIN_REMOTE_MAX_DEVICES, Math.floor(value));
		vscode.postMessage({
			type: "updateRemoteMaxDevices",
			value: remoteMaxDevices,
		});
	}
	remoteMaxDevicesInput.value = String(remoteMaxDevices);
}

function updateRemoteMaxDevicesUI() {
	if (!remoteMaxDevicesInput) return;
	remoteMaxDevicesInput.value = String(remoteMaxDevices);
}

/**
 * Toggle human-like delay. When enabled, a random delay (jitter)
 * between min and max seconds is applied before each auto-response,
 * simulating natural human reading and typing time.
 */
function toggleHumanDelaySetting() {
	humanLikeDelayEnabled = !humanLikeDelayEnabled;
	vscode.postMessage({
		type: "updateHumanDelaySetting",
		enabled: humanLikeDelayEnabled,
	});
	updateHumanDelayUI();
}

/**
 * Update minimum delay (seconds). Clamps to valid range [1, max].
 * Sends new value to extension for persistence in VS Code settings.
 */
function handleHumanDelayMinChange() {
	if (!humanDelayMinInput) return;
	let value = parseInt(humanDelayMinInput.value, 10);
	if (
		!isNaN(value) &&
		value >= HUMAN_DELAY_MIN_LOWER &&
		value <= HUMAN_DELAY_MIN_UPPER
	) {
		// Ensure min <= max
		if (value > humanLikeDelayMax) {
			value = humanLikeDelayMax;
		}
		humanLikeDelayMin = value;
		vscode.postMessage({ type: "updateHumanDelayMin", value: value });
	}
	humanDelayMinInput.value = humanLikeDelayMin;
}

/**
 * Update maximum delay (seconds). Clamps to valid range [min, 60].
 * Sends new value to extension for persistence in VS Code settings.
 */
function handleHumanDelayMaxChange() {
	if (!humanDelayMaxInput) return;
	let value = parseInt(humanDelayMaxInput.value, 10);
	if (
		!isNaN(value) &&
		value >= HUMAN_DELAY_MAX_LOWER &&
		value <= HUMAN_DELAY_MAX_UPPER
	) {
		// Ensure max >= min
		if (value < humanLikeDelayMin) {
			value = humanLikeDelayMin;
		}
		humanLikeDelayMax = value;
		vscode.postMessage({ type: "updateHumanDelayMax", value: value });
	}
	humanDelayMaxInput.value = humanLikeDelayMax;
}

function updateHumanDelayUI() {
	if (humanDelayToggle) {
		humanDelayToggle.classList.toggle("active", humanLikeDelayEnabled);
		humanDelayToggle.setAttribute(
			"aria-checked",
			humanLikeDelayEnabled ? "true" : "false",
		);
	}
	if (humanDelayRangeContainer) {
		humanDelayRangeContainer.style.display = humanLikeDelayEnabled
			? "flex"
			: "none";
	}
	if (humanDelayMinInput) {
		humanDelayMinInput.value = humanLikeDelayMin;
	}
	if (humanDelayMaxInput) {
		humanDelayMaxInput.value = humanLikeDelayMax;
	}
}

function showAddPromptForm() {
	if (!addPromptForm || !addPromptBtn) return;
	addPromptForm.classList.remove("hidden");
	addPromptBtn.classList.add("hidden");
	let nameInput = document.getElementById("prompt-name-input");
	let textInput = document.getElementById("prompt-text-input");
	if (nameInput) {
		nameInput.value = "";
		nameInput.focus();
	}
	if (textInput) textInput.value = "";
	// Clear edit mode
	addPromptForm.removeAttribute("data-editing-id");
}

function hideAddPromptForm() {
	if (!addPromptForm || !addPromptBtn) return;
	addPromptForm.classList.add("hidden");
	addPromptBtn.classList.remove("hidden");
	addPromptForm.removeAttribute("data-editing-id");
}

function saveNewPrompt() {
	let nameInput = document.getElementById("prompt-name-input");
	let textInput = document.getElementById("prompt-text-input");
	if (!nameInput || !textInput) return;

	let name = nameInput.value.trim();
	let prompt = textInput.value.trim();

	if (!name || !prompt) {
		return;
	}

	let editingId = addPromptForm.getAttribute("data-editing-id");
	if (editingId) {
		// Editing existing prompt
		vscode.postMessage({
			type: "editReusablePrompt",
			id: editingId,
			name: name,
			prompt: prompt,
		});
	} else {
		// Adding new prompt
		vscode.postMessage({
			type: "addReusablePrompt",
			name: name,
			prompt: prompt,
		});
	}

	hideAddPromptForm();
}

// ========== Autopilot Prompts Array Functions ==========

// Shared prompt-list UI (delegates rendering/CRUD to promptListUI.js factory)
var workspacePromptListUI = createPromptListUI({
	getPrompts: function () {
		return autopilotPrompts;
	},
	setPrompts: function (arr) {
		autopilotPrompts = arr;
	},
	listEl: null, // bound lazily after DOM ready
	formEl: null,
	inputEl: null,
	emptyHint: "No prompts added. Add prompts to cycle through during Autopilot.",
	onListChange: function () {
		vscode.postMessage({
			type: "saveAutopilotPrompts",
			prompts: autopilotPrompts,
		});
	},
});

/** Bind the shared UI to DOM elements (called after DOM is ready). */
function initWorkspacePromptListUI() {
	workspacePromptListUI = createPromptListUI({
		getPrompts: function () {
			return autopilotPrompts;
		},
		setPrompts: function (arr) {
			autopilotPrompts = arr;
		},
		listEl: autopilotPromptsList,
		formEl: addAutopilotPromptForm,
		inputEl: autopilotPromptInput,
		emptyHint:
			"No prompts added. Add prompts to cycle through during Autopilot.",
		onListChange: function () {
			vscode.postMessage({
				type: "saveAutopilotPrompts",
				prompts: autopilotPrompts,
			});
		},
	});
	workspacePromptListUI.bindEvents();
}

// Delegate existing function names to the shared UI for backward compatibility
function renderAutopilotPromptsList() {
	workspacePromptListUI.render();
}
function showAddAutopilotPromptForm() {
	workspacePromptListUI.showAddForm();
}
function hideAddAutopilotPromptForm() {
	workspacePromptListUI.hideAddForm();
}
function saveAutopilotPrompt() {
	workspacePromptListUI.save();
}
function handleAutopilotPromptsListClick(e) {
	workspacePromptListUI.handleListClick(e);
}
function handleAutopilotDragStart(e) {
	workspacePromptListUI.handleDragStart(e);
}
function handleAutopilotDragOver(e) {
	workspacePromptListUI.handleDragOver(e);
}
function handleAutopilotDragEnd(e) {
	workspacePromptListUI.handleDragEnd(e);
}
function handleAutopilotDrop(e) {
	workspacePromptListUI.handleDrop(e);
}

// ========== End Autopilot Prompts Functions ==========

function renderPromptsList() {
	if (!promptsList) return;

	if (reusablePrompts.length === 0) {
		promptsList.innerHTML = "";
		return;
	}

	// Compact list - show only name, full prompt on hover via title
	promptsList.innerHTML = reusablePrompts
		.map(function (p) {
			// Truncate very long prompts for tooltip to prevent massive tooltips
			let tooltipText =
				p.prompt.length > 300 ? p.prompt.substring(0, 300) + "..." : p.prompt;
			// Escape for HTML attribute
			tooltipText = escapeHtml(tooltipText);
			return (
				'<div class="prompt-item compact" data-id="' +
				escapeHtml(p.id) +
				'" title="' +
				tooltipText +
				'">' +
				'<div class="prompt-item-content">' +
				'<span class="prompt-item-name">/' +
				escapeHtml(p.name) +
				"</span>" +
				"</div>" +
				'<div class="prompt-item-actions">' +
				'<button class="prompt-item-btn edit" data-id="' +
				escapeHtml(p.id) +
				'" title="Edit"><span class="codicon codicon-edit"></span></button>' +
				'<button class="prompt-item-btn delete" data-id="' +
				escapeHtml(p.id) +
				'" title="Delete"><span class="codicon codicon-trash"></span></button>' +
				"</div></div>"
			);
		})
		.join("");

	// Bind edit/delete events
	promptsList.querySelectorAll(".prompt-item-btn.edit").forEach(function (btn) {
		btn.addEventListener("click", function () {
			let id = btn.getAttribute("data-id");
			editPrompt(id);
		});
	});

	promptsList
		.querySelectorAll(".prompt-item-btn.delete")
		.forEach(function (btn) {
			btn.addEventListener("click", function () {
				let id = btn.getAttribute("data-id");
				deletePrompt(id);
			});
		});
}

function editPrompt(id) {
	let prompt = reusablePrompts.find(function (p) {
		return p.id === id;
	});
	if (!prompt) return;

	let nameInput = document.getElementById("prompt-name-input");
	let textInput = document.getElementById("prompt-text-input");
	if (!nameInput || !textInput) return;

	// Show form with existing values
	addPromptForm.classList.remove("hidden");
	addPromptBtn.classList.add("hidden");
	addPromptForm.setAttribute("data-editing-id", id);

	nameInput.value = prompt.name;
	textInput.value = prompt.prompt;
	nameInput.focus();
}

function deletePrompt(id) {
	vscode.postMessage({ type: "removeReusablePrompt", id: id });
}
// ===== SESSION SETTINGS MINI-MODAL FUNCTIONS =====

// Local state for session-level autopilot prompts (managed entirely in the modal)
var ssAutopilotPromptsLocal = [];

// Shared prompt-list UI for session settings (delegates rendering/CRUD to promptListUI.js)
var sessionPromptListUI = createPromptListUI({
	getPrompts: function () {
		return ssAutopilotPromptsLocal;
	},
	setPrompts: function (arr) {
		ssAutopilotPromptsLocal = arr;
	},
	listEl: null,
	formEl: null,
	inputEl: null,
	emptyHint: "No session prompts. Inherits workspace prompts.",
});

/** Bind the shared UI to DOM elements (called after DOM is ready). */
function initSessionPromptListUI() {
	sessionPromptListUI = createPromptListUI({
		getPrompts: function () {
			return ssAutopilotPromptsLocal;
		},
		setPrompts: function (arr) {
			ssAutopilotPromptsLocal = arr;
		},
		listEl: ssAutopilotPromptsList,
		formEl: ssAddAutopilotPromptForm,
		inputEl: ssAutopilotPromptInput,
		emptyHint: "No session prompts. Inherits workspace prompts.",
	});
	sessionPromptListUI.bindEvents();
}

// Delegate to shared UI
function ssRenderPromptsList() {
	sessionPromptListUI.render();
}
function ssShowAddPromptForm() {
	sessionPromptListUI.showAddForm();
}
function ssHideAddPromptForm() {
	sessionPromptListUI.hideAddForm();
}
function ssSavePrompt() {
	sessionPromptListUI.save();
}
function ssHandlePromptsListClick(e) {
	sessionPromptListUI.handleListClick(e);
}
function ssHandleDragStart(e) {
	sessionPromptListUI.handleDragStart(e);
}
function ssHandleDragOver(e) {
	sessionPromptListUI.handleDragOver(e);
}
function ssHandleDragEnd() {
	sessionPromptListUI.handleDragEnd();
}
function ssHandleDrop(e) {
	sessionPromptListUI.handleDrop(e);
}

function openSessionSettingsModal() {
	if (!sessionSettingsOverlay) return;
	vscode.postMessage({ type: "requestSessionSettings" });
	sessionSettingsOverlay.classList.remove("hidden");
}

function closeSessionSettingsModal() {
	if (!sessionSettingsOverlay) return;
	// Auto-save on close
	saveSessionSettings();
	sessionSettingsOverlay.classList.add("hidden");
	ssHideAddPromptForm();
}

function saveSessionSettings() {
	var isAutopilotEnabled = ssAutopilotToggle
		? ssAutopilotToggle.classList.contains("active")
		: false;
	var isAutoAppendEnabled = ssAutoAppendToggle
		? ssAutoAppendToggle.classList.contains("active")
		: false;
	var autoAppendText = ssAutoAppendTextInput ? ssAutoAppendTextInput.value : "";
	var isReminderEnabled = ssAlwaysAppendReminderToggle
		? ssAlwaysAppendReminderToggle.classList.contains("active")
		: false;

	vscode.postMessage({
		type: "updateSessionSettings",
		autopilotEnabled: isAutopilotEnabled,
		autopilotPrompts: ssAutopilotPromptsLocal.filter(function (p) {
			return p.trim().length > 0;
		}),
		autoAppendEnabled: isAutoAppendEnabled,
		autoAppendText: autoAppendText,
		alwaysAppendReminder: isReminderEnabled,
	});
}

function resetSessionSettings() {
	vscode.postMessage({ type: "resetSessionSettings" });
	// The backend will send back a sessionSettingsState with workspace defaults
}

function populateSessionSettings(msg) {
	sessionSettingsHasOverrides = msg.isDefault === false;
	updateSessionSettingsGearIndicator();

	// Autopilot toggle
	if (ssAutopilotToggle) {
		ssAutopilotToggle.classList.toggle("active", msg.autopilotEnabled === true);
		ssAutopilotToggle.setAttribute(
			"aria-checked",
			msg.autopilotEnabled ? "true" : "false",
		);
	}

	// Autopilot prompts
	ssAutopilotPromptsLocal = Array.isArray(msg.autopilotPrompts)
		? msg.autopilotPrompts.slice()
		: [];
	ssRenderPromptsList();

	// Auto Append toggle
	if (ssAutoAppendToggle) {
		ssAutoAppendToggle.classList.toggle(
			"active",
			msg.autoAppendEnabled === true,
		);
		ssAutoAppendToggle.setAttribute(
			"aria-checked",
			msg.autoAppendEnabled ? "true" : "false",
		);
	}

	// Auto Append text row visibility
	var ssAutoAppendTextRow = document.getElementById("ss-auto-append-text-row");
	if (ssAutoAppendTextRow) {
		ssAutoAppendTextRow.classList.toggle(
			"hidden",
			msg.autoAppendEnabled !== true,
		);
	}

	// Auto Append text
	if (ssAutoAppendTextInput) {
		ssAutoAppendTextInput.value =
			typeof msg.autoAppendText === "string" ? msg.autoAppendText : "";
	}

	// Always Append Reminder toggle
	if (ssAlwaysAppendReminderToggle) {
		ssAlwaysAppendReminderToggle.classList.toggle(
			"active",
			msg.alwaysAppendReminder === true,
		);
		ssAlwaysAppendReminderToggle.setAttribute(
			"aria-checked",
			msg.alwaysAppendReminder ? "true" : "false",
		);
	}
}

function updateSessionSettingsGearIndicator() {
	if (!threadSettingsBtn) return;
	threadSettingsBtn.classList.toggle(
		"has-overrides",
		sessionSettingsHasOverrides,
	);
}

// --- Session toggle functions ---

function ssToggleAutopilot() {
	if (!ssAutopilotToggle) return;
	var active = !ssAutopilotToggle.classList.contains("active");
	ssAutopilotToggle.classList.toggle("active", active);
	ssAutopilotToggle.setAttribute("aria-checked", active ? "true" : "false");
}

function ssToggleAutoAppend() {
	if (!ssAutoAppendToggle) return;
	var active = !ssAutoAppendToggle.classList.contains("active");
	ssAutoAppendToggle.classList.toggle("active", active);
	ssAutoAppendToggle.setAttribute("aria-checked", active ? "true" : "false");

	var ssAutoAppendTextRow = document.getElementById("ss-auto-append-text-row");
	if (ssAutoAppendTextRow) {
		ssAutoAppendTextRow.classList.toggle("hidden", !active);
	}
}

function ssToggleAlwaysAppendReminder() {
	if (!ssAlwaysAppendReminderToggle) return;
	var active = !ssAlwaysAppendReminderToggle.classList.contains("active");
	ssAlwaysAppendReminderToggle.classList.toggle("active", active);
	ssAlwaysAppendReminderToggle.setAttribute(
		"aria-checked",
		active ? "true" : "false",
	);
}
// ===== SLASH COMMAND FUNCTIONS =====

/**
 * Expand /commandName patterns to their full prompt text
 * Only expands known commands at the start of lines or after whitespace
 */
function expandSlashCommands(text) {
	if (!text || reusablePrompts.length === 0) return text;

	// Use stored mappings from selectSlashItem if available
	let mappings =
		chatInput && chatInput._slashPrompts ? chatInput._slashPrompts : {};

	// Build a regex to match all known prompt names
	let promptNames = reusablePrompts.map(function (p) {
		return p.name;
	});
	if (Object.keys(mappings).length > 0) {
		Object.keys(mappings).forEach(function (name) {
			if (promptNames.indexOf(name) === -1) promptNames.push(name);
		});
	}

	// Match /promptName at start or after whitespace
	let expanded = text;
	promptNames.forEach(function (name) {
		// Escape special regex chars in name
		let escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		let regex = new RegExp("(^|\\s)/" + escapedName + "(?=\\s|$)", "g");
		let fullPrompt =
			mappings[name] ||
			(
				reusablePrompts.find(function (p) {
					return p.name === name;
				}) || {}
			).prompt ||
			"";
		if (fullPrompt) {
			expanded = expanded.replace(regex, "$1" + fullPrompt);
		}
	});

	// Clear stored mappings after expansion
	if (chatInput) chatInput._slashPrompts = {};

	return expanded.trim();
}

function handleSlashCommands() {
	if (!chatInput) return;
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Find slash at start of input or after whitespace
	let slashPos = -1;
	for (var i = cursorPos - 1; i >= 0; i--) {
		if (value[i] === "/") {
			// Check if it's at start or after whitespace
			if (i === 0 || /\s/.test(value[i - 1])) {
				slashPos = i;
			}
			break;
		}
		if (/\s/.test(value[i])) break;
	}

	if (slashPos >= 0 && reusablePrompts.length > 0) {
		let query = value.substring(slashPos + 1, cursorPos);
		slashStartPos = slashPos;
		if (slashDebounceTimer) clearTimeout(slashDebounceTimer);
		slashDebounceTimer = setTimeout(function () {
			// Filter locally for instant results
			let queryLower = query.toLowerCase();
			let matchingPrompts = reusablePrompts.filter(function (p) {
				return (
					p.name.toLowerCase().includes(queryLower) ||
					p.prompt.toLowerCase().includes(queryLower)
				);
			});
			showSlashDropdown(matchingPrompts);
		}, 50);
	} else if (slashDropdownVisible) {
		hideSlashDropdown();
	}
}

function showSlashDropdown(results) {
	if (!slashDropdown || !slashList || !slashEmpty) return;
	slashResults = results;
	selectedSlashIndex = results.length > 0 ? 0 : -1;

	// Hide file autocomplete if showing slash commands
	hideAutocomplete();

	if (results.length === 0) {
		slashList.classList.add("hidden");
		slashEmpty.classList.remove("hidden");
	} else {
		slashList.classList.remove("hidden");
		slashEmpty.classList.add("hidden");
		renderSlashList();
	}
	slashDropdown.classList.remove("hidden");
	slashDropdownVisible = true;
}

function hideSlashDropdown() {
	if (slashDropdown) slashDropdown.classList.add("hidden");
	slashDropdownVisible = false;
	slashResults = [];
	selectedSlashIndex = -1;
	slashStartPos = -1;
	if (slashDebounceTimer) {
		clearTimeout(slashDebounceTimer);
		slashDebounceTimer = null;
	}
}

function renderSlashList() {
	if (!slashList) return;
	slashList.innerHTML = slashResults
		.map(function (p, index) {
			let truncatedPrompt =
				p.prompt.length > 50 ? p.prompt.substring(0, 50) + "..." : p.prompt;
			// Prepare tooltip text - escape for HTML attribute
			let tooltipText =
				p.prompt.length > 500 ? p.prompt.substring(0, 500) + "..." : p.prompt;
			tooltipText = escapeHtml(tooltipText);
			return (
				'<div class="slash-item' +
				(index === selectedSlashIndex ? " selected" : "") +
				'" data-index="' +
				index +
				'" data-tooltip="' +
				tooltipText +
				'">' +
				'<span class="slash-item-icon"><span class="codicon codicon-symbol-keyword"></span></span>' +
				'<div class="slash-item-content">' +
				'<span class="slash-item-name">/' +
				escapeHtml(p.name) +
				"</span>" +
				'<span class="slash-item-preview">' +
				escapeHtml(truncatedPrompt) +
				"</span>" +
				"</div></div>"
			);
		})
		.join("");

	slashList.querySelectorAll(".slash-item").forEach(function (item) {
		item.addEventListener("click", function () {
			selectSlashItem(parseInt(item.getAttribute("data-index"), 10));
		});
		item.addEventListener("mouseenter", function () {
			selectedSlashIndex = parseInt(item.getAttribute("data-index"), 10);
			updateSlashSelection();
		});
	});
	scrollToSelectedSlashItem();
}

function updateSlashSelection() {
	if (!slashList) return;
	slashList.querySelectorAll(".slash-item").forEach(function (item, index) {
		item.classList.toggle("selected", index === selectedSlashIndex);
	});
	scrollToSelectedSlashItem();
}

function scrollToSelectedSlashItem() {
	let selectedItem = slashList
		? slashList.querySelector(".slash-item.selected")
		: null;
	if (selectedItem)
		selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectSlashItem(index) {
	if (
		index < 0 ||
		index >= slashResults.length ||
		!chatInput ||
		slashStartPos < 0
	)
		return;
	let prompt = slashResults[index];
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Create a slash tag representation - when sent, we'll expand it to full prompt
	// For now, insert /name as text and store the mapping
	let slashText = "/" + prompt.name + " ";
	chatInput.value =
		value.substring(0, slashStartPos) + slashText + value.substring(cursorPos);
	let newCursorPos = slashStartPos + slashText.length;
	chatInput.setSelectionRange(newCursorPos, newCursorPos);

	// Store the prompt reference for expansion on send
	if (!chatInput._slashPrompts) chatInput._slashPrompts = {};
	chatInput._slashPrompts[prompt.name] = prompt.prompt;

	hideSlashDropdown();
	chatInput.focus();
	updateSendButtonState();
}
// ===== NOTIFICATION SOUND FUNCTION =====

/**
 * Unlock audio playback after first user interaction
 * Required due to browser autoplay policy
 */
function unlockAudioOnInteraction() {
	function unlock() {
		if (audioUnlocked) return;
		let audio = document.getElementById("notification-sound");
		if (audio) {
			// Play and immediately pause to unlock
			audio.volume = 0;
			let playPromise = audio.play();
			if (playPromise !== undefined) {
				playPromise
					.then(function () {
						audio.pause();
						audio.currentTime = 0;
						audio.volume = 0.5;
						audioUnlocked = true;
					})
					.catch(function () {
						// Still locked, will try again on next interaction
					});
			}
		}
		// Remove listeners after first attempt
		document.removeEventListener("click", unlock);
		document.removeEventListener("keydown", unlock);
	}
	document.addEventListener("click", unlock, { once: true });
	document.addEventListener("keydown", unlock, { once: true });
}

function playNotificationSound() {
	// Play the preloaded audio element
	try {
		let audio = document.getElementById("notification-sound");
		if (audio) {
			audio.currentTime = 0; // Reset to beginning
			audio.volume = 0.5;
			let playPromise = audio.play();
			if (playPromise !== undefined) {
				playPromise
					.then(function () {
						// Audio playback started
					})
					.catch(function (e) {
						// If autoplay blocked, show visual feedback
						flashNotification();
					});
			}
		} else {
			flashNotification();
		}
	} catch (e) {
		flashNotification();
	}
}

function flashNotification() {
	// Visual flash when audio fails
	let body = document.body;
	body.style.transition = "background-color 0.1s ease";
	let originalBg = body.style.backgroundColor;
	body.style.backgroundColor = "var(--vscode-textLink-foreground, #3794ff)";
	setTimeout(function () {
		body.style.backgroundColor = originalBg || "";
	}, 150);
}

function bindDragAndDrop() {
	if (!queueList) return;
	queueList.querySelectorAll(".queue-item").forEach(function (item) {
		item.addEventListener("dragstart", function (e) {
			e.dataTransfer.setData(
				"text/plain",
				String(parseInt(item.getAttribute("data-index"), 10)),
			);
			item.classList.add("dragging");
		});
		item.addEventListener("dragend", function () {
			item.classList.remove("dragging");
		});
		item.addEventListener("dragover", function (e) {
			e.preventDefault();
			item.classList.add("drag-over");
		});
		item.addEventListener("dragleave", function () {
			item.classList.remove("drag-over");
		});
		item.addEventListener("drop", function (e) {
			e.preventDefault();
			let fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
			let toIndex = parseInt(item.getAttribute("data-index"), 10);
			item.classList.remove("drag-over");
			if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex))
				reorderQueue(fromIndex, toIndex);
		});
	});
}

function bindKeyboardNavigation() {
	if (!queueList) return;
	let items = queueList.querySelectorAll(".queue-item");
	items.forEach(function (item, index) {
		item.addEventListener("keydown", function (e) {
			if (e.key === "ArrowDown" && index < items.length - 1) {
				e.preventDefault();
				items[index + 1].focus();
			} else if (e.key === "ArrowUp" && index > 0) {
				e.preventDefault();
				items[index - 1].focus();
			} else if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				var id = item.getAttribute("data-id");
				if (id) removeFromQueue(id);
			}
		});
	});
}

function reorderQueue(fromIndex, toIndex) {
	let removed = promptQueue.splice(fromIndex, 1)[0];
	promptQueue.splice(toIndex, 0, removed);
	renderQueue();
	vscode.postMessage({
		type: "reorderQueue",
		fromIndex: fromIndex,
		toIndex: toIndex,
	});
}

function handleAutocomplete() {
	if (!chatInput) return;
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;
	let hashPos = -1;
	for (var i = cursorPos - 1; i >= 0; i--) {
		if (value[i] === "#") {
			hashPos = i;
			break;
		}
		if (value[i] === " " || value[i] === "\n") break;
	}
	if (hashPos >= 0) {
		let query = value.substring(hashPos + 1, cursorPos);
		autocompleteStartPos = hashPos;
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(function () {
			vscode.postMessage({ type: "searchFiles", query: query });
		}, 150);
	} else if (autocompleteVisible) {
		hideAutocomplete();
	}
}

function showAutocomplete(results) {
	if (!autocompleteDropdown || !autocompleteList || !autocompleteEmpty) return;
	autocompleteResults = results;
	selectedAutocompleteIndex = results.length > 0 ? 0 : -1;
	if (results.length === 0) {
		autocompleteList.classList.add("hidden");
		autocompleteEmpty.classList.remove("hidden");
	} else {
		autocompleteList.classList.remove("hidden");
		autocompleteEmpty.classList.add("hidden");
		renderAutocompleteList();
	}
	autocompleteDropdown.classList.remove("hidden");
	autocompleteVisible = true;
}

function hideAutocomplete() {
	if (autocompleteDropdown) autocompleteDropdown.classList.add("hidden");
	autocompleteVisible = false;
	autocompleteResults = [];
	selectedAutocompleteIndex = -1;
	autocompleteStartPos = -1;
	if (searchDebounceTimer) {
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = null;
	}
}

function renderAutocompleteList() {
	if (!autocompleteList) return;
	autocompleteList.innerHTML = autocompleteResults
		.map(function (file, index) {
			return (
				'<div class="autocomplete-item' +
				(index === selectedAutocompleteIndex ? " selected" : "") +
				'" data-index="' +
				index +
				'">' +
				'<span class="autocomplete-item-icon"><span class="codicon codicon-' +
				file.icon +
				'"></span></span>' +
				'<div class="autocomplete-item-content"><span class="autocomplete-item-name">' +
				escapeHtml(file.name) +
				"</span>" +
				'<span class="autocomplete-item-path">' +
				escapeHtml(file.path) +
				"</span></div></div>"
			);
		})
		.join("");

	autocompleteList
		.querySelectorAll(".autocomplete-item")
		.forEach(function (item) {
			item.addEventListener("click", function () {
				selectAutocompleteItem(parseInt(item.getAttribute("data-index"), 10));
			});
			item.addEventListener("mouseenter", function () {
				selectedAutocompleteIndex = parseInt(
					item.getAttribute("data-index"),
					10,
				);
				updateAutocompleteSelection();
			});
		});
	scrollToSelectedItem();
}

function updateAutocompleteSelection() {
	if (!autocompleteList) return;
	autocompleteList
		.querySelectorAll(".autocomplete-item")
		.forEach(function (item, index) {
			item.classList.toggle("selected", index === selectedAutocompleteIndex);
		});
	scrollToSelectedItem();
}

function scrollToSelectedItem() {
	let selectedItem = autocompleteList
		? autocompleteList.querySelector(".autocomplete-item.selected")
		: null;
	if (selectedItem)
		selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectAutocompleteItem(index) {
	if (
		index < 0 ||
		index >= autocompleteResults.length ||
		!chatInput ||
		autocompleteStartPos < 0
	)
		return;
	let file = autocompleteResults[index];
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Check if this is a context item (#terminal, #problems)
	if (file.isContext && file.uri && file.uri.startsWith("context://")) {
		// Remove the #query from input - chip will be added
		chatInput.value =
			value.substring(0, autocompleteStartPos) + value.substring(cursorPos);
		let newCursorPos = autocompleteStartPos;
		chatInput.setSelectionRange(newCursorPos, newCursorPos);

		// Send context reference request to backend
		vscode.postMessage({
			type: "selectContextReference",
			contextType: file.name, // 'terminal' or 'problems'
			options: undefined,
		});

		hideAutocomplete();
		chatInput.focus();
		autoResizeTextarea();
		updateInputHighlighter();
		saveWebviewState();
		updateSendButtonState();
		return;
	}

	// Tool reference — insert #toolName, no file attachment needed
	if (file.isTool) {
		let referenceText = "#" + file.name + " ";
		chatInput.value =
			value.substring(0, autocompleteStartPos) +
			referenceText +
			value.substring(cursorPos);
		let newCursorPos = autocompleteStartPos + referenceText.length;
		chatInput.setSelectionRange(newCursorPos, newCursorPos);
		hideAutocomplete();
		chatInput.focus();
		autoResizeTextarea();
		updateInputHighlighter();
		saveWebviewState();
		updateSendButtonState();
		return;
	}

	// Regular file/folder reference
	let referenceText = "#" + file.name + " ";
	chatInput.value =
		value.substring(0, autocompleteStartPos) +
		referenceText +
		value.substring(cursorPos);
	let newCursorPos = autocompleteStartPos + referenceText.length;
	chatInput.setSelectionRange(newCursorPos, newCursorPos);
	vscode.postMessage({ type: "addFileReference", file: file });
	hideAutocomplete();
	chatInput.focus();
}

function syncAttachmentsWithText() {
	let text = chatInput ? chatInput.value : "";
	let toRemove = [];
	currentAttachments.forEach(function (att) {
		// Skip temporary attachments (like pasted images)
		if (att.isTemporary) return;
		// Skip context attachments (#terminal, #problems) - they use context:// URI
		if (att.uri && att.uri.startsWith("context://")) return;
		// Only sync file references that have isTextReference flag
		if (!att.isTextReference) return;
		// Check if the #filename reference still exists in text
		if (text.indexOf("#" + att.name) === -1) toRemove.push(att.id);
	});
	if (toRemove.length > 0) {
		toRemove.forEach(function (id) {
			vscode.postMessage({ type: "removeAttachment", attachmentId: id });
		});
		currentAttachments = currentAttachments.filter(function (a) {
			return toRemove.indexOf(a.id) === -1;
		});
		updateChipsDisplay();
	}
}

function handlePaste(event) {
	if (!event.clipboardData) return;
	let items = event.clipboardData.items;
	for (var i = 0; i < items.length; i++) {
		if (items[i].type.indexOf("image/") === 0) {
			event.preventDefault();
			let file = items[i].getAsFile();
			if (file) processImageFile(file);
			return;
		}
	}
}

/**
 * Capture latest right-click position for context-menu copy resolution.
 */
function handleContextMenu(event) {
	if (!event || !event.target || !event.target.closest) {
		lastContextMenuTarget = null;
		lastContextMenuTimestamp = 0;
		return;
	}

	lastContextMenuTarget = event.target;
	lastContextMenuTimestamp = Date.now();
}

/**
 * Override Copy when nothing is selected and context-menu target points to a message.
 */
function handleCopy(event) {
	let selection = window.getSelection ? window.getSelection() : null;
	if (selection && selection.toString().length > 0) {
		return;
	}

	if (
		!lastContextMenuTarget ||
		Date.now() - lastContextMenuTimestamp > CONTEXT_MENU_COPY_MAX_AGE_MS
	) {
		return;
	}

	let copyText = resolveCopyTextFromTarget(lastContextMenuTarget);
	if (!copyText) {
		return;
	}

	if (event) {
		event.preventDefault();
	}

	if (event && event.clipboardData) {
		try {
			event.clipboardData.setData("text/plain", copyText);
			lastContextMenuTarget = null;
			lastContextMenuTimestamp = 0;
			return;
		} catch (error) {
			// Fall through to extension host clipboard API fallback.
		}
	}

	vscode.postMessage({ type: "copyToClipboard", text: copyText });
	lastContextMenuTarget = null;
	lastContextMenuTimestamp = 0;
}

/**
 * Resolve copy payload from the exact message area that was right-clicked.
 */
function resolveCopyTextFromTarget(target) {
	if (!target || !target.closest) {
		return "";
	}

	let pendingQuestion = target.closest(".pending-ai-question");
	if (pendingQuestion) {
		if (pendingToolCall && typeof pendingToolCall.prompt === "string") {
			return pendingToolCall.prompt;
		}
		return (pendingQuestion.textContent || "").trim();
	}

	let toolCallEntry = resolveToolCallEntryFromTarget(target);
	if (!toolCallEntry) {
		return "";
	}

	if (target.closest(".tool-call-ai-response")) {
		return typeof toolCallEntry.prompt === "string" ? toolCallEntry.prompt : "";
	}

	if (target.closest(".tool-call-user-response")) {
		return typeof toolCallEntry.response === "string"
			? toolCallEntry.response
			: "";
	}

	if (target.closest(".chips-container")) {
		return formatAttachmentsForCopy(toolCallEntry.attachments);
	}

	return formatToolCallEntryForCopy(toolCallEntry);
}

/**
 * Resolve a tool call entry by traversing from a DOM target to its card id.
 */
function resolveToolCallEntryFromTarget(target) {
	let card = target.closest(".tool-call-card");
	if (!card) {
		return null;
	}

	return resolveToolCallEntryFromCardId(card.getAttribute("data-id"));
}

/**
 * Find a tool call entry in current session first, then persisted history.
 */
function resolveToolCallEntryFromCardId(cardId) {
	if (!cardId) {
		return null;
	}

	let currentEntry = currentSessionCalls.find(function (tc) {
		return tc.id === cardId;
	});
	if (currentEntry) {
		return currentEntry;
	}

	let persistedEntry = persistedHistory.find(function (tc) {
		return tc.id === cardId;
	});
	return persistedEntry || null;
}

/**
 * Compose full card copy output when right-click happened outside a specific message block.
 */
function formatToolCallEntryForCopy(entry) {
	if (!entry) {
		return "";
	}

	let parts = [];
	if (typeof entry.prompt === "string" && entry.prompt.length > 0) {
		parts.push(entry.prompt);
	}
	if (typeof entry.response === "string" && entry.response.length > 0) {
		parts.push(entry.response);
	}

	let attachmentsText = formatAttachmentsForCopy(entry.attachments);
	if (attachmentsText) {
		parts.push(attachmentsText);
	}

	return parts.join("\n\n");
}

/**
 * Convert attachment list to plain text while preserving stored attachment names.
 */
function formatAttachmentsForCopy(attachments) {
	if (!attachments || attachments.length === 0) {
		return "";
	}

	return attachments
		.map(function (att) {
			if (att && typeof att.name === "string" && att.name.length > 0) {
				return att.name;
			}
			return att && typeof att.uri === "string" ? att.uri : "";
		})
		.filter(function (value) {
			return value.length > 0;
		})
		.join("\n");
}

function processImageFile(file) {
	let reader = new FileReader();
	reader.onload = function (e) {
		if (e.target && e.target.result)
			vscode.postMessage({
				type: "saveImage",
				data: e.target.result,
				mimeType: file.type,
			});
	};
	reader.readAsDataURL(file);
}

function updateChipsDisplay() {
	if (!chipsContainer) return;
	if (currentAttachments.length === 0) {
		chipsContainer.classList.add("hidden");
		chipsContainer.innerHTML = "";
	} else {
		chipsContainer.classList.remove("hidden");
		chipsContainer.innerHTML = currentAttachments
			.map(function (att) {
				let isImage =
					att.isTemporary || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
				let iconClass = att.isFolder
					? "folder"
					: isImage
						? "file-media"
						: "file";
				let displayName = att.isTemporary ? "Pasted Image" : att.name;
				return (
					'<div class="chip" data-id="' +
					att.id +
					'" title="' +
					escapeHtml(att.uri || att.name) +
					'">' +
					'<span class="chip-icon"><span class="codicon codicon-' +
					iconClass +
					'"></span></span>' +
					'<span class="chip-text">' +
					escapeHtml(displayName) +
					"</span>" +
					'<button class="chip-remove" data-remove="' +
					att.id +
					'" title="Remove"><span class="codicon codicon-close"></span></button></div>'
				);
			})
			.join("");

		chipsContainer.querySelectorAll(".chip-remove").forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				const attId = btn.getAttribute("data-remove");
				if (attId) removeAttachment(attId);
			});
		});
	}
	// Persist attachments so they survive sidebar tab switches
	saveWebviewState();
}

function removeAttachment(attachmentId) {
	vscode.postMessage({ type: "removeAttachment", attachmentId: attachmentId });
	currentAttachments = currentAttachments.filter(function (a) {
		return a.id !== attachmentId;
	});
	updateChipsDisplay();
	// saveWebviewState() is called in updateChipsDisplay
}

function escapeHtml(str) {
	if (!str) return "";
	let div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

function renderAttachmentsHtml(attachments) {
	if (!attachments || attachments.length === 0) return "";
	let items = attachments
		.map(function (att) {
			let iconClass = "file";
			if (att.isFolder) iconClass = "folder";
			else if (
				att.name &&
				(att.name.endsWith(".png") ||
					att.name.endsWith(".jpg") ||
					att.name.endsWith(".jpeg"))
			)
				iconClass = "file-media";
			else if ((att.uri || "").indexOf("context://terminal") !== -1)
				iconClass = "terminal";
			else if ((att.uri || "").indexOf("context://problems") !== -1)
				iconClass = "error";

			return (
				'<div class="chip" style="margin-top:0;" title="' +
				escapeHtml(att.name) +
				'">' +
				'<span class="chip-icon"><span class="codicon codicon-' +
				iconClass +
				'"></span></span>' +
				'<span class="chip-text">' +
				escapeHtml(att.name) +
				"</span>" +
				"</div>"
			);
		})
		.join("");

	return (
		'<div class="chips-container" style="padding: 6px 0 0 0; border: none;">' +
		items +
		"</div>"
	);
}

function initChangesPanel() {
	if (!changesSection) return;
	changesSection.classList.toggle("hidden", !changesPanelVisible);
	updateChangesHeaderButton();
	renderChangesPanel();
}

function toggleChangesPanel(forceVisible) {
	changesPanelVisible =
		typeof forceVisible === "boolean" ? forceVisible : !changesPanelVisible;
	if (changesSection) {
		changesSection.classList.toggle("hidden", !changesPanelVisible);
	}
	updateChangesHeaderButton();
	if (changesPanelVisible) {
		requestChangesRefresh();
	}
}

function updateChangesHeaderButton() {
	var remoteChangesBtn = document.getElementById("remote-changes-btn");
	if (remoteChangesBtn) {
		remoteChangesBtn.classList.toggle("active", changesPanelVisible);
	}
	if (changesRefreshBtn) {
		changesRefreshBtn.disabled = !changesPanelVisible;
	}
	if (changesCloseBtn) {
		changesCloseBtn.disabled = !changesPanelVisible;
	}
}

function getRemoteGitHeaders() {
	var headers = { "Content-Type": "application/json" };
	try {
		var sessionToken = sessionStorage.getItem(SESSION_KEYS.SESSION_TOKEN) || "";
		if (sessionToken) headers["x-tasksync-session"] = sessionToken;
		var pin = sessionStorage.getItem(SESSION_KEYS.PIN) || "";
		if (pin) headers["x-tasksync-pin"] = pin;
	} catch {
		// Ignore storage access issues and let server enforce auth.
	}
	return headers;
}

async function callRemoteGitApi(method, endpoint, payload) {
	var req = {
		method: method,
		headers: getRemoteGitHeaders(),
	};
	if (payload !== undefined) {
		req.body = JSON.stringify(payload);
	}

	var res = await fetch(endpoint, req);
	var data = {};
	try {
		data = await res.json();
	} catch {
		data = {};
	}

	if (!res.ok) {
		throw new Error(data.error || "Operation failed");
	}

	return data;
}

async function requestChangesRefresh() {
	changesLoading = true;
	changesError = "";
	renderChangesPanel();

	if (isRemoteMode) {
		try {
			var data = await callRemoteGitApi("GET", "/api/changes");
			applyChangesState(data);
		} catch (err) {
			changesLoading = false;
			changesError =
				err && err.message ? err.message : "Failed to load git changes.";
			renderChangesPanel();
		}
		return;
	}

	vscode.postMessage({ type: "getChanges" });
}

function refreshChangesState() {
	if (changesPanelVisible) {
		void requestChangesRefresh();
	}
}

function applyChangesState(state) {
	changesState = {
		staged: Array.isArray(state && state.staged) ? state.staged : [],
		unstaged: Array.isArray(state && state.unstaged) ? state.unstaged : [],
	};
	pruneCachedChangeStats();
	changeStatsRequestToken += 1;
	changesLoading = false;
	changesError = "";
	if (!hasSelectedChangeFile()) {
		selectedChangeFile = firstChangeFilePath();
		selectedChangeDiff = "";
	}
	renderChangesPanel();
	if (isRemoteMode && changesPanelVisible) {
		void prefetchChangeStats(changeStatsRequestToken);
	}
	if (changesPanelVisible && selectedChangeFile) {
		void requestChangeDiff(selectedChangeFile);
	}
}

function applyChangeDiff(filePath, diff) {
	if (filePath && selectedChangeFile && filePath !== selectedChangeFile) {
		return;
	}
	selectedChangeFile = filePath || selectedChangeFile;
	selectedChangeDiff = typeof diff === "string" ? diff : "";
	if (filePath) {
		changeStatsByFile[filePath] = extractDiffStats(selectedChangeDiff);
	}
	changesLoading = false;
	changesError = "";
	renderChangesPanel();
}

async function requestChangeDiff(filePath) {
	if (!filePath) return;
	selectedChangeFile = filePath;
	selectedChangeDiff = "";
	changesLoading = true;
	changesError = "";
	renderChangesPanel();

	if (isRemoteMode) {
		try {
			var data = await callRemoteGitApi(
				"GET",
				"/api/diff?file=" + encodeURIComponent(filePath),
			);
			applyChangeDiff(filePath, data.diff || "");
		} catch (err) {
			changesLoading = false;
			changesError = err && err.message ? err.message : "Failed to load diff.";
			renderChangesPanel();
		}
		return;
	}

	vscode.postMessage({ type: "getDiff", file: filePath });
}

function handleChangeFileSelect(filePath) {
	void requestChangeDiff(filePath);
}

function hasSelectedChangeFile() {
	if (!selectedChangeFile) return false;
	return (
		changesState.staged.some(function (item) {
			return item.path === selectedChangeFile;
		}) ||
		changesState.unstaged.some(function (item) {
			return item.path === selectedChangeFile;
		})
	);
}

function firstChangeFilePath() {
	if (changesState.unstaged.length > 0) return changesState.unstaged[0].path;
	if (changesState.staged.length > 0) return changesState.staged[0].path;
	return "";
}

function formatChangeStatusLabel(statusText) {
	if (typeof statusText !== "string") return "";
	var trimmedStatus = statusText.trim();
	if (!trimmedStatus) return "";
	if (trimmedStatus.toLowerCase() === "modified") return "";
	return trimmedStatus;
}

function renderChangesPanel() {
	if (!changesSection) return;

	if (changesSummary) {
		var summaryText;
		if (
			changesLoading &&
			!changesState.staged.length &&
			!changesState.unstaged.length
		) {
			summaryText = "Loading git changes...";
		} else {
			var totalChanges =
				changesState.unstaged.length + changesState.staged.length;
			summaryText =
				totalChanges +
				" changes (" +
				changesState.unstaged.length +
				" unstaged, " +
				changesState.staged.length +
				" staged)";
		}
		changesSummary.textContent = summaryText;
	}

	if (changesStatus) {
		if (changesError) {
			changesStatus.textContent = changesError;
		} else if (changesLoading) {
			changesStatus.textContent = "Loading...";
		} else {
			changesStatus.textContent = "";
		}
	}

	if (changesDiffTitle) {
		changesDiffTitle.textContent = selectedChangeFile
			? selectedChangeFile
			: "Select a file to preview its diff";
	}

	if (changesDiffMeta) {
		var metaText = "";
		if (selectedChangeFile) {
			var selectedItem = findChangeItem(selectedChangeFile);
			metaText = selectedItem
				? formatChangeStatusLabel(selectedItem.status)
				: "";
		}
		changesDiffMeta.textContent = metaText;
	}

	if (changesDiffOutput) {
		if (selectedChangeDiff) {
			changesDiffOutput.innerHTML = formatGitDiffHtml(selectedChangeDiff);
			changesDiffOutput.classList.remove("empty");
		} else if (changesLoading && selectedChangeFile) {
			changesDiffOutput.textContent = "Loading diff...";
			changesDiffOutput.classList.add("empty");
		} else {
			changesDiffOutput.textContent =
				"Open the panel, then select a file to inspect the diff.";
			changesDiffOutput.classList.add("empty");
		}
	}

	renderChangeGroups();
	bindChangePanelEvents();
	updateChangesHeaderButton();
}

function renderChangeGroups() {
	if (changesUnstagedList) {
		var allChanges = changesState.unstaged
			.map(function (item) {
				return { ...item, section: "unstaged" };
			})
			.concat(
				changesState.staged.map(function (item) {
					return { ...item, section: "staged" };
				}),
			);
		renderChangeGroup(changesUnstagedList, allChanges);
	}
	if (changesUnstagedGroup) {
		changesUnstagedGroup.classList.remove("hidden");
	}
}

function renderChangeGroup(container, items) {
	if (!container) return;
	if (!items || items.length === 0) {
		container.innerHTML = '<div class="changes-empty">No changes</div>';
		return;
	}

	container.innerHTML = items
		.map(function (item) {
			var isSelected = item.path === selectedChangeFile;
			var section = item.section || "unstaged";
			var statusText = formatChangeStatusLabel(item.status || section);
			var statusHtml = statusText
				? '<span class="change-item-status ' +
					escapeHtml(section) +
					'">' +
					escapeHtml(statusText) +
					"</span>"
				: "";
			var stats = resolveChangeStats(item);
			var additions = stats ? Math.max(0, Number(stats.additions) || 0) : null;
			var deletions = stats ? Math.max(0, Number(stats.deletions) || 0) : null;
			var statsLabel =
				additions !== null && deletions !== null
					? '<span class="change-item-lines" aria-label="' +
						escapeHtml(
							additions + " additions and " + deletions + " deletions",
						) +
						'">' +
						'<span class="plus">+' +
						escapeHtml(String(additions)) +
						"</span>" +
						'<span class="minus">-' +
						escapeHtml(String(deletions)) +
						"</span></span>"
					: '<span class="change-item-lines pending" aria-hidden="true">+? -?</span>';
			return (
				'<div class="change-item' +
				(isSelected ? " selected" : "") +
				'" data-change-file="' +
				escapeHtml(item.path) +
				'">' +
				'<button type="button" class="change-item-main" data-select-change-file="' +
				escapeHtml(item.path) +
				'">' +
				'<span class="change-item-top"><span class="change-item-path">' +
				escapeHtml(item.path) +
				"</span>" +
				statsLabel +
				"</span>" +
				statusHtml +
				"</button></div>"
			);
		})
		.join("");
}

function resolveChangeStats(item) {
	if (!item || !item.path) return null;
	if (
		typeof item.additions === "number" ||
		typeof item.deletions === "number"
	) {
		return {
			additions: Math.max(0, Number(item.additions) || 0),
			deletions: Math.max(0, Number(item.deletions) || 0),
		};
	}
	return changeStatsByFile[item.path] || null;
}

function pruneCachedChangeStats() {
	var activeFiles = {};
	changesState.unstaged.forEach(function (item) {
		if (item && item.path) activeFiles[item.path] = true;
	});
	changesState.staged.forEach(function (item) {
		if (item && item.path) activeFiles[item.path] = true;
	});

	var nextStats = {};
	Object.keys(changeStatsByFile).forEach(function (filePath) {
		if (activeFiles[filePath]) {
			nextStats[filePath] = changeStatsByFile[filePath];
		}
	});
	changeStatsByFile = nextStats;

	var nextInFlight = {};
	Object.keys(changeStatsInFlight).forEach(function (filePath) {
		if (activeFiles[filePath]) {
			nextInFlight[filePath] = true;
		}
	});
	changeStatsInFlight = nextInFlight;
}

async function prefetchChangeStats(requestToken) {
	if (!isRemoteMode) return;

	var filePaths = changesState.unstaged
		.concat(changesState.staged)
		.map(function (item) {
			return item.path;
		})
		.filter(function (filePath) {
			return (
				!!filePath &&
				!changeStatsByFile[filePath] &&
				!changeStatsInFlight[filePath]
			);
		})
		.slice(0, 40);

	if (filePaths.length === 0) return;

	var cursor = 0;
	var maxConcurrent = 3;

	async function worker() {
		while (cursor < filePaths.length) {
			var currentIndex = cursor;
			cursor += 1;
			var filePath = filePaths[currentIndex];
			if (!filePath) continue;
			await fetchAndCacheChangeStats(filePath, requestToken);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(maxConcurrent, filePaths.length) },
			function () {
				return worker();
			},
		),
	);

	if (requestToken === changeStatsRequestToken && changesPanelVisible) {
		renderChangesPanel();
	}
}

async function fetchAndCacheChangeStats(filePath, requestToken) {
	if (!filePath || changeStatsByFile[filePath] || changeStatsInFlight[filePath])
		return;

	changeStatsInFlight[filePath] = true;
	try {
		var data = await callRemoteGitApi(
			"GET",
			"/api/diff?file=" + encodeURIComponent(filePath),
		);
		if (requestToken !== changeStatsRequestToken) return;
		changeStatsByFile[filePath] = extractDiffStats(
			data && data.diff ? data.diff : "",
		);
	} catch {
		// Keep placeholder stats when diff cannot be loaded.
	} finally {
		delete changeStatsInFlight[filePath];
	}
}

function extractDiffStats(diffText) {
	if (!diffText || typeof diffText !== "string") {
		return { additions: 0, deletions: 0 };
	}

	var additions = 0;
	var deletions = 0;
	diffText.split("\n").forEach(function (line) {
		if (line.startsWith("+++") || line.startsWith("---")) return;
		if (line.startsWith("+") && !line.startsWith("+++")) {
			additions += 1;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions += 1;
		}
	});

	return { additions: additions, deletions: deletions };
}

function formatGitDiffHtml(diffText) {
	if (!diffText) return "";

	var oldLine = 0;
	var newLine = 0;
	var inHunk = false;
	var renderedBinaryNotice = false;

	var rows = diffText
		.split("\n")
		.map(function (line) {
			if (line.startsWith("@@")) {
				var parsed = parseDiffHunkHeader(line);
				if (parsed) {
					oldLine = parsed.oldLine;
					newLine = parsed.newLine;
					inHunk = true;
				}
				return renderDiffMetaRow("diff-hunk", line);
			}

			if (line.startsWith("diff --git")) {
				inHunk = false;
				return "";
			}

			if (
				line.startsWith("index ") ||
				line.startsWith("new file mode") ||
				line.startsWith("deleted file mode") ||
				line.startsWith("similarity index") ||
				line.startsWith("rename from") ||
				line.startsWith("rename to") ||
				line.startsWith("+++") ||
				line.startsWith("---") ||
				line.startsWith("\\ No newline at end of file")
			) {
				return "";
			}

			if (line.startsWith("Binary files") && !renderedBinaryNotice) {
				renderedBinaryNotice = true;
				return renderDiffMetaRow(
					"diff-meta",
					"Binary file changed (text diff unavailable).",
				);
			}

			if (inHunk) {
				if (line.startsWith("+") && !line.startsWith("+++")) {
					var addRow = renderDiffCodeRow(
						"",
						String(newLine),
						"+",
						line.slice(1),
						"diff-addition",
					);
					newLine += 1;
					return addRow;
				}

				if (line.startsWith("-") && !line.startsWith("---")) {
					var delRow = renderDiffCodeRow(
						String(oldLine),
						"",
						"-",
						line.slice(1),
						"diff-deletion",
					);
					oldLine += 1;
					return delRow;
				}

				var contextRow = renderDiffCodeRow(
					String(oldLine),
					String(newLine),
					" ",
					line.startsWith(" ") ? line.slice(1) : line,
					"diff-context",
				);
				oldLine += 1;
				newLine += 1;
				return contextRow;
			}

			return "";
		})
		.filter(Boolean)
		.join("");

	if (rows.length > 0) {
		return rows;
	}

	return renderDiffMetaRow("diff-meta", "No textual diff to display.");
}

function parseDiffHunkHeader(hunkLine) {
	var match = /^@@\s-(\d+)(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@/.exec(hunkLine);
	if (!match) return null;
	return {
		oldLine: Number(match[1]),
		newLine: Number(match[2]),
	};
}

function renderDiffMetaRow(extraClass, line) {
	return (
		'<span class="diff-line ' +
		extraClass +
		'">' +
		'<span class="diff-line-code">' +
		escapeHtml(line.length > 0 ? line : " ") +
		"</span></span>"
	);
}

function renderDiffCodeRow(oldNumber, newNumber, sign, content, extraClass) {
	return (
		'<span class="diff-line ' +
		extraClass +
		'">' +
		'<span class="diff-line-number old">' +
		escapeHtml(oldNumber) +
		"</span>" +
		'<span class="diff-line-number new">' +
		escapeHtml(newNumber) +
		"</span>" +
		'<span class="diff-line-sign">' +
		escapeHtml(sign) +
		"</span>" +
		'<span class="diff-line-code">' +
		escapeHtml(content.length > 0 ? content : " ") +
		"</span></span>"
	);
}

function findChangeItem(filePath) {
	if (!filePath) return null;
	var staged = changesState.staged.find(function (item) {
		return item.path === filePath;
	});
	if (staged) return staged;
	var unstaged = changesState.unstaged.find(function (item) {
		return item.path === filePath;
	});
	return unstaged || null;
}

function bindChangePanelEvents() {
	if (!changesSection) return;

	if (changesRefreshBtn) {
		changesRefreshBtn.onclick = function () {
			void requestChangesRefresh();
		};
	}
	if (changesCloseBtn) {
		changesCloseBtn.onclick = function () {
			toggleChangesPanel(false);
		};
	}

	changesSection
		.querySelectorAll("[data-select-change-file]")
		.forEach(function (btn) {
			btn.onclick = function () {
				var filePath = btn.getAttribute("data-select-change-file");
				if (filePath) handleChangeFileSelect(filePath);
			};
		});
}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
