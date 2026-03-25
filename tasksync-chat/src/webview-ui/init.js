function init() {
	try {
		cacheDOMElements();
		createHistoryModal();
		createEditModeUI();
		createApprovalModal();
		createSettingsModal();
		createNewSessionModal();
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

		// Restore persisted input value (when user switches sidebar tabs and comes back)
		if (chatInput && persistedInputValue) {
			chatInput.value = persistedInputValue;
			autoResizeTextarea();
			updateInputHighlighter();
			updateSendButtonState();
		}

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
	vscode.setState({
		inputValue: chatInput ? chatInput.value : "",
		attachments: currentAttachments.filter(function (a) {
			return !a.isTemporary;
		}), // Don't persist temp images
	});
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
	remoteSessionTimerEl = document.getElementById("remote-session-timer");
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

	// Consistent mode section - adds a reminder instruction for consistent #askUser usage
	let askUserVerbosePayloadSection = document.createElement("div");
	askUserVerbosePayloadSection.className = "settings-section";
	askUserVerbosePayloadSection.innerHTML =
		'<div class="settings-section-header">' +
		'<div class="settings-section-title">' +
		'<span class="codicon codicon-symbol-structure"></span> Consistent mode' +
		'<span class="settings-info-icon" title="When enabled, TaskSync adds an extra instruction prompt in ask_user output so Copilot consistently calls #askUser.\n\nDisabled by default for cleaner Input/Output blocks.">' +
		'<span class="codicon codicon-info"></span></span>' +
		"</div>" +
		'<div class="toggle-switch" id="askuser-verbose-payload-toggle" role="switch" aria-checked="false" aria-label="Enable Consistent mode prompt" tabindex="0"></div>' +
		"</div>";
	modalContent.appendChild(askUserVerbosePayloadSection);

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
	askUserVerbosePayloadToggle = document.getElementById(
		"askuser-verbose-payload-toggle",
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

// ===== NEW SESSION MODAL =====

var newSessionModalOverlay = null;

function createNewSessionModal() {
	newSessionModalOverlay = document.createElement("div");
	newSessionModalOverlay.className = "settings-modal-overlay hidden";
	newSessionModalOverlay.id = "new-session-modal-overlay";

	var modal = document.createElement("div");
	modal.className = "settings-modal new-session-modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-labelledby", "new-session-modal-title");

	// Header
	var header = document.createElement("div");
	header.className = "settings-modal-header";
	var title = document.createElement("span");
	title.className = "settings-modal-title";
	title.id = "new-session-modal-title";
	title.textContent = "New Session";
	header.appendChild(title);
	var headerBtns = document.createElement("div");
	headerBtns.className = "settings-modal-header-buttons";
	var closeBtn = document.createElement("button");
	closeBtn.className = "settings-modal-header-btn";
	closeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
	closeBtn.title = "Cancel";
	closeBtn.setAttribute("aria-label", "Cancel");
	closeBtn.addEventListener("click", closeNewSessionModal);
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);

	// Content
	var content = document.createElement("div");
	content.className = "settings-modal-content new-session-modal-content";

	// Model note
	var modelNote = document.createElement("p");
	modelNote.className = "new-session-note";
	modelNote.innerHTML =
		'<span class="codicon codicon-info"></span> Please check the model preselected in VS Code\'s Agent Mode before starting.';
	content.appendChild(modelNote);

	// Warning message
	var warning = document.createElement("p");
	warning.className = "new-session-warning";
	warning.textContent =
		"This will clear the current session history and start a fresh Copilot chat session.";
	content.appendChild(warning);

	// Button row
	var btnRow = document.createElement("div");
	btnRow.className = "new-session-btn-row";
	var cancelBtn = document.createElement("button");
	cancelBtn.className = "form-btn form-btn-cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", closeNewSessionModal);
	btnRow.appendChild(cancelBtn);

	var confirmBtn = document.createElement("button");
	confirmBtn.className = "form-btn form-btn-save";
	confirmBtn.textContent = "New Session";
	confirmBtn.addEventListener("click", function () {
		closeNewSessionModal();
		vscode.postMessage({ type: "newSession" });
	});
	btnRow.appendChild(confirmBtn);
	content.appendChild(btnRow);

	modal.appendChild(header);
	modal.appendChild(content);
	newSessionModalOverlay.appendChild(modal);
	document.body.appendChild(newSessionModalOverlay);

	// Close on overlay click
	newSessionModalOverlay.addEventListener("click", function (e) {
		if (e.target === newSessionModalOverlay) closeNewSessionModal();
	});
}

function openNewSessionModal() {
	if (!newSessionModalOverlay) return;
	newSessionModalOverlay.classList.remove("hidden");
}

function closeNewSessionModal() {
	if (!newSessionModalOverlay) return;
	newSessionModalOverlay.classList.add("hidden");
}
