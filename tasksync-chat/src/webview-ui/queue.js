// ==================== Queue Management ====================

function addToQueue(prompt) {
	if (!prompt || !prompt.trim()) return;
	// ID format must match VALID_QUEUE_ID_PATTERN in remoteConstants.ts
	let id =
		"q_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
	// Store attachments with the queue item
	let attachmentsToStore =
		currentAttachments.length > 0 ? currentAttachments.slice() : undefined;
	promptQueue.push({
		id: id,
		prompt: prompt.trim(),
		attachments: attachmentsToStore,
	});
	renderQueue();
	// Expand queue section when adding items so user can see what was added
	if (queueSection) queueSection.classList.remove("collapsed");
	// Send to backend with attachments
	vscode.postMessage({
		type: "addQueuePrompt",
		prompt: prompt.trim(),
		id: id,
		attachments: attachmentsToStore || [],
	});
	// Clear attachments after adding to queue (they're now stored with the queue item)
	currentAttachments = [];
	updateChipsDisplay();
}

function removeFromQueue(id) {
	promptQueue = promptQueue.filter(function (item) {
		return item.id !== id;
	});
	renderQueue();
	vscode.postMessage({ type: "removeQueuePrompt", promptId: id });
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

	queueList.innerHTML = promptQueue
		.map(function (item, index) {
			let bulletClass = index === 0 ? "active" : "pending";
			let truncatedPrompt =
				item.prompt.length > 80
					? item.prompt.substring(0, 80) + "..."
					: item.prompt;
			// Show attachment indicator if this queue item has attachments
			let attachmentBadge =
				item.attachments && item.attachments.length > 0
					? '<span class="queue-item-attachment-badge" title="' +
						item.attachments.length +
						' attachment(s)" aria-label="' +
						item.attachments.length +
						' attachments"><span class="codicon codicon-file-media" aria-hidden="true"></span></span>'
					: "";
			return (
				'<div class="queue-item" data-id="' +
				escapeHtml(item.id) +
				'" data-index="' +
				index +
				'" tabindex="0" draggable="true" role="listitem" aria-label="Queue item ' +
				(index + 1) +
				": " +
				escapeHtml(truncatedPrompt) +
				'">' +
				'<span class="bullet ' +
				bulletClass +
				'" aria-hidden="true"></span>' +
				'<span class="text" title="' +
				escapeHtml(item.prompt) +
				'">' +
				(index + 1) +
				". " +
				escapeHtml(truncatedPrompt) +
				"</span>" +
				attachmentBadge +
				'<div class="queue-item-actions">' +
				'<button class="edit-btn" data-id="' +
				escapeHtml(item.id) +
				'" title="Edit" aria-label="Edit queue item ' +
				(index + 1) +
				'"><span class="codicon codicon-edit" aria-hidden="true"></span></button>' +
				'<button class="remove-btn" data-id="' +
				escapeHtml(item.id) +
				'" title="Remove" aria-label="Remove queue item ' +
				(index + 1) +
				'"><span class="codicon codicon-close" aria-hidden="true"></span></button>' +
				"</div></div>"
			);
		})
		.join("");

	queueList.querySelectorAll(".remove-btn").forEach(function (btn) {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			let id = btn.getAttribute("data-id");
			if (id) removeFromQueue(id);
		});
	});

	queueList.querySelectorAll(".edit-btn").forEach(function (btn) {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			let id = btn.getAttribute("data-id");
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

	let item = promptQueue.find(function (p) {
		return p.id === id;
	});
	if (!item) return;

	// Save current state
	editingPromptId = id;
	editingOriginalPrompt = item.prompt;
	savedInputValue = chatInput ? chatInput.value : "";

	// Mark queue item as being edited
	let queueItem = queueList.querySelector('.queue-item[data-id="' + id + '"]');
	if (queueItem) {
		queueItem.classList.add("editing");
	}

	// Switch to edit mode UI
	enterEditMode(item.prompt);
}

function enterEditMode(promptText) {
	// Hide normal actions, show edit actions
	if (actionsLeft) actionsLeft.classList.add("hidden");
	if (sendBtn) sendBtn.classList.add("hidden");
	if (editActionsContainer) editActionsContainer.classList.remove("hidden");

	// Mark input container as in edit mode
	if (inputContainer) {
		inputContainer.classList.add("edit-mode");
		inputContainer.setAttribute("aria-label", "Editing queue prompt");
	}

	// Set input value to the prompt being edited
	if (chatInput) {
		chatInput.value = promptText;
		chatInput.setAttribute(
			"aria-label",
			"Edit prompt text. Press Enter to confirm, Escape to cancel.",
		);
		chatInput.focus();
		// Move cursor to end
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		autoResizeTextarea();
	}
}

function exitEditMode() {
	// Show normal actions, hide edit actions
	if (actionsLeft) actionsLeft.classList.remove("hidden");
	if (sendBtn) sendBtn.classList.remove("hidden");
	if (editActionsContainer) editActionsContainer.classList.add("hidden");

	// Remove edit mode class from input container
	if (inputContainer) {
		inputContainer.classList.remove("edit-mode");
		inputContainer.removeAttribute("aria-label");
	}

	// Remove editing class from queue item
	if (queueList) {
		let editingItem = queueList.querySelector(".queue-item.editing");
		if (editingItem) editingItem.classList.remove("editing");
	}

	// Restore original input value and accessibility
	if (chatInput) {
		chatInput.value = savedInputValue;
		chatInput.setAttribute("aria-label", "Message input");
		autoResizeTextarea();
	}

	// Reset edit state
	editingPromptId = null;
	editingOriginalPrompt = null;
	savedInputValue = "";
}

function confirmEditMode() {
	if (!editingPromptId) return;

	let newValue = chatInput ? chatInput.value.trim() : "";

	if (!newValue) {
		// If empty, remove the prompt
		removeFromQueue(editingPromptId);
	} else if (newValue !== editingOriginalPrompt) {
		// Update the prompt
		let item = promptQueue.find(function (p) {
			return p.id === editingPromptId;
		});
		if (item) {
			item.prompt = newValue;
			vscode.postMessage({
				type: "editQueuePrompt",
				promptId: editingPromptId,
				newPrompt: newValue,
			});
		}
	}

	// Clear saved input - we don't want to restore old value after editing
	savedInputValue = "";

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
	vscode.postMessage({
		type: "submit",
		sessionId: activeSessionId,
		toolCallId: pendingToolCall ? pendingToolCall.id : null,
		value: "yes",
		attachments: [],
	});
	// In remote mode, show "Processing your response" optimistically while awaiting server round-trip
	if (isRemoteMode) {
		pendingToolCall = null;
		isProcessingResponse = true;
		updatePendingUI();
	}
	if (chatInput) {
		chatInput.value = "";
		chatInput.style.height = "auto";
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
			chatInput.value = "No, ";
			chatInput.setSelectionRange(
				chatInput.value.length,
				chatInput.value.length,
			);
		}
		autoResizeTextarea();
		updateInputHighlighter();
		updateSendButtonState();
		saveWebviewState();
	}
}
