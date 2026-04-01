// Shared autopilot prompt-list UI factory.
// Both workspace settings and session settings reuse this to avoid CRUD duplication.

/**
 * Create a prompt-list UI controller bound to the given DOM elements and data hooks.
 *
 * @param {Object} opts
 * @param {function(): string[]} opts.getPrompts      - Return the current prompts array.
 * @param {function(string[]): void} opts.setPrompts   - Replace the prompts array.
 * @param {HTMLElement|null} opts.listEl               - The UL/container for prompt items.
 * @param {HTMLElement|null} opts.formEl               - The add/edit form wrapper.
 * @param {HTMLInputElement|null} opts.inputEl         - The prompt text input.
 * @param {string} opts.emptyHint                      - HTML shown when the list is empty.
 * @param {function(): void} [opts.onListChange]       - Called after any mutation (render already done).
 */
function createPromptListUI(opts) {
	var getPrompts = opts.getPrompts;
	var setPrompts = opts.setPrompts;
	var listEl = opts.listEl;
	var formEl = opts.formEl;
	var inputEl = opts.inputEl;
	var emptyHint = opts.emptyHint;
	var onListChange = opts.onListChange || function () {};

	var editingIndex = -1;
	var draggedIndex = -1;

	function render() {
		if (!listEl) return;
		var prompts = getPrompts();

		if (prompts.length === 0) {
			listEl.innerHTML =
				'<div class="empty-prompts-hint">' + emptyHint + "</div>";
			return;
		}

		listEl.innerHTML = prompts
			.map(function (prompt, index) {
				var truncated =
					prompt.length > 80 ? prompt.substring(0, 80) + "..." : prompt;
				var tooltipText =
					prompt.length > 300 ? prompt.substring(0, 300) + "..." : prompt;
				tooltipText = escapeHtml(tooltipText);
				return (
					'<div class="autopilot-prompt-item" draggable="true" data-index="' +
					index +
					'" title="' +
					tooltipText +
					'">' +
					'<span class="autopilot-prompt-drag-handle codicon codicon-grabber"></span>' +
					'<span class="autopilot-prompt-number">' +
					(index + 1) +
					".</span>" +
					'<span class="autopilot-prompt-text">' +
					escapeHtml(truncated) +
					"</span>" +
					'<div class="autopilot-prompt-actions">' +
					'<button class="prompt-item-btn edit" data-index="' +
					index +
					'" title="Edit"><span class="codicon codicon-edit"></span></button>' +
					'<button class="prompt-item-btn delete" data-index="' +
					index +
					'" title="Delete"><span class="codicon codicon-trash"></span></button>' +
					"</div></div>"
				);
			})
			.join("");
	}

	function showAddForm() {
		if (!formEl || !inputEl) return;
		editingIndex = -1;
		inputEl.value = "";
		formEl.classList.remove("hidden");
		formEl.removeAttribute("data-editing-index");
		inputEl.focus();
	}

	function hideAddForm() {
		if (!formEl || !inputEl) return;
		formEl.classList.add("hidden");
		inputEl.value = "";
		editingIndex = -1;
		formEl.removeAttribute("data-editing-index");
	}

	function save() {
		if (!inputEl) return;
		var prompt = inputEl.value.trim();
		if (!prompt) return;

		var prompts = getPrompts().slice();
		var editAttr = formEl ? formEl.getAttribute("data-editing-index") : null;
		if (editAttr !== null) {
			var idx = parseInt(editAttr, 10);
			if (idx >= 0 && idx < prompts.length) {
				prompts[idx] = prompt;
			}
		} else {
			prompts.push(prompt);
		}
		setPrompts(prompts);
		hideAddForm();
		render();
		onListChange();
	}

	function handleListClick(e) {
		var target = e.target.closest(".prompt-item-btn");
		if (!target) return;

		var index = parseInt(target.getAttribute("data-index"), 10);
		if (isNaN(index)) return;

		if (target.classList.contains("edit")) {
			editPrompt(index);
		} else if (target.classList.contains("delete")) {
			deletePrompt(index);
		}
	}

	function editPrompt(index) {
		var prompts = getPrompts();
		if (index < 0 || index >= prompts.length) return;
		if (!formEl || !inputEl) return;

		editingIndex = index;
		inputEl.value = prompts[index];
		formEl.setAttribute("data-editing-index", index);
		formEl.classList.remove("hidden");
		inputEl.focus();
	}

	function deletePrompt(index) {
		var prompts = getPrompts().slice();
		if (index < 0 || index >= prompts.length) return;
		prompts.splice(index, 1);
		setPrompts(prompts);
		render();
		onListChange();
	}

	function handleDragStart(e) {
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item) return;
		draggedIndex = parseInt(item.getAttribute("data-index"), 10);
		item.classList.add("dragging");
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", draggedIndex);
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item || !listEl) return;

		listEl.querySelectorAll(".autopilot-prompt-item").forEach(function (el) {
			el.classList.remove("drag-over-top", "drag-over-bottom");
		});

		var rect = item.getBoundingClientRect();
		var midY = rect.top + rect.height / 2;
		if (e.clientY < midY) {
			item.classList.add("drag-over-top");
		} else {
			item.classList.add("drag-over-bottom");
		}
	}

	function handleDragEnd() {
		draggedIndex = -1;
		if (!listEl) return;
		listEl.querySelectorAll(".autopilot-prompt-item").forEach(function (el) {
			el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
		});
	}

	function handleDrop(e) {
		e.preventDefault();
		var item = e.target.closest(".autopilot-prompt-item");
		if (!item || draggedIndex < 0) return;

		var toIndex = parseInt(item.getAttribute("data-index"), 10);
		if (isNaN(toIndex) || draggedIndex === toIndex) {
			handleDragEnd();
			return;
		}

		var prompts = getPrompts().slice();
		var rect = item.getBoundingClientRect();
		var midY = rect.top + rect.height / 2;
		var insertBelow = e.clientY >= midY;

		var targetIndex = toIndex;
		if (insertBelow && toIndex < prompts.length - 1) {
			targetIndex = toIndex + 1;
		}
		if (draggedIndex < targetIndex) {
			targetIndex--;
		}
		targetIndex = Math.max(0, Math.min(targetIndex, prompts.length - 1));

		if (draggedIndex !== targetIndex) {
			var moved = prompts.splice(draggedIndex, 1)[0];
			prompts.splice(targetIndex, 0, moved);
			setPrompts(prompts);
			render();
			onListChange();
		}
		handleDragEnd();
	}

	// Bind drag events to the list element
	function bindEvents() {
		if (!listEl) return;
		listEl.addEventListener("click", handleListClick);
		listEl.addEventListener("dragstart", handleDragStart);
		listEl.addEventListener("dragover", handleDragOver);
		listEl.addEventListener("dragend", handleDragEnd);
		listEl.addEventListener("drop", handleDrop);
	}

	return {
		render: render,
		showAddForm: showAddForm,
		hideAddForm: hideAddForm,
		save: save,
		handleListClick: handleListClick,
		handleDragStart: handleDragStart,
		handleDragOver: handleDragOver,
		handleDragEnd: handleDragEnd,
		handleDrop: handleDrop,
		bindEvents: bindEvents,
	};
}
