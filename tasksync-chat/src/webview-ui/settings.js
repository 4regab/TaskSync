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
