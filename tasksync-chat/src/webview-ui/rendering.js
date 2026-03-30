// ==================== Tool Call Rendering ====================

function addToolCallToCurrentSession(entry, sessionTerminated) {
	pendingToolCall = null;
	document.body.classList.remove("has-pending-toolcall");
	hideApprovalModal();
	hideChoicesBar();

	let idx = currentSessionCalls.findIndex(function (tc) {
		return tc.id === entry.id;
	});
	if (idx >= 0) {
		currentSessionCalls[idx] = entry;
	} else {
		currentSessionCalls.unshift(entry);
	}
	renderCurrentSession();
	isProcessingResponse = true;
	if (pendingMessage) {
		pendingMessage.classList.remove("hidden");
		// Check if session terminated
		if (sessionTerminated) {
			isProcessingResponse = false;
			pendingMessage.innerHTML =
				'<div class="new-session-prompt">' +
				"<span>Session terminated</span>" +
				'<button class="new-session-btn" id="new-session-btn">' +
				'<span class="codicon codicon-add"></span> Start new session' +
				"</button></div>";
			let newSessionBtn = document.getElementById("new-session-btn");
			if (newSessionBtn) {
				newSessionBtn.addEventListener("click", function () {
					vscode.postMessage({ type: "newSession" });
				});
			}
		} else {
			pendingMessage.innerHTML =
				'<div class="working-indicator">Processing your response</div>';
		}
	}

	// Auto-scroll to show the working indicator
	scrollToBottom();
}

function renderCurrentSession() {
	if (!toolHistoryArea) return;

	// Clear old chat stream bubbles when switching/re-rendering session
	if (chatStreamArea) {
		chatStreamArea.innerHTML = "";
		chatStreamArea.classList.add("hidden");
	}

	let completedCalls = currentSessionCalls.filter(function (tc) {
		return tc.status === "completed";
	});

	if (completedCalls.length === 0) {
		toolHistoryArea.innerHTML = "";
		return;
	}

	// Reverse to show oldest first (new items stack at bottom)
	let sortedCalls = completedCalls.slice().reverse();

	let cardsHtml = sortedCalls
		.map(function (tc, index) {
			let firstSentence = tc.prompt.split(/[.!?]/)[0];
			let truncatedTitle =
				firstSentence.length > 120
					? firstSentence.substring(0, 120) + "..."
					: firstSentence;
			let queueBadge = tc.isFromQueue
				? '<span class="tool-call-badge queue">Queue</span>'
				: "";
			let isLatest = index === sortedCalls.length - 1;
			let cardHtml =
				'<div class="tool-call-card' +
				(isLatest ? " expanded" : "") +
				'" data-id="' +
				escapeHtml(tc.id) +
				'">' +
				'<div class="tool-call-header">' +
				'<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
				'<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
				'<div class="tool-call-header-wrapper">' +
				'<span class="tool-call-title">' +
				escapeHtml(truncatedTitle) +
				queueBadge +
				"</span>" +
				"</div>" +
				"</div>" +
				'<div class="tool-call-body">' +
				'<div class="tool-call-ai-response">' +
				formatMarkdown(tc.prompt) +
				"</div>" +
				'<div class="tool-call-user-section">' +
				'<div class="tool-call-user-response">' +
				escapeHtml(tc.response) +
				"</div>" +
				(tc.attachments ? renderAttachmentsHtml(tc.attachments) : "") +
				"</div>" +
				"</div></div>";
			return cardHtml;
		})
		.join("");

	toolHistoryArea.innerHTML = cardsHtml;
	toolHistoryArea
		.querySelectorAll(".tool-call-header")
		.forEach(function (header) {
			header.addEventListener("click", function (e) {
				let card = header.closest(".tool-call-card");
				if (card) card.classList.toggle("expanded");
			});
		});
	renderMermaidDiagrams();
}

// ——— User message bubble for remote chat ———
/** Add user message bubble to the chat stream area. */
function addChatStreamUserBubble(text) {
	if (!chatStreamArea) return;
	chatStreamArea.classList.remove("hidden");
	var div = document.createElement("div");
	div.className = "chat-stream-msg user";
	div.textContent = text;
	chatStreamArea.appendChild(div);
	scrollToBottom();
}

function renderHistoryModal() {
	if (!historyModalList) return;
	if (persistedHistory.length === 0) {
		historyModalList.innerHTML =
			'<div class="history-modal-empty">No history yet</div>';
		if (historyModalClearAll) historyModalClearAll.classList.add("hidden");
		return;
	}

	if (historyModalClearAll) historyModalClearAll.classList.remove("hidden");
	function renderToolCallCard(tc) {
		let firstSentence = tc.prompt.split(/[.!?]/)[0];
		let truncatedTitle =
			firstSentence.length > 80
				? firstSentence.substring(0, 80) + "..."
				: firstSentence;
		let queueBadge = tc.isFromQueue
			? '<span class="tool-call-badge queue">Queue</span>'
			: "";

		return (
			'<div class="tool-call-card history-card" data-id="' +
			escapeHtml(tc.id) +
			'">' +
			'<div class="tool-call-header">' +
			'<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
			'<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
			'<div class="tool-call-header-wrapper">' +
			'<span class="tool-call-title">' +
			escapeHtml(truncatedTitle) +
			queueBadge +
			"</span>" +
			"</div>" +
			'<button class="tool-call-remove" data-id="' +
			escapeHtml(tc.id) +
			'" title="Remove"><span class="codicon codicon-close"></span></button>' +
			"</div>" +
			'<div class="tool-call-body">' +
			'<div class="tool-call-ai-response">' +
			formatMarkdown(tc.prompt) +
			"</div>" +
			'<div class="tool-call-user-section">' +
			'<div class="tool-call-user-response">' +
			escapeHtml(tc.response) +
			"</div>" +
			(tc.attachments ? renderAttachmentsHtml(tc.attachments) : "") +
			"</div>" +
			"</div></div>"
		);
	}

	let cardsHtml = '<div class="history-items-list">';
	cardsHtml += persistedHistory.map(renderToolCallCard).join("");
	cardsHtml += "</div>";

	historyModalList.innerHTML = cardsHtml;
	historyModalList
		.querySelectorAll(".tool-call-header")
		.forEach(function (header) {
			header.addEventListener("click", function (e) {
				if (e.target.closest(".tool-call-remove")) return;
				let card = header.closest(".tool-call-card");
				if (card) card.classList.toggle("expanded");
			});
		});
	historyModalList
		.querySelectorAll(".tool-call-remove")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				let id = btn.getAttribute("data-id");
				if (id) {
					vscode.postMessage({ type: "removeHistoryItem", callId: id });
					persistedHistory = persistedHistory.filter(function (tc) {
						return tc.id !== id;
					});
					renderHistoryModal();
				}
			});
		});
}

function formatMarkdown(text) {
	if (!text) return "";

	// ReDoS prevention: truncate very long inputs before regex (OWASP mitigation)
	if (text.length > MARKDOWN_MAX_LENGTH) {
		text =
			text.substring(0, MARKDOWN_MAX_LENGTH) +
			"\n... (content truncated for display)";
	}

	// Normalize line endings (Windows \r\n to \n)
	let processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	// Store code blocks BEFORE escaping HTML to preserve backticks
	let codeBlocks = [];
	let mermaidBlocks = [];
	let inlineCodeSpans = [];

	// Extract mermaid blocks first (before HTML escaping)
	// Match ```mermaid followed by newline or just content
	processedText = processedText.replace(
		/```mermaid\s*\n([\s\S]*?)```/g,
		function (match, code) {
			let index = mermaidBlocks.length;
			mermaidBlocks.push(code.trim());
			return "%%MERMAID" + index + "%%";
		},
	);

	// Extract other code blocks (before HTML escaping)
	// Match ```lang or just ``` followed by optional newline
	processedText = processedText.replace(
		/```(\w*)\s*\n?([\s\S]*?)```/g,
		function (match, lang, code) {
			let index = codeBlocks.length;
			codeBlocks.push({ lang: lang || "", code: code.trim() });
			return "%%CODEBLOCK" + index + "%%";
		},
	);

	// Extract inline code before escaping (prevents * and _ in `code` from being parsed)
	processedText = processedText.replace(/`([^`\n]+)`/g, function (match, code) {
		let index = inlineCodeSpans.length;
		inlineCodeSpans.push(code);
		return "%%INLINECODE" + index + "%%";
	});

	// Now escape HTML on the remaining text
	let html = escapeHtml(processedText);

	// Headers (## Header) - must be at start of line
	html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// Horizontal rules (--- or ***)
	html = html.replace(/^---+$/gm, "<hr>");
	html = html.replace(/^\*\*\*+$/gm, "<hr>");

	// Blockquotes (> text) - simple single-line support
	html = html.replace(/^&gt;\s*(.*)$/gm, "<blockquote>$1</blockquote>");
	// Merge consecutive blockquotes
	html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

	// Lists (ordered/unordered, including nested indentation)
	// Security contract: html is already escaped above; list conversion must keep item text as-is.
	html = convertMarkdownLists(html);

	// Markdown tables - SAFE approach to prevent ReDoS
	// Instead of using nested quantifiers with regex (which can cause exponential backtracking),
	// we use a line-by-line processing approach for safety
	let tableLines = html.split("\n");
	let processedLines = [];
	let tableBuffer = [];
	let inTable = false;

	for (var lineIdx = 0; lineIdx < tableLines.length; lineIdx++) {
		let line = tableLines[lineIdx];
		// Check if line looks like a table row (starts and ends with |)
		let isTableRow = /^\|.+\|$/.test(line.trim());

		if (isTableRow) {
			tableBuffer.push(line);
			inTable = true;
		} else {
			if (inTable && tableBuffer.length >= 2) {
				// Process accumulated table buffer
				const tableHtml = processTableBuffer(tableBuffer, MAX_TABLE_ROWS);
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
	html = processedLines.join("\n");

	// Tokenize markdown links before emphasis parsing so link targets are not mutated by markdown transforms.
	let markdownLinksApi = window.TaskSyncMarkdownLinks;
	let tokenizedLinks = null;
	if (
		markdownLinksApi &&
		typeof markdownLinksApi.tokenizeMarkdownLinks === "function"
	) {
		tokenizedLinks = markdownLinksApi.tokenizeMarkdownLinks(html);
		html = tokenizedLinks.text;
	}

	// Bold (**text** or __text__)
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

	// Strikethrough (~~text~~)
	html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

	// Italic (*text* or _text_)
	// For *text*: require non-word boundaries around delimiters and alnum at content edges.
	// This avoids false-positive matches in plain prose (e.g. regex snippets, list-marker-like asterisks).
	html = html.replace(
		/(^|[^\p{L}\p{N}_*])\*([\p{L}\p{N}](?:[^*\n]*?[\p{L}\p{N}])?)\*(?=[^\p{L}\p{N}_*]|$)/gu,
		"$1<em>$2</em>",
	);
	// For _text_: require non-word boundaries (Unicode-aware) around underscore markers
	// This keeps punctuation-adjacent emphasis working while avoiding snake_case matches
	html = html.replace(
		/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?=[^\p{L}\p{N}_]|$)/gu,
		"$1<em>$2</em>",
	);

	// Restore tokenized markdown links after emphasis parsing.
	if (
		tokenizedLinks &&
		markdownLinksApi &&
		typeof markdownLinksApi.restoreTokenizedLinks === "function"
	) {
		html = markdownLinksApi.restoreTokenizedLinks(html, tokenizedLinks.links);
	} else if (
		markdownLinksApi &&
		typeof markdownLinksApi.convertMarkdownLinks === "function"
	) {
		html = markdownLinksApi.convertMarkdownLinks(html);
	}

	// Restore inline code after emphasis parsing so markdown markers inside code stay literal.
	inlineCodeSpans.forEach(function (code, index) {
		let escapedCode = escapeHtml(code);
		let replacement = '<code class="inline-code">' + escapedCode + "</code>";
		html = html.replace("%%INLINECODE" + index + "%%", replacement);
	});

	// Line breaks - but collapse multiple consecutive breaks
	// Don't add <br> after block elements
	html = html.replace(/\n{3,}/g, "\n\n");
	html = html.replace(
		/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)\n/g,
		"$1",
	);
	html = html.replace(/\n/g, "<br>");

	// Restore code blocks
	codeBlocks.forEach(function (block, index) {
		let langAttr = block.lang ? ' data-lang="' + block.lang + '"' : "";
		let escapedCode = escapeHtml(block.code);
		let replacement =
			'<pre class="code-block"' +
			langAttr +
			"><code>" +
			escapedCode +
			"</code></pre>";
		html = html.replace("%%CODEBLOCK" + index + "%%", replacement);
	});

	// Restore mermaid blocks as diagrams
	mermaidBlocks.forEach(function (code, index) {
		let mermaidId =
			"mermaid-" +
			Date.now() +
			"-" +
			index +
			"-" +
			Math.random().toString(36).substr(2, 9);
		let replacement =
			'<div class="mermaid-container" data-mermaid-id="' +
			mermaidId +
			'"><div class="mermaid" id="' +
			mermaidId +
			'">' +
			escapeHtml(code) +
			"</div></div>";
		html = html.replace("%%MERMAID" + index + "%%", replacement);
	});

	// Clean up excessive <br> around block elements
	html = html.replace(
		/(<br>)+(<pre|<div class="mermaid|<h[1-6]|<ul|<ol|<blockquote|<hr)/g,
		"$2",
	);
	html = html.replace(
		/(<\/pre>|<\/div>|<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)(<br>)+/g,
		"$1",
	);

	return html;
}

// Mermaid rendering - lazy load and render
let mermaidLoaded = false;
let mermaidLoading = false;

function loadMermaid(callback) {
	if (mermaidLoaded) {
		callback();
		return;
	}
	if (mermaidLoading) {
		// Wait for existing load (with 10s timeout)
		let checkCount = 0;
		let checkInterval = setInterval(function () {
			checkCount++;
			if (mermaidLoaded) {
				clearInterval(checkInterval);
				callback();
			} else if (checkCount > 200) {
				// 10s = 200 * 50ms
				clearInterval(checkInterval);
				console.error("Mermaid load timeout");
			}
		}, 50);
		return;
	}
	mermaidLoading = true;

	let script = document.createElement("script");
	script.src = window.__MERMAID_SRC__ || "mermaid.min.js";
	script.onload = function () {
		window.mermaid.initialize({
			startOnLoad: false,
			theme: document.body.classList.contains("vscode-light")
				? "default"
				: "dark",
			securityLevel: "strict",
			fontFamily: "var(--vscode-font-family)",
		});
		mermaidLoaded = true;
		mermaidLoading = false;
		callback();
	};
	script.onerror = function () {
		mermaidLoading = false;
		console.error("Failed to load mermaid.js");
	};
	document.head.appendChild(script);
}

function renderMermaidDiagrams() {
	let containers = document.querySelectorAll(
		".mermaid-container:not(.rendered)",
	);
	if (containers.length === 0) return;

	loadMermaid(function () {
		containers.forEach(function (container) {
			let mermaidDiv = container.querySelector(".mermaid");
			if (!mermaidDiv) return;

			let code = mermaidDiv.textContent;
			let id = mermaidDiv.id;

			try {
				window.mermaid
					.render(id + "-svg", code)
					.then(function (result) {
						mermaidDiv.innerHTML = result.svg;
						container.classList.add("rendered");
					})
					.catch(function (err) {
						// Show code block as fallback on error
						mermaidDiv.innerHTML =
							'<pre class="code-block" data-lang="mermaid"><code>' +
							escapeHtml(code) +
							"</code></pre>";
						container.classList.add("rendered", "error");
					});
			} catch (err) {
				mermaidDiv.innerHTML =
					'<pre class="code-block" data-lang="mermaid"><code>' +
					escapeHtml(code) +
					"</code></pre>";
				container.classList.add("rendered", "error");
			}
		});
	});
}

/**
 * Toggle split view mode (sessions list + thread side by side)
 */
function toggleSplitView() {
	splitViewEnabled = !splitViewEnabled;
	var container = document.querySelector(".main-container.orch");
	if (container) {
		container.classList.toggle("split-view", splitViewEnabled);
	}
	var resizer = document.getElementById("split-resizer");
	if (resizer) {
		resizer.classList.toggle("hidden", !splitViewEnabled);
	}
	if (splitViewEnabled) {
		applySplitRatio(splitRatio);
	} else {
		// Reset inline styles when exiting split view
		var hubEl = document.getElementById("workspace-hub");
		if (hubEl) hubEl.style.flex = "";
	}
	updateWelcomeSectionVisibility();
	saveWebviewState();
}

/**
 * Apply the split ratio to the hub panel width
 */
function applySplitRatio(ratio) {
	ratio = Math.min(60, Math.max(20, ratio));
	var hubEl = document.getElementById("workspace-hub");
	if (hubEl) {
		hubEl.style.flex = "0 0 " + ratio + "%";
	}
}

/**
 * Initialise the split-view drag resizer.
 * Called once from cacheDOMElements / DOMContentLoaded.
 */
function initSplitResizer() {
	var resizer = document.getElementById("split-resizer");
	if (!resizer) return;

	var container = document.querySelector(".main-container.orch");
	if (!container) return;

	var dragging = false;

	resizer.addEventListener("mousedown", function (e) {
		if (!splitViewEnabled) return;
		e.preventDefault();
		dragging = true;
		resizer.classList.add("active");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	});

	document.addEventListener("mousemove", function (e) {
		if (!dragging) return;
		var rect = container.getBoundingClientRect();
		var offset = e.clientX - rect.left;
		var pct = (offset / rect.width) * 100;
		// Clamp between 20% and 60%
		pct = Math.min(60, Math.max(20, pct));
		splitRatio = Math.round(pct);
		applySplitRatio(splitRatio);
	});

	document.addEventListener("mouseup", function () {
		if (!dragging) return;
		dragging = false;
		resizer.classList.remove("active");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		saveWebviewState();
	});

	// Restore persisted ratio on init
	if (splitViewEnabled) {
		resizer.classList.remove("hidden");
		applySplitRatio(splitRatio);
	}
}

/**
 * Update workspace visibility and toggle between Hub and Thread views
 */
function updateWelcomeSectionVisibility() {
	var hubEl = document.getElementById("workspace-hub");
	var threadEl = document.getElementById("thread-shell");
	var placeholderEl = document.getElementById("split-placeholder");
	var threadHeadEl = document.getElementById("stage-head");
	var composerEl = document.getElementById("input-area-container");

	if (splitViewEnabled) {
		// Split view: always show hub, always show thread shell
		if (hubEl) hubEl.classList.remove("hidden");
		if (threadEl) threadEl.classList.remove("hidden");

		if (activeSessionId) {
			// Session selected: show thread content, hide placeholder
			if (placeholderEl) placeholderEl.classList.add("hidden");
			if (threadHeadEl) threadHeadEl.classList.remove("hidden");
			if (composerEl) composerEl.classList.remove("hidden");
			var activeSession = (sessions || []).find(function (s) {
				return s.id === activeSessionId;
			});
			var stageTitle = document.getElementById("stage-title");
			if (activeSession && stageTitle) {
				stageTitle.textContent = activeSession.title;
			}
		} else {
			// No session: show placeholder, hide thread head + composer
			if (placeholderEl) placeholderEl.classList.remove("hidden");
			if (threadHeadEl) threadHeadEl.classList.add("hidden");
			if (composerEl) composerEl.classList.add("hidden");
		}
		return;
	}

	// Single view (default): hide placeholder, restore thread head + composer
	if (placeholderEl) placeholderEl.classList.add("hidden");
	if (threadHeadEl) threadHeadEl.classList.remove("hidden");
	if (composerEl) composerEl.classList.remove("hidden");

	// Toggle between hub and thread
	if (activeSessionId) {
		if (hubEl) hubEl.classList.add("hidden");
		if (threadEl) threadEl.classList.remove("hidden");

		// Update thread head title
		var activeSession = (sessions || []).find(function (s) {
			return s.id === activeSessionId;
		});
		var stageTitle = document.getElementById("stage-title");
		if (activeSession) {
			if (stageTitle) stageTitle.textContent = activeSession.title;
		}
	} else {
		// No active session: show the hub, hide the thread shell
		if (hubEl) hubEl.classList.remove("hidden");
		if (threadEl) threadEl.classList.add("hidden");
	}
}

/**
 * Auto-scroll chat container to bottom
 */
function scrollToBottom() {
	if (!chatContainer) return;
	requestAnimationFrame(function () {
		chatContainer.scrollTop = chatContainer.scrollHeight;
	});
}

// ==================== Multi-Session Rendering ====================

/**
 * Render the sessions list in the workspace-hub.
 * Displays each session as a clickable row.
 */
function renderSessionsList() {
	var sessionsListEl = document.getElementById("sessions-list");
	var sessionsPanelEl = document.getElementById("sessions-panel");
	if (!sessionsListEl) return;

	if (!sessions || sessions.length === 0) {
		sessionsListEl.innerHTML = "";
		if (sessionsPanelEl) sessionsPanelEl.classList.add("hidden");
		if (welcomeSection) welcomeSection.classList.remove("hidden");
		return;
	}

	if (sessionsPanelEl) sessionsPanelEl.classList.remove("hidden");
	if (welcomeSection) welcomeSection.classList.add("hidden");

	// Sort: active sessions first (newest first), then archived
	var sorted = sessions.slice().sort(function (a, b) {
		if (a.status !== b.status) {
			return a.status === "active" ? -1 : 1;
		}
		return b.createdAt - a.createdAt;
	});

	var html = sorted
		.map(function (session) {
			var isActive = session.id === activeSessionId;
			var isWaiting = session.waitingOnUser;
			var isArchived = session.status === "archived";

			var rowClass =
				"chat-row" +
				(isActive ? " active" : "") +
				(isWaiting ? " waiting" : "") +
				(isArchived ? " archived" : "");

			// Default preview snippet
			var promptPreview = "Tap to view thread...";
			if (session.history && session.history.length > 0) {
				var lastHistory = session.history[0]; // Assuming reversed (newest first)? Or last?
				// Let's grab the last prompt block string:
				var lastH = session.history[session.history.length - 1]; // standard order
				if (
					session.history[0] &&
					session.history[0].timestamp > (lastH ? lastH.timestamp : 0)
				) {
					lastH = session.history[0]; // Wait, if history is [newest, ...oldest] then 0 is latest
				}
				promptPreview = lastH.prompt || promptPreview;
			}
			if (isWaiting) promptPreview = "Waiting for reply: " + promptPreview;

			var formatTime = function (ts) {
				if (!ts) return "";
				var d = new Date(ts);
				return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
			};
			var timeStr = formatTime(session.createdAt);

			return (
				'<div class="' +
				rowClass +
				'" data-session-id="' +
				escapeHtml(session.id) +
				'">' +
				'<div class="chat-row-main">' +
				'<div class="chat-row-top">' +
				'<strong class="session-title">' +
				escapeHtml(session.title) +
				"</strong>" +
				"<span>" +
				escapeHtml(timeStr) +
				"</span>" +
				"</div>" +
				'<div class="chat-row-preview">' +
				escapeHtml(promptPreview).substring(0, 100) +
				"</div>" +
				"</div>" +
				'<div class="session-thread-actions">' +
				'<button class="session-action-btn session-rename-btn" data-rename-session-id="' +
				escapeHtml(session.id) +
				'" title="Rename session" aria-label="Rename session ' +
				escapeHtml(session.title) +
				'"><span class="codicon codicon-edit"></span></button>' +
				'<button class="session-action-btn session-delete-btn" data-delete-session-id="' +
				escapeHtml(session.id) +
				'" title="Delete session" aria-label="Delete session ' +
				escapeHtml(session.title) +
				'"><span class="codicon codicon-trash"></span></button>' +
				"</div>" +
				"</div>"
			);
		})
		.join("");

	sessionsListEl.innerHTML = html;

	// Bind click handlers for session switching
	sessionsListEl.querySelectorAll(".chat-row").forEach(function (item) {
		item.addEventListener("click", function () {
			var sessionId = item.getAttribute("data-session-id");
			if (sessionId) {
				vscode.postMessage({ type: "switchSession", sessionId: sessionId });
			}
		});
	});

	sessionsListEl
		.querySelectorAll(".session-delete-btn")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				var sessionId = btn.getAttribute("data-delete-session-id");
				if (sessionId) {
					vscode.postMessage({ type: "deleteSession", sessionId: sessionId });
				}
			});
		});

	sessionsListEl
		.querySelectorAll(".session-rename-btn")
		.forEach(function (btn) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				var row = btn.closest(".chat-row");
				if (!row) return;
				var sessionId = btn.getAttribute("data-rename-session-id");
				var titleEl = row.querySelector(".session-title");
				if (!titleEl || !sessionId) return;

				var currentTitle = titleEl.textContent || "";
				var input = document.createElement("input");
				input.type = "text";
				input.className = "session-rename-input";
				input.value = currentTitle;
				input.maxLength = 50;
				titleEl.replaceWith(input);
				input.focus();
				input.select();

				var committed = false;
				function commit() {
					if (committed) return;
					committed = true;
					var newTitle = input.value.trim();
					if (newTitle && newTitle !== currentTitle) {
						vscode.postMessage({
							type: "updateSessionTitle",
							sessionId: sessionId,
							title: newTitle,
						});
					} else {
						// Revert — re-render will fix it, but restore immediately for UX
						var strong = document.createElement("strong");
						strong.className = "session-title";
						strong.textContent = currentTitle;
						input.replaceWith(strong);
					}
				}

				input.addEventListener("keydown", function (ev) {
					if (ev.key === "Enter") {
						ev.preventDefault();
						commit();
					} else if (ev.key === "Escape") {
						ev.preventDefault();
						committed = true; // prevent blur from committing
						var strong = document.createElement("strong");
						strong.className = "session-title";
						strong.textContent = currentTitle;
						input.replaceWith(strong);
					}
				});
				input.addEventListener("blur", commit);
			});
		});
}
