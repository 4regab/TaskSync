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
			return {
				type: "newSession",
				stopCurrentSession: msg.stopCurrentSession === true,
				initialPrompt: msg.initialPrompt,
				useQueuedPrompt: msg.useQueuedPrompt === true,
			};
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
			if (!agentOrchestrationEnabled) {
				if (typeof syncClientSessionSelection === "function") {
					syncClientSessionSelection(
						serverActiveSessionId || activeSessionId || null,
					);
				}
				renderSessionsList();
				updateWelcomeSectionVisibility();
				return null;
			}
			if (!msg.sessionId) {
				// Back to hub — handle locally, no server round-trip needed
				if (typeof saveActiveSessionComposerState === "function") {
					saveActiveSessionComposerState();
				}
				activeSessionId = null;
				if (typeof restoreActiveSessionComposerState === "function") {
					restoreActiveSessionComposerState();
				}
				updateWelcomeSectionVisibility();
				renderSessionsList();
				return null;
			}
			// Optimistic update: switch view immediately, server will confirm
			activeSessionId = msg.sessionId;
			renderSessionsList();
			updateWelcomeSectionVisibility();
			return { type: "switchSession", sessionId: msg.sessionId };
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
			if (typeof requestFollowServerActiveSession === "function") {
				requestFollowServerActiveSession();
			}
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
				if (typeof syncClientSessionSelection === "function") {
					syncClientSessionSelection(msg.data.activeSessionId || null);
				} else {
					activeSessionId = msg.data.activeSessionId || null;
				}
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
	if (
		typeof statusMessage === "string" &&
		statusMessage &&
		((typeof sessionExists === "function" &&
			sessionExists(serverActiveSessionId)) ||
			serverActiveSessionId)
	) {
		activeSessionId = serverActiveSessionId;
	}
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
	if (s.agentOrchestrationEnabled !== undefined) {
		agentOrchestrationEnabled = s.agentOrchestrationEnabled;
		if (!agentOrchestrationEnabled) {
			splitViewEnabled = false;
			if (typeof syncClientSessionSelection === "function") {
				syncClientSessionSelection(
					serverActiveSessionId || activeSessionId || null,
				);
			}
		}
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
	// Multi-session state (sessions list + active session ID)
	if (Array.isArray(state.sessions)) {
		sessions = state.sessions;
		if (typeof syncClientSessionSelection === "function") {
			syncClientSessionSelection(state.activeSessionId || null);
		} else {
			activeSessionId = state.activeSessionId || null;
		}
		if (typeof renderSessionsList === "function") renderSessionsList();
	}
	if (typeof updateWelcomeSectionVisibility === "function")
		updateWelcomeSectionVisibility();
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
	updateAgentOrchestrationToggleUI();
	updateAutoAppendToggleUI();
	updateAutoAppendTextUI();
	updateSendWithCtrlEnterToggleUI();
	updateAutopilotToggleUI();
	updateResponseTimeoutUI();
	updateSessionWarningHoursUI();
	updateMaxAutoResponsesUI();
	updateRemoteMaxDevicesUI();
	updateHumanDelayUI();
	workspacePromptListUI.render();
	renderPromptsList();
	updateQueueVisibility();
	renderSessionsList();
	updateWelcomeSectionVisibility();
}

// ==================== End Communication Adapter ====================
