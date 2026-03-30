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
	// Autopilot toggle
	setToggle(ssAutopilotToggle, msg.autopilotEnabled === true);

	// Autopilot prompts
	ssAutopilotPromptsLocal = Array.isArray(msg.autopilotPrompts)
		? msg.autopilotPrompts.slice()
		: [];
	ssRenderPromptsList();

	// Auto Append toggle
	setToggle(ssAutoAppendToggle, msg.autoAppendEnabled === true);

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
	setToggle(ssAlwaysAppendReminderToggle, msg.alwaysAppendReminder === true);
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
}

function ssToggleAlwaysAppendReminder() {
	if (!ssAlwaysAppendReminderToggle) return;
	setToggle(
		ssAlwaysAppendReminderToggle,
		!ssAlwaysAppendReminderToggle.classList.contains("active"),
	);
}
