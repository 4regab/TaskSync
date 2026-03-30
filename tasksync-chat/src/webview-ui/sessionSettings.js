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
