// ==================== Markdown Utilities ====================
// Extracted from rendering.js: table processing and list conversion

// Constants for security and performance limits
let MARKDOWN_MAX_LENGTH = 100000; // Max markdown input length to prevent ReDoS
let MAX_TABLE_ROWS = 100; // Max table rows to process

/**
 * Process a buffer of table lines into HTML table markup (ReDoS-safe).
 * Security: Caller (formatMarkdown) must pre-escape HTML before passing lines here.
 */
function processTableBuffer(lines, maxRows) {
	if (lines.length < 2) return lines.join("\n");
	if (lines.length > maxRows) return lines.join("\n"); // Skip very large tables

	// Check if second line is separator (contains only |, -, :, spaces)
	let separatorRegex = /^\|[\s\-:|]+\|$/;
	if (!separatorRegex.test(lines[1].trim())) return lines.join("\n");

	let headerCells = lines[0].split("|").filter(function (c) {
		return c.trim() !== "";
	});
	if (headerCells.length === 0) return lines.join("\n");

	let headerHtml =
		"<tr>" +
		headerCells
			.map(function (c) {
				return "<th>" + c.trim() + "</th>";
			})
			.join("") +
		"</tr>";

	let bodyHtml = "";
	for (var i = 2; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		let cells = lines[i].split("|").filter(function (c) {
			return c.trim() !== "";
		});
		bodyHtml +=
			"<tr>" +
			cells
				.map(function (c) {
					return "<td>" + c.trim() + "</td>";
				})
				.join("") +
			"</tr>";
	}

	return (
		'<table class="markdown-table"><thead>' +
		headerHtml +
		"</thead><tbody>" +
		bodyHtml +
		"</tbody></table>"
	);
}

/**
 * Converts markdown lists (ordered/unordered) with indentation-based nesting into HTML.
 * Uses 2-space indentation as one nesting level.
 * @param {string} text - Escaped markdown text (must already be HTML-escaped by caller)
 * @returns {string} Text with markdown lists converted to nested HTML lists
 */
function convertMarkdownLists(text) {
	let listLineRegex = /^\s*(?:[-*]|\d+\.)\s.*$/;
	let lines = text.split("\n");
	let output = [];
	let listBuffer = [];

	function renderListNode(node) {
		let startAttr =
			node.type === "ol" && typeof node.start === "number" && node.start > 1
				? ' start="' + node.start + '"'
				: "";
		return (
			"<" +
			node.type +
			startAttr +
			">" +
			node.items
				.map(function (item) {
					let childrenHtml = item.children.map(renderListNode).join("");
					return "<li>" + item.text + childrenHtml + "</li>";
				})
				.join("") +
			"</" +
			node.type +
			">"
		);
	}

	function processListBuffer(buffer) {
		let listItemRegex = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
		let rootLists = [];
		let stack = [];

		buffer.forEach(function (line) {
			let match = listItemRegex.exec(line);
			if (!match) return;

			let indent = match[1].replace(/\t/g, "    ").length;
			let depth = Math.floor(indent / 2);
			let marker = match[2];
			let type = marker === "-" || marker === "*" ? "ul" : "ol";
			let text = match[3];

			while (stack.length > depth + 1) {
				stack.pop();
			}

			let entry = stack[depth];
			if (!entry || entry.type !== type) {
				const listNode = {
					type: type,
					items: [],
					start: type === "ol" ? parseInt(marker, 10) : null,
				};

				if (depth === 0) {
					rootLists.push(listNode);
				} else {
					const parentEntry = stack[depth - 1];
					if (parentEntry && parentEntry.lastItem) {
						parentEntry.lastItem.children.push(listNode);
					} else {
						rootLists.push(listNode);
					}
				}

				entry = { type: type, list: listNode, lastItem: null };
			}

			stack = stack.slice(0, depth);
			stack[depth] = entry;

			let item = { text: text, children: [] };
			entry.list.items.push(item);
			entry.lastItem = item;
			stack[depth] = entry;
		});

		return rootLists.map(renderListNode).join("");
	}

	lines.forEach(function (line) {
		if (listLineRegex.test(line)) {
			listBuffer.push(line);
			return;
		}
		if (listBuffer.length > 0) {
			output.push(processListBuffer(listBuffer));
			listBuffer = [];
		}
		output.push(line);
	});

	if (listBuffer.length > 0) {
		output.push(processListBuffer(listBuffer));
	}

	return output.join("\n");
}
