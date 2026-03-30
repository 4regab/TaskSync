// ===== SESSION SETTINGS MINI-MODAL FUNCTIONS =====

// Local state for session-level autopilot prompts (managed entirely in the modal)
var ssAutopilotPromptsLocal = [];
var ssEditingPromptIndex = -1;
var ssDraggedIndex = -1;

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

// --- Session autopilot prompts list (local) ---

function ssRenderPromptsList() {
	if (!ssAutopilotPromptsList) return;

	if (ssAutopilotPromptsLocal.length === 0) {
		ssAutopilotPromptsList.innerHTML =
			'<div class="empty-prompts-hint">No session prompts. Inherits workspace prompts.</div>';
		return;
	}

	ssAutopilotPromptsList.innerHTML = ssAutopilotPromptsLocal
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

function ssShowAddPromptForm() {
	if (!ssAddAutopilotPromptForm || !ssAutopilotPromptInput) return;
	ssEditingPromptIndex = -1;
	ssAutopilotPromptInput.value = "";
	ssAddAutopilotPromptForm.classList.remove("hidden");
	ssAddAutopilotPromptForm.removeAttribute("data-editing-index");
	ssAutopilotPromptInput.focus();
}

function ssHideAddPromptForm() {
	if (!ssAddAutopilotPromptForm || !ssAutopilotPromptInput) return;
	ssAddAutopilotPromptForm.classList.add("hidden");
	ssAutopilotPromptInput.value = "";
	ssEditingPromptIndex = -1;
	ssAddAutopilotPromptForm.removeAttribute("data-editing-index");
}

function ssSavePrompt() {
	if (!ssAutopilotPromptInput) return;
	var prompt = ssAutopilotPromptInput.value.trim();
	if (!prompt) return;

	var editingIndex = ssAddAutopilotPromptForm
		? ssAddAutopilotPromptForm.getAttribute("data-editing-index")
		: null;
	if (editingIndex !== null) {
		var idx = parseInt(editingIndex, 10);
		if (idx >= 0 && idx < ssAutopilotPromptsLocal.length) {
			ssAutopilotPromptsLocal[idx] = prompt;
		}
	} else {
		ssAutopilotPromptsLocal.push(prompt);
	}
	ssHideAddPromptForm();
	ssRenderPromptsList();
}

function ssHandlePromptsListClick(e) {
	var target = e.target.closest(".prompt-item-btn");
	if (!target) return;

	var index = parseInt(target.getAttribute("data-index"), 10);
	if (isNaN(index)) return;

	if (target.classList.contains("edit")) {
		ssEditPrompt(index);
	} else if (target.classList.contains("delete")) {
		ssDeletePrompt(index);
	}
}

function ssEditPrompt(index) {
	if (index < 0 || index >= ssAutopilotPromptsLocal.length) return;
	if (!ssAddAutopilotPromptForm || !ssAutopilotPromptInput) return;

	ssEditingPromptIndex = index;
	ssAutopilotPromptInput.value = ssAutopilotPromptsLocal[index];
	ssAddAutopilotPromptForm.setAttribute("data-editing-index", index);
	ssAddAutopilotPromptForm.classList.remove("hidden");
	ssAutopilotPromptInput.focus();
}

function ssDeletePrompt(index) {
	if (index < 0 || index >= ssAutopilotPromptsLocal.length) return;
	ssAutopilotPromptsLocal.splice(index, 1);
	ssRenderPromptsList();
}

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

function ssHandleDragStart(e) {
	var item = e.target.closest(".autopilot-prompt-item");
	if (!item) return;
	ssDraggedIndex = parseInt(item.getAttribute("data-index"), 10);
	item.classList.add("dragging");
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData("text/plain", ssDraggedIndex);
}

function ssHandleDragOver(e) {
	e.preventDefault();
	e.dataTransfer.dropEffect = "move";
	var item = e.target.closest(".autopilot-prompt-item");
	if (!item || !ssAutopilotPromptsList) return;

	ssAutopilotPromptsList
		.querySelectorAll(".autopilot-prompt-item")
		.forEach(function (el) {
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

function ssHandleDragEnd() {
	ssDraggedIndex = -1;
	if (!ssAutopilotPromptsList) return;
	ssAutopilotPromptsList
		.querySelectorAll(".autopilot-prompt-item")
		.forEach(function (el) {
			el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
		});
}

function ssHandleDrop(e) {
	e.preventDefault();
	var item = e.target.closest(".autopilot-prompt-item");
	if (!item || ssDraggedIndex < 0) return;

	var toIndex = parseInt(item.getAttribute("data-index"), 10);
	if (isNaN(toIndex) || ssDraggedIndex === toIndex) {
		ssHandleDragEnd();
		return;
	}

	var rect = item.getBoundingClientRect();
	var midY = rect.top + rect.height / 2;
	var insertBelow = e.clientY >= midY;

	var targetIndex = toIndex;
	if (insertBelow && toIndex < ssAutopilotPromptsLocal.length - 1) {
		targetIndex = toIndex + 1;
	}
	if (ssDraggedIndex < targetIndex) {
		targetIndex--;
	}

	var moved = ssAutopilotPromptsLocal.splice(ssDraggedIndex, 1)[0];
	ssAutopilotPromptsLocal.splice(targetIndex, 0, moved);
	ssHandleDragEnd();
	ssRenderPromptsList();
}
