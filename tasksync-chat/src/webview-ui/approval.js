// ==================== Approval Modal ====================

/**
 * Show approval modal
 */
function showApprovalModal() {
	if (!approvalModal) return;
	approvalModal.classList.remove("hidden");
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
	approvalModal.classList.add("hidden");
	isApprovalQuestion = false;
}

/**
 * Show choices bar with toggleable multi-select buttons
 */
function showChoicesBar() {
	// Hide approval modal first
	hideApprovalModal();

	// Create or get choices bar
	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) {
		choicesBar = document.createElement("div");
		choicesBar.className = "choices-bar";
		choicesBar.id = "choices-bar";
		choicesBar.setAttribute("role", "toolbar");
		choicesBar.setAttribute("aria-label", "Quick choice options");

		// Insert at top of input-wrapper
		let inputWrapper = document.getElementById("input-wrapper");
		if (inputWrapper) {
			inputWrapper.insertBefore(choicesBar, inputWrapper.firstChild);
		}
	}

	// Build toggleable choice buttons
	let buttonsHtml = currentChoices
		.map(function (choice) {
			let shortLabel = choice.shortLabel || choice.value;
			let title = choice.label || choice.value;
			return (
				'<button class="choice-btn" data-value="' +
				escapeHtml(choice.value) +
				'" ' +
				'title="' +
				escapeHtml(title) +
				'" ' +
				'aria-pressed="false">' +
				escapeHtml(shortLabel) +
				"</button>"
			);
		})
		.join("");

	choicesBar.innerHTML =
		'<span class="choices-label">Choose:</span>' +
		'<div class="choices-buttons">' +
		buttonsHtml +
		"</div>" +
		'<div class="choices-actions">' +
		'<button class="choices-action-btn choices-all-btn" title="Select all" aria-label="Select all">All</button>' +
		'<button class="choices-action-btn choices-send-btn" title="Send selected" aria-label="Send selected choices" disabled>Send</button>' +
		"</div>";

	// Bind click events to choice buttons (toggle selection)
	choicesBar.querySelectorAll(".choice-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			handleChoiceToggle(btn);
		});
	});

	// Bind 'All' button
	let allBtn = choicesBar.querySelector(".choices-all-btn");
	if (allBtn) {
		allBtn.addEventListener("click", handleChoicesSelectAll);
	}

	// Bind 'Send' button
	let choicesSendBtn = choicesBar.querySelector(".choices-send-btn");
	if (choicesSendBtn) {
		choicesSendBtn.addEventListener("click", handleChoicesSend);
	}

	choicesBar.classList.remove("hidden");

	// Focus chat input for immediate typing
	if (chatInput) {
		chatInput.focus();
	}
}

/**
 * Hide choices bar
 */
function hideChoicesBar() {
	let choicesBar = document.getElementById("choices-bar");
	if (choicesBar) {
		choicesBar.classList.add("hidden");
	}
	currentChoices = [];
}

/**
 * Toggle a choice button's selected state
 */
function handleChoiceToggle(btn) {
	if (!pendingToolCall) return;

	let isSelected = btn.classList.toggle("selected");
	btn.setAttribute("aria-pressed", isSelected ? "true" : "false");

	updateChoicesSendButton();
}

/**
 * Toggle all choices selected/deselected
 */
function handleChoicesSelectAll() {
	if (!pendingToolCall) return;

	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let buttons = choicesBar.querySelectorAll(".choice-btn");
	let allSelected = Array.from(buttons).every(function (btn) {
		return btn.classList.contains("selected");
	});

	buttons.forEach(function (btn) {
		if (allSelected) {
			btn.classList.remove("selected");
			btn.setAttribute("aria-pressed", "false");
		} else {
			btn.classList.add("selected");
			btn.setAttribute("aria-pressed", "true");
		}
	});

	updateChoicesSendButton();
}

/**
 * Send all selected choices as a comma-separated response
 */
function handleChoicesSend() {
	if (!pendingToolCall) return;

	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let selectedButtons = choicesBar.querySelectorAll(".choice-btn.selected");
	if (selectedButtons.length === 0) return;

	let values = Array.from(selectedButtons).map(function (btn) {
		return btn.getAttribute("data-value");
	});
	let responseValue = values.join(", ");

	// Hide choices bar
	hideChoicesBar();

	// Send the response
	vscode.postMessage({ type: "submit", value: responseValue, attachments: [] });
	// In remote mode, show "Working…" optimistically while awaiting server round-trip
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
 * Update the Send button state and All button label based on current selections
 */
function updateChoicesSendButton() {
	let choicesBar = document.getElementById("choices-bar");
	if (!choicesBar) return;

	let selectedCount = choicesBar.querySelectorAll(
		".choice-btn.selected",
	).length;
	let totalCount = choicesBar.querySelectorAll(".choice-btn").length;
	let choicesSendBtn = choicesBar.querySelector(".choices-send-btn");
	let allBtn = choicesBar.querySelector(".choices-all-btn");

	if (choicesSendBtn) {
		choicesSendBtn.disabled = selectedCount === 0;
		choicesSendBtn.textContent =
			selectedCount > 0 ? "Send (" + selectedCount + ")" : "Send";
	}

	if (allBtn) {
		let isAllSelected = totalCount > 0 && selectedCount === totalCount;
		allBtn.textContent = isAllSelected ? "None" : "All";
		let allBtnActionLabel = isAllSelected ? "Deselect all" : "Select all";
		allBtn.title = allBtnActionLabel;
		allBtn.setAttribute("aria-label", allBtnActionLabel);
	}
}
