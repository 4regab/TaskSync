// ===== SESSION SETTINGS MINI-MODAL FUNCTIONS =====

// Local state for session-level autopilot prompts (managed entirely in the modal)
var ssAutopilotPromptsLocal = [];
// Workspace-level default auto-append text (for dirty-check on save button)
var ssWorkspaceDefaultAutoAppendText = "";

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
	emptyHint:
		"No session prompts yet. Autopilot will use the default fallback text.",
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
		emptyHint:
			"No session prompts yet. Autopilot will use the default fallback text.",
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
	focusDialogSurface(sessionSettingsOverlay, "#ss-close-btn");
}

function closeSessionSettingsModal() {
	if (!sessionSettingsOverlay) return;
	// Auto-save on close
	saveSessionSettings();
	sessionSettingsOverlay.classList.add("hidden");
	ssHideAddPromptForm();
	restoreDialogFocus(sessionSettingsOverlay);
}

function saveSessionSettings() {
	var isAutopilotEnabled = ssAutopilotToggle
		? ssAutopilotToggle.classList.contains("active")
		: false;
	var isAutoAppendEnabled = ssAutoAppendToggle
		? ssAutoAppendToggle.classList.contains("active")
		: false;
	var autoAppendText = ssAutoAppendTextInput ? ssAutoAppendTextInput.value : "";

	vscode.postMessage({
		type: "updateSessionSettings",
		autopilotEnabled: isAutopilotEnabled,
		autopilotPrompts: ssAutopilotPromptsLocal.filter(function (p) {
			return p.trim().length > 0;
		}),
		autoAppendEnabled: isAutoAppendEnabled,
		autoAppendText: autoAppendText,
	});
}

function resetSessionSettings() {
	vscode.postMessage({ type: "resetSessionSettings" });
	// The backend will send back a sessionSettingsState with TaskSync defaults
}

function populateSessionSettings(msg) {
	// Autopilot toggle
	setToggle(ssAutopilotToggle, msg.autopilotEnabled === true);

	// Autopilot prompts
	ssAutopilotPromptsLocal = Array.isArray(msg.autopilotPrompts)
		? msg.autopilotPrompts.slice()
		: [];
	ssRenderPromptsList();

	// Auto Append toggle
	setToggle(ssAutoAppendToggle, msg.autoAppendEnabled === true);

	// Store workspace default for dirty-check
	ssWorkspaceDefaultAutoAppendText =
		typeof msg.workspaceDefaultAutoAppendText === "string"
			? msg.workspaceDefaultAutoAppendText
			: "";

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

	ssValidateAutoAppendText();
}

// --- Session toggle functions ---

function ssToggleAutopilot() {
	if (!ssAutopilotToggle) return;
	setToggle(ssAutopilotToggle, !ssAutopilotToggle.classList.contains("active"));
}

function ssToggleAutoAppend() {
	if (!ssAutoAppendToggle) return;
	var active = !ssAutoAppendToggle.classList.contains("active");
	setToggle(ssAutoAppendToggle, active);

	var ssAutoAppendTextRow = document.getElementById("ss-auto-append-text-row");
	if (ssAutoAppendTextRow) {
		ssAutoAppendTextRow.classList.toggle("hidden", !active);
	}
	ssValidateAutoAppendText();
}

/** Show/hide the error message and save-as-default button based on toggle + text state. */
function ssValidateAutoAppendText() {
	var isActive =
		ssAutoAppendToggle && ssAutoAppendToggle.classList.contains("active");
	var text = ssAutoAppendTextInput ? ssAutoAppendTextInput.value.trim() : "";
	if (ssAutoAppendError) {
		ssAutoAppendError.classList.toggle(
			"hidden",
			!(isActive && text.length === 0),
		);
	}
	if (ssSaveAsDefaultBtn) {
		// Show only when toggle ON, text is non-empty, and text differs from workspace default
		var isDirty = text !== ssWorkspaceDefaultAutoAppendText;
		ssSaveAsDefaultBtn.classList.toggle(
			"hidden",
			!(isActive && text.length > 0 && isDirty),
		);
	}
}

/** Save current auto-append settings as the workspace default for new sessions. */
function ssSaveAutoAppendAsDefault() {
	// Flush current modal state to the session first — messages are processed in order
	saveSessionSettings();
	vscode.postMessage({ type: "saveAutoAppendAsWorkspaceDefault" });
	// Update cached default so button hides (text is now the new default)
	ssWorkspaceDefaultAutoAppendText = ssAutoAppendTextInput
		? ssAutoAppendTextInput.value.trim()
		: "";
	if (ssSaveAsDefaultBtn) {
		ssSaveAsDefaultBtn.textContent = "\u2713 Saved";
		ssSaveAsDefaultBtn.disabled = true;
		setTimeout(function () {
			if (ssSaveAsDefaultBtn) {
				ssSaveAsDefaultBtn.innerHTML =
					'<span class="codicon codicon-save"></span> Save as Workspace Default';
				ssSaveAsDefaultBtn.disabled = false;
			}
		}, 2000);
	}
}
