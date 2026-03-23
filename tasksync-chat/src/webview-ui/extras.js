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
