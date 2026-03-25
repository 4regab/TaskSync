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
				message.prompt,
				message.isApproval,
				message.choices,
			);
			break;
		case "toolCallCompleted":
			addToolCallToCurrentSession(message.entry, message.sessionTerminated);
			break;
		case "updateCurrentSession":
			currentSessionCalls = message.history || [];
			renderCurrentSession();
			// Hide welcome section if we have completed tool calls
			updateWelcomeSectionVisibility();
			// Auto-scroll to bottom after rendering
			scrollToBottom();
			break;
		case "updatePersistedHistory":
			persistedHistory = message.history || [];
			renderHistoryModal();
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
		case "updateSettings":
			soundEnabled = message.soundEnabled !== false;
			interactiveApprovalEnabled = message.interactiveApprovalEnabled !== false;
			askUserVerbosePayloadEnabled =
				message.askUserVerbosePayloadEnabled === true;
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
			updateAskUserVerbosePayloadToggleUI();
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
			promptQueue = [];
			currentSessionCalls = [];
			pendingToolCall = null;
			lastPendingContentHtml = "";
			isProcessingResponse = false;
			renderQueue();
			renderCurrentSession();
			if (pendingMessage) {
				pendingMessage.classList.remove("hidden");
				pendingMessage.innerHTML =
					'<div class="session-started-notice">' +
					'<span class="codicon codicon-check"></span> New session started — waiting for AI' +
					"</div>";
			}
			updateWelcomeSectionVisibility();
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

function showPendingToolCall(id, prompt, isApproval, choices) {
	pendingToolCall = { id: id, prompt: prompt };
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
