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
	if (!isNaN(value)) {
		responseTimeout = value;
		vscode.postMessage({ type: "updateResponseTimeout", value: value });
	}
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

// Track which autopilot prompt is being edited (-1 = adding new, >= 0 = editing index)
let editingAutopilotPromptIndex = -1;
// Track drag state
let draggedAutopilotIndex = -1;

function renderAutopilotPromptsList() {
	if (!autopilotPromptsList) return;

	if (autopilotPrompts.length === 0) {
		autopilotPromptsList.innerHTML =
			'<div class="empty-prompts-hint">No prompts added. Add prompts to cycle through during Autopilot.</div>';
		return;
	}

	// Render list with drag handles, numbers, edit/delete buttons
	autopilotPromptsList.innerHTML = autopilotPrompts
		.map(function (prompt, index) {
			let truncated =
				prompt.length > 80 ? prompt.substring(0, 80) + "..." : prompt;
			let tooltipText =
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

function showAddAutopilotPromptForm() {
	if (!addAutopilotPromptForm || !autopilotPromptInput) return;
	editingAutopilotPromptIndex = -1;
	autopilotPromptInput.value = "";
	addAutopilotPromptForm.classList.remove("hidden");
	addAutopilotPromptForm.removeAttribute("data-editing-index");
	autopilotPromptInput.focus();
}

function hideAddAutopilotPromptForm() {
	if (!addAutopilotPromptForm || !autopilotPromptInput) return;
	addAutopilotPromptForm.classList.add("hidden");
	autopilotPromptInput.value = "";
	editingAutopilotPromptIndex = -1;
	addAutopilotPromptForm.removeAttribute("data-editing-index");
}

function saveAutopilotPrompt() {
	if (!autopilotPromptInput) return;
	let prompt = autopilotPromptInput.value.trim();
	if (!prompt) return;

	let editingIndex = addAutopilotPromptForm.getAttribute("data-editing-index");
	if (editingIndex !== null) {
		// Editing existing
		vscode.postMessage({
			type: "editAutopilotPrompt",
			index: parseInt(editingIndex, 10),
			prompt: prompt,
		});
	} else {
		// Adding new
		vscode.postMessage({ type: "addAutopilotPrompt", prompt: prompt });
	}
	hideAddAutopilotPromptForm();
}

function handleAutopilotPromptsListClick(e) {
	let target = e.target.closest(".prompt-item-btn");
	if (!target) return;

	let index = parseInt(target.getAttribute("data-index"), 10);
	if (isNaN(index)) return;

	if (target.classList.contains("edit")) {
		editAutopilotPrompt(index);
	} else if (target.classList.contains("delete")) {
		deleteAutopilotPrompt(index);
	}
}

function editAutopilotPrompt(index) {
	if (index < 0 || index >= autopilotPrompts.length) return;
	if (!addAutopilotPromptForm || !autopilotPromptInput) return;

	let prompt = autopilotPrompts[index];
	editingAutopilotPromptIndex = index;
	autopilotPromptInput.value = prompt;
	addAutopilotPromptForm.setAttribute("data-editing-index", index);
	addAutopilotPromptForm.classList.remove("hidden");
	autopilotPromptInput.focus();
}

function deleteAutopilotPrompt(index) {
	if (index < 0 || index >= autopilotPrompts.length) return;
	vscode.postMessage({ type: "removeAutopilotPrompt", index: index });
}

function handleAutopilotDragStart(e) {
	let item = e.target.closest(".autopilot-prompt-item");
	if (!item) return;
	draggedAutopilotIndex = parseInt(item.getAttribute("data-index"), 10);
	item.classList.add("dragging");
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData("text/plain", draggedAutopilotIndex);
}

function handleAutopilotDragOver(e) {
	e.preventDefault();
	e.dataTransfer.dropEffect = "move";
	let item = e.target.closest(".autopilot-prompt-item");
	if (!item || !autopilotPromptsList) return;

	// Remove all drag-over classes first
	autopilotPromptsList
		.querySelectorAll(".autopilot-prompt-item")
		.forEach(function (el) {
			el.classList.remove("drag-over-top", "drag-over-bottom");
		});

	// Determine if we're above or below center of target
	let rect = item.getBoundingClientRect();
	let midY = rect.top + rect.height / 2;
	if (e.clientY < midY) {
		item.classList.add("drag-over-top");
	} else {
		item.classList.add("drag-over-bottom");
	}
}

function handleAutopilotDragEnd(e) {
	draggedAutopilotIndex = -1;
	if (!autopilotPromptsList) return;
	autopilotPromptsList
		.querySelectorAll(".autopilot-prompt-item")
		.forEach(function (el) {
			el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
		});
}

function handleAutopilotDrop(e) {
	e.preventDefault();
	let item = e.target.closest(".autopilot-prompt-item");
	if (!item || draggedAutopilotIndex < 0) return;

	let toIndex = parseInt(item.getAttribute("data-index"), 10);
	if (isNaN(toIndex) || draggedAutopilotIndex === toIndex) {
		handleAutopilotDragEnd(e);
		return;
	}

	// Determine insert position based on where we dropped
	let rect = item.getBoundingClientRect();
	let midY = rect.top + rect.height / 2;
	let insertBelow = e.clientY >= midY;

	// Calculate actual target index
	let targetIndex = toIndex;
	if (insertBelow && toIndex < autopilotPrompts.length - 1) {
		targetIndex = toIndex + 1;
	}

	// Adjust for removal of source
	if (draggedAutopilotIndex < targetIndex) {
		targetIndex--;
	}

	targetIndex = Math.max(0, Math.min(targetIndex, autopilotPrompts.length - 1));

	if (draggedAutopilotIndex !== targetIndex) {
		vscode.postMessage({
			type: "reorderAutopilotPrompts",
			fromIndex: draggedAutopilotIndex,
			toIndex: targetIndex,
		});
	}

	handleAutopilotDragEnd(e);
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
