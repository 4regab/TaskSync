import type { ParsedChoice } from "./webviewTypes";

/**
 * Default threshold for "short question" heuristic in approval detection.
 */
export const SHORT_QUESTION_THRESHOLD = 100; // chars

/** Maximum display length for a choice label button. */
export const CHOICE_LABEL_MAX_LENGTH = 40;

/** Truncation point for long labels (leaves room for "..."). */
const CHOICE_LABEL_TRUNCATE_AT = CHOICE_LABEL_MAX_LENGTH - 3;

/**
 * Parse choices from a question text.
 * Detects numbered lists (1. 2. 3.), lettered options (A. B. C.), and Option X: patterns.
 * Only detects choices near the LAST question mark "?" to avoid false positives from
 * earlier numbered/lettered content in the text.
 *
 * @param text - The question text to parse
 * @returns Array of parsed choices, empty if no choices detected
 */
export function parseChoices(text: string): ParsedChoice[] {
	const choices: ParsedChoice[] = [];
	let match;

	// Search the ENTIRE text for numbered/lettered lists, not just after the last "?"
	// The previous approach failed when examples within the text contained "?" characters
	// (e.g., "Example: What's your favorite language?")

	// Strategy: Find the FIRST major numbered/lettered list that starts early in the text
	// These are the actual choices, not examples or descriptions within the text

	// Split entire text into lines for multi-line patterns
	const lines = text.split("\n");

	// Pattern 1: Numbered options - lines starting with "1." or "1)" through 9
	// Also match bold numbered options like "**1. Option**"
	const numberedLinePattern = /^\s*\*{0,2}(\d+)[.)]\s*\*{0,2}\s*(.+)$/;
	const numberedLines: {
		index: number;
		num: string;
		numValue: number;
		text: string;
	}[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(numberedLinePattern);
		if (m && m[2].trim().length >= 3) {
			// Clean up markdown bold markers from text
			const cleanText = m[2].replace(/\*\*/g, "").trim();
			numberedLines.push({
				index: i,
				num: m[1],
				numValue: parseInt(m[1], 10),
				text: cleanText,
			});
		}
	}

	// Find the FIRST contiguous list (which contains the main choices)
	// Previously used LAST list which missed choices when examples appeared later in text
	if (numberedLines.length >= 2) {
		// Find all list boundaries by detecting number restarts
		const listBoundaries: number[] = [0]; // First list starts at index 0

		for (let i = 1; i < numberedLines.length; i++) {
			const prevNum = numberedLines[i - 1].numValue;
			const currNum = numberedLines[i].numValue;
			const lineGap = numberedLines[i].index - numberedLines[i - 1].index;

			// Detect a new list if:
			// 1. Number resets (e.g., 2 -> 1, or any case where current < previous)
			// 2. Large gap between lines (> 5 lines typically means different section)
			if (currNum <= prevNum || lineGap > 5) {
				listBoundaries.push(i);
			}
		}

		// Get the FIRST list (the main choices list)
		// The first numbered list is typically the actual choices
		// Later lists are often examples or descriptions within each choice
		const firstListEnd =
			listBoundaries.length > 1 ? listBoundaries[1] : numberedLines.length;
		const firstGroup = numberedLines.slice(0, firstListEnd);

		if (firstGroup.length >= 2) {
			for (const m of firstGroup) {
				const cleanText = m.text.replace(/[?!]+$/, "").trim();
				const displayText =
					cleanText.length > CHOICE_LABEL_MAX_LENGTH
						? cleanText.substring(0, CHOICE_LABEL_TRUNCATE_AT) + "..."
						: cleanText;
				choices.push({
					label: displayText,
					value: m.num,
					shortLabel: m.num,
				});
			}
			return choices;
		}
	}

	// Pattern 1b: Inline numbered lists "1. option 2. option 3. option" or "1 - option 2 - option"
	const inlineNumberedPattern =
		/(\d+)(?:[.):]|\s+-)\s+([^0-9]+?)(?=\s+\d+(?:[.):]|\s+-)|$)/g;
	const inlineNumberedMatches: { num: string; text: string }[] = [];

	// Only try inline if no multi-line matches found
	// Use full text converted to single line
	const singleLine = text.replace(/\n/g, " ");
	while ((match = inlineNumberedPattern.exec(singleLine)) !== null) {
		const optionText = match[2].trim();
		if (optionText.length >= 3) {
			inlineNumberedMatches.push({ num: match[1], text: optionText });
		}
	}

	if (inlineNumberedMatches.length >= 2) {
		for (const m of inlineNumberedMatches) {
			const cleanText = m.text.replace(/[?!]+$/, "").trim();
			const displayText =
				cleanText.length > CHOICE_LABEL_MAX_LENGTH
					? cleanText.substring(0, CHOICE_LABEL_TRUNCATE_AT) + "..."
					: cleanText;
			choices.push({
				label: displayText,
				value: m.num,
				shortLabel: m.num,
			});
		}
		return choices;
	}

	// Pattern 2: Lettered options - lines starting with "A." or "A)" or "**A)" through Z
	// Also match bold lettered options like "**A) Option**"
	// FIX: Search entire text, not just after question mark
	const letteredLinePattern = /^\s*\*{0,2}([A-Za-z])[.)]\s*\*{0,2}\s*(.+)$/;
	const letteredLines: { index: number; letter: string; text: string }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(letteredLinePattern);
		if (m && m[2].trim().length >= 3) {
			// Clean up markdown bold markers from text
			const cleanText = m[2].replace(/\*\*/g, "").trim();
			letteredLines.push({
				index: i,
				letter: m[1].toUpperCase(),
				text: cleanText,
			});
		}
	}

	if (letteredLines.length >= 2) {
		// Find all list boundaries by detecting letter restarts or gaps
		const listBoundaries: number[] = [0];

		for (let i = 1; i < letteredLines.length; i++) {
			const gap = letteredLines[i].index - letteredLines[i - 1].index;
			// Detect new list if gap > 3 lines
			if (gap > 3) {
				listBoundaries.push(i);
			}
		}

		// Get the FIRST list (the main choices list)
		const firstListEnd =
			listBoundaries.length > 1 ? listBoundaries[1] : letteredLines.length;
		const firstGroup = letteredLines.slice(0, firstListEnd);

		if (firstGroup.length >= 2) {
			for (const m of firstGroup) {
				const cleanText = m.text.replace(/[?!]+$/, "").trim();
				const displayText =
					cleanText.length > CHOICE_LABEL_MAX_LENGTH
						? cleanText.substring(0, CHOICE_LABEL_TRUNCATE_AT) + "..."
						: cleanText;
				choices.push({
					label: displayText,
					value: m.letter,
					shortLabel: m.letter,
				});
			}
			return choices;
		}
	}

	// Pattern 2b: Inline lettered "A. option B. option C. option"
	// Only match single uppercase letters to avoid false positives
	const inlineLetteredPattern = /\b([A-Z])[.)]\s+([^A-Z]+?)(?=\s+[A-Z][.)]|$)/g;
	const inlineLetteredMatches: { letter: string; text: string }[] = [];

	while ((match = inlineLetteredPattern.exec(singleLine)) !== null) {
		const optionText = match[2].trim();
		if (optionText.length >= 3) {
			inlineLetteredMatches.push({ letter: match[1], text: optionText });
		}
	}

	if (inlineLetteredMatches.length >= 2) {
		for (const m of inlineLetteredMatches) {
			const cleanText = m.text.replace(/[?!]+$/, "").trim();
			const displayText =
				cleanText.length > CHOICE_LABEL_MAX_LENGTH
					? cleanText.substring(0, CHOICE_LABEL_TRUNCATE_AT) + "..."
					: cleanText;
			choices.push({
				label: displayText,
				value: m.letter,
				shortLabel: m.letter,
			});
		}
		return choices;
	}

	// Pattern 3: "Option A:" or "Option 1:" style
	// Search entire text for this pattern
	const optionPattern =
		/option\s+([A-Za-z1-9])\s*:\s*([^\n]+?)(?=\s*Option\s+[A-Za-z1-9]|\s*$|\n)/gi;
	const optionMatches: { id: string; text: string }[] = [];

	while ((match = optionPattern.exec(text)) !== null) {
		const optionText = match[2].trim();
		if (optionText.length >= 3) {
			optionMatches.push({ id: match[1].toUpperCase(), text: optionText });
		}
	}

	if (optionMatches.length >= 2) {
		for (const m of optionMatches) {
			const cleanText = m.text.replace(/[?!]+$/, "").trim();
			const displayText =
				cleanText.length > CHOICE_LABEL_MAX_LENGTH
					? cleanText.substring(0, CHOICE_LABEL_TRUNCATE_AT) + "..."
					: cleanText;
			choices.push({
				label: displayText,
				value: `Option ${m.id}`,
				shortLabel: m.id,
			});
		}
		return choices;
	}

	return choices;
}

/**
 * Detect if a question is an approval/confirmation type that warrants quick action buttons.
 * Uses NLP patterns to identify yes/no questions, permission requests, and confirmations.
 *
 * @param text - The question text to analyze
 * @param shortQuestionThreshold - Character threshold for "short question" heuristic (default: 100)
 * @returns true if the question is an approval-type question
 */
export function isApprovalQuestion(
	text: string,
	shortQuestionThreshold: number = SHORT_QUESTION_THRESHOLD,
): boolean {
	const lowerText = text.toLowerCase();

	// NEGATIVE patterns - questions that require specific input (NOT approval questions)
	const requiresSpecificInput = [
		// Generic "select/choose an option" prompts - these need specific choice, not yes/no
		/please (?:select|choose|pick) (?:an? )?option/i,
		/select (?:an? )?option/i,
		// Open-ended requests for feedback/information
		/let me know/i,
		/tell me (?:what|how|when|if|about)/i,
		/waiting (?:for|on) (?:your|the)/i,
		/ready to (?:hear|see|get|receive)/i,
		// Questions asking for specific information
		/what (?:is|are|should|would)/i,
		/which (?:one|file|option|method|approach)/i,
		/where (?:should|would|is|are)/i,
		/how (?:should|would|do|can)/i,
		/when (?:should|would)/i,
		/who (?:should|would)/i,
		// Questions asking for names, values, content
		/(?:enter|provide|specify|give|type|input|write)\s+(?:a|the|your)/i,
		/what.*(?:name|value|path|url|content|text|message)/i,
		/please (?:enter|provide|specify|give|type)/i,
		// Open-ended questions
		/describe|explain|elaborate|clarify/i,
		/tell me (?:about|more|how)/i,
		/what do you (?:think|want|need|prefer)/i,
		/any (?:suggestions|recommendations|preferences|thoughts)/i,
		// Questions with multiple choice indicators (not binary)
		/choose (?:from|between|one of)/i,
		/select (?:from|one of|which)/i,
		/pick (?:one|from|between)/i,
		// Numbered options (1. 2. 3. or 1) 2) 3))
		/\n\s*[1-9][.)]\s+\S/i,
		// Lettered options (A. B. C. or a) b) c) or Option A/B/C)
		/\n\s*[a-d][.)]\s+\S/i,
		/option\s+[a-d]\s*:/i,
		// "Would you like me to:" followed by list
		/would you like (?:me to|to):\s*\n/i,
		// ASCII art boxes/mockups (common patterns)
		/[┌├└│┐┤┘─╔╠╚║╗╣╝═]/,
		/\[.+\]\s+\[.+\]/i, // Multiple bracketed options like [Approve] [Reject]
		// "Something else?" at the end of a list typically means multi-choice
		/\d+[.)]\s+something else\??/i,
	];

	// Check if question requires specific input - if so, NOT an approval question
	for (const pattern of requiresSpecificInput) {
		if (pattern.test(lowerText)) {
			return false;
		}
	}

	// Also check for numbered lists anywhere in text (strong indicator of multi-choice)
	const numberedListCount = (text.match(/\n\s*\d+[.)]\s+/g) || []).length;
	if (numberedListCount >= 2) {
		return false; // Multiple numbered items = multi-choice question
	}

	// POSITIVE patterns - approval/confirmation questions
	const approvalPatterns = [
		// Direct yes/no question patterns
		/^(?:shall|should|can|could|may|would|will|do|does|did|is|are|was|were|have|has|had)\s+(?:i|we|you|it|this|that)\b/i,
		// Permission/confirmation phrases
		/(?:proceed|continue|go ahead|start|begin|execute|run|apply|commit|save|delete|remove|create|add|update|modify|change|overwrite|replace)/i,
		/(?:ok|okay|alright|ready|confirm|approve|accept|allow|enable|disable|skip|ignore|dismiss|close|cancel|abort|stop|exit|quit)/i,
		// Question endings that suggest yes/no
		/\?$/,
		/(?:right|correct|yes|no)\s*\?$/i,
		/(?:is that|does that|would that|should that)\s+(?:ok|okay|work|help|be\s+(?:ok|fine|good|acceptable))/i,
		// Explicit approval requests
		/(?:do you want|would you like|shall i|should i|can i|may i|could i)/i,
		/(?:want me to|like me to|need me to)/i,
		/(?:approve|confirm|authorize|permit|allow)\s+(?:this|the|these)/i,
		// Binary choice indicators
		/(?:yes or no|y\/n|yes\/no|\[y\/n\]|\(y\/n\))/i,
		// Action confirmation patterns
		/(?:are you sure|do you confirm|please confirm|confirm that)/i,
		/(?:this will|this would|this is going to)/i,
	];

	// Check if any approval pattern matches
	for (const pattern of approvalPatterns) {
		if (pattern.test(lowerText)) {
			return true;
		}
	}

	// Additional heuristic: short questions ending with ? are likely yes/no
	if (
		lowerText.length < shortQuestionThreshold &&
		lowerText.trim().endsWith("?")
	) {
		// But exclude questions with interrogative words that typically need specific answers
		const interrogatives =
			/^(?:what|which|where|when|why|how|who|whom|whose)\b/i;
		if (!interrogatives.test(lowerText.trim())) {
			return true;
		}
	}

	return false;
}
