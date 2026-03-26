// ===== SLASH COMMAND FUNCTIONS =====

/**
 * Expand /commandName patterns to their full prompt text
 * Only expands known commands at the start of lines or after whitespace
 */
function expandSlashCommands(text) {
	if (!text || reusablePrompts.length === 0) return text;

	// Use stored mappings from selectSlashItem if available
	let mappings =
		chatInput && chatInput._slashPrompts ? chatInput._slashPrompts : {};

	// Build a regex to match all known prompt names
	let promptNames = reusablePrompts.map(function (p) {
		return p.name;
	});
	if (Object.keys(mappings).length > 0) {
		Object.keys(mappings).forEach(function (name) {
			if (promptNames.indexOf(name) === -1) promptNames.push(name);
		});
	}

	// Match /promptName at start or after whitespace
	let expanded = text;
	promptNames.forEach(function (name) {
		// Escape special regex chars in name
		let escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		let regex = new RegExp("(^|\\s)/" + escapedName + "(?=\\s|$)", "g");
		let fullPrompt =
			mappings[name] ||
			(
				reusablePrompts.find(function (p) {
					return p.name === name;
				}) || {}
			).prompt ||
			"";
		if (fullPrompt) {
			expanded = expanded.replace(regex, "$1" + fullPrompt);
		}
	});

	// Clear stored mappings after expansion
	if (chatInput) chatInput._slashPrompts = {};

	return expanded.trim();
}

function handleSlashCommands() {
	if (!chatInput) return;
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Find slash at start of input or after whitespace
	let slashPos = -1;
	for (var i = cursorPos - 1; i >= 0; i--) {
		if (value[i] === "/") {
			// Check if it's at start or after whitespace
			if (i === 0 || /\s/.test(value[i - 1])) {
				slashPos = i;
			}
			break;
		}
		if (/\s/.test(value[i])) break;
	}

	if (slashPos >= 0 && reusablePrompts.length > 0) {
		let query = value.substring(slashPos + 1, cursorPos);
		slashStartPos = slashPos;
		if (slashDebounceTimer) clearTimeout(slashDebounceTimer);
		slashDebounceTimer = setTimeout(function () {
			// Filter locally for instant results
			let queryLower = query.toLowerCase();
			let matchingPrompts = reusablePrompts.filter(function (p) {
				return (
					p.name.toLowerCase().includes(queryLower) ||
					p.prompt.toLowerCase().includes(queryLower)
				);
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
		slashList.classList.add("hidden");
		slashEmpty.classList.remove("hidden");
	} else {
		slashList.classList.remove("hidden");
		slashEmpty.classList.add("hidden");
		renderSlashList();
	}
	slashDropdown.classList.remove("hidden");
	slashDropdownVisible = true;
}

function hideSlashDropdown() {
	if (slashDropdown) slashDropdown.classList.add("hidden");
	slashDropdownVisible = false;
	slashResults = [];
	selectedSlashIndex = -1;
	slashStartPos = -1;
	if (slashDebounceTimer) {
		clearTimeout(slashDebounceTimer);
		slashDebounceTimer = null;
	}
}

function renderSlashList() {
	if (!slashList) return;
	slashList.innerHTML = slashResults
		.map(function (p, index) {
			let truncatedPrompt =
				p.prompt.length > 50 ? p.prompt.substring(0, 50) + "..." : p.prompt;
			// Prepare tooltip text - escape for HTML attribute
			let tooltipText =
				p.prompt.length > 500 ? p.prompt.substring(0, 500) + "..." : p.prompt;
			tooltipText = escapeHtml(tooltipText);
			return (
				'<div class="slash-item' +
				(index === selectedSlashIndex ? " selected" : "") +
				'" data-index="' +
				index +
				'" data-tooltip="' +
				tooltipText +
				'">' +
				'<span class="slash-item-icon"><span class="codicon codicon-symbol-keyword"></span></span>' +
				'<div class="slash-item-content">' +
				'<span class="slash-item-name">/' +
				escapeHtml(p.name) +
				"</span>" +
				'<span class="slash-item-preview">' +
				escapeHtml(truncatedPrompt) +
				"</span>" +
				"</div></div>"
			);
		})
		.join("");

	slashList.querySelectorAll(".slash-item").forEach(function (item) {
		item.addEventListener("click", function () {
			selectSlashItem(parseInt(item.getAttribute("data-index"), 10));
		});
		item.addEventListener("mouseenter", function () {
			selectedSlashIndex = parseInt(item.getAttribute("data-index"), 10);
			updateSlashSelection();
		});
	});
	scrollToSelectedSlashItem();
}

function updateSlashSelection() {
	if (!slashList) return;
	slashList.querySelectorAll(".slash-item").forEach(function (item, index) {
		item.classList.toggle("selected", index === selectedSlashIndex);
	});
	scrollToSelectedSlashItem();
}

function scrollToSelectedSlashItem() {
	let selectedItem = slashList
		? slashList.querySelector(".slash-item.selected")
		: null;
	if (selectedItem)
		selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectSlashItem(index) {
	if (
		index < 0 ||
		index >= slashResults.length ||
		!chatInput ||
		slashStartPos < 0
	)
		return;
	let prompt = slashResults[index];
	let value = chatInput.value;
	let cursorPos = chatInput.selectionStart;

	// Create a slash tag representation - when sent, we'll expand it to full prompt
	// For now, insert /name as text and store the mapping
	let slashText = "/" + prompt.name + " ";
	chatInput.value =
		value.substring(0, slashStartPos) + slashText + value.substring(cursorPos);
	let newCursorPos = slashStartPos + slashText.length;
	chatInput.setSelectionRange(newCursorPos, newCursorPos);

	// Store the prompt reference for expansion on send
	if (!chatInput._slashPrompts) chatInput._slashPrompts = {};
	chatInput._slashPrompts[prompt.name] = prompt.prompt;

	hideSlashDropdown();
	chatInput.focus();
	updateSendButtonState();
}
