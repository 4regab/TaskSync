// Restore persisted state (survives sidebar switch)
const previousState = vscode.getState() || {};

// Settings defaults & validation ranges — use shared constants if available (remote mode)
// Keep timeout options aligned with select values to avoid invalid UI state.
const RESPONSE_TIMEOUT_ALLOWED_VALUES =
	typeof TASKSYNC_RESPONSE_TIMEOUT_ALLOWED !== "undefined"
		? new Set(TASKSYNC_RESPONSE_TIMEOUT_ALLOWED)
		: new Set([
			0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210,
			240,
		]);
const RESPONSE_TIMEOUT_DEFAULT =
	typeof TASKSYNC_RESPONSE_TIMEOUT_DEFAULT !== "undefined"
		? TASKSYNC_RESPONSE_TIMEOUT_DEFAULT
		: 60;
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
let askUserVerbosePayloadEnabled = false;
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

// Slash command autocomplete state
let slashDropdownVisible = false;
let slashResults = [];
let selectedSlashIndex = -1;
let slashStartPos = -1;
let slashDebounceTimer = null;

// Persisted input value (restored from state)
let persistedInputValue = previousState.inputValue || "";

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
// Settings modal elements
let settingsModal, settingsModalOverlay, settingsModalClose;
let soundToggle,
	interactiveApprovalToggle,
	askUserVerbosePayloadToggle,
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
