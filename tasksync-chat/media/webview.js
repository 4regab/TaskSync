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
    let queueSection, queueHeader, queueList, queueCount;
    let chatContainer, chipsContainer, autocompleteDropdown, autocompleteList, autocompleteEmpty;
    let inputContainer, inputAreaContainer, welcomeSection, welcomeTips;
    let cardVibe, cardSpec, toolHistoryArea, pendingMessage;
    let historyModal, historyModalOverlay, historyModalList, historyModalClose, historyModalClearAll;
    // Edit mode elements
    let actionsLeft, actionsBar, editActionsContainer, editCancelBtn, editConfirmBtn;
    // Approval modal elements
    let approvalModal, approvalContinueBtn, approvalNoBtn;

    function init() {
        try {
            console.log('[TaskSync Webview] init() starting...');
            cacheDOMElements();
            createHistoryModal();
            createEditModeUI();
            createApprovalModal();
            bindEventListeners();
            console.log('[TaskSync Webview] Event listeners bound, pendingMessage element:', !!pendingMessage);
            renderQueue();
            updateModeUI();
            updateQueueVisibility();
            initCardSelection();

            // Restore persisted input value (when user switches sidebar tabs and comes back)
            if (chatInput && persistedInputValue) {
                chatInput.value = persistedInputValue;
                autoResizeTextarea();
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
        welcomeTips = document.getElementById('welcome-tips');
        cardVibe = document.getElementById('card-vibe');
        cardSpec = document.getElementById('card-spec');
        toolHistoryArea = document.getElementById('tool-history-area');
        pendingMessage = document.getElementById('pending-message');
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
        infoSpan.textContent = 'Your tool call history is stored in VS Code globalStorage/tool-history.json';
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

    function bindEventListeners() {
        if (chatInput) {
            chatInput.addEventListener('input', handleTextareaInput);
            chatInput.addEventListener('keydown', handleTextareaKeydown);
            chatInput.addEventListener('paste', handlePaste);
        }
        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (attachBtn) attachBtn.addEventListener('click', handleAttach);
        if (modeBtn) modeBtn.addEventListener('click', toggleModeDropdown);

        document.querySelectorAll('.mode-option').forEach(function (option) {
            option.addEventListener('click', function () {
                setMode(option.getAttribute('data-mode'), true);
                closeModeDropdown();
            });
        });

        document.addEventListener('click', function (e) {
            if (dropdownOpen && !e.target.closest('.mode-selector') && !e.target.closest('.mode-dropdown')) closeModeDropdown();
            if (autocompleteVisible && !e.target.closest('.autocomplete-dropdown') && !e.target.closest('#chat-input')) hideAutocomplete();
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
        updateTips(card);
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

    function updateTips(card) {
        if (!welcomeTips) return;
        var tipsList = welcomeTips.querySelector('.tips-list');
        if (!tipsList) return;
        if (card === 'normal') {
            // Normal mode tips
            tipsList.innerHTML = '<li>Full control over each response</li><li>Complex multi-step tasks</li><li>Detailed feedback to AI</li>';
        } else {
            // Queue mode tips
            tipsList.innerHTML = '<li>Automating repetitive AI interactions</li><li>Batch processing multiple prompts</li><li>Hands-free workflow execution</li>';
        }
    }

    function autoResizeTextarea() {
        if (!chatInput) return;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    }

    function handleTextareaInput() {
        autoResizeTextarea();
        handleAutocomplete();
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
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
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
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                confirmEditMode();
                return;
            }
            // Allow other keys in edit mode
            return;
        }

        if (autocompleteVisible) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedAutocompleteIndex < autocompleteResults.length - 1) { selectedAutocompleteIndex++; updateAutocompleteSelection(); } return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedAutocompleteIndex > 0) { selectedAutocompleteIndex--; updateAutocompleteSelection(); } return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && selectedAutocompleteIndex >= 0) { e.preventDefault(); selectAutocompleteItem(selectedAutocompleteIndex); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); handleSend(); }
    }

    function handleSend() {
        var text = chatInput ? chatInput.value.trim() : '';
        if (!text && currentAttachments.length === 0) return;

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
            if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; }
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

        if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; }
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
        document.querySelectorAll('.mode-option').forEach(function (opt) {
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
                updateTips(queueEnabled ? 'queue' : 'normal');
                // Hide welcome section if we have current session calls
                updateWelcomeSectionVisibility();
                break;
            case 'toolCallPending':
                console.log('[TaskSync Webview] toolCallPending - showing question:', message.prompt?.substring(0, 50));
                showPendingToolCall(message.id, message.prompt, message.isApprovalQuestion, message.choices);
                break;
            case 'toolCallCompleted':
                addToolCallToCurrentSession(message.entry);
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
                renderQueue();
                renderCurrentSession();
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
        if (currentChoices.length > 0) {
            showChoicesBar();
        } else if (isApprovalQuestion) {
            showApprovalModal();
        } else {
            hideApprovalModal();
            hideChoicesBar();
        }
    }

    function addToolCallToCurrentSession(entry) {
        pendingToolCall = null;

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
            pendingMessage.innerHTML = '<div class="working-indicator">Processing your response</div>';
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
            var cardHtml = '<div class="tool-call-card expanded" data-id="' + escapeHtml(tc.id) + '">' +
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

        // Render as expandable cards (same style as current session)
        var cardsHtml = persistedHistory.map(function (tc) {
            var firstSentence = tc.prompt.split(/[.!?]/)[0];
            var truncatedTitle = firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
            var queueBadge = tc.isFromQueue ? '<span class="tool-call-badge queue">Queue</span>' : '';

            // Build expandable card HTML (collapsed by default in modal)
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
                '</div>' +
                '</div></div>';
        }).join('');

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

    function formatMarkdown(text) {
        if (!text) return '';

        // Normalize line endings (Windows \r\n to \n)
        var processedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Store code blocks BEFORE escaping HTML to preserve backticks
        var codeBlocks = [];
        var mermaidBlocks = [];

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

        // Unordered lists (- item or * item)
        html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
        // Wrap consecutive <li> in <ul>
        html = html.replace(/(<li>.*<\/li>\n?)+/g, function (match) {
            return '<ul>' + match.replace(/\n/g, '') + '</ul>';
        });

        // Ordered lists (1. item)
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
        // Wrap consecutive <oli> in <ol> then convert to li
        html = html.replace(/(<oli>.*<\/oli>\n?)+/g, function (match) {
            return '<ol>' + match.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>').replace(/\n/g, '') + '</ol>';
        });

        // Markdown tables
        // Match table pattern: header row, separator row (with dashes), and data rows
        // Performance: Limit table size to prevent regex backtracking on huge content
        var MAX_TABLE_ROWS = 100;
        html = html.replace(/((?:^\|[^\n]+\|\n?){2,})/gm, function (tableMatch) {
            var lines = tableMatch.trim().split('\n');
            if (lines.length < 2) return tableMatch; // Need at least header and separator
            if (lines.length > MAX_TABLE_ROWS) return tableMatch; // Skip very large tables

            // Check if second line is separator (contains only |, -, :, spaces)
            var separatorRegex = /^\|[\s\-:|]+\|$/;
            if (!separatorRegex.test(lines[1])) return tableMatch;

            // Parse header
            var headerCells = lines[0].split('|').filter(function (c) { return c.trim() !== ''; });
            if (headerCells.length === 0) return tableMatch; // Invalid table

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
        });

        // Inline code (`code`)
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // Bold (**text** or __text__)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Italic (*text* or _text_)
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

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
        promptQueue.push({ id: id, prompt: prompt.trim() });
        renderQueue();
        // Expand queue section when adding items so user can see what was added
        if (queueSection) queueSection.classList.remove('collapsed');
        vscode.postMessage({ type: 'addQueuePrompt', prompt: prompt.trim(), id: id });
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
            return '<div class="queue-item" data-id="' + escapeHtml(item.id) + '" data-index="' + index + '" tabindex="0" draggable="true">' +
                '<span class="bullet ' + bulletClass + '"></span>' +
                '<span class="text" title="' + escapeHtml(item.prompt) + '">' + (index + 1) + '. ' + escapeHtml(truncatedPrompt) + '</span>' +
                '<div class="queue-item-actions">' +
                '<button class="edit-btn" data-id="' + escapeHtml(item.id) + '" title="Edit"><span class="codicon codicon-edit"></span></button>' +
                '<button class="remove-btn" data-id="' + escapeHtml(item.id) + '" title="Remove"><span class="codicon codicon-close"></span></button>' +
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
            updateSendButtonState();
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
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        saveWebviewState();
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
            if (att.isTemporary || !att.isTextReference) return;
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
