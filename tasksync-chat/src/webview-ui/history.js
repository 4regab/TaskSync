// ==================== History Modal ====================

function openHistoryModal() {
	if (!historyModalOverlay) return;

	if (isRemoteMode) {
		// Remote mode: use currentSessionCalls as history source (already available)
		// Map to persistedHistory format for renderHistoryModal
		persistedHistory = (currentSessionCalls || []).slice().reverse();
		renderHistoryModal();
	} else {
		// VS Code mode: request persisted history from extension
		vscode.postMessage({ type: "openHistoryModal" });
	}

	historyModalOverlay.classList.remove("hidden");
	focusDialogSurface(historyModalOverlay, "#history-modal");
}

function closeHistoryModal() {
	if (!historyModalOverlay) return;
	historyModalOverlay.classList.add("hidden");
	restoreDialogFocus(historyModalOverlay);
}

function clearAllPersistedHistory() {
	if (persistedHistory.length === 0) return;
	vscode.postMessage({ type: "clearPersistedHistory" });
	persistedHistory = [];
	renderHistoryModal();
}

function initCardSelection() {
	if (cardVibe) {
		cardVibe.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			selectCard("normal", true);
		});
	}
	if (cardSpec) {
		cardSpec.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			selectCard("queue", true);
		});
	}
	// Don't set default here - wait for updateQueue message from extension
	// which contains the persisted enabled state
	updateCardSelection();
}

function selectCard(card, notify) {
	selectedCard = card;
	queueEnabled = card === "queue";
	updateCardSelection();
	updateModeUI();
	updateQueueVisibility();

	// Only notify extension if user clicked (not on init from persisted state)
	if (notify) {
		vscode.postMessage({ type: "toggleQueue", enabled: queueEnabled });
	}
}

function updateCardSelection() {
	// card-vibe = Normal mode, card-spec = Queue mode
	if (cardVibe) cardVibe.classList.toggle("selected", !queueEnabled);
	if (cardSpec) cardSpec.classList.toggle("selected", queueEnabled);
}
