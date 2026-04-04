// ===== NOTIFICATION SOUND FUNCTION =====

/**
 * Unlock audio playback after first user interaction
 * Required due to browser autoplay policy
 */
function unlockAudioOnInteraction() {
	function unlock() {
		if (audioUnlocked) return;
		let audio = document.getElementById("notification-sound");
		if (audio) {
			// Play and immediately pause to unlock
			audio.volume = 0;
			let playPromise = audio.play();
			if (playPromise !== undefined) {
				playPromise
					.then(function () {
						audio.pause();
						audio.currentTime = 0;
						audio.volume = 0.5;
						audioUnlocked = true;
					})
					.catch(function () {
						// Still locked, will try again on next interaction
					});
			}
		}
		// Remove listeners after first attempt
		document.removeEventListener("click", unlock);
		document.removeEventListener("keydown", unlock);
	}
	document.addEventListener("click", unlock, { once: true });
	document.addEventListener("keydown", unlock, { once: true });
}

function playNotificationSound() {
	// Play the preloaded audio element
	try {
		let audio = document.getElementById("notification-sound");
		if (audio) {
			audio.currentTime = 0; // Reset to beginning
			audio.volume = 0.5;
			let playPromise = audio.play();
			if (playPromise !== undefined) {
				playPromise
					.then(function () {
						// Audio playback started
					})
					.catch(function (e) {
						// If autoplay blocked, show visual feedback
						flashNotification();
					});
			}
		} else {
			flashNotification();
		}
	} catch (e) {
		flashNotification();
	}
}

function flashNotification() {
	// Visual flash when audio fails
	let body = document.body;
	body.style.transition = "background-color 0.1s ease";
	let originalBg = body.style.backgroundColor;
	body.style.backgroundColor = "var(--vscode-textLink-foreground, #3794ff)";
	setTimeout(function () {
		body.style.backgroundColor = originalBg || "";
	}, 150);
}

function bindDragAndDrop() {
	if (!queueList) return;
	queueList.querySelectorAll(".queue-item").forEach(function (item) {
		item.addEventListener("dragstart", function (e) {
			e.dataTransfer.setData(
				"text/plain",
				String(parseInt(item.getAttribute("data-index"), 10)),
			);
			item.classList.add("dragging");
		});
		item.addEventListener("dragend", function () {
			item.classList.remove("dragging");
		});
		item.addEventListener("dragover", function (e) {
			e.preventDefault();
			item.classList.add("drag-over");
		});
		item.addEventListener("dragleave", function () {
			item.classList.remove("drag-over");
		});
		item.addEventListener("drop", function (e) {
			e.preventDefault();
			let fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
			let toIndex = parseInt(item.getAttribute("data-index"), 10);
			item.classList.remove("drag-over");
			if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex))
				reorderQueue(fromIndex, toIndex);
		});
	});
}

function bindKeyboardNavigation() {
	if (!queueList) return;
	let items = queueList.querySelectorAll(".queue-item");
	items.forEach(function (item, index) {
		item.addEventListener("keydown", function (e) {
			if (e.key === "ArrowDown" && index < items.length - 1) {
				e.preventDefault();
				items[index + 1].focus();
			} else if (e.key === "ArrowUp" && index > 0) {
				e.preventDefault();
				items[index - 1].focus();
			} else if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				var id = item.getAttribute("data-id");
				if (id) removeFromQueue(id);
			}
		});
	});
}

function reorderQueue(fromIndex, toIndex) {
	let removed = promptQueue.splice(fromIndex, 1)[0];
	promptQueue.splice(toIndex, 0, removed);
	renderQueue();
	vscode.postMessage({
		type: "reorderQueue",
		fromIndex: fromIndex,
		toIndex: toIndex,
	});
}

function handleAutocomplete() {
	if (!chatInput) return;
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;
	let hashPos = -1;
	for (var i = cursorPos - 1; i >= 0; i--) {
		if (value[i] === "#") {
			hashPos = i;
			break;
		}
		if (value[i] === " " || value[i] === "\n") break;
	}
	if (hashPos >= 0) {
		let query = value.substring(hashPos + 1, cursorPos);
		autocompleteStartPos = hashPos;
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(function () {
			vscode.postMessage({ type: "searchFiles", query: query });
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
		autocompleteList.classList.add("hidden");
		autocompleteEmpty.classList.remove("hidden");
	} else {
		autocompleteList.classList.remove("hidden");
		autocompleteEmpty.classList.add("hidden");
		renderAutocompleteList();
	}
	autocompleteDropdown.classList.remove("hidden");
	autocompleteVisible = true;
}

function hideAutocomplete() {
	if (autocompleteDropdown) autocompleteDropdown.classList.add("hidden");
	autocompleteVisible = false;
	autocompleteResults = [];
	selectedAutocompleteIndex = -1;
	autocompleteStartPos = -1;
	if (searchDebounceTimer) {
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = null;
	}
}

function renderAutocompleteList() {
	if (!autocompleteList) return;
	autocompleteList.innerHTML = autocompleteResults
		.map(function (file, index) {
			return (
				'<div class="autocomplete-item' +
				(index === selectedAutocompleteIndex ? " selected" : "") +
				'" data-index="' +
				index +
				'">' +
				'<span class="autocomplete-item-icon"><span class="codicon codicon-' +
				file.icon +
				'"></span></span>' +
				'<div class="autocomplete-item-content"><span class="autocomplete-item-name">' +
				escapeHtml(file.name) +
				"</span>" +
				'<span class="autocomplete-item-path">' +
				escapeHtml(file.path) +
				"</span></div></div>"
			);
		})
		.join("");

	autocompleteList
		.querySelectorAll(".autocomplete-item")
		.forEach(function (item) {
			item.addEventListener("click", function () {
				selectAutocompleteItem(parseInt(item.getAttribute("data-index"), 10));
			});
			item.addEventListener("mouseenter", function () {
				selectedAutocompleteIndex = parseInt(
					item.getAttribute("data-index"),
					10,
				);
				updateAutocompleteSelection();
			});
		});
	scrollToSelectedItem();
}

function updateAutocompleteSelection() {
	if (!autocompleteList) return;
	autocompleteList
		.querySelectorAll(".autocomplete-item")
		.forEach(function (item, index) {
			item.classList.toggle("selected", index === selectedAutocompleteIndex);
		});
	scrollToSelectedItem();
}

function scrollToSelectedItem() {
	let selectedItem = autocompleteList
		? autocompleteList.querySelector(".autocomplete-item.selected")
		: null;
	if (selectedItem)
		selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectAutocompleteItem(index) {
	if (
		index < 0 ||
		index >= autocompleteResults.length ||
		!chatInput ||
		autocompleteStartPos < 0
	)
		return;
	let file = autocompleteResults[index];
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Check if this is a context item (#terminal, #problems)
	if (file.isContext && file.uri && file.uri.startsWith("context://")) {
		// Remove the #query from input - chip will be added
		chatInput.value =
			value.substring(0, autocompleteStartPos) + value.substring(cursorPos);
		let newCursorPos = autocompleteStartPos;
		chatInput.setSelectionRange(newCursorPos, newCursorPos);

		// Send context reference request to backend
		vscode.postMessage({
			type: "selectContextReference",
			contextType: file.name, // 'terminal' or 'problems'
			options: undefined,
		});

		hideAutocomplete();
		chatInput.focus();
		autoResizeTextarea();
		updateInputHighlighter();
		saveWebviewState();
		updateSendButtonState();
		return;
	}

	// Tool reference — insert #toolName, no file attachment needed
	if (file.isTool) {
		let referenceText = "#" + file.name + " ";
		chatInput.value =
			value.substring(0, autocompleteStartPos) +
			referenceText +
			value.substring(cursorPos);
		let newCursorPos = autocompleteStartPos + referenceText.length;
		chatInput.setSelectionRange(newCursorPos, newCursorPos);
		hideAutocomplete();
		chatInput.focus();
		autoResizeTextarea();
		updateInputHighlighter();
		saveWebviewState();
		updateSendButtonState();
		return;
	}

	// Regular file/folder reference
	let referenceText = "#" + file.name + " ";
	chatInput.value =
		value.substring(0, autocompleteStartPos) +
		referenceText +
		value.substring(cursorPos);
	let newCursorPos = autocompleteStartPos + referenceText.length;
	chatInput.setSelectionRange(newCursorPos, newCursorPos);
	vscode.postMessage({ type: "addFileReference", file: file });
	hideAutocomplete();
	chatInput.focus();
}

function syncAttachmentsWithText() {
	let text = chatInput ? chatInput.value : "";
	let toRemove = [];
	currentAttachments.forEach(function (att) {
		// Skip temporary attachments (like pasted images)
		if (att.isTemporary) return;
		// Skip context attachments (#terminal, #problems) - they use context:// URI
		if (att.uri && att.uri.startsWith("context://")) return;
		// Only sync file references that have isTextReference flag
		if (!att.isTextReference) return;
		// Check if the #filename reference still exists in text
		if (text.indexOf("#" + att.name) === -1) toRemove.push(att.id);
	});
	if (toRemove.length > 0) {
		toRemove.forEach(function (id) {
			vscode.postMessage({ type: "removeAttachment", attachmentId: id });
		});
		currentAttachments = currentAttachments.filter(function (a) {
			return toRemove.indexOf(a.id) === -1;
		});
		updateChipsDisplay();
	}
}

function handlePaste(event) {
	if (!event.clipboardData) return;
	let items = event.clipboardData.items;
	for (var i = 0; i < items.length; i++) {
		if (items[i].type.indexOf("image/") === 0) {
			event.preventDefault();
			let file = items[i].getAsFile();
			if (file) processImageFile(file);
			return;
		}
	}
}

/**
 * Capture latest right-click position for context-menu copy resolution.
 */
function handleContextMenu(event) {
	if (!event || !event.target || !event.target.closest) {
		lastContextMenuTarget = null;
		lastContextMenuTimestamp = 0;
		return;
	}

	lastContextMenuTarget = event.target;
	lastContextMenuTimestamp = Date.now();
}

/**
 * Override Copy when nothing is selected and context-menu target points to a message.
 */
function handleCopy(event) {
	let selection = window.getSelection ? window.getSelection() : null;
	if (selection && selection.toString().length > 0) {
		return;
	}

	if (
		!lastContextMenuTarget ||
		Date.now() - lastContextMenuTimestamp > CONTEXT_MENU_COPY_MAX_AGE_MS
	) {
		return;
	}

	let copyText = resolveCopyTextFromTarget(lastContextMenuTarget);
	if (!copyText) {
		return;
	}

	if (event) {
		event.preventDefault();
	}

	if (event && event.clipboardData) {
		try {
			event.clipboardData.setData("text/plain", copyText);
			lastContextMenuTarget = null;
			lastContextMenuTimestamp = 0;
			return;
		} catch (error) {
			// Fall through to extension host clipboard API fallback.
		}
	}

	vscode.postMessage({ type: "copyToClipboard", text: copyText });
	lastContextMenuTarget = null;
	lastContextMenuTimestamp = 0;
}

/**
 * Resolve copy payload from the exact message area that was right-clicked.
 */
function resolveCopyTextFromTarget(target) {
	if (!target || !target.closest) {
		return "";
	}

	let pendingQuestion = target.closest(".pending-ai-question");
	if (pendingQuestion) {
		if (pendingToolCall && typeof pendingToolCall.prompt === "string") {
			return pendingToolCall.prompt;
		}
		return (pendingQuestion.textContent || "").trim();
	}

	let toolCallEntry = resolveToolCallEntryFromTarget(target);
	if (!toolCallEntry) {
		return "";
	}

	if (target.closest(".tool-call-ai-response")) {
		return typeof toolCallEntry.prompt === "string" ? toolCallEntry.prompt : "";
	}

	if (target.closest(".tool-call-user-response")) {
		return typeof toolCallEntry.response === "string"
			? toolCallEntry.response
			: "";
	}

	if (target.closest(".chips-container")) {
		return formatAttachmentsForCopy(toolCallEntry.attachments);
	}

	return formatToolCallEntryForCopy(toolCallEntry);
}

/**
 * Resolve a tool call entry by traversing from a DOM target to its card id.
 */
function resolveToolCallEntryFromTarget(target) {
	let card = target.closest(".tool-call-card");
	if (!card) {
		return null;
	}

	return resolveToolCallEntryFromCardId(card.getAttribute("data-id"));
}

/**
 * Find a tool call entry in current session first, then persisted history.
 */
function resolveToolCallEntryFromCardId(cardId) {
	if (!cardId) {
		return null;
	}

	let currentEntry = currentSessionCalls.find(function (tc) {
		return tc.id === cardId;
	});
	if (currentEntry) {
		return currentEntry;
	}

	let persistedEntry = persistedHistory.find(function (tc) {
		return tc.id === cardId;
	});
	return persistedEntry || null;
}

/**
 * Compose full card copy output when right-click happened outside a specific message block.
 */
function formatToolCallEntryForCopy(entry) {
	if (!entry) {
		return "";
	}

	let parts = [];
	if (typeof entry.prompt === "string" && entry.prompt.length > 0) {
		parts.push(entry.prompt);
	}
	if (typeof entry.response === "string" && entry.response.length > 0) {
		parts.push(entry.response);
	}

	let attachmentsText = formatAttachmentsForCopy(entry.attachments);
	if (attachmentsText) {
		parts.push(attachmentsText);
	}

	return parts.join("\n\n");
}

/**
 * Convert attachment list to plain text while preserving stored attachment names.
 */
function formatAttachmentsForCopy(attachments) {
	if (!attachments || attachments.length === 0) {
		return "";
	}

	return attachments
		.map(function (att) {
			if (att && typeof att.name === "string" && att.name.length > 0) {
				return att.name;
			}
			return att && typeof att.uri === "string" ? att.uri : "";
		})
		.filter(function (value) {
			return value.length > 0;
		})
		.join("\n");
}

function processImageFile(file) {
	let reader = new FileReader();
	reader.onload = function (e) {
		if (e.target && e.target.result)
			vscode.postMessage({
				type: "saveImage",
				data: e.target.result,
				mimeType: file.type,
			});
	};
	reader.readAsDataURL(file);
}

function updateChipsDisplay() {
	if (!chipsContainer) return;
	if (currentAttachments.length === 0) {
		chipsContainer.classList.add("hidden");
		chipsContainer.innerHTML = "";
	} else {
		chipsContainer.classList.remove("hidden");
		chipsContainer.innerHTML = currentAttachments
			.map(function (att) {
				let isImage =
					att.isTemporary || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
				let iconClass = att.isFolder
					? "folder"
					: isImage
						? "file-media"
						: "file";
				let displayName = att.isTemporary ? "Pasted Image" : att.name;
				return (
					'<div class="chip" data-id="' +
					att.id +
					'" title="' +
					escapeHtml(att.uri || att.name) +
					'">' +
					'<span class="chip-icon"><span class="codicon codicon-' +
					iconClass +
					'"></span></span>' +
					'<span class="chip-text">' +
					escapeHtml(displayName) +
					"</span>" +
					'<button class="chip-remove" data-remove="' +
					att.id +
					'" title="Remove"><span class="codicon codicon-close"></span></button></div>'
				);
			})
			.join("");

		chipsContainer.querySelectorAll(".chip-remove").forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				const attId = btn.getAttribute("data-remove");
				if (attId) removeAttachment(attId);
			});
		});
	}
	// Persist attachments so they survive sidebar tab switches
	saveWebviewState();
}

function removeAttachment(attachmentId) {
	vscode.postMessage({ type: "removeAttachment", attachmentId: attachmentId });
	currentAttachments = currentAttachments.filter(function (a) {
		return a.id !== attachmentId;
	});
	updateChipsDisplay();
	// saveWebviewState() is called in updateChipsDisplay
}

function escapeHtml(str) {
	if (!str) return "";
	let div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

function renderAttachmentsHtml(attachments) {
	if (!attachments || attachments.length === 0) return "";
	let items = attachments
		.map(function (att) {
			let iconClass = "file";
			if (att.isFolder) iconClass = "folder";
			else if (
				att.name &&
				(att.name.endsWith(".png") ||
					att.name.endsWith(".jpg") ||
					att.name.endsWith(".jpeg"))
			)
				iconClass = "file-media";
			else if ((att.uri || "").indexOf("context://terminal") !== -1)
				iconClass = "terminal";
			else if ((att.uri || "").indexOf("context://problems") !== -1)
				iconClass = "error";

			return (
				'<div class="chip" style="margin-top:0;" title="' +
				escapeHtml(att.name) +
				'">' +
				'<span class="chip-icon"><span class="codicon codicon-' +
				iconClass +
				'"></span></span>' +
				'<span class="chip-text">' +
				escapeHtml(att.name) +
				"</span>" +
				"</div>"
			);
		})
		.join("");

	return (
		'<div class="chips-container" style="padding: 6px 0 0 0; border: none;">' +
		items +
		"</div>"
	);
}

function initChangesPanel() {
	if (!changesModalOverlay) return;
	changesModalOverlay.classList.toggle("hidden", !changesPanelVisible);
	updateChangesHeaderButton();

	// Event delegation for file selection - handles dynamically rendered items
	// This is set up ONCE at init, not on every render
	if (changesUnstagedList) {
		changesUnstagedList.addEventListener("click", function (e) {
			// Find the button with data-select-change-file (could be target or ancestor)
			var btn = e.target.closest("[data-select-change-file]");
			if (btn) {
				var filePath = btn.getAttribute("data-select-change-file");
				if (filePath) handleChangeFileSelect(filePath);
			}
		});
	}

	renderChangesPanel();
}

/**
 * Toggle the changes panel visibility.
 * When opening, fetches changes first and shows alert if no changes exist.
 * @param {boolean} [forceVisible] - Force a specific visibility state
 */
async function toggleChangesPanel(forceVisible) {
	var targetVisible =
		typeof forceVisible === "boolean" ? forceVisible : !changesPanelVisible;

	// If closing, just close
	if (!targetVisible) {
		changesPanelVisible = false;
		if (changesModalOverlay) {
			changesModalOverlay.classList.add("hidden");
		}
		restoreDialogFocus(changesModalOverlay);
		updateChangesHeaderButton();
		return;
	}

	// If opening, fetch changes first to check if any exist
	if (isRemoteMode) {
		try {
			var data = await callRemoteGitApi("GET", "/api/changes");

			// Validate response format (must have staged/unstaged arrays)
			if (!Array.isArray(data.staged) || !Array.isArray(data.unstaged)) {
				console.error("[TaskSync] Invalid response format:", data);
				showSimpleAlert(
					"Error",
					"Invalid response from git API. Please try again.",
					"codicon-error",
				);
				return;
			}

			var hasChanges = data.staged.length > 0 || data.unstaged.length > 0;

			if (!hasChanges) {
				// No changes - show alert instead of panel
				showSimpleAlert(
					"No Changes",
					"There are no git changes to review.",
					"codicon-source-control",
				);
				return;
			}

			// Has changes - open panel and apply state
			changesPanelVisible = true;
			if (changesModalOverlay) {
				changesModalOverlay.classList.remove("hidden");
				focusDialogSurface(changesModalOverlay, "#changes-close-btn");
			}
			updateChangesHeaderButton();
			applyChangesState(data);
		} catch (err) {
			// Error fetching - show alert with error
			console.error("[TaskSync] Error fetching changes:", err);
			showSimpleAlert(
				"Error",
				err && err.message ? err.message : "Failed to load git changes.",
				"codicon-error",
			);
		}
		return;
	}

	// VS Code mode - just open panel and request changes (let it load)
	changesPanelVisible = true;
	if (changesModalOverlay) {
		changesModalOverlay.classList.remove("hidden");
		focusDialogSurface(changesModalOverlay, "#changes-close-btn");
	}
	updateChangesHeaderButton();
	requestChangesRefresh();
}

function updateChangesHeaderButton() {
	var remoteChangesBtn = document.getElementById("remote-changes-btn");
	if (remoteChangesBtn) {
		remoteChangesBtn.classList.toggle("active", changesPanelVisible);
	}
	if (changesRefreshBtn) {
		changesRefreshBtn.disabled = !changesPanelVisible;
	}
	if (changesCloseBtn) {
		changesCloseBtn.disabled = !changesPanelVisible;
	}
}

function getRemoteGitHeaders() {
	var headers = { "Content-Type": "application/json" };
	try {
		var sessionToken = sessionStorage.getItem(SESSION_KEYS.SESSION_TOKEN) || "";
		if (sessionToken) headers["x-tasksync-session"] = sessionToken;
		var pin = sessionStorage.getItem(SESSION_KEYS.PIN) || "";
		if (pin) headers["x-tasksync-pin"] = pin;
	} catch {
		// Ignore storage access issues and let server enforce auth.
	}
	return headers;
}

async function callRemoteGitApi(method, endpoint, payload) {
	var req = {
		method: method,
		headers: getRemoteGitHeaders(),
	};
	if (payload !== undefined) {
		req.body = JSON.stringify(payload);
	}

	var res = await fetch(endpoint, req);
	var data = {};
	try {
		data = await res.json();
	} catch {
		data = {};
	}

	if (!res.ok) {
		throw new Error(data.error || "Operation failed");
	}

	return data;
}

async function requestChangesRefresh() {
	changesLoading = true;
	changesError = "";
	renderChangesPanel();

	if (isRemoteMode) {
		try {
			var data = await callRemoteGitApi("GET", "/api/changes");
			applyChangesState(data);
		} catch (err) {
			changesLoading = false;
			changesError =
				err && err.message ? err.message : "Failed to load git changes.";
			renderChangesPanel();
		}
		return;
	}

	vscode.postMessage({ type: "getChanges" });
}

function refreshChangesState() {
	if (changesPanelVisible) {
		void requestChangesRefresh();
	}
}

function applyChangesState(state) {
	changesState = {
		staged: Array.isArray(state && state.staged) ? state.staged : [],
		unstaged: Array.isArray(state && state.unstaged) ? state.unstaged : [],
	};
	pruneCachedChangeStats();
	changeStatsRequestToken += 1;
	changesLoading = false;
	changesError = "";
	if (!hasSelectedChangeFile()) {
		selectedChangeFile = firstChangeFilePath();
		selectedChangeDiff = "";
	}
	renderChangesPanel();
	if (isRemoteMode && changesPanelVisible) {
		void prefetchChangeStats(changeStatsRequestToken);
	}
	if (changesPanelVisible && selectedChangeFile) {
		void requestChangeDiff(selectedChangeFile);
	}
}

function applyChangeDiff(filePath, diff) {
	if (filePath && selectedChangeFile && filePath !== selectedChangeFile) {
		return;
	}
	selectedChangeFile = filePath || selectedChangeFile;
	selectedChangeDiff = typeof diff === "string" ? diff : "";
	if (filePath) {
		changeStatsByFile[filePath] = extractDiffStats(selectedChangeDiff);
	}
	changesLoading = false;
	changesError = "";
	renderChangesPanel();
}

async function requestChangeDiff(filePath) {
	if (!filePath) return;
	selectedChangeFile = filePath;
	selectedChangeDiff = "";
	changesLoading = true;
	changesError = "";
	renderChangesPanel();

	if (isRemoteMode) {
		try {
			var data = await callRemoteGitApi(
				"GET",
				"/api/diff?file=" + encodeURIComponent(filePath),
			);
			applyChangeDiff(filePath, data.diff || "");
		} catch (err) {
			changesLoading = false;
			changesError = err && err.message ? err.message : "Failed to load diff.";
			renderChangesPanel();
		}
		return;
	}

	vscode.postMessage({ type: "getDiff", file: filePath });
}

function handleChangeFileSelect(filePath) {
	void requestChangeDiff(filePath);
}

function hasSelectedChangeFile() {
	if (!selectedChangeFile) return false;
	return (
		changesState.staged.some(function (item) {
			return item.path === selectedChangeFile;
		}) ||
		changesState.unstaged.some(function (item) {
			return item.path === selectedChangeFile;
		})
	);
}

function firstChangeFilePath() {
	if (changesState.unstaged.length > 0) return changesState.unstaged[0].path;
	if (changesState.staged.length > 0) return changesState.staged[0].path;
	return "";
}

function formatChangeStatusLabel(statusText) {
	if (typeof statusText !== "string") return "";
	var trimmedStatus = statusText.trim();
	if (!trimmedStatus) return "";
	if (trimmedStatus.toLowerCase() === "modified") return "";
	return trimmedStatus;
}

function renderChangesPanel() {
	if (!changesSection) return;

	// Show/hide spinner based on loading state
	if (changesLoadingSpinner) {
		if (changesLoading) {
			changesLoadingSpinner.classList.remove("hidden");
		} else {
			changesLoadingSpinner.classList.add("hidden");
		}
	}

	if (changesSummary) {
		var totalChanges =
			changesState.unstaged.length + changesState.staged.length;
		var summaryText =
			totalChanges +
			" changes (" +
			changesState.unstaged.length +
			" unstaged, " +
			changesState.staged.length +
			" staged)";
		changesSummary.textContent = summaryText;
	}

	if (changesStatus) {
		if (changesError) {
			changesStatus.textContent = changesError;
		} else {
			changesStatus.textContent = "";
		}
	}

	if (changesDiffTitle) {
		changesDiffTitle.textContent = selectedChangeFile
			? selectedChangeFile
			: "Select a file to preview its diff";
	}

	if (changesDiffMeta) {
		var metaText = "";
		if (selectedChangeFile) {
			var selectedItem = findChangeItem(selectedChangeFile);
			metaText = selectedItem
				? formatChangeStatusLabel(selectedItem.status)
				: "";
		}
		changesDiffMeta.textContent = metaText;
	}

	if (changesDiffOutput) {
		if (selectedChangeDiff) {
			changesDiffOutput.innerHTML = formatGitDiffHtml(selectedChangeDiff);
			changesDiffOutput.classList.remove("empty");
		} else if (selectedChangeFile) {
			// Empty state while loading or if diff is empty
			changesDiffOutput.textContent = "";
			changesDiffOutput.classList.add("empty");
		} else {
			changesDiffOutput.textContent =
				"Open the panel, then select a file to inspect the diff.";
			changesDiffOutput.classList.add("empty");
		}
	}

	renderChangeGroups();
	bindChangePanelEvents();
	updateChangesHeaderButton();
}

function renderChangeGroups() {
	if (changesUnstagedList) {
		var allChanges = changesState.unstaged
			.map(function (item) {
				return { ...item, section: "unstaged" };
			})
			.concat(
				changesState.staged.map(function (item) {
					return { ...item, section: "staged" };
				}),
			);
		renderChangeGroup(changesUnstagedList, allChanges);
	}
	if (changesUnstagedGroup) {
		changesUnstagedGroup.classList.remove("hidden");
	}
}

function renderChangeGroup(container, items) {
	if (!container) return;
	if (!items || items.length === 0) {
		container.innerHTML = '<div class="changes-empty">No changes</div>';
		return;
	}

	container.innerHTML = items
		.map(function (item) {
			var isSelected = item.path === selectedChangeFile;
			var section = item.section || "unstaged";
			var statusText = formatChangeStatusLabel(item.status || section);
			var statusHtml = statusText
				? '<span class="change-item-status ' +
					escapeHtml(section) +
					'">' +
					escapeHtml(statusText) +
					"</span>"
				: "";
			var stats = resolveChangeStats(item);
			var additions = stats ? Math.max(0, Number(stats.additions) || 0) : null;
			var deletions = stats ? Math.max(0, Number(stats.deletions) || 0) : null;
			var statsLabel =
				additions !== null && deletions !== null
					? '<span class="change-item-lines" aria-label="' +
						escapeHtml(
							additions + " additions and " + deletions + " deletions",
						) +
						'">' +
						'<span class="plus">+' +
						escapeHtml(String(additions)) +
						"</span>" +
						'<span class="minus">-' +
						escapeHtml(String(deletions)) +
						"</span></span>"
					: '<span class="change-item-lines pending" aria-hidden="true">+? -?</span>';
			return (
				'<div class="change-item' +
				(isSelected ? " selected" : "") +
				'" data-change-file="' +
				escapeHtml(item.path) +
				'">' +
				'<button type="button" class="change-item-main" data-select-change-file="' +
				escapeHtml(item.path) +
				'">' +
				'<span class="change-item-top"><span class="change-item-path">' +
				escapeHtml(item.path) +
				"</span>" +
				statsLabel +
				"</span>" +
				statusHtml +
				"</button></div>"
			);
		})
		.join("");
}

function resolveChangeStats(item) {
	if (!item || !item.path) return null;
	if (
		typeof item.additions === "number" ||
		typeof item.deletions === "number"
	) {
		return {
			additions: Math.max(0, Number(item.additions) || 0),
			deletions: Math.max(0, Number(item.deletions) || 0),
		};
	}
	return changeStatsByFile[item.path] || null;
}

function pruneCachedChangeStats() {
	var activeFiles = {};
	changesState.unstaged.forEach(function (item) {
		if (item && item.path) activeFiles[item.path] = true;
	});
	changesState.staged.forEach(function (item) {
		if (item && item.path) activeFiles[item.path] = true;
	});

	var nextStats = {};
	Object.keys(changeStatsByFile).forEach(function (filePath) {
		if (activeFiles[filePath]) {
			nextStats[filePath] = changeStatsByFile[filePath];
		}
	});
	changeStatsByFile = nextStats;

	var nextInFlight = {};
	Object.keys(changeStatsInFlight).forEach(function (filePath) {
		if (activeFiles[filePath]) {
			nextInFlight[filePath] = true;
		}
	});
	changeStatsInFlight = nextInFlight;
}

async function prefetchChangeStats(requestToken) {
	if (!isRemoteMode) return;

	var filePaths = changesState.unstaged
		.concat(changesState.staged)
		.map(function (item) {
			return item.path;
		})
		.filter(function (filePath) {
			return (
				!!filePath &&
				!changeStatsByFile[filePath] &&
				!changeStatsInFlight[filePath]
			);
		})
		.slice(0, 40);

	if (filePaths.length === 0) return;

	var cursor = 0;
	var maxConcurrent = 3;

	async function worker() {
		while (cursor < filePaths.length) {
			var currentIndex = cursor;
			cursor += 1;
			var filePath = filePaths[currentIndex];
			if (!filePath) continue;
			await fetchAndCacheChangeStats(filePath, requestToken);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(maxConcurrent, filePaths.length) },
			function () {
				return worker();
			},
		),
	);

	if (requestToken === changeStatsRequestToken && changesPanelVisible) {
		renderChangesPanel();
	}
}

async function fetchAndCacheChangeStats(filePath, requestToken) {
	if (!filePath || changeStatsByFile[filePath] || changeStatsInFlight[filePath])
		return;

	changeStatsInFlight[filePath] = true;
	try {
		var data = await callRemoteGitApi(
			"GET",
			"/api/diff?file=" + encodeURIComponent(filePath),
		);
		if (requestToken !== changeStatsRequestToken) return;
		changeStatsByFile[filePath] = extractDiffStats(
			data && data.diff ? data.diff : "",
		);
	} catch {
		// Keep placeholder stats when diff cannot be loaded.
	} finally {
		delete changeStatsInFlight[filePath];
	}
}

function extractDiffStats(diffText) {
	if (!diffText || typeof diffText !== "string") {
		return { additions: 0, deletions: 0 };
	}

	var additions = 0;
	var deletions = 0;
	diffText.split("\n").forEach(function (line) {
		if (line.startsWith("+++") || line.startsWith("---")) return;
		if (line.startsWith("+") && !line.startsWith("+++")) {
			additions += 1;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions += 1;
		}
	});

	return { additions: additions, deletions: deletions };
}

function formatGitDiffHtml(diffText) {
	if (!diffText) return "";

	var oldLine = 0;
	var newLine = 0;
	var inHunk = false;
	var renderedBinaryNotice = false;

	var rows = diffText
		.split("\n")
		.map(function (line) {
			if (line.startsWith("@@")) {
				var parsed = parseDiffHunkHeader(line);
				if (parsed) {
					oldLine = parsed.oldLine;
					newLine = parsed.newLine;
					inHunk = true;
				}
				return renderDiffMetaRow("diff-hunk", line);
			}

			if (line.startsWith("diff --git")) {
				inHunk = false;
				return "";
			}

			if (
				line.startsWith("index ") ||
				line.startsWith("new file mode") ||
				line.startsWith("deleted file mode") ||
				line.startsWith("similarity index") ||
				line.startsWith("rename from") ||
				line.startsWith("rename to") ||
				line.startsWith("+++") ||
				line.startsWith("---") ||
				line.startsWith("\\ No newline at end of file")
			) {
				return "";
			}

			if (line.startsWith("Binary files") && !renderedBinaryNotice) {
				renderedBinaryNotice = true;
				return renderDiffMetaRow(
					"diff-meta",
					"Binary file changed (text diff unavailable).",
				);
			}

			if (inHunk) {
				if (line.startsWith("+") && !line.startsWith("+++")) {
					var addRow = renderDiffCodeRow(
						"",
						String(newLine),
						"+",
						line.slice(1),
						"diff-addition",
					);
					newLine += 1;
					return addRow;
				}

				if (line.startsWith("-") && !line.startsWith("---")) {
					var delRow = renderDiffCodeRow(
						String(oldLine),
						"",
						"-",
						line.slice(1),
						"diff-deletion",
					);
					oldLine += 1;
					return delRow;
				}

				var contextRow = renderDiffCodeRow(
					String(oldLine),
					String(newLine),
					" ",
					line.startsWith(" ") ? line.slice(1) : line,
					"diff-context",
				);
				oldLine += 1;
				newLine += 1;
				return contextRow;
			}

			return "";
		})
		.filter(Boolean)
		.join("");

	if (rows.length > 0) {
		return rows;
	}

	return renderDiffMetaRow("diff-meta", "No textual diff to display.");
}

function parseDiffHunkHeader(hunkLine) {
	var match = /^@@\s-(\d+)(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@/.exec(hunkLine);
	if (!match) return null;
	return {
		oldLine: Number(match[1]),
		newLine: Number(match[2]),
	};
}

function renderDiffMetaRow(extraClass, line) {
	return (
		'<span class="diff-line ' +
		extraClass +
		'">' +
		'<span class="diff-line-code">' +
		escapeHtml(line.length > 0 ? line : " ") +
		"</span></span>"
	);
}

function renderDiffCodeRow(oldNumber, newNumber, sign, content, extraClass) {
	return (
		'<span class="diff-line ' +
		extraClass +
		'">' +
		'<span class="diff-line-number old">' +
		escapeHtml(oldNumber) +
		"</span>" +
		'<span class="diff-line-number new">' +
		escapeHtml(newNumber) +
		"</span>" +
		'<span class="diff-line-sign">' +
		escapeHtml(sign) +
		"</span>" +
		'<span class="diff-line-code">' +
		escapeHtml(content.length > 0 ? content : " ") +
		"</span></span>"
	);
}

function findChangeItem(filePath) {
	if (!filePath) return null;
	var staged = changesState.staged.find(function (item) {
		return item.path === filePath;
	});
	if (staged) return staged;
	var unstaged = changesState.unstaged.find(function (item) {
		return item.path === filePath;
	});
	return unstaged || null;
}

function bindChangePanelEvents() {
	if (!changesSection) return;

	// Click overlay backdrop to close (but not the panel itself)
	if (changesModalOverlay) {
		changesModalOverlay.onclick = function (e) {
			if (e.target === changesModalOverlay) {
				toggleChangesPanel(false);
			}
		};
	}

	if (changesRefreshBtn) {
		changesRefreshBtn.onclick = function () {
			void requestChangesRefresh();
		};
	}
	if (changesCloseBtn) {
		changesCloseBtn.onclick = function () {
			toggleChangesPanel(false);
		};
	}

	// Event delegation for file selection - handles dynamically rendered items
	// (individual button handlers removed - using container delegation instead)
}
