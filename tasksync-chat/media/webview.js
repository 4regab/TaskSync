/**
 * TaskSync Extension - Webview Script
 * Handles tool call history, prompt queue, attachments, and file autocomplete
 */
(function () {
    const vscode = acquireVsCodeApi();

    // Restore persisted state (survives sidebar switch)
    const previousState = vscode.getState() || {};

    // State
    let promptQueue = [];
    let queueEnabled = true; // Default to true (Queue mode ON by default)
    let dropdownOpen = false;
    let currentAttachments = previousState.attachments || []; // Restore attachments
    let selectedCard = 'queue';
    let currentSessionCalls = []; // Current session tool calls (shown in chat)
    let persistedHistory = []; // Past sessions history (shown in modal)
    let pendingToolCall = null;
    let isProcessingResponse = false; // True when AI is processing user's response
    let isApprovalQuestion = false; // True when current pending question is an approval-type question
    let currentChoices = []; // Parsed choices from multi-choice questions

    // Settings state
    let soundEnabled = true;
    let interactiveApprovalEnabled = true;
    let sendWithCtrlEnter = false;
    let autopilotEnabled = false;
    let autopilotText = '';
    let autopilotTextDebounceTimer = null;
    let responseTimeout = 60;
    let sessionWarningHours = 2;
    let maxConsecutiveAutoResponses = 5;
    // Keep timeout options aligned with select values to avoid invalid UI state.
    var RESPONSE_TIMEOUT_ALLOWED_VALUES = new Set([0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240]);
    var RESPONSE_TIMEOUT_DEFAULT = 60;
    // Human-like delay: random jitter simulates natural reading/typing time
    let humanLikeDelayEnabled = true;
    let humanLikeDelayMin = 2;  // minimum seconds
    let humanLikeDelayMax = 6;  // maximum seconds

    // Tracks local edits to prevent stale settings overwriting user input mid-typing.
    let autopilotTextEditVersion = 0;
    let autopilotTextLastSentVersion = 0;
    let reusablePrompts = [];
    let audioUnlocked = false; // Track if audio playback has been unlocked by user gesture

    // Slash command autocomplete state
    let slashDropdownVisible = false;
    let slashResults = [];
    let selectedSlashIndex = -1;
    let slashStartPos = -1;
    let slashDebounceTimer = null;

    // Persisted input value (restored from state)
    let persistedInputValue = previousState.inputValue || '';

    // Edit mode state
    let editingPromptId = null;
    let editingOriginalPrompt = null;
    let savedInputValue = ''; // Save input value when entering edit mode

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
    let chatContainer, chipsContainer, autocompleteDropdown, autocompleteList, autocompleteEmpty;
    let inputContainer, inputAreaContainer, welcomeSection;
    let cardVibe, cardSpec, toolHistoryArea, pendingMessage;
    let historyModal, historyModalOverlay, historyModalList, historyModalClose, historyModalClearAll;
    // Edit mode elements
    let actionsLeft, actionsBar, editActionsContainer, editCancelBtn, editConfirmBtn;
    // Approval modal elements
    let approvalModal, approvalContinueBtn, approvalNoBtn;
    // Slash command elements
    let slashDropdown, slashList, slashEmpty;
    // Settings modal elements
    let settingsModal, settingsModalOverlay, settingsModalClose;
    let soundToggle, interactiveApprovalToggle, sendShortcutToggle, autopilotEditBtn, autopilotToggle, autopilotTextInput, promptsList, addPromptBtn, addPromptForm;
    let responseTimeoutSelect, sessionWarningHoursInput, maxAutoResponsesInput;
    let humanDelayToggle, humanDelayRangeContainer, humanDelayMinInput, humanDelayMaxInput;

    function init() {
        try {
            console.log('[TaskSync Webview] init() starting...');
            cacheDOMElements();
            createHistoryModal();
            createEditModeUI();
            createApprovalModal();
            createSettingsModal();
            bindEventListeners();
            unlockAudioOnInteraction(); // Enable audio after first user interaction
            console.log('[TaskSync Webview] Event listeners bound, pendingMessage element:', !!pendingMessage);
            renderQueue();
            updateModeUI();
            updateQueueVisibility();
            initCardSelection();

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
            console.log('[TaskSync Webview] Sending webviewReady message');
            vscode.postMessage({ type: 'webviewReady' });
        } catch (err) {
            console.error('[TaskSync] Init error:', err);
        }
    }

    /**
     * Save webview state to persist across sidebar visibility changes
     */
    function saveWebviewState() {
        vscode.setState({
            inputValue: chatInput ? chatInput.value : '',
            attachments: currentAttachments.filter(function (a) { return !a.isTemporary; }) // Don't persist temp images
        });
    }

    function cacheDOMElements() {
        chatInput = document.getElementById('chat-input');
        inputHighlighter = document.getElementById('input-highlighter');
        sendBtn = document.getElementById('send-btn');
        attachBtn = document.getElementById('attach-btn');
        modeBtn = document.getElementById('mode-btn');
        modeDropdown = document.getElementById('mode-dropdown');
        modeLabel = document.getElementById('mode-label');

        queueSection = document.getElementById('queue-section');
        queueHeader = document.getElementById('queue-header');
        queueList = document.getElementById('queue-list');
        queueCount = document.getElementById('queue-count');
        chatContainer = document.getElementById('chat-container');
        chipsContainer = document.getElementById('chips-container');
        autocompleteDropdown = document.getElementById('autocomplete-dropdown');
        autocompleteList = document.getElementById('autocomplete-list');
        autocompleteEmpty = document.getElementById('autocomplete-empty');
        inputContainer = document.getElementById('input-container');
        inputAreaContainer = document.getElementById('input-area-container');
        welcomeSection = document.getElementById('welcome-section');
        cardVibe = document.getElementById('card-vibe');
        cardSpec = document.getElementById('card-spec');
        autopilotToggle = document.getElementById('autopilot-toggle');
        toolHistoryArea = document.getElementById('tool-history-area');
        pendingMessage = document.getElementById('pending-message');
        // Slash command dropdown
        slashDropdown = document.getElementById('slash-dropdown');
        slashList = document.getElementById('slash-list');
        slashEmpty = document.getElementById('slash-empty');
        // Get actions bar elements for edit mode
        actionsBar = document.querySelector('.actions-bar');
        actionsLeft = document.querySelector('.actions-left');
    }

    function createHistoryModal() {
        // Create modal overlay
        historyModalOverlay = document.createElement('div');
        historyModalOverlay.className = 'history-modal-overlay hidden';
        historyModalOverlay.id = 'history-modal-overlay';

        // Create modal container
        historyModal = document.createElement('div');
        historyModal.className = 'history-modal';
        historyModal.id = 'history-modal';

        // Modal header
        var modalHeader = document.createElement('div');
        modalHeader.className = 'history-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'history-modal-title';
        titleSpan.textContent = 'History';
        modalHeader.appendChild(titleSpan);

        // Info text - left aligned after title
        var infoSpan = document.createElement('span');
        infoSpan.className = 'history-modal-info';
        infoSpan.textContent = 'History is stored in VS Code globalStorage/tool-history.json';
        modalHeader.appendChild(infoSpan);

        // Clear all button (icon only)
        historyModalClearAll = document.createElement('button');
        historyModalClearAll.className = 'history-modal-clear-btn';
        historyModalClearAll.innerHTML = '<span class="codicon codicon-trash"></span>';
        historyModalClearAll.title = 'Clear all history';
        modalHeader.appendChild(historyModalClearAll);

        // Close button
        historyModalClose = document.createElement('button');
        historyModalClose.className = 'history-modal-close-btn';
        historyModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
        historyModalClose.title = 'Close';
        modalHeader.appendChild(historyModalClose);

        // Modal body (list)
        historyModalList = document.createElement('div');
        historyModalList.className = 'history-modal-list';
        historyModalList.id = 'history-modal-list';

        // Assemble modal
        historyModal.appendChild(modalHeader);
        historyModal.appendChild(historyModalList);
        historyModalOverlay.appendChild(historyModal);

        // Add to DOM
        document.body.appendChild(historyModalOverlay);
    }

    function createEditModeUI() {
        // Create edit actions container (hidden by default)
        editActionsContainer = document.createElement('div');
        editActionsContainer.className = 'edit-actions-container hidden';
        editActionsContainer.id = 'edit-actions-container';

        // Edit mode label
        var editLabel = document.createElement('span');
        editLabel.className = 'edit-mode-label';
        editLabel.textContent = 'Editing prompt';

        // Cancel button (X)
        editCancelBtn = document.createElement('button');
        editCancelBtn.className = 'icon-btn edit-cancel-btn';
        editCancelBtn.title = 'Cancel edit (Esc)';
        editCancelBtn.setAttribute('aria-label', 'Cancel editing');
        editCancelBtn.innerHTML = '<span class="codicon codicon-close"></span>';

        // Confirm button (✓)
        editConfirmBtn = document.createElement('button');
        editConfirmBtn.className = 'icon-btn edit-confirm-btn';
        editConfirmBtn.title = 'Confirm edit (Enter)';
        editConfirmBtn.setAttribute('aria-label', 'Confirm edit');
        editConfirmBtn.innerHTML = '<span class="codicon codicon-check"></span>';

        // Assemble edit actions
        editActionsContainer.appendChild(editLabel);
        var btnGroup = document.createElement('div');
        btnGroup.className = 'edit-btn-group';
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
        approvalModal = document.createElement('div');
        approvalModal.className = 'approval-bar hidden';
        approvalModal.id = 'approval-bar';
        approvalModal.setAttribute('role', 'toolbar');
        approvalModal.setAttribute('aria-label', 'Quick approval options');

        // Left side label
        var labelSpan = document.createElement('span');
        labelSpan.className = 'approval-label';
        labelSpan.textContent = 'Waiting on your input..';

        // Right side buttons container
        var buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'approval-buttons';

        // No/Reject button (secondary action - text only)
        approvalNoBtn = document.createElement('button');
        approvalNoBtn.className = 'approval-btn approval-reject-btn';
        approvalNoBtn.setAttribute('aria-label', 'Reject and provide custom response');
        approvalNoBtn.textContent = 'No';

        // Continue/Accept button (primary action)
        approvalContinueBtn = document.createElement('button');
        approvalContinueBtn.className = 'approval-btn approval-accept-btn';
        approvalContinueBtn.setAttribute('aria-label', 'Yes and continue');
        approvalContinueBtn.textContent = 'Yes';

        // Assemble buttons
        buttonsContainer.appendChild(approvalNoBtn);
        buttonsContainer.appendChild(approvalContinueBtn);

        // Assemble bar
        approvalModal.appendChild(labelSpan);
        approvalModal.appendChild(buttonsContainer);

        // Insert at top of input-wrapper (inside the border)
        var inputWrapper = document.getElementById('input-wrapper');
        if (inputWrapper) {
            inputWrapper.insertBefore(approvalModal, inputWrapper.firstChild);
        }
    }

    function createSettingsModal() {
        // Create modal overlay
        settingsModalOverlay = document.createElement('div');
        settingsModalOverlay.className = 'settings-modal-overlay hidden';
        settingsModalOverlay.id = 'settings-modal-overlay';

        // Create modal container
        settingsModal = document.createElement('div');
        settingsModal.className = 'settings-modal';
        settingsModal.id = 'settings-modal';
        settingsModal.setAttribute('role', 'dialog');
        settingsModal.setAttribute('aria-labelledby', 'settings-modal-title');

        // Modal header
        var modalHeader = document.createElement('div');
        modalHeader.className = 'settings-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'settings-modal-title';
        titleSpan.id = 'settings-modal-title';
        titleSpan.textContent = 'Settings';
        modalHeader.appendChild(titleSpan);

        // Header buttons container
        var headerButtons = document.createElement('div');
        headerButtons.className = 'settings-modal-header-buttons';

        // Report Issue button
        var reportBtn = document.createElement('button');
        reportBtn.className = 'settings-modal-header-btn';
        reportBtn.innerHTML = '<span class="codicon codicon-report"></span>';
        reportBtn.title = 'Report Issue';
        reportBtn.setAttribute('aria-label', 'Report an issue on GitHub');
        reportBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'openExternal', url: 'https://github.com/4regab/TaskSync/issues/new' });
        });
        headerButtons.appendChild(reportBtn);

        // Close button
        settingsModalClose = document.createElement('button');
        settingsModalClose.className = 'settings-modal-header-btn';
        settingsModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
        settingsModalClose.title = 'Close';
        settingsModalClose.setAttribute('aria-label', 'Close settings');
        headerButtons.appendChild(settingsModalClose);

        modalHeader.appendChild(headerButtons);

        // Modal content
        var modalContent = document.createElement('div');
        modalContent.className = 'settings-modal-content';

        // Sound section - simplified, toggle right next to header
        var soundSection = document.createElement('div');
        soundSection.className = 'settings-section';
        soundSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-unmute"></span> Notifications</div>' +
            '<div class="toggle-switch active" id="sound-toggle" role="switch" aria-checked="true" aria-label="Enable notification sound" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(soundSection);

        // Interactive approval section - toggle interactive Yes/No + choices UI
        var approvalSection = document.createElement('div');
        approvalSection.className = 'settings-section';
        approvalSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-checklist"></span> Interactive Approvals</div>' +
            '<div class="toggle-switch active" id="interactive-approval-toggle" role="switch" aria-checked="true" aria-label="Enable interactive approval and choice buttons" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(approvalSection);

        // Send shortcut section - switch between Enter and Ctrl/Cmd+Enter send
        var sendShortcutSection = document.createElement('div');
        sendShortcutSection.className = 'settings-section';
        sendShortcutSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-keyboard"></span> Ctrl/Cmd+Enter to Send</div>' +
            '<div class="toggle-switch" id="send-shortcut-toggle" role="switch" aria-checked="false" aria-label="Use Ctrl/Cmd+Enter to send messages" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(sendShortcutSection);

        // Autopilot section
        var autopilotSection = document.createElement('div');
        autopilotSection.className = 'settings-section';
        autopilotSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-rocket"></span> Autopilot Prompt' +
            '<span class="settings-info-icon" title="When enabled, the AI automatically receives your configured text as a response instead of waiting for manual input.\n\nHow it works:\n• The agent calls ask_user → Autopilot instantly replies with your text\n• The agent continues working without waiting for you\n• Disable Autopilot at any time to regain manual control\n\nQueue Priority:\n• Queued prompts are ALWAYS sent first before Autopilot triggers\n• Autopilot only activates when the queue is empty\n• This lets you steer the agent with queued instructions while Autopilot handles routine questions" > ' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<button class="add-prompt-btn-inline" id="autopilot-edit-btn" title="Edit Autopilot prompt" aria-label="Edit Autopilot prompt"><span class="codicon codicon-edit"></span></button>' +
            '</div>' +
            '<div class="form-row hidden">' +
            '<textarea class="form-input form-textarea" id="autopilot-text" placeholder="Enter Autopilot response text..." maxlength="2000"></textarea>' +
            '</div>';
        modalContent.appendChild(autopilotSection);

        // Response Timeout section - dropdown for 10-120 minutes
        var timeoutSection = document.createElement('div');
        timeoutSection.className = 'settings-section';
        timeoutSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-clock"></span> Response Timeout' +
            '<span class="settings-info-icon" title="If no response is received within this time, it will automatically send the session termination message.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<select class="form-input form-select" id="response-timeout-select">' +
            '<option value="0">Disabled</option>' +
            '<option value="5">5 minutes</option>' +
            '<option value="10">10 minutes</option>' +
            '<option value="20">20 minutes</option>' +
            '<option value="30">30 minutes</option>' +
            '<option value="40">40 minutes</option>' +
            '<option value="50">50 minutes</option>' +
            '<option value="60">60 minutes (default)</option>' +
            '<option value="70">70 minutes</option>' +
            '<option value="80">80 minutes</option>' +
            '<option value="90">90 minutes</option>' +
            '<option value="100">100 minutes</option>' +
            '<option value="110">110 minutes</option>' +
            '<option value="120">120 minutes (2h)</option>' +
            '<option value="150">150 minutes (2.5h)</option>' +
            '<option value="180">180 minutes (3h)</option>' +
            '<option value="210">210 minutes (3.5h)</option>' +
            '<option value="240">240 minutes (4h)</option>' +
            '</select>' +
            '</div>';
        modalContent.appendChild(timeoutSection);

        // Session Warning section - warning threshold in hours
        var sessionWarningSection = document.createElement('div');
        sessionWarningSection.className = 'settings-section';
        sessionWarningSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-watch"></span> Session Warning (hours)' +
            '<span class="settings-info-icon" title="Show a one-time warning after this many hours in the same session. Set to 0 to disable.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<input type="number" class="form-input" id="session-warning-hours-input" min="0" max="8" value="2" />' +
            '</div>';
        modalContent.appendChild(sessionWarningSection);

        // Max Consecutive Auto-Responses section - number input
        var maxAutoSection = document.createElement('div');
        maxAutoSection.className = 'settings-section';
        maxAutoSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-stop-circle"></span> Max Auto-Responses' +
            '<span class="settings-info-icon" title="Maximum consecutive auto-responses using Autopilot before pausing and requiring manual input. Prevents infinite loops.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<input type="number" class="form-input" id="max-auto-responses-input" min="1" max="50" value="5" />' +
            '</div>';
        modalContent.appendChild(maxAutoSection);

        // Human-Like Delay section - toggle + min/max inputs
        var humanDelaySection = document.createElement('div');
        humanDelaySection.className = 'settings-section';
        humanDelaySection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-pulse"></span> Human-Like Delay' +
            '<span class="settings-info-icon" title="Add random delays (2-6s by default) before auto-responses. Simulates natural pacing for automated responses.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch active" id="human-delay-toggle" role="switch" aria-checked="true" aria-label="Toggle Human-Like Delay" tabindex="0"></div>' +
            '</div>' +
            '<div class="form-row human-delay-range" id="human-delay-range">' +
            '<label class="form-label-inline">Min (s):</label>' +
            '<input type="number" class="form-input form-input-small" id="human-delay-min-input" min="1" max="30" value="2" />' +
            '<label class="form-label-inline">Max (s):</label>' +
            '<input type="number" class="form-input form-input-small" id="human-delay-max-input" min="2" max="60" value="6" />' +
            '</div>';
        modalContent.appendChild(humanDelaySection);

        // Reusable Prompts section - plus button next to title
        var promptsSection = document.createElement('div');
        promptsSection.className = 'settings-section';
        promptsSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-symbol-keyword"></span> Reusable Prompts</div>' +
            '<button class="add-prompt-btn-inline" id="add-prompt-btn" title="Add Prompt" aria-label="Add reusable prompt"><span class="codicon codicon-add"></span></button>' +
            '</div>' +
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
        soundToggle = document.getElementById('sound-toggle');
        interactiveApprovalToggle = document.getElementById('interactive-approval-toggle');
        sendShortcutToggle = document.getElementById('send-shortcut-toggle');
        autopilotEditBtn = document.getElementById('autopilot-edit-btn');
        autopilotTextInput = document.getElementById('autopilot-text');
        responseTimeoutSelect = document.getElementById('response-timeout-select');
        sessionWarningHoursInput = document.getElementById('session-warning-hours-input');
        maxAutoResponsesInput = document.getElementById('max-auto-responses-input');
        humanDelayToggle = document.getElementById('human-delay-toggle');
        humanDelayRangeContainer = document.getElementById('human-delay-range');
        humanDelayMinInput = document.getElementById('human-delay-min-input');
        humanDelayMaxInput = document.getElementById('human-delay-max-input');
        promptsList = document.getElementById('prompts-list');
        addPromptBtn = document.getElementById('add-prompt-btn');
        addPromptForm = document.getElementById('add-prompt-form');
    }

    function bindEventListeners() {
        if (chatInput) {
            chatInput.addEventListener('input', handleTextareaInput);
            chatInput.addEventListener('keydown', handleTextareaKeydown);
            chatInput.addEventListener('paste', handlePaste);
            // Sync scroll between textarea and highlighter
            chatInput.addEventListener('scroll', function () {
                if (inputHighlighter) {
                    inputHighlighter.scrollTop = chatInput.scrollTop;
                }
            });
        }
        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (attachBtn) attachBtn.addEventListener('click', handleAttach);
        if (modeBtn) modeBtn.addEventListener('click', toggleModeDropdown);

        document.querySelectorAll('.mode-option[data-mode]').forEach(function (option) {
            option.addEventListener('click', function () {
                setMode(option.getAttribute('data-mode'), true);
                closeModeDropdown();
            });
        });

        document.addEventListener('click', function (e) {
            var markdownLink = e.target && e.target.closest ? e.target.closest('a.markdown-link[data-link-target]') : null;
            if (markdownLink) {
                e.preventDefault();
                var markdownLinksApi = window.TaskSyncMarkdownLinks;
                var encodedTarget = markdownLink.getAttribute('data-link-target');
                if (encodedTarget && markdownLinksApi && typeof markdownLinksApi.toWebviewMessage === 'function') {
                    var linkMessage = markdownLinksApi.toWebviewMessage(encodedTarget);
                    if (linkMessage) {
                        vscode.postMessage(linkMessage);
                    }
                }
                return;
            }

            if (dropdownOpen && !e.target.closest('.mode-selector') && !e.target.closest('.mode-dropdown')) closeModeDropdown();
            if (autocompleteVisible && !e.target.closest('.autocomplete-dropdown') && !e.target.closest('#chat-input')) hideAutocomplete();
            if (slashDropdownVisible && !e.target.closest('.slash-dropdown') && !e.target.closest('#chat-input')) hideSlashDropdown();
        });

        if (queueHeader) queueHeader.addEventListener('click', handleQueueHeaderClick);
        if (historyModalClose) historyModalClose.addEventListener('click', closeHistoryModal);
        if (historyModalClearAll) historyModalClearAll.addEventListener('click', clearAllPersistedHistory);
        if (historyModalOverlay) {
            historyModalOverlay.addEventListener('click', function (e) {
                if (e.target === historyModalOverlay) closeHistoryModal();
            });
        }
        // Edit mode button events
        if (editCancelBtn) editCancelBtn.addEventListener('click', cancelEditMode);
        if (editConfirmBtn) editConfirmBtn.addEventListener('click', confirmEditMode);

        // Approval modal button events
        if (approvalContinueBtn) approvalContinueBtn.addEventListener('click', handleApprovalContinue);
        if (approvalNoBtn) approvalNoBtn.addEventListener('click', handleApprovalNo);

        // Settings modal events
        if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);
        if (settingsModalOverlay) {
            settingsModalOverlay.addEventListener('click', function (e) {
                if (e.target === settingsModalOverlay) closeSettingsModal();
            });
        }
        if (soundToggle) {
            soundToggle.addEventListener('click', toggleSoundSetting);
            soundToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSoundSetting();
                }
            });
        }
        if (interactiveApprovalToggle) {
            interactiveApprovalToggle.addEventListener('click', toggleInteractiveApprovalSetting);
            interactiveApprovalToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleInteractiveApprovalSetting();
                }
            });
        }
        if (sendShortcutToggle) {
            sendShortcutToggle.addEventListener('click', toggleSendWithCtrlEnterSetting);
            sendShortcutToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSendWithCtrlEnterSetting();
                }
            });
        }
        if (autopilotEditBtn) {
            autopilotEditBtn.addEventListener('click', toggleAutopilotTextEdit);
        }
        if (autopilotToggle) {
            autopilotToggle.addEventListener('click', toggleAutopilotSetting);
            autopilotToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleAutopilotSetting();
                }
            });
        }
        if (autopilotTextInput) {
            autopilotTextInput.addEventListener('input', handleAutopilotTextInput);
            autopilotTextInput.addEventListener('blur', flushAutopilotTextUpdate);
        }
        if (responseTimeoutSelect) {
            responseTimeoutSelect.addEventListener('change', handleResponseTimeoutChange);
        }
        if (sessionWarningHoursInput) {
            sessionWarningHoursInput.addEventListener('change', handleSessionWarningHoursChange);
            sessionWarningHoursInput.addEventListener('blur', handleSessionWarningHoursChange);
        }
        if (maxAutoResponsesInput) {
            maxAutoResponsesInput.addEventListener('change', handleMaxAutoResponsesChange);
            maxAutoResponsesInput.addEventListener('blur', handleMaxAutoResponsesChange);
        }
        if (humanDelayToggle) {
            humanDelayToggle.addEventListener('click', toggleHumanDelaySetting);
            humanDelayToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHumanDelaySetting();
                }
            });
        }
        if (humanDelayMinInput) {
            humanDelayMinInput.addEventListener('change', handleHumanDelayMinChange);
            humanDelayMinInput.addEventListener('blur', handleHumanDelayMinChange);
        }
        if (humanDelayMaxInput) {
            humanDelayMaxInput.addEventListener('change', handleHumanDelayMaxChange);
            humanDelayMaxInput.addEventListener('blur', handleHumanDelayMaxChange);
        }
        if (addPromptBtn) addPromptBtn.addEventListener('click', showAddPromptForm);
        // Add prompt form events (deferred - bind after modal created)
        var cancelPromptBtn = document.getElementById('cancel-prompt-btn');
        var savePromptBtn = document.getElementById('save-prompt-btn');
        if (cancelPromptBtn) cancelPromptBtn.addEventListener('click', hideAddPromptForm);
        if (savePromptBtn) savePromptBtn.addEventListener('click', saveNewPrompt);

        window.addEventListener('message', handleExtensionMessage);
    }

    function openHistoryModal() {
        if (!historyModalOverlay) return;
        // Request persisted history from extension
        vscode.postMessage({ type: 'openHistoryModal' });
        historyModalOverlay.classList.remove('hidden');
    }

    function closeHistoryModal() {
        if (!historyModalOverlay) return;
        historyModalOverlay.classList.add('hidden');
    }

    function clearAllPersistedHistory() {
        if (persistedHistory.length === 0) return;
        vscode.postMessage({ type: 'clearPersistedHistory' });
        persistedHistory = [];
        renderHistoryModal();
    }

    function initCardSelection() {
        if (cardVibe) {
            cardVibe.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                selectCard('normal', true);
            });
        }
        if (cardSpec) {
            cardSpec.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                selectCard('queue', true);
            });
        }
        // Don't set default here - wait for updateQueue message from extension
        // which contains the persisted enabled state
        updateCardSelection();
    }

    function selectCard(card, notify) {
        selectedCard = card;
        queueEnabled = card === 'queue';
        updateCardSelection();
        updateModeUI();
        updateQueueVisibility();

        // Only notify extension if user clicked (not on init from persisted state)
        if (notify) {
            vscode.postMessage({ type: 'toggleQueue', enabled: queueEnabled });
        }
    }

    function updateCardSelection() {
        // card-vibe = Normal mode, card-spec = Queue mode
        if (cardVibe) cardVibe.classList.toggle('selected', !queueEnabled);
        if (cardSpec) cardSpec.classList.toggle('selected', queueEnabled);
    }

    function autoResizeTextarea() {
        if (!chatInput) return;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    }

    /**
     * Update the input highlighter overlay to show syntax highlighting
     * for slash commands (/command) and file references (#file)
     */
    function updateInputHighlighter() {
        if (!inputHighlighter || !chatInput) return;

        var text = chatInput.value;
        if (!text) {
            inputHighlighter.innerHTML = '';
            return;
        }

        // Build a list of known slash command names for exact matching
        var knownSlashNames = reusablePrompts.map(function (p) { return p.name; });
        // Also add any pending stored mappings
        var mappings = chatInput._slashPrompts || {};
        Object.keys(mappings).forEach(function (name) {
            if (knownSlashNames.indexOf(name) === -1) knownSlashNames.push(name);
        });

        // Escape HTML first
        var html = escapeHtml(text);

        // Highlight slash commands - match /word patterns
        // Only highlight if it's a known command OR any /word pattern
        html = html.replace(/(^|\s)(\/[a-zA-Z0-9_-]+)(\s|$)/g, function (match, before, slash, after) {
            var cmdName = slash.substring(1); // Remove the /
            // Highlight if it's a known command or if we have prompts defined
            if (knownSlashNames.length === 0 || knownSlashNames.indexOf(cmdName) >= 0) {
                return before + '<span class="slash-highlight">' + slash + '</span>' + after;
            }
            // Still highlight as generic slash command
            return before + '<span class="slash-highlight">' + slash + '</span>' + after;
        });

        // Highlight file references - match #word patterns
        html = html.replace(/(^|\s)(#[a-zA-Z0-9_.\/-]+)(\s|$)/g, function (match, before, hash, after) {
            return before + '<span class="hash-highlight">' + hash + '</span>' + after;
        });

        // Don't add trailing space - causes visual artifacts
        // html += '&nbsp;';

        inputHighlighter.innerHTML = html;

        // Sync scroll position
        inputHighlighter.scrollTop = chatInput.scrollTop;
    }

    function handleTextareaInput() {
        autoResizeTextarea();
        updateInputHighlighter();
        handleAutocomplete();
        handleSlashCommands();
        // Context items (#terminal, #problems) now handled via handleAutocomplete()
        syncAttachmentsWithText();
        updateSendButtonState();
        // Persist input value so it survives sidebar tab switches
        saveWebviewState();
    }

    function updateSendButtonState() {
        if (!sendBtn || !chatInput) return;
        var hasText = chatInput.value.trim().length > 0;
        sendBtn.classList.toggle('has-text', hasText);
    }

    function handleTextareaKeydown(e) {
        // Handle approval modal keyboard shortcuts when visible
        if (isApprovalQuestion && approvalModal && !approvalModal.classList.contains('hidden')) {
            // Enter sends "Continue" when approval modal is visible and input is empty
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                var inputText = chatInput ? chatInput.value.trim() : '';
                if (!inputText) {
                    e.preventDefault();
                    handleApprovalContinue();
                    return;
                }
                // If there's text, fall through to normal send behavior
            }
            // Escape dismisses approval modal
            if (e.key === 'Escape') {
                e.preventDefault();
                handleApprovalNo();
                return;
            }
        }

        // Handle edit mode keyboard shortcuts
        if (editingPromptId) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelEditMode();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                confirmEditMode();
                return;
            }
            // Allow other keys in edit mode
            return;
        }

        // Handle slash command dropdown navigation
        if (slashDropdownVisible) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedSlashIndex < slashResults.length - 1) { selectedSlashIndex++; updateSlashSelection(); } return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedSlashIndex > 0) { selectedSlashIndex--; updateSlashSelection(); } return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && selectedSlashIndex >= 0) { e.preventDefault(); selectSlashItem(selectedSlashIndex); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideSlashDropdown(); return; }
        }

        if (autocompleteVisible) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedAutocompleteIndex < autocompleteResults.length - 1) { selectedAutocompleteIndex++; updateAutocompleteSelection(); } return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedAutocompleteIndex > 0) { selectedAutocompleteIndex--; updateAutocompleteSelection(); } return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && selectedAutocompleteIndex >= 0) { e.preventDefault(); selectAutocompleteItem(selectedAutocompleteIndex); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
        }

        // Context dropdown navigation removed - context now uses # via file autocomplete

        var isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey;
        var isCtrlOrCmdEnter = e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey);

        if (!sendWithCtrlEnter && isPlainEnter) {
            e.preventDefault();
            handleSend();
            return;
        }

        if (sendWithCtrlEnter && isCtrlOrCmdEnter) {
            e.preventDefault();
            handleSend();
            return;
        }

    }

    /**
     * Handle send action triggered by VS Code command/keybinding.
     * Mirrors Enter behavior while avoiding sends when input is not focused.
     */
    function handleSendFromShortcut() {
        if (!chatInput || document.activeElement !== chatInput) {
            return;
        }

        if (isApprovalQuestion && approvalModal && !approvalModal.classList.contains('hidden')) {
            var inputText = chatInput.value.trim();
            if (!inputText) {
                handleApprovalContinue();
                return;
            }
        }

        if (editingPromptId) {
            confirmEditMode();
            return;
        }

        if (slashDropdownVisible && selectedSlashIndex >= 0) {
            selectSlashItem(selectedSlashIndex);
            return;
        }

        if (autocompleteVisible && selectedAutocompleteIndex >= 0) {
            selectAutocompleteItem(selectedAutocompleteIndex);
            return;
        }

        handleSend();
    }

    function handleSend() {
        var text = chatInput ? chatInput.value.trim() : '';
        if (!text && currentAttachments.length === 0) return;

        // Expand slash commands to full prompt text
        text = expandSlashCommands(text);

        // Hide approval modal when sending any response
        hideApprovalModal();

        // If processing response (AI working), auto-queue the message
        if (isProcessingResponse && text) {
            addToQueue(text);
            // This reduces friction - user's prompt is in queue, so show them queue mode
            if (!queueEnabled) {
                queueEnabled = true;
                updateModeUI();
                updateQueueVisibility();
                updateCardSelection();
                vscode.postMessage({ type: 'toggleQueue', enabled: true });
            }
            if (chatInput) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                updateInputHighlighter();
            }
            currentAttachments = [];
            updateChipsDisplay();
            updateSendButtonState();
            // Clear persisted state after sending
            saveWebviewState();
            return;
        }

        if (queueEnabled && text && !pendingToolCall) {
            addToQueue(text);
        } else {
            vscode.postMessage({ type: 'submit', value: text, attachments: currentAttachments });
        }

        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        // Clear persisted state after sending
        saveWebviewState();
    }

    function handleAttach() { vscode.postMessage({ type: 'addAttachment' }); }

    function toggleModeDropdown(e) {
        e.stopPropagation();
        if (dropdownOpen) closeModeDropdown();
        else {
            dropdownOpen = true;
            positionModeDropdown();
            modeDropdown.classList.remove('hidden');
            modeDropdown.classList.add('visible');
        }
    }

    function positionModeDropdown() {
        if (!modeDropdown || !modeBtn) return;
        var rect = modeBtn.getBoundingClientRect();
        modeDropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        modeDropdown.style.left = rect.left + 'px';
    }

    function closeModeDropdown() {
        dropdownOpen = false;
        if (modeDropdown) {
            modeDropdown.classList.remove('visible');
            modeDropdown.classList.add('hidden');
        }
    }

    function setMode(mode, notify) {
        queueEnabled = mode === 'queue';
        updateModeUI();
        updateQueueVisibility();
        updateCardSelection();
        if (notify) vscode.postMessage({ type: 'toggleQueue', enabled: queueEnabled });
    }

    function updateModeUI() {
        if (modeLabel) modeLabel.textContent = queueEnabled ? 'Queue' : 'Normal';
        document.querySelectorAll('.mode-option[data-mode]').forEach(function (opt) {
            opt.classList.toggle('selected', opt.getAttribute('data-mode') === (queueEnabled ? 'queue' : 'normal'));
        });
    }

    function updateQueueVisibility() {
        if (!queueSection) return;
        // Hide queue section if: not in queue mode OR queue is empty
        var shouldHide = !queueEnabled || promptQueue.length === 0;
        var wasHidden = queueSection.classList.contains('hidden');
        queueSection.classList.toggle('hidden', shouldHide);
        // Only collapse when showing for the FIRST time (was hidden, now visible)
        // Don't collapse on subsequent updates to preserve user's expanded state
        if (wasHidden && !shouldHide && promptQueue.length > 0) {
            queueSection.classList.add('collapsed');
        }
    }

    function handleQueueHeaderClick() {
        if (queueSection) queueSection.classList.toggle('collapsed');
    }

    function normalizeResponseTimeout(value) {
        if (!Number.isFinite(value)) {
            return RESPONSE_TIMEOUT_DEFAULT;
        }
        if (!RESPONSE_TIMEOUT_ALLOWED_VALUES.has(value)) {
            return RESPONSE_TIMEOUT_DEFAULT;
        }
        return value;
    }

    function handleExtensionMessage(event) {
        var message = event.data;
        console.log('[TaskSync Webview] Received message:', message.type, message);
        switch (message.type) {
            case 'updateQueue':
                promptQueue = message.queue || [];
                queueEnabled = message.enabled !== false;
                renderQueue();
                updateModeUI();
                updateQueueVisibility();
                updateCardSelection();
                // Hide welcome section if we have current session calls
                updateWelcomeSectionVisibility();
                break;
            case 'toolCallPending':
                console.log('[TaskSync Webview] toolCallPending - showing question:', message.prompt?.substring(0, 50));
                showPendingToolCall(message.id, message.prompt, message.isApprovalQuestion, message.choices);
                break;
            case 'toolCallCompleted':
                addToolCallToCurrentSession(message.entry, message.sessionTerminated);
                break;
            case 'updateCurrentSession':
                currentSessionCalls = message.history || [];
                renderCurrentSession();
                // Hide welcome section if we have completed tool calls
                updateWelcomeSectionVisibility();
                // Auto-scroll to bottom after rendering
                scrollToBottom();
                break;
            case 'updatePersistedHistory':
                persistedHistory = message.history || [];
                renderHistoryModal();
                break;
            case 'openHistoryModal':
                openHistoryModal();
                break;
            case 'openSettingsModal':
                openSettingsModal();
                break;
            case 'updateSettings':
                soundEnabled = message.soundEnabled !== false;
                interactiveApprovalEnabled = message.interactiveApprovalEnabled !== false;
                sendWithCtrlEnter = message.sendWithCtrlEnter === true;
                autopilotEnabled = message.autopilotEnabled === true;
                autopilotText = typeof message.autopilotText === 'string' ? message.autopilotText : '';
                reusablePrompts = message.reusablePrompts || [];
                responseTimeout = normalizeResponseTimeout(message.responseTimeout);
                sessionWarningHours = typeof message.sessionWarningHours === 'number' ? message.sessionWarningHours : 2;
                maxConsecutiveAutoResponses = typeof message.maxConsecutiveAutoResponses === 'number' ? message.maxConsecutiveAutoResponses : 5;
                humanLikeDelayEnabled = message.humanLikeDelayEnabled !== false;
                humanLikeDelayMin = typeof message.humanLikeDelayMin === 'number' ? message.humanLikeDelayMin : 2;
                humanLikeDelayMax = typeof message.humanLikeDelayMax === 'number' ? message.humanLikeDelayMax : 6;
                updateSoundToggleUI();
                updateInteractiveApprovalToggleUI();
                updateSendWithCtrlEnterToggleUI();
                updateAutopilotToggleUI();
                updateAutopilotTextUI();
                updateResponseTimeoutUI();
                updateSessionWarningHoursUI();
                updateMaxAutoResponsesUI();
                updateHumanDelayUI();
                renderPromptsList();
                break;
            case 'slashCommandResults':
                showSlashDropdown(message.prompts || []);
                break;
            case 'playNotificationSound':
                playNotificationSound();
                break;
            case 'fileSearchResults':
                showAutocomplete(message.files || []);
                break;
            case 'updateAttachments':
                currentAttachments = message.attachments || [];
                updateChipsDisplay();
                break;
            case 'imageSaved':
                if (message.attachment && !currentAttachments.some(function (a) { return a.id === message.attachment.id; })) {
                    currentAttachments.push(message.attachment);
                    updateChipsDisplay();
                }
                break;
            case 'clear':
                promptQueue = [];
                currentSessionCalls = [];
                pendingToolCall = null;
                isProcessingResponse = false;
                renderQueue();
                renderCurrentSession();
                if (pendingMessage) {
                    pendingMessage.classList.add('hidden');
                    pendingMessage.innerHTML = '';
                }
                updateWelcomeSectionVisibility();
                break;
            case 'updateSessionTimer':
                // Timer is displayed in the view title bar by the extension host
                // No webview UI to update
                break;
            case 'triggerSendFromShortcut':
                handleSendFromShortcut();
                break;
        }
    }

    function showPendingToolCall(id, prompt, isApproval, choices) {
        console.log('[TaskSync Webview] showPendingToolCall called with id:', id);
        pendingToolCall = { id: id, prompt: prompt };
        isProcessingResponse = false; // AI is now asking, not processing
        isApprovalQuestion = isApproval === true;
        currentChoices = choices || [];

        if (welcomeSection) {
            welcomeSection.classList.add('hidden');
        }

        // Add pending class to disable session switching UI
        document.body.classList.add('has-pending-toolcall');

        // Show AI question as plain text (hide "Working...." since AI asked a question)
        if (pendingMessage) {
            console.log('[TaskSync Webview] Setting pendingMessage innerHTML...');
            pendingMessage.classList.remove('hidden');
            pendingMessage.innerHTML = '<div class="pending-ai-question">' + formatMarkdown(prompt) + '</div>';
            console.log('[TaskSync Webview] pendingMessage.innerHTML set, length:', pendingMessage.innerHTML.length);
        } else {
            console.error('[TaskSync Webview] pendingMessage element is null!');
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

    function addToolCallToCurrentSession(entry, sessionTerminated) {
        pendingToolCall = null;

        // Remove pending class to re-enable session switching UI
        document.body.classList.remove('has-pending-toolcall');

        // Hide approval modal and choices bar when tool call completes
        hideApprovalModal();
        hideChoicesBar();

        // Update or add entry to current session
        var idx = currentSessionCalls.findIndex(function (tc) { return tc.id === entry.id; });
        if (idx >= 0) {
            currentSessionCalls[idx] = entry;
        } else {
            currentSessionCalls.unshift(entry);
        }
        renderCurrentSession();

        // Show working indicator after user responds (AI is now processing the response)
        isProcessingResponse = true;
        if (pendingMessage) {
            pendingMessage.classList.remove('hidden');
            // Check if the extension host signaled session termination
            if (sessionTerminated) {
                isProcessingResponse = false;
                pendingMessage.innerHTML = '<div class="new-session-prompt">' +
                    '<span>Session terminated</span>' +
                    '<button class="new-session-btn" id="new-session-btn">' +
                    '<span class="codicon codicon-add"></span> Start new session' +
                    '</button></div>';
                var newSessionBtn = document.getElementById('new-session-btn');
                if (newSessionBtn) {
                    newSessionBtn.addEventListener('click', function () {
                        vscode.postMessage({ type: 'newSession' });
                    });
                }
            } else {
                pendingMessage.innerHTML = '<div class="working-indicator">Processing your response</div>';
            }
        }

        // Auto-scroll to show the working indicator
        scrollToBottom();
    }

    function renderCurrentSession() {
        if (!toolHistoryArea) return;

        // Only show COMPLETED calls from current session (pending is shown separately as plain text)
        var completedCalls = currentSessionCalls.filter(function (tc) { return tc.status === 'completed'; });

        if (completedCalls.length === 0) {
            toolHistoryArea.innerHTML = '';
            return;
        }

        // Reverse to show oldest first (new items stack at bottom)
        var sortedCalls = completedCalls.slice().reverse();

        var cardsHtml = sortedCalls.map(function (tc, index) {
            // Get first sentence for title - let CSS handle truncation with ellipsis
            var firstSentence = tc.prompt.split(/[.!?]/)[0];
            var truncatedTitle = firstSentence.length > 120 ? firstSentence.substring(0, 120) + '...' : firstSentence;
            var queueBadge = tc.isFromQueue ? '<span class="tool-call-badge queue">Queue</span>' : '';

            // Build card HTML - NO X button for current session cards
            var isLatest = index === sortedCalls.length - 1;
            var cardHtml = '<div class="tool-call-card' + (isLatest ? ' expanded' : '') + '" data-id="' + escapeHtml(tc.id) + '">' +
                '<div class="tool-call-header">' +
                '<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
                '<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
                '<div class="tool-call-header-wrapper">' +
                '<span class="tool-call-title">' + escapeHtml(truncatedTitle) + queueBadge + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="tool-call-body">' +
                '<div class="tool-call-ai-response">' + formatMarkdown(tc.prompt) + '</div>' +
                '<div class="tool-call-user-section">' +
                '<div class="tool-call-user-response">' + escapeHtml(tc.response) + '</div>' +
                (tc.attachments ? renderAttachmentsHtml(tc.attachments) : '') +
                '</div>' +
                '</div></div>';
            return cardHtml;
        }).join('');

        toolHistoryArea.innerHTML = cardsHtml;

        // Bind events - only expand/collapse, no remove
        toolHistoryArea.querySelectorAll('.tool-call-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                var card = header.closest('.tool-call-card');
                if (card) card.classList.toggle('expanded');
            });
        });

        // Render any mermaid diagrams
        renderMermaidDiagrams();
    }

    function renderHistoryModal() {
        if (!historyModalList) return;

        if (persistedHistory.length === 0) {
            historyModalList.innerHTML = '<div class="history-modal-empty">No history yet</div>';
            if (historyModalClearAll) historyModalClearAll.classList.add('hidden');
            return;
        }

        if (historyModalClearAll) historyModalClearAll.classList.remove('hidden');

        // Helper to render tool call card
        function renderToolCallCard(tc) {
            var firstSentence = tc.prompt.split(/[.!?]/)[0];
            var truncatedTitle = firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
            var queueBadge = tc.isFromQueue ? '<span class="tool-call-badge queue">Queue</span>' : '';

            return '<div class="tool-call-card history-card" data-id="' + escapeHtml(tc.id) + '">' +
                '<div class="tool-call-header">' +
                '<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
                '<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
                '<div class="tool-call-header-wrapper">' +
                '<span class="tool-call-title">' + escapeHtml(truncatedTitle) + queueBadge + '</span>' +
                '</div>' +
                '<button class="tool-call-remove" data-id="' + escapeHtml(tc.id) + '" title="Remove"><span class="codicon codicon-close"></span></button>' +
                '</div>' +
                '<div class="tool-call-body">' +
                '<div class="tool-call-ai-response">' + formatMarkdown(tc.prompt) + '</div>' +
                '<div class="tool-call-user-section">' +
                '<div class="tool-call-user-response">' + escapeHtml(tc.response) + '</div>' +
                (tc.attachments ? renderAttachmentsHtml(tc.attachments) : '') +
                '</div>' +
                '</div></div>';
        }

        // Render all history items directly without grouping
        var cardsHtml = '<div class="history-items-list">';
        cardsHtml += persistedHistory.map(renderToolCallCard).join('');
        cardsHtml += '</div>';

        historyModalList.innerHTML = cardsHtml;

        // Bind expand/collapse events
        historyModalList.querySelectorAll('.tool-call-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                if (e.target.closest('.tool-call-remove')) return;
                var card = header.closest('.tool-call-card');
                if (card) card.classList.toggle('expanded');
            });
        });

        // Bind remove buttons
        historyModalList.querySelectorAll('.tool-call-remove').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) {
                    vscode.postMessage({ type: 'removeHistoryItem', callId: id });
                    persistedHistory = persistedHistory.filter(function (tc) { return tc.id !== id; });
                    renderHistoryModal();
                }
            });
        });
    }

    // Constants for security and performance limits
    var MARKDOWN_MAX_LENGTH = 100000; // Max markdown input length to prevent ReDoS
    var MAX_TABLE_ROWS = 100; // Max table rows to process

    /**
     * Process a buffer of table lines into HTML table markup (ReDoS-safe implementation)
     * @param {string[]} lines - Array of table row strings
     * @param {number} maxRows - Maximum number of rows to process
     * @returns {string} HTML table markup or original lines joined
     */
    function processTableBuffer(lines, maxRows) {
        if (lines.length < 2) return lines.join('\n');
        if (lines.length > maxRows) return lines.join('\n'); // Skip very large tables

        // Check if second line is separator (contains only |, -, :, spaces)
        var separatorRegex = /^\|[\s\-:|]+\|$/;
        if (!separatorRegex.test(lines[1].trim())) return lines.join('\n');

        // Parse header
        var headerCells = lines[0].split('|').filter(function (c) { return c.trim() !== ''; });
        if (headerCells.length === 0) return lines.join('\n'); // Invalid table

        var headerHtml = '<tr>' + headerCells.map(function (c) {
            return '<th>' + c.trim() + '</th>';
        }).join('') + '</tr>';

        // Parse data rows (skip separator at index 1)
        var bodyHtml = '';
        for (var i = 2; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            var cells = lines[i].split('|').filter(function (c) { return c.trim() !== ''; });
            bodyHtml += '<tr>' + cells.map(function (c) {
                return '<td>' + c.trim() + '</td>';
            }).join('') + '</tr>';
        }

        return '<table class="markdown-table"><thead>' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table>';
    }

    /**
     * Converts markdown lists (ordered/unordered) with indentation-based nesting into HTML.
     * Uses 2-space indentation as one nesting level.
    * @param {string} text - Escaped markdown text (must already be HTML-escaped by caller)
     * @returns {string} Text with markdown lists converted to nested HTML lists
     */
    function convertMarkdownLists(text) {
        // Allow empty list items (e.g. "- ") to stay closer to markdown behavior.
        var listLineRegex = /^\s*(?:[-*]|\d+\.)\s.*$/;
        var lines = text.split('\n');
        var output = [];
        var listBuffer = [];

        function renderListNode(node) {
            var startAttr = (node.type === 'ol' && typeof node.start === 'number' && node.start > 1)
                ? ' start="' + node.start + '"'
                : '';
            return '<' + node.type + startAttr + '>' + node.items.map(function (item) {
                var childrenHtml = item.children.map(renderListNode).join('');
                return '<li>' + item.text + childrenHtml + '</li>';
            }).join('') + '</' + node.type + '>';
        }

        function processListBuffer(buffer) {
            var listItemRegex = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
            var rootLists = [];
            var stack = []; // [{ type, list, lastItem }]

            buffer.forEach(function (line) {
                var match = listItemRegex.exec(line);
                if (!match) return;

                var indent = match[1].replace(/\t/g, '    ').length;
                var depth = Math.floor(indent / 2);
                var marker = match[2];
                var type = (marker === '-' || marker === '*') ? 'ul' : 'ol';
                var text = match[3];

                while (stack.length > depth + 1) {
                    stack.pop();
                }

                var entry = stack[depth];
                if (!entry || entry.type !== type) {
                    var listNode = {
                        type: type,
                        items: [],
                        start: type === 'ol' ? parseInt(marker, 10) : null
                    };

                    if (depth === 0) {
                        rootLists.push(listNode);
                    } else {
                        var parentEntry = stack[depth - 1];
                        if (parentEntry && parentEntry.lastItem) {
                            parentEntry.lastItem.children.push(listNode);
                        } else {
                            // Fallback for malformed indentation without a parent item
                            rootLists.push(listNode);
                        }
                    }

                    entry = { type: type, list: listNode, lastItem: null };
                }

                // Keep one stack entry per depth for predictable parent/child handling.
                stack = stack.slice(0, depth);
                stack[depth] = entry;

                var item = { text: text, children: [] };
                entry.list.items.push(item);
                entry.lastItem = item;
                stack[depth] = entry;
            });

            return rootLists.map(renderListNode).join('');
        }

        lines.forEach(function (line) {
            if (listLineRegex.test(line)) {
                listBuffer.push(line);
                return;
            }

            if (listBuffer.length > 0) {
                output.push(processListBuffer(listBuffer));
                listBuffer = [];
            }

            output.push(line);
        });

        if (listBuffer.length > 0) {
            output.push(processListBuffer(listBuffer));
        }

        return output.join('\n');
    }

    function formatMarkdown(text) {
        if (!text) return '';

        // ReDoS prevention: truncate very long inputs before regex processing
        // This prevents exponential backtracking on crafted inputs (OWASP ReDoS mitigation)
        if (text.length > MARKDOWN_MAX_LENGTH) {
            text = text.substring(0, MARKDOWN_MAX_LENGTH) + '\n... (content truncated for display)';
        }

        // Normalize line endings (Windows \r\n to \n)
        var processedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Store code blocks BEFORE escaping HTML to preserve backticks
        var codeBlocks = [];
        var mermaidBlocks = [];
        var inlineCodeSpans = [];

        // Extract mermaid blocks first (before HTML escaping)
        // Match ```mermaid followed by newline or just content
        processedText = processedText.replace(/```mermaid\s*\n([\s\S]*?)```/g, function (match, code) {
            var index = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
            return '%%MERMAID' + index + '%%';
        });

        // Extract other code blocks (before HTML escaping)
        // Match ```lang or just ``` followed by optional newline
        processedText = processedText.replace(/```(\w*)\s*\n?([\s\S]*?)```/g, function (match, lang, code) {
            var index = codeBlocks.length;
            codeBlocks.push({ lang: lang || '', code: code.trim() });
            return '%%CODEBLOCK' + index + '%%';
        });

        // Extract inline code BEFORE escaping and inline emphasis parsing.
        // This prevents * and _ inside `code` from being interpreted as markdown emphasis.
        processedText = processedText.replace(/`([^`\n]+)`/g, function (match, code) {
            var index = inlineCodeSpans.length;
            inlineCodeSpans.push(code);
            return '%%INLINECODE' + index + '%%';
        });

        // Now escape HTML on the remaining text
        var html = escapeHtml(processedText);

        // Headers (## Header) - must be at start of line
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Horizontal rules (--- or ***)
        html = html.replace(/^---+$/gm, '<hr>');
        html = html.replace(/^\*\*\*+$/gm, '<hr>');

        // Blockquotes (> text) - simple single-line support
        html = html.replace(/^&gt;\s*(.*)$/gm, '<blockquote>$1</blockquote>');
        // Merge consecutive blockquotes
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Lists (ordered/unordered, including nested indentation)
        // Security contract: html is already escaped above; list conversion must keep item text as-is.
        html = convertMarkdownLists(html);

        // Markdown tables - SAFE approach to prevent ReDoS
        // Instead of using nested quantifiers with regex (which can cause exponential backtracking),
        // we use a line-by-line processing approach for safety
        var tableLines = html.split('\n');
        var processedLines = [];
        var tableBuffer = [];
        var inTable = false;

        for (var lineIdx = 0; lineIdx < tableLines.length; lineIdx++) {
            var line = tableLines[lineIdx];
            // Check if line looks like a table row (starts and ends with |)
            var isTableRow = /^\|.+\|$/.test(line.trim());

            if (isTableRow) {
                tableBuffer.push(line);
                inTable = true;
            } else {
                if (inTable && tableBuffer.length >= 2) {
                    // Process accumulated table buffer
                    var tableHtml = processTableBuffer(tableBuffer, MAX_TABLE_ROWS);
                    processedLines.push(tableHtml);
                }
                tableBuffer = [];
                inTable = false;
                processedLines.push(line);
            }
        }
        // Handle table at end of content
        if (inTable && tableBuffer.length >= 2) {
            processedLines.push(processTableBuffer(tableBuffer, MAX_TABLE_ROWS));
        }
        html = processedLines.join('\n');

        // Tokenize markdown links before emphasis parsing so link targets are not mutated by markdown transforms.
        var markdownLinksApi = window.TaskSyncMarkdownLinks;
        var tokenizedLinks = null;
        if (markdownLinksApi && typeof markdownLinksApi.tokenizeMarkdownLinks === 'function') {
            tokenizedLinks = markdownLinksApi.tokenizeMarkdownLinks(html);
            html = tokenizedLinks.text;
        }

        // Bold (**text** or __text__)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Strikethrough (~~text~~)
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Italic (*text* or _text_)
        // For *text*: require non-word boundaries around delimiters and alnum at content edges.
        // This avoids false-positive matches in plain prose (e.g. regex snippets, list-marker-like asterisks).
        html = html.replace(/(^|[^\p{L}\p{N}_*])\*([\p{L}\p{N}](?:[^*\n]*?[\p{L}\p{N}])?)\*(?=[^\p{L}\p{N}_*]|$)/gu, '$1<em>$2</em>');
        // For _text_: require non-word boundaries (Unicode-aware) around underscore markers
        // This keeps punctuation-adjacent emphasis working while avoiding snake_case matches
        html = html.replace(/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?=[^\p{L}\p{N}_]|$)/gu, '$1<em>$2</em>');

        // Restore tokenized markdown links after emphasis parsing.
        if (tokenizedLinks && markdownLinksApi && typeof markdownLinksApi.restoreTokenizedLinks === 'function') {
            html = markdownLinksApi.restoreTokenizedLinks(html, tokenizedLinks.links);
        } else if (markdownLinksApi && typeof markdownLinksApi.convertMarkdownLinks === 'function') {
            html = markdownLinksApi.convertMarkdownLinks(html);
        }

        // Restore inline code after emphasis parsing so markdown markers inside code stay literal.
        inlineCodeSpans.forEach(function (code, index) {
            var escapedCode = escapeHtml(code);
            var replacement = '<code class="inline-code">' + escapedCode + '</code>';
            html = html.replace('%%INLINECODE' + index + '%%', replacement);
        });

        // Line breaks - but collapse multiple consecutive breaks
        // Don't add <br> after block elements
        html = html.replace(/\n{3,}/g, '\n\n');
        html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)\n/g, '$1');
        html = html.replace(/\n/g, '<br>');

        // Restore code blocks
        codeBlocks.forEach(function (block, index) {
            var langAttr = block.lang ? ' data-lang="' + block.lang + '"' : '';
            var escapedCode = escapeHtml(block.code);
            var replacement = '<pre class="code-block"' + langAttr + '><code>' + escapedCode + '</code></pre>';
            html = html.replace('%%CODEBLOCK' + index + '%%', replacement);
        });

        // Restore mermaid blocks as diagrams
        mermaidBlocks.forEach(function (code, index) {
            var mermaidId = 'mermaid-' + Date.now() + '-' + index + '-' + Math.random().toString(36).substr(2, 9);
            var replacement = '<div class="mermaid-container" data-mermaid-id="' + mermaidId + '"><div class="mermaid" id="' + mermaidId + '">' + escapeHtml(code) + '</div></div>';
            html = html.replace('%%MERMAID' + index + '%%', replacement);
        });

        // Clean up excessive <br> around block elements
        html = html.replace(/(<br>)+(<pre|<div class="mermaid|<h[1-6]|<ul|<ol|<blockquote|<hr)/g, '$2');
        html = html.replace(/(<\/pre>|<\/div>|<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)(<br>)+/g, '$1');

        return html;
    }

    // Mermaid rendering - lazy load and render
    var mermaidLoaded = false;
    var mermaidLoading = false;

    function loadMermaid(callback) {
        if (mermaidLoaded) {
            callback();
            return;
        }
        if (mermaidLoading) {
            // Wait for existing load
            var checkInterval = setInterval(function () {
                if (mermaidLoaded) {
                    clearInterval(checkInterval);
                    callback();
                }
            }, 50);
            return;
        }
        mermaidLoading = true;

        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.onload = function () {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
                securityLevel: 'loose',
                fontFamily: 'var(--vscode-font-family)'
            });
            mermaidLoaded = true;
            mermaidLoading = false;
            callback();
        };
        script.onerror = function () {
            mermaidLoading = false;
            console.error('Failed to load mermaid.js');
        };
        document.head.appendChild(script);
    }

    function renderMermaidDiagrams() {
        var containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
        if (containers.length === 0) return;

        loadMermaid(function () {
            containers.forEach(function (container) {
                var mermaidDiv = container.querySelector('.mermaid');
                if (!mermaidDiv) return;

                var code = mermaidDiv.textContent;
                var id = mermaidDiv.id;

                try {
                    window.mermaid.render(id + '-svg', code).then(function (result) {
                        mermaidDiv.innerHTML = result.svg;
                        container.classList.add('rendered');
                    }).catch(function (err) {
                        // Show code block as fallback on error
                        mermaidDiv.innerHTML = '<pre class="code-block" data-lang="mermaid"><code>' + escapeHtml(code) + '</code></pre>';
                        container.classList.add('rendered', 'error');
                    });
                } catch (err) {
                    mermaidDiv.innerHTML = '<pre class="code-block" data-lang="mermaid"><code>' + escapeHtml(code) + '</code></pre>';
                    container.classList.add('rendered', 'error');
                }
            });
        });
    }

    /**
     * Update welcome section visibility based on current session state
     * Hide welcome when there are completed tool calls or a pending call
     */
    function updateWelcomeSectionVisibility() {
        if (!welcomeSection) return;
        var hasCompletedCalls = currentSessionCalls.some(function (tc) { return tc.status === 'completed'; });
        var hasPendingMessage = pendingMessage && !pendingMessage.classList.contains('hidden');
        var shouldHide = hasCompletedCalls || pendingToolCall !== null || hasPendingMessage;
        welcomeSection.classList.toggle('hidden', shouldHide);
    }

    /**
     * Auto-scroll chat container to bottom
     */
    function scrollToBottom() {
        if (!chatContainer) return;
        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(function () {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    function addToQueue(prompt) {
        if (!prompt || !prompt.trim()) return;
        var id = 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
        // Store attachments with the queue item
        var attachmentsToStore = currentAttachments.length > 0 ? currentAttachments.slice() : undefined;
        promptQueue.push({ id: id, prompt: prompt.trim(), attachments: attachmentsToStore });
        renderQueue();
        // Expand queue section when adding items so user can see what was added
        if (queueSection) queueSection.classList.remove('collapsed');
        // Send to backend with attachments
        vscode.postMessage({ type: 'addQueuePrompt', prompt: prompt.trim(), id: id, attachments: attachmentsToStore || [] });
        // Clear attachments after adding to queue (they're now stored with the queue item)
        currentAttachments = [];
        updateChipsDisplay();
    }

    function removeFromQueue(id) {
        promptQueue = promptQueue.filter(function (item) { return item.id !== id; });
        renderQueue();
        vscode.postMessage({ type: 'removeQueuePrompt', promptId: id });
    }

    function renderQueue() {
        if (!queueList) return;
        if (queueCount) queueCount.textContent = promptQueue.length;

        // Update visibility based on queue state
        updateQueueVisibility();

        if (promptQueue.length === 0) {
            queueList.innerHTML = '<div class="queue-empty">No prompts in queue</div>';
            return;
        }

        queueList.innerHTML = promptQueue.map(function (item, index) {
            var bulletClass = index === 0 ? 'active' : 'pending';
            var truncatedPrompt = item.prompt.length > 80 ? item.prompt.substring(0, 80) + '...' : item.prompt;
            // Show attachment indicator if this queue item has attachments
            var attachmentBadge = (item.attachments && item.attachments.length > 0)
                ? '<span class="queue-item-attachment-badge" title="' + item.attachments.length + ' attachment(s)" aria-label="' + item.attachments.length + ' attachments"><span class="codicon codicon-file-media" aria-hidden="true"></span></span>'
                : '';
            return '<div class="queue-item" data-id="' + escapeHtml(item.id) + '" data-index="' + index + '" tabindex="0" draggable="true" role="listitem" aria-label="Queue item ' + (index + 1) + ': ' + escapeHtml(truncatedPrompt) + '">' +
                '<span class="bullet ' + bulletClass + '" aria-hidden="true"></span>' +
                '<span class="text" title="' + escapeHtml(item.prompt) + '">' + (index + 1) + '. ' + escapeHtml(truncatedPrompt) + '</span>' +
                attachmentBadge +
                '<div class="queue-item-actions">' +
                '<button class="edit-btn" data-id="' + escapeHtml(item.id) + '" title="Edit" aria-label="Edit queue item ' + (index + 1) + '"><span class="codicon codicon-edit" aria-hidden="true"></span></button>' +
                '<button class="remove-btn" data-id="' + escapeHtml(item.id) + '" title="Remove" aria-label="Remove queue item ' + (index + 1) + '"><span class="codicon codicon-close" aria-hidden="true"></span></button>' +
                '</div></div>';
        }).join('');

        queueList.querySelectorAll('.remove-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) removeFromQueue(id);
            });
        });

        queueList.querySelectorAll('.edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) startEditPrompt(id);
            });
        });

        bindDragAndDrop();
        bindKeyboardNavigation();
    }

    function startEditPrompt(id) {
        // Cancel any existing edit first
        if (editingPromptId && editingPromptId !== id) {
            cancelEditMode();
        }

        var item = promptQueue.find(function (p) { return p.id === id; });
        if (!item) return;

        // Save current state
        editingPromptId = id;
        editingOriginalPrompt = item.prompt;
        savedInputValue = chatInput ? chatInput.value : '';

        // Mark queue item as being edited
        var queueItem = queueList.querySelector('.queue-item[data-id="' + id + '"]');
        if (queueItem) {
            queueItem.classList.add('editing');
        }

        // Switch to edit mode UI
        enterEditMode(item.prompt);
    }

    function enterEditMode(promptText) {
        // Hide normal actions, show edit actions
        if (actionsLeft) actionsLeft.classList.add('hidden');
        if (sendBtn) sendBtn.classList.add('hidden');
        if (editActionsContainer) editActionsContainer.classList.remove('hidden');

        // Mark input container as in edit mode
        if (inputContainer) {
            inputContainer.classList.add('edit-mode');
            inputContainer.setAttribute('aria-label', 'Editing queue prompt');
        }

        // Set input value to the prompt being edited
        if (chatInput) {
            chatInput.value = promptText;
            chatInput.setAttribute('aria-label', 'Edit prompt text. Press Enter to confirm, Escape to cancel.');
            chatInput.focus();
            // Move cursor to end
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
            autoResizeTextarea();
        }
    }

    function exitEditMode() {
        // Show normal actions, hide edit actions
        if (actionsLeft) actionsLeft.classList.remove('hidden');
        if (sendBtn) sendBtn.classList.remove('hidden');
        if (editActionsContainer) editActionsContainer.classList.add('hidden');

        // Remove edit mode class from input container
        if (inputContainer) {
            inputContainer.classList.remove('edit-mode');
            inputContainer.removeAttribute('aria-label');
        }

        // Remove editing class from queue item
        if (queueList) {
            var editingItem = queueList.querySelector('.queue-item.editing');
            if (editingItem) editingItem.classList.remove('editing');
        }

        // Restore original input value and accessibility
        if (chatInput) {
            chatInput.value = savedInputValue;
            chatInput.setAttribute('aria-label', 'Message input');
            autoResizeTextarea();
        }

        // Reset edit state
        editingPromptId = null;
        editingOriginalPrompt = null;
        savedInputValue = '';
    }

    function confirmEditMode() {
        if (!editingPromptId) return;

        var newValue = chatInput ? chatInput.value.trim() : '';

        if (!newValue) {
            // If empty, remove the prompt
            removeFromQueue(editingPromptId);
        } else if (newValue !== editingOriginalPrompt) {
            // Update the prompt
            var item = promptQueue.find(function (p) { return p.id === editingPromptId; });
            if (item) {
                item.prompt = newValue;
                vscode.postMessage({ type: 'editQueuePrompt', promptId: editingPromptId, newPrompt: newValue });
            }
        }

        // Clear saved input - we don't want to restore old value after editing
        savedInputValue = '';

        exitEditMode();
        renderQueue();
    }

    function cancelEditMode() {
        exitEditMode();
        renderQueue();
    }

    /**
     * Handle "accept" button click in approval modal
     * Sends "yes" as the response
     */
    function handleApprovalContinue() {
        if (!pendingToolCall) return;

        // Hide approval modal
        hideApprovalModal();

        // Send affirmative response
        vscode.postMessage({ type: 'submit', value: 'yes', attachments: [] });
        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        saveWebviewState();
    }

    /**
     * Handle "No" button click in approval modal
     * Dismisses modal and focuses input for custom response
     */
    function handleApprovalNo() {
        // Hide approval modal but keep pending state
        hideApprovalModal();

        // Focus input for custom response
        if (chatInput) {
            chatInput.focus();
            // Optionally pre-fill with "No, " to help user
            if (!chatInput.value.trim()) {
                chatInput.value = 'No, ';
                chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
            }
            autoResizeTextarea();
            updateInputHighlighter();
            updateSendButtonState();
            saveWebviewState();
        }
    }

    /**
     * Show approval modal
     */
    function showApprovalModal() {
        if (!approvalModal) return;
        approvalModal.classList.remove('hidden');
        // Focus chat input instead of Yes button to prevent accidental Enter approvals
        // User can still click Yes/No or use keyboard navigation
        if (chatInput) {
            chatInput.focus();
        }
    }

    /**
     * Hide approval modal
     */
    function hideApprovalModal() {
        if (!approvalModal) return;
        approvalModal.classList.add('hidden');
        isApprovalQuestion = false;
    }

    /**
     * Show choices bar with dynamic buttons based on parsed choices
     */
    function showChoicesBar() {
        // Hide approval modal first
        hideApprovalModal();

        // Create or get choices bar
        var choicesBar = document.getElementById('choices-bar');
        if (!choicesBar) {
            choicesBar = document.createElement('div');
            choicesBar.className = 'choices-bar';
            choicesBar.id = 'choices-bar';
            choicesBar.setAttribute('role', 'toolbar');
            choicesBar.setAttribute('aria-label', 'Quick choice options');

            // Insert at top of input-wrapper
            var inputWrapper = document.getElementById('input-wrapper');
            if (inputWrapper) {
                inputWrapper.insertBefore(choicesBar, inputWrapper.firstChild);
            }
        }

        // Build choice buttons
        var buttonsHtml = currentChoices.map(function (choice, index) {
            var shortLabel = choice.shortLabel || choice.value;
            var title = choice.label || choice.value;
            return '<button class="choice-btn" data-value="' + escapeHtml(choice.value) + '" ' +
                'data-index="' + index + '" title="' + escapeHtml(title) + '">' +
                escapeHtml(shortLabel) + '</button>';
        }).join('');

        choicesBar.innerHTML = '<span class="choices-label">Choose:</span>' +
            '<div class="choices-buttons">' + buttonsHtml + '</div>';

        // Bind click events to choice buttons
        choicesBar.querySelectorAll('.choice-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var value = btn.getAttribute('data-value');
                handleChoiceClick(value);
            });
        });

        choicesBar.classList.remove('hidden');

        // Don't auto-focus buttons - let user click or use keyboard
        // Focus the chat input instead for immediate typing
        if (chatInput) {
            chatInput.focus();
        }
    }

    /**
     * Hide choices bar
     */
    function hideChoicesBar() {
        var choicesBar = document.getElementById('choices-bar');
        if (choicesBar) {
            choicesBar.classList.add('hidden');
        }
        currentChoices = [];
    }

    /**
     * Handle choice button click
     */
    function handleChoiceClick(value) {
        if (!pendingToolCall) return;

        // Hide choices bar
        hideChoicesBar();

        // Send the choice value as response
        vscode.postMessage({ type: 'submit', value: value, attachments: [] });
        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        saveWebviewState();
    }

    // ===== SETTINGS MODAL FUNCTIONS =====

    function openSettingsModal() {
        if (!settingsModalOverlay) return;
        vscode.postMessage({ type: 'openSettingsModal' });
        settingsModalOverlay.classList.remove('hidden');
    }

    function closeSettingsModal() {
        if (!settingsModalOverlay) return;
        flushAutopilotTextUpdate();
        settingsModalOverlay.classList.add('hidden');
        hideAddPromptForm();
    }

    function toggleSoundSetting() {
        soundEnabled = !soundEnabled;
        updateSoundToggleUI();
        vscode.postMessage({ type: 'updateSoundSetting', enabled: soundEnabled });
    }

    function updateSoundToggleUI() {
        if (!soundToggle) return;
        soundToggle.classList.toggle('active', soundEnabled);
        soundToggle.setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
    }

    function toggleInteractiveApprovalSetting() {
        interactiveApprovalEnabled = !interactiveApprovalEnabled;
        updateInteractiveApprovalToggleUI();
        vscode.postMessage({ type: 'updateInteractiveApprovalSetting', enabled: interactiveApprovalEnabled });
    }

    function updateInteractiveApprovalToggleUI() {
        if (!interactiveApprovalToggle) return;
        interactiveApprovalToggle.classList.toggle('active', interactiveApprovalEnabled);
        interactiveApprovalToggle.setAttribute('aria-checked', interactiveApprovalEnabled ? 'true' : 'false');
    }

    function toggleSendWithCtrlEnterSetting() {
        sendWithCtrlEnter = !sendWithCtrlEnter;
        updateSendWithCtrlEnterToggleUI();
        vscode.postMessage({ type: 'updateSendWithCtrlEnterSetting', enabled: sendWithCtrlEnter });
    }

    function updateSendWithCtrlEnterToggleUI() {
        if (!sendShortcutToggle) return;
        sendShortcutToggle.classList.toggle('active', sendWithCtrlEnter);
        sendShortcutToggle.setAttribute('aria-checked', sendWithCtrlEnter ? 'true' : 'false');
    }

    function toggleAutopilotSetting() {
        autopilotEnabled = !autopilotEnabled;
        updateAutopilotToggleUI();
        vscode.postMessage({ type: 'updateAutopilotSetting', enabled: autopilotEnabled });
    }

    function updateAutopilotToggleUI() {
        if (autopilotToggle) {
            autopilotToggle.classList.toggle('active', autopilotEnabled);
            autopilotToggle.setAttribute('aria-checked', autopilotEnabled ? 'true' : 'false');
        }
    }

    function toggleAutopilotTextEdit() {
        var autopilotTextRow = autopilotTextInput ? autopilotTextInput.closest('.form-row') : null;
        if (autopilotTextRow) {
            var isHidden = autopilotTextRow.classList.toggle('hidden');
            if (!isHidden && autopilotTextInput) {
                autopilotTextInput.focus();
            }
        }
    }

    function handleAutopilotTextInput() {
        if (!autopilotTextInput) return;
        autopilotText = autopilotTextInput.value;
        autopilotTextEditVersion++;
        scheduleAutopilotTextUpdate();
    }

    function scheduleAutopilotTextUpdate() {
        if (autopilotTextDebounceTimer) clearTimeout(autopilotTextDebounceTimer);
        autopilotTextDebounceTimer = setTimeout(flushAutopilotTextUpdate, 400);
    }

    function flushAutopilotTextUpdate() {
        if (autopilotTextDebounceTimer) {
            clearTimeout(autopilotTextDebounceTimer);
            autopilotTextDebounceTimer = null;
        }
        if (!autopilotTextInput) return;
        autopilotText = autopilotTextInput.value;
        autopilotTextLastSentVersion = autopilotTextEditVersion;
        vscode.postMessage({ type: 'updateAutopilotText', text: autopilotText });
    }

    function updateAutopilotTextUI() {
        if (!autopilotTextInput) return;

        var isFocused = document.activeElement === autopilotTextInput;
        var hasUnflushedEdits = autopilotTextEditVersion > autopilotTextLastSentVersion;

        // While user is typing, do not apply incoming settings updates that could revert new characters.
        if (isFocused && hasUnflushedEdits) {
            return;
        }

        if (autopilotTextInput.value !== autopilotText) {
            var selectionStart = autopilotTextInput.selectionStart;
            var selectionEnd = autopilotTextInput.selectionEnd;

            autopilotTextInput.value = autopilotText;

            if (isFocused && selectionStart !== null && selectionEnd !== null) {
                var maxPos = autopilotTextInput.value.length;
                autopilotTextInput.setSelectionRange(
                    Math.min(selectionStart, maxPos),
                    Math.min(selectionEnd, maxPos)
                );
            }
        }
    }

    function handleResponseTimeoutChange() {
        if (!responseTimeoutSelect) return;
        var value = parseInt(responseTimeoutSelect.value, 10);
        console.log('[TaskSync] Response timeout changed to:', value);
        if (!isNaN(value)) {
            responseTimeout = value;
            vscode.postMessage({ type: 'updateResponseTimeout', value: value });
        }
    }

    function updateResponseTimeoutUI() {
        if (!responseTimeoutSelect) return;
        responseTimeoutSelect.value = String(responseTimeout);
    }

    function handleSessionWarningHoursChange() {
        if (!sessionWarningHoursInput) return;

        var value = parseInt(sessionWarningHoursInput.value, 10);
        if (!isNaN(value) && value >= 0 && value <= 8) {
            sessionWarningHours = value;
            vscode.postMessage({ type: 'updateSessionWarningHours', value: value });
        }

        sessionWarningHoursInput.value = String(sessionWarningHours);
    }

    function updateSessionWarningHoursUI() {
        if (!sessionWarningHoursInput) return;
        sessionWarningHoursInput.value = String(sessionWarningHours);
    }

    function handleMaxAutoResponsesChange() {
        if (!maxAutoResponsesInput) return;
        var value = parseInt(maxAutoResponsesInput.value, 10);
        if (!isNaN(value) && value >= 1 && value <= 50) {
            maxConsecutiveAutoResponses = value;
            vscode.postMessage({ type: 'updateMaxConsecutiveAutoResponses', value: value });
        } else {
            // Reset to valid value
            maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
        }
    }

    function updateMaxAutoResponsesUI() {
        if (!maxAutoResponsesInput) return;
        maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
    }

    /**
     * Toggle human-like delay. When enabled, a random delay (jitter)
     * between min and max seconds is applied before each auto-response,
     * simulating natural human reading and typing time.
     */
    function toggleHumanDelaySetting() {
        humanLikeDelayEnabled = !humanLikeDelayEnabled;
        vscode.postMessage({ type: 'updateHumanDelaySetting', enabled: humanLikeDelayEnabled });
        updateHumanDelayUI();
    }

    /**
     * Update minimum delay (seconds). Clamps to valid range [1, max].
     * Sends new value to extension for persistence in VS Code settings.
     */
    function handleHumanDelayMinChange() {
        if (!humanDelayMinInput) return;
        var value = parseInt(humanDelayMinInput.value, 10);
        if (!isNaN(value) && value >= 1 && value <= 30) {
            // Ensure min <= max
            if (value > humanLikeDelayMax) {
                value = humanLikeDelayMax;
            }
            humanLikeDelayMin = value;
            vscode.postMessage({ type: 'updateHumanDelayMin', value: value });
        }
        humanDelayMinInput.value = humanLikeDelayMin;
    }

    /**
     * Update maximum delay (seconds). Clamps to valid range [min, 60].
     * Sends new value to extension for persistence in VS Code settings.
     */
    function handleHumanDelayMaxChange() {
        if (!humanDelayMaxInput) return;
        var value = parseInt(humanDelayMaxInput.value, 10);
        if (!isNaN(value) && value >= 2 && value <= 60) {
            // Ensure max >= min
            if (value < humanLikeDelayMin) {
                value = humanLikeDelayMin;
            }
            humanLikeDelayMax = value;
            vscode.postMessage({ type: 'updateHumanDelayMax', value: value });
        }
        humanDelayMaxInput.value = humanLikeDelayMax;
    }

    function updateHumanDelayUI() {
        if (humanDelayToggle) {
            humanDelayToggle.classList.toggle('active', humanLikeDelayEnabled);
            humanDelayToggle.setAttribute('aria-checked', humanLikeDelayEnabled ? 'true' : 'false');
        }
        if (humanDelayRangeContainer) {
            humanDelayRangeContainer.style.display = humanLikeDelayEnabled ? 'flex' : 'none';
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
        addPromptForm.classList.remove('hidden');
        addPromptBtn.classList.add('hidden');
        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        if (textInput) textInput.value = '';
        // Clear edit mode
        addPromptForm.removeAttribute('data-editing-id');
    }

    function hideAddPromptForm() {
        if (!addPromptForm || !addPromptBtn) return;
        addPromptForm.classList.add('hidden');
        addPromptBtn.classList.remove('hidden');
        addPromptForm.removeAttribute('data-editing-id');
    }

    function saveNewPrompt() {
        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (!nameInput || !textInput) return;

        var name = nameInput.value.trim();
        var prompt = textInput.value.trim();

        if (!name || !prompt) {
            return;
        }

        var editingId = addPromptForm.getAttribute('data-editing-id');
        if (editingId) {
            // Editing existing prompt
            vscode.postMessage({ type: 'editReusablePrompt', id: editingId, name: name, prompt: prompt });
        } else {
            // Adding new prompt
            vscode.postMessage({ type: 'addReusablePrompt', name: name, prompt: prompt });
        }

        hideAddPromptForm();
    }

    function renderPromptsList() {
        if (!promptsList) return;

        if (reusablePrompts.length === 0) {
            promptsList.innerHTML = '';
            return;
        }

        // Compact list - show only name, full prompt on hover via title
        promptsList.innerHTML = reusablePrompts.map(function (p) {
            // Truncate very long prompts for tooltip to prevent massive tooltips
            var tooltipText = p.prompt.length > 300 ? p.prompt.substring(0, 300) + '...' : p.prompt;
            // Escape for HTML attribute
            tooltipText = tooltipText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="prompt-item compact" data-id="' + escapeHtml(p.id) + '" title="' + tooltipText + '">' +
                '<div class="prompt-item-content">' +
                '<span class="prompt-item-name">/' + escapeHtml(p.name) + '</span>' +
                '</div>' +
                '<div class="prompt-item-actions">' +
                '<button class="prompt-item-btn edit" data-id="' + escapeHtml(p.id) + '" title="Edit"><span class="codicon codicon-edit"></span></button>' +
                '<button class="prompt-item-btn delete" data-id="' + escapeHtml(p.id) + '" title="Delete"><span class="codicon codicon-trash"></span></button>' +
                '</div></div>';
        }).join('');

        // Bind edit/delete events
        promptsList.querySelectorAll('.prompt-item-btn.edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                editPrompt(id);
            });
        });

        promptsList.querySelectorAll('.prompt-item-btn.delete').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                deletePrompt(id);
            });
        });
    }

    function editPrompt(id) {
        var prompt = reusablePrompts.find(function (p) { return p.id === id; });
        if (!prompt) return;

        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (!nameInput || !textInput) return;

        // Show form with existing values
        addPromptForm.classList.remove('hidden');
        addPromptBtn.classList.add('hidden');
        addPromptForm.setAttribute('data-editing-id', id);

        nameInput.value = prompt.name;
        textInput.value = prompt.prompt;
        nameInput.focus();
    }

    function deletePrompt(id) {
        vscode.postMessage({ type: 'removeReusablePrompt', id: id });
    }

    // ===== SLASH COMMAND FUNCTIONS =====

    /**
     * Expand /commandName patterns to their full prompt text
     * Only expands known commands at the start of lines or after whitespace
     */
    function expandSlashCommands(text) {
        if (!text || reusablePrompts.length === 0) return text;

        // Use stored mappings from selectSlashItem if available
        var mappings = chatInput && chatInput._slashPrompts ? chatInput._slashPrompts : {};

        // Build a regex to match all known prompt names
        var promptNames = reusablePrompts.map(function (p) { return p.name; });
        if (Object.keys(mappings).length > 0) {
            Object.keys(mappings).forEach(function (name) {
                if (promptNames.indexOf(name) === -1) promptNames.push(name);
            });
        }

        // Match /promptName at start or after whitespace
        var expanded = text;
        promptNames.forEach(function (name) {
            // Escape special regex chars in name
            var escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var regex = new RegExp('(^|\\s)/' + escapedName + '(?=\\s|$)', 'g');
            var fullPrompt = mappings[name] || (reusablePrompts.find(function (p) { return p.name === name; }) || {}).prompt || '';
            if (fullPrompt) {
                expanded = expanded.replace(regex, '$1' + fullPrompt);
            }
        });

        // Clear stored mappings after expansion
        if (chatInput) chatInput._slashPrompts = {};

        return expanded.trim();
    }

    function handleSlashCommands() {
        if (!chatInput) return;
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;

        // Find slash at start of input or after whitespace
        var slashPos = -1;
        for (var i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '/') {
                // Check if it's at start or after whitespace
                if (i === 0 || /\s/.test(value[i - 1])) {
                    slashPos = i;
                }
                break;
            }
            if (/\s/.test(value[i])) break;
        }

        if (slashPos >= 0 && reusablePrompts.length > 0) {
            var query = value.substring(slashPos + 1, cursorPos);
            slashStartPos = slashPos;
            if (slashDebounceTimer) clearTimeout(slashDebounceTimer);
            slashDebounceTimer = setTimeout(function () {
                // Filter locally for instant results
                var queryLower = query.toLowerCase();
                var matchingPrompts = reusablePrompts.filter(function (p) {
                    return p.name.toLowerCase().includes(queryLower) ||
                        p.prompt.toLowerCase().includes(queryLower);
                });
                showSlashDropdown(matchingPrompts);
            }, 50);
        } else if (slashDropdownVisible) {
            hideSlashDropdown();
        }
    }

    function showSlashDropdown(results) {
        if (!slashDropdown || !slashList || !slashEmpty) return;
        slashResults = results;
        selectedSlashIndex = results.length > 0 ? 0 : -1;

        // Hide file autocomplete if showing slash commands
        hideAutocomplete();

        if (results.length === 0) {
            slashList.classList.add('hidden');
            slashEmpty.classList.remove('hidden');
        } else {
            slashList.classList.remove('hidden');
            slashEmpty.classList.add('hidden');
            renderSlashList();
        }
        slashDropdown.classList.remove('hidden');
        slashDropdownVisible = true;
    }

    function hideSlashDropdown() {
        if (slashDropdown) slashDropdown.classList.add('hidden');
        slashDropdownVisible = false;
        slashResults = [];
        selectedSlashIndex = -1;
        slashStartPos = -1;
        if (slashDebounceTimer) { clearTimeout(slashDebounceTimer); slashDebounceTimer = null; }
    }

    function renderSlashList() {
        if (!slashList) return;
        slashList.innerHTML = slashResults.map(function (p, index) {
            var truncatedPrompt = p.prompt.length > 50 ? p.prompt.substring(0, 50) + '...' : p.prompt;
            // Prepare tooltip text - escape for HTML attribute
            var tooltipText = p.prompt.length > 500 ? p.prompt.substring(0, 500) + '...' : p.prompt;
            tooltipText = tooltipText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="slash-item' + (index === selectedSlashIndex ? ' selected' : '') + '" data-index="' + index + '" data-tooltip="' + tooltipText + '">' +
                '<span class="slash-item-icon"><span class="codicon codicon-symbol-keyword"></span></span>' +
                '<div class="slash-item-content">' +
                '<span class="slash-item-name">/' + escapeHtml(p.name) + '</span>' +
                '<span class="slash-item-preview">' + escapeHtml(truncatedPrompt) + '</span>' +
                '</div></div>';
        }).join('');

        slashList.querySelectorAll('.slash-item').forEach(function (item) {
            item.addEventListener('click', function () { selectSlashItem(parseInt(item.getAttribute('data-index'), 10)); });
            item.addEventListener('mouseenter', function () { selectedSlashIndex = parseInt(item.getAttribute('data-index'), 10); updateSlashSelection(); });
        });
        scrollToSelectedSlashItem();
    }

    function updateSlashSelection() {
        if (!slashList) return;
        slashList.querySelectorAll('.slash-item').forEach(function (item, index) {
            item.classList.toggle('selected', index === selectedSlashIndex);
        });
        scrollToSelectedSlashItem();
    }

    function scrollToSelectedSlashItem() {
        var selectedItem = slashList ? slashList.querySelector('.slash-item.selected') : null;
        if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectSlashItem(index) {
        if (index < 0 || index >= slashResults.length || !chatInput || slashStartPos < 0) return;
        var prompt = slashResults[index];
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;

        // Create a slash tag representation - when sent, we'll expand it to full prompt
        // For now, insert /name as text and store the mapping
        var slashText = '/' + prompt.name + ' ';
        chatInput.value = value.substring(0, slashStartPos) + slashText + value.substring(cursorPos);
        var newCursorPos = slashStartPos + slashText.length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);

        // Store the prompt reference for expansion on send
        if (!chatInput._slashPrompts) chatInput._slashPrompts = {};
        chatInput._slashPrompts[prompt.name] = prompt.prompt;

        hideSlashDropdown();
        chatInput.focus();
        updateSendButtonState();
    }

    // ===== NOTIFICATION SOUND FUNCTION =====

    /**
     * Unlock audio playback after first user interaction
     * Required due to browser autoplay policy
     */
    function unlockAudioOnInteraction() {
        function unlock() {
            if (audioUnlocked) return;
            var audio = document.getElementById('notification-sound');
            if (audio) {
                // Play and immediately pause to unlock
                audio.volume = 0;
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        audio.pause();
                        audio.currentTime = 0;
                        audio.volume = 0.5;
                        audioUnlocked = true;
                        console.log('[TaskSync] Audio unlocked successfully');
                    }).catch(function () {
                        // Still locked, will try again on next interaction
                    });
                }
            }
            // Remove listeners after first attempt
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
        }
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
    }

    function playNotificationSound() {
        console.log('[TaskSync] playNotificationSound called, audioUnlocked:', audioUnlocked);
        // Play the preloaded audio element
        try {
            var audio = document.getElementById('notification-sound');
            console.log('[TaskSync] Audio element found:', !!audio);
            if (audio) {
                audio.currentTime = 0; // Reset to beginning
                audio.volume = 0.5;
                console.log('[TaskSync] Attempting to play audio...');
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        console.log('[TaskSync] Audio playback started successfully');
                    }).catch(function (e) {
                        console.log('[TaskSync] Could not play audio:', e.message);
                        console.log('[TaskSync] Error name:', e.name);
                        // If autoplay blocked, show visual feedback
                        flashNotification();
                    });
                }
            } else {
                console.log('[TaskSync] No audio element found, showing visual notification');
                flashNotification();
            }
        } catch (e) {
            console.log('[TaskSync] Could not play notification sound:', e);
            flashNotification();
        }
    }

    function flashNotification() {
        // Visual flash when audio fails
        var body = document.body;
        body.style.transition = 'background-color 0.1s ease';
        var originalBg = body.style.backgroundColor;
        body.style.backgroundColor = 'var(--vscode-textLink-foreground, #3794ff)';
        setTimeout(function () {
            body.style.backgroundColor = originalBg || '';
        }, 150);
    }

    function bindDragAndDrop() {
        if (!queueList) return;
        queueList.querySelectorAll('.queue-item').forEach(function (item) {
            item.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', String(parseInt(item.getAttribute('data-index'), 10)));
                item.classList.add('dragging');
            });
            item.addEventListener('dragend', function () { item.classList.remove('dragging'); });
            item.addEventListener('dragover', function (e) { e.preventDefault(); item.classList.add('drag-over'); });
            item.addEventListener('dragleave', function () { item.classList.remove('drag-over'); });
            item.addEventListener('drop', function (e) {
                e.preventDefault();
                var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                var toIndex = parseInt(item.getAttribute('data-index'), 10);
                item.classList.remove('drag-over');
                if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) reorderQueue(fromIndex, toIndex);
            });
        });
    }

    function bindKeyboardNavigation() {
        if (!queueList) return;
        var items = queueList.querySelectorAll('.queue-item');
        items.forEach(function (item, index) {
            item.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault(); items[index + 1].focus(); }
                else if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); items[index - 1].focus(); }
                else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); var id = item.getAttribute('data-id'); if (id) removeFromQueue(id); }
            });
        });
    }

    function reorderQueue(fromIndex, toIndex) {
        var removed = promptQueue.splice(fromIndex, 1)[0];
        promptQueue.splice(toIndex, 0, removed);
        renderQueue();
        vscode.postMessage({ type: 'reorderQueue', fromIndex: fromIndex, toIndex: toIndex });
    }

    function handleAutocomplete() {
        if (!chatInput) return;
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;
        var hashPos = -1;
        for (var i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '#') { hashPos = i; break; }
            if (value[i] === ' ' || value[i] === '\n') break;
        }
        if (hashPos >= 0) {
            var query = value.substring(hashPos + 1, cursorPos);
            autocompleteStartPos = hashPos;
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(function () {
                vscode.postMessage({ type: 'searchFiles', query: query });
            }, 150);
        } else if (autocompleteVisible) {
            hideAutocomplete();
        }
    }

    function showAutocomplete(results) {
        if (!autocompleteDropdown || !autocompleteList || !autocompleteEmpty) return;
        autocompleteResults = results;
        selectedAutocompleteIndex = results.length > 0 ? 0 : -1;
        if (results.length === 0) {
            autocompleteList.classList.add('hidden');
            autocompleteEmpty.classList.remove('hidden');
        } else {
            autocompleteList.classList.remove('hidden');
            autocompleteEmpty.classList.add('hidden');
            renderAutocompleteList();
        }
        autocompleteDropdown.classList.remove('hidden');
        autocompleteVisible = true;
    }

    function hideAutocomplete() {
        if (autocompleteDropdown) autocompleteDropdown.classList.add('hidden');
        autocompleteVisible = false;
        autocompleteResults = [];
        selectedAutocompleteIndex = -1;
        autocompleteStartPos = -1;
        if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    }

    function renderAutocompleteList() {
        if (!autocompleteList) return;
        autocompleteList.innerHTML = autocompleteResults.map(function (file, index) {
            return '<div class="autocomplete-item' + (index === selectedAutocompleteIndex ? ' selected' : '') + '" data-index="' + index + '">' +
                '<span class="autocomplete-item-icon"><span class="codicon codicon-' + file.icon + '"></span></span>' +
                '<div class="autocomplete-item-content"><span class="autocomplete-item-name">' + escapeHtml(file.name) + '</span>' +
                '<span class="autocomplete-item-path">' + escapeHtml(file.path) + '</span></div></div>';
        }).join('');

        autocompleteList.querySelectorAll('.autocomplete-item').forEach(function (item) {
            item.addEventListener('click', function () { selectAutocompleteItem(parseInt(item.getAttribute('data-index'), 10)); });
            item.addEventListener('mouseenter', function () { selectedAutocompleteIndex = parseInt(item.getAttribute('data-index'), 10); updateAutocompleteSelection(); });
        });
        scrollToSelectedItem();
    }

    function updateAutocompleteSelection() {
        if (!autocompleteList) return;
        autocompleteList.querySelectorAll('.autocomplete-item').forEach(function (item, index) {
            item.classList.toggle('selected', index === selectedAutocompleteIndex);
        });
        scrollToSelectedItem();
    }

    function scrollToSelectedItem() {
        var selectedItem = autocompleteList ? autocompleteList.querySelector('.autocomplete-item.selected') : null;
        if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectAutocompleteItem(index) {
        if (index < 0 || index >= autocompleteResults.length || !chatInput || autocompleteStartPos < 0) return;
        var file = autocompleteResults[index];
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;

        // Check if this is a context item (#terminal, #problems)
        if (file.isContext && file.uri && file.uri.startsWith('context://')) {
            // Remove the #query from input - chip will be added
            chatInput.value = value.substring(0, autocompleteStartPos) + value.substring(cursorPos);
            var newCursorPos = autocompleteStartPos;
            chatInput.setSelectionRange(newCursorPos, newCursorPos);

            // Send context reference request to backend
            vscode.postMessage({
                type: 'selectContextReference',
                contextType: file.name, // 'terminal' or 'problems'
                options: undefined
            });

            hideAutocomplete();
            chatInput.focus();
            autoResizeTextarea();
            updateInputHighlighter();
            saveWebviewState();
            updateSendButtonState();
            return;
        }

        // Regular file/folder reference
        var referenceText = '#' + file.name + ' ';
        chatInput.value = value.substring(0, autocompleteStartPos) + referenceText + value.substring(cursorPos);
        var newCursorPos = autocompleteStartPos + referenceText.length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);
        vscode.postMessage({ type: 'addFileReference', file: file });
        hideAutocomplete();
        chatInput.focus();
    }

    function syncAttachmentsWithText() {
        var text = chatInput ? chatInput.value : '';
        var toRemove = [];
        currentAttachments.forEach(function (att) {
            // Skip temporary attachments (like pasted images)
            if (att.isTemporary) return;
            // Skip context attachments (#terminal, #problems) - they use context:// URI
            if (att.uri && att.uri.startsWith('context://')) return;
            // Only sync file references that have isTextReference flag
            if (!att.isTextReference) return;
            // Check if the #filename reference still exists in text
            if (text.indexOf('#' + att.name) === -1) toRemove.push(att.id);
        });
        if (toRemove.length > 0) {
            toRemove.forEach(function (id) { vscode.postMessage({ type: 'removeAttachment', attachmentId: id }); });
            currentAttachments = currentAttachments.filter(function (a) { return toRemove.indexOf(a.id) === -1; });
            updateChipsDisplay();
        }
    }

    function handlePaste(event) {
        if (!event.clipboardData) return;
        var items = event.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') === 0) {
                event.preventDefault();
                var file = items[i].getAsFile();
                if (file) processImageFile(file);
                return;
            }
        }
    }

    function processImageFile(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            if (e.target && e.target.result) vscode.postMessage({ type: 'saveImage', data: e.target.result, mimeType: file.type });
        };
        reader.readAsDataURL(file);
    }

    function updateChipsDisplay() {
        if (!chipsContainer) return;
        if (currentAttachments.length === 0) {
            chipsContainer.classList.add('hidden');
            chipsContainer.innerHTML = '';
        } else {
            chipsContainer.classList.remove('hidden');
            chipsContainer.innerHTML = currentAttachments.map(function (att) {
                var isImage = att.isTemporary || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
                var iconClass = att.isFolder ? 'folder' : (isImage ? 'file-media' : 'file');
                var displayName = att.isTemporary ? 'Pasted Image' : att.name;
                return '<div class="chip" data-id="' + att.id + '" title="' + escapeHtml(att.uri || att.name) + '">' +
                    '<span class="chip-icon"><span class="codicon codicon-' + iconClass + '"></span></span>' +
                    '<span class="chip-text">' + escapeHtml(displayName) + '</span>' +
                    '<button class="chip-remove" data-remove="' + att.id + '" title="Remove"><span class="codicon codicon-close"></span></button></div>';
            }).join('');

            chipsContainer.querySelectorAll('.chip-remove').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var attId = btn.getAttribute('data-remove');
                    if (attId) removeAttachment(attId);
                });
            });
        }
        // Persist attachments so they survive sidebar tab switches
        saveWebviewState();
    }

    function removeAttachment(attachmentId) {
        vscode.postMessage({ type: 'removeAttachment', attachmentId: attachmentId });
        currentAttachments = currentAttachments.filter(function (a) { return a.id !== attachmentId; });
        updateChipsDisplay();
        // saveWebviewState() is called in updateChipsDisplay
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderAttachmentsHtml(attachments) {
        if (!attachments || attachments.length === 0) return '';
        var items = attachments.map(function (att) {
            var iconClass = 'file';
            if (att.isFolder) iconClass = 'folder';
            else if (att.name && (att.name.endsWith('.png') || att.name.endsWith('.jpg') || att.name.endsWith('.jpeg'))) iconClass = 'file-media';
            else if ((att.uri || '').indexOf('context://terminal') !== -1) iconClass = 'terminal';
            else if ((att.uri || '').indexOf('context://problems') !== -1) iconClass = 'error';

            return '<div class="chip" style="margin-top:0;" title="' + escapeHtml(att.name) + '">' +
                '<span class="chip-icon"><span class="codicon codicon-' + iconClass + '"></span></span>' +
                '<span class="chip-text">' + escapeHtml(att.name) + '</span>' +
                '</div>';
        }).join('');

        return '<div class="chips-container" style="padding: 6px 0 0 0; border: none;">' + items + '</div>';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
