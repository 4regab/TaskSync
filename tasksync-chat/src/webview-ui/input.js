// ==================== Input Handling ====================

// Cached input history (invalidated when currentSessionCalls changes)
var _inputHistoryCache = null;
var _inputHistoryCacheLen = -1;

/**
 * Build a deduplicated list of past user-typed responses (newest first)
 * from the existing tool-call history. Filters out queued/autopilot responses,
 * cancelled entries, approval shortcuts, and very short responses.
 * Capped at 50 entries. Cached until session length changes.
 */
function getInputHistory() {
	var sessionLen = currentSessionCalls ? currentSessionCalls.length : 0;
	if (_inputHistoryCache && _inputHistoryCacheLen === sessionLen) {
		return _inputHistoryCache;
	}
	var all = (currentSessionCalls || []).concat(persistedHistory || []);
	var seen = {};
	var result = [];
	for (var i = 0; i < all.length; i++) {
		if (result.length >= 50) break;
		var e = all[i];
		if (
			e.status === "completed" &&
			!e.isFromQueue &&
			e.response &&
			e.response.trim().length > 3
		) {
			var text = e.response.trim();
			if (!seen[text]) {
				seen[text] = true;
				result.push(text);
			}
		}
	}
	_inputHistoryCache = result;
	_inputHistoryCacheLen = sessionLen;
	return result;
}

/**
 * Check if the cursor is on the first line of a textarea.
 */
function isCursorOnFirstLine() {
	if (!chatInput) return true;
	var text = chatInput.value;
	var pos = chatInput.selectionStart;
	return text.lastIndexOf("\n", pos - 1) === -1;
}

/**
 * Check if the cursor is on the last line of a textarea.
 */
function isCursorOnLastLine() {
	if (!chatInput) return true;
	var text = chatInput.value;
	var pos = chatInput.selectionEnd;
	return text.indexOf("\n", pos) === -1;
}

function autoResizeTextarea() {
	if (!chatInput) return;
	chatInput.style.height = "auto";
	chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
}

/**
 * Update the input highlighter overlay to show syntax highlighting
 * for slash commands (/command) and file references (#file)
 */
function updateInputHighlighter() {
	if (!inputHighlighter || !chatInput) return;

	let text = chatInput.value;
	if (!text) {
		inputHighlighter.innerHTML = "";
		return;
	}

	// Build a list of known slash command names for exact matching
	let knownSlashNames = reusablePrompts.map(function (p) {
		return p.name;
	});
	// Also add any pending stored mappings
	let mappings = chatInput._slashPrompts || {};
	Object.keys(mappings).forEach(function (name) {
		if (knownSlashNames.indexOf(name) === -1) knownSlashNames.push(name);
	});

	// Escape HTML first
	let html = escapeHtml(text);

	// Highlight slash commands - match /word patterns
	// Only highlight if it's a known command OR any /word pattern
	html = html.replace(
		/(^|\s)(\/[a-zA-Z0-9_-]+)(\s|$)/g,
		function (match, before, slash, after) {
			let cmdName = slash.substring(1); // Remove the /
			// Highlight if it's a known command or if we have prompts defined
			if (
				knownSlashNames.length === 0 ||
				knownSlashNames.indexOf(cmdName) >= 0
			) {
				return (
					before + '<span class="slash-highlight">' + slash + "</span>" + after
				);
			}
			// Still highlight as generic slash command
			return (
				before + '<span class="slash-highlight">' + slash + "</span>" + after
			);
		},
	);

	// Highlight file references - match #word patterns
	html = html.replace(
		/(^|\s)(#[a-zA-Z0-9_.\/-]+)(\s|$)/g,
		function (match, before, hash, after) {
			return (
				before + '<span class="hash-highlight">' + hash + "</span>" + after
			);
		},
	);

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
	// Reset history position on manual edits — edited text becomes the new "draft"
	historyIndex = -1;
	// Persist input value so it survives sidebar tab switches
	saveWebviewState();
}

function updateSendButtonState() {
	if (!sendBtn || !chatInput) return;
	let hasText = chatInput.value.trim().length > 0;
	sendBtn.classList.toggle("has-text", hasText);
}

function handleTextareaKeydown(e) {
	// Handle approval modal keyboard shortcuts when visible
	if (
		isApprovalQuestion &&
		approvalModal &&
		!approvalModal.classList.contains("hidden")
	) {
		// Enter sends "Continue" when approval modal is visible and input is empty
		if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			let inputText = chatInput ? chatInput.value.trim() : "";
			if (!inputText) {
				e.preventDefault();
				handleApprovalContinue();
				return;
			}
			// If there's text, fall through to normal send behavior
		}
		// Escape dismisses approval modal
		if (e.key === "Escape") {
			e.preventDefault();
			handleApprovalNo();
			return;
		}
	}

	// Handle edit mode keyboard shortcuts
	if (editingPromptId) {
		if (e.key === "Escape") {
			e.preventDefault();
			cancelEditMode();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			confirmEditMode();
			return;
		}
		// Allow other keys in edit mode
		return;
	}

	// Handle slash command dropdown navigation
	if (slashDropdownVisible) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (selectedSlashIndex < slashResults.length - 1) {
				selectedSlashIndex++;
				updateSlashSelection();
			}
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (selectedSlashIndex > 0) {
				selectedSlashIndex--;
				updateSlashSelection();
			}
			return;
		}
		if ((e.key === "Enter" || e.key === "Tab") && selectedSlashIndex >= 0) {
			e.preventDefault();
			selectSlashItem(selectedSlashIndex);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			hideSlashDropdown();
			return;
		}
	}

	if (autocompleteVisible) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (selectedAutocompleteIndex < autocompleteResults.length - 1) {
				selectedAutocompleteIndex++;
				updateAutocompleteSelection();
			}
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (selectedAutocompleteIndex > 0) {
				selectedAutocompleteIndex--;
				updateAutocompleteSelection();
			}
			return;
		}
		if (
			(e.key === "Enter" || e.key === "Tab") &&
			selectedAutocompleteIndex >= 0
		) {
			e.preventDefault();
			selectAutocompleteItem(selectedAutocompleteIndex);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			hideAutocomplete();
			return;
		}
	}

	// Context dropdown navigation removed - context now uses # via file autocomplete

	// Up/Down arrow: cycle through past user responses when no dropdown is active
	if (e.key === "ArrowUp") {
		if (isCursorOnFirstLine()) {
			var history = getInputHistory();
			if (history.length > 0) {
				e.preventDefault();
				if (historyIndex === -1) {
					// Starting navigation — save current draft
					historyDraft = chatInput ? chatInput.value : "";
					historyIndex = 0;
				} else if (historyIndex < history.length - 1) {
					historyIndex++;
				}
				if (chatInput) {
					chatInput.value = history[historyIndex];
					chatInput.selectionStart = chatInput.selectionEnd = 0;
					autoResizeTextarea();
					updateInputHighlighter();
					updateSendButtonState();
				}
				return;
			}
		}
	}

	if (e.key === "ArrowDown" && historyIndex >= 0 && isCursorOnLastLine()) {
		e.preventDefault();
		var historyDown = getInputHistory();
		if (historyIndex > 0) {
			historyIndex--;
			if (chatInput) {
				chatInput.value = historyDown[historyIndex];
				chatInput.selectionStart = chatInput.selectionEnd = 0;
				autoResizeTextarea();
				updateInputHighlighter();
				updateSendButtonState();
			}
		} else {
			// Past newest entry — restore draft
			historyIndex = -1;
			if (chatInput) {
				chatInput.value = historyDraft;
				autoResizeTextarea();
				updateInputHighlighter();
				updateSendButtonState();
			}
		}
		return;
	}

	let isPlainEnter =
		e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;
	let isCtrlOrCmdEnter =
		e.key === "Enter" && !e.shiftKey && (e.ctrlKey || e.metaKey);

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

	if (
		isApprovalQuestion &&
		approvalModal &&
		!approvalModal.classList.contains("hidden")
	) {
		let inputText = chatInput.value.trim();
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
	// Reset history navigation and invalidate cache on every send
	historyIndex = -1;
	historyDraft = "";
	_inputHistoryCache = null;

	let text = chatInput ? chatInput.value.trim() : "";
	if (!text && currentAttachments.length === 0) {
		// If choices are selected and input is empty, send the selected choices
		let choicesBar = document.getElementById("choices-bar");
		if (choicesBar && !choicesBar.classList.contains("hidden")) {
			let selectedButtons = choicesBar.querySelectorAll(".choice-btn.selected");
			if (selectedButtons.length > 0) {
				handleChoicesSend();
				return;
			}
		}
		return;
	}

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
			vscode.postMessage({ type: "toggleQueue", enabled: true });
		}
		if (chatInput) {
			chatInput.value = "";
			chatInput.style.height = "auto";
			updateInputHighlighter();
		}
		currentAttachments = [];
		updateChipsDisplay();
		updateSendButtonState();
		// Clear persisted state after sending
		saveWebviewState();
		return;
	}

	// In remote mode with no pending tool call and no active session,
	// bypass queue mode and use direct chat for immediate response.
	var bypassQueueForChat =
		isRemoteMode &&
		!pendingToolCall &&
		text &&
		currentSessionCalls.length === 0;
	debugLog(
		"handleSend: isRemote:",
		isRemoteMode,
		"bypass:",
		bypassQueueForChat,
		"queue:",
		queueEnabled,
		"sessions:",
		currentSessionCalls.length,
	);

	if (!bypassQueueForChat && queueEnabled && text && !pendingToolCall) {
		debugLog("handleSend: → addToQueue");
		addToQueue(text);
	} else if (isRemoteMode && !pendingToolCall && text) {
		debugLog("handleSend: → chatMessage");
		addChatStreamUserBubble(text);
		vscode.postMessage({ type: "chatMessage", content: text });
		// Show "Processing your response" immediately so the user sees the same state as the main UI
		isProcessingResponse = true;
		updatePendingUI();
	} else {
		vscode.postMessage({
			type: "submit",
			value: text,
			attachments: currentAttachments,
		});
		// In remote mode, show "Processing your response" optimistically while awaiting server round-trip
		if (isRemoteMode && pendingToolCall) {
			pendingToolCall = null;
			isProcessingResponse = true;
			updatePendingUI();
		}
	}

	if (chatInput) {
		chatInput.value = "";
		chatInput.style.height = "auto";
		updateInputHighlighter();
	}
	currentAttachments = [];
	updateChipsDisplay();
	updateSendButtonState();
	// Clear persisted state after sending
	saveWebviewState();
}

function handleAttach() {
	vscode.postMessage({ type: "addAttachment" });
}

function toggleModeDropdown(e) {
	e.stopPropagation();
	if (dropdownOpen) closeModeDropdown();
	else {
		dropdownOpen = true;
		positionModeDropdown();
		modeDropdown.classList.remove("hidden");
		modeDropdown.classList.add("visible");
	}
}

function positionModeDropdown() {
	if (!modeDropdown || !modeBtn) return;
	let rect = modeBtn.getBoundingClientRect();
	modeDropdown.style.bottom = window.innerHeight - rect.top + 4 + "px";
	modeDropdown.style.left = rect.left + "px";
}

function closeModeDropdown() {
	dropdownOpen = false;
	if (modeDropdown) {
		modeDropdown.classList.remove("visible");
		modeDropdown.classList.add("hidden");
	}
}

function setMode(mode, notify) {
	queueEnabled = mode === "queue";
	updateModeUI();
	updateQueueVisibility();
	updateCardSelection();
	if (notify)
		vscode.postMessage({ type: "toggleQueue", enabled: queueEnabled });
}

function updateModeUI() {
	if (modeLabel) modeLabel.textContent = queueEnabled ? "Queue" : "Normal";
	document.querySelectorAll(".mode-option[data-mode]").forEach(function (opt) {
		opt.classList.toggle(
			"selected",
			opt.getAttribute("data-mode") === (queueEnabled ? "queue" : "normal"),
		);
	});
}

function updateQueueVisibility() {
	if (!queueSection) return;
	// Hide queue section if: not in queue mode OR queue is empty
	let shouldHide = !queueEnabled || promptQueue.length === 0;
	let wasHidden = queueSection.classList.contains("hidden");
	queueSection.classList.toggle("hidden", shouldHide);
	// Only collapse when showing for the FIRST time (was hidden, now visible)
	// Don't collapse on subsequent updates to preserve user's expanded state
	if (wasHidden && !shouldHide && promptQueue.length > 0) {
		queueSection.classList.add("collapsed");
	}
}

function handleQueueHeaderClick() {
	if (queueSection) queueSection.classList.toggle("collapsed");
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
