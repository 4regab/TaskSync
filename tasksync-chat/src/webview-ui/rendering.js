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
			let truncatedTitle;
			if (tc.summary) {
				truncatedTitle =
					tc.summary.length > 120
						? tc.summary.substring(0, 120) + "..."
						: tc.summary;
			} else {
				let firstSentence = tc.prompt.split(/[.!?]/)[0];
				truncatedTitle =
					firstSentence.length > 120
						? firstSentence.substring(0, 120) + "..."
						: firstSentence;
			}
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
		let truncatedTitle;
		if (tc.summary) {
			truncatedTitle =
				tc.summary.length > 80
					? tc.summary.substring(0, 80) + "..."
					: tc.summary;
		} else {
			let firstSentence = tc.prompt.split(/[.!?]/)[0];
			truncatedTitle =
				firstSentence.length > 80
					? firstSentence.substring(0, 80) + "..."
					: firstSentence;
		}
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
 * Update welcome section visibility based on current session state
 * Hide welcome when there are completed tool calls or a pending call
 */
function updateWelcomeSectionVisibility() {
	if (!welcomeSection) return;
	let hasCompletedCalls = currentSessionCalls.some(function (tc) {
		return tc.status === "completed";
	});
	let hasPendingMessage =
		pendingMessage && !pendingMessage.classList.contains("hidden");
	let shouldHide =
		hasCompletedCalls || pendingToolCall !== null || hasPendingMessage;
	welcomeSection.classList.toggle("hidden", shouldHide);
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
