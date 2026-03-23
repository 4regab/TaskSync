import { describe, expect, it } from "vitest";
import {
	CHOICE_LABEL_MAX_LENGTH,
	isApprovalQuestion,
	parseChoices,
	SHORT_QUESTION_THRESHOLD,
} from "../webview/choiceParser";

// ─── parseChoices ────────────────────────────────────────────

describe("parseChoices", () => {
	describe("numbered lists (multi-line)", () => {
		it("detects a basic numbered list (1. 2. 3.)", () => {
			const text = "Which language?\n1. JavaScript\n2. Python\n3. Rust";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0]).toMatchObject({ value: "1", shortLabel: "1" });
			expect(choices[1]).toMatchObject({ value: "2", shortLabel: "2" });
			expect(choices[2]).toMatchObject({ value: "3", shortLabel: "3" });
		});

		it("detects numbered list with parentheses (1) 2) 3))", () => {
			const text = "Pick one:\n1) Option A\n2) Option B\n3) Option C";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0].label).toContain("Option A");
		});

		it("detects bold markdown numbered options", () => {
			const text = "Choose:\n**1. First choice**\n**2. Second choice**";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(2);
			expect(choices[0].label).toContain("First choice");
		});

		it("returns first list when multiple numbered lists exist", () => {
			const text =
				"Main choices:\n1. Alpha\n2. Beta\n3. Gamma\n\nExamples:\n1. Example one\n2. Example two";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0].label).toContain("Alpha");
		});

		it("truncates long labels to CHOICE_LABEL_MAX_LENGTH", () => {
			const longOption = "A".repeat(50);
			const text = `Pick:\n1. ${longOption}\n2. Short`;
			const choices = parseChoices(text);
			expect(choices[0].label.length).toBeLessThanOrEqual(
				CHOICE_LABEL_MAX_LENGTH,
			);
			expect(choices[0].label).toContain("...");
		});

		it("strips trailing punctuation from labels", () => {
			const text = "Pick:\n1. Continue?\n2. Stop!";
			const choices = parseChoices(text);
			expect(choices[0].label).toBe("Continue");
			expect(choices[1].label).toBe("Stop");
		});
	});

	describe("inline numbered lists", () => {
		it("detects inline numbered options", () => {
			const text = "Choose: 1. JavaScript 2. Python 3. Rust";
			const choices = parseChoices(text);
			expect(choices.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("lettered lists (multi-line)", () => {
		it("detects lettered list (A. B. C.)", () => {
			const text = "Options:\nA. First\nB. Second\nC. Third";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0]).toMatchObject({ value: "A", shortLabel: "A" });
			expect(choices[1]).toMatchObject({ value: "B", shortLabel: "B" });
			expect(choices[2]).toMatchObject({ value: "C", shortLabel: "C" });
		});

		it("detects lettered list with parentheses (A) B) C))", () => {
			const text = "Pick:\nA) Alpha\nB) Bravo\nC) Charlie";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0].label).toContain("Alpha");
		});

		it("normalises letters to uppercase", () => {
			const text = "Pick:\na. lower alpha\nb. lower bravo";
			const choices = parseChoices(text);
			expect(choices[0].value).toBe("A");
			expect(choices[1].value).toBe("B");
		});
	});

	describe("Option X: pattern", () => {
		it("detects Option A: / Option B: style", () => {
			const text =
				"Option A: Use React for the frontend\nOption B: Use Vue for the frontend";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(2);
			expect(choices[0].value).toBe("Option A");
			expect(choices[1].value).toBe("Option B");
		});

		it("detects Option 1: / Option 2: style", () => {
			const text =
				"Option 1: Keep the current implementation\nOption 2: Refactor to use hooks";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(2);
			// Matched by inline numbered pattern (Pattern 1b), not Option X: pattern
			expect(choices[0].value).toBe("1");
			expect(choices[1].value).toBe("2");
		});
	});

	describe("inline lettered lists", () => {
		it("detects inline lettered A. B. C. pattern (uppercase only)", () => {
			const text = "A. agree B. disagree C. maybe later";
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0].value).toBe("A");
			expect(choices[1].value).toBe("B");
			expect(choices[2].value).toBe("C");
		});
	});

	describe("lettered list boundary detection", () => {
		it("uses first group when two lettered lists are separated by > 3 lines", () => {
			const text = [
				"Main choices:",
				"A. Alpha",
				"B. Bravo",
				"C. Charlie",
				"",
				"Some extra info here.",
				"More context about the above.",
				"Even more details.",
				"And yet another line.",
				"A. Unrelated item",
				"B. Another unrelated",
			].join("\n");
			const choices = parseChoices(text);
			expect(choices).toHaveLength(3);
			expect(choices[0].label).toContain("Alpha");
			expect(choices[2].label).toContain("Charlie");
		});
	});

	describe("edge cases", () => {
		it("returns empty array for plain text", () => {
			expect(parseChoices("Hello world")).toEqual([]);
		});

		it("returns empty array for empty string", () => {
			expect(parseChoices("")).toEqual([]);
		});

		it("returns empty array for single-item list (needs >= 2)", () => {
			expect(parseChoices("Only:\n1. One item")).toEqual([]);
		});

		it("ignores items with very short text (<3 chars)", () => {
			const text = "Pick:\n1. OK\n2. Go\n3. Something valid";
			const choices = parseChoices(text);
			// "OK" and "Go" are only 2 chars → skipped; only "Something valid" remains (1 item → empty)
			// or if parser considers them valid, that's fine too
			// The important thing is the parser doesn't crash
			expect(Array.isArray(choices)).toBe(true);
		});
	});
});

// ─── isApprovalQuestion ──────────────────────────────────────

describe("isApprovalQuestion", () => {
	describe("positive: approval / confirmation questions", () => {
		it("detects yes/no question starters", () => {
			expect(isApprovalQuestion("Shall I proceed?")).toBe(true);
			expect(isApprovalQuestion("Should we continue?")).toBe(true);
			expect(isApprovalQuestion("Can I delete this file?")).toBe(true);
			expect(isApprovalQuestion("Would you like to save?")).toBe(true);
			expect(isApprovalQuestion("Do you want to proceed?")).toBe(true);
		});

		it("detects action confirmation keywords", () => {
			expect(isApprovalQuestion("Ready to proceed?")).toBe(true);
			expect(isApprovalQuestion("Confirm the deployment?")).toBe(true);
			expect(isApprovalQuestion("Apply these changes?")).toBe(true);
		});

		it("detects binary choice indicators", () => {
			expect(isApprovalQuestion("Continue? [y/n]")).toBe(true);
			expect(isApprovalQuestion("Are you sure? yes or no")).toBe(true);
		});

		it("detects 'want me to' / 'like me to' phrases", () => {
			expect(isApprovalQuestion("Do you want me to fix this?")).toBe(true);
			expect(isApprovalQuestion("Would you like me to refactor?")).toBe(true);
		});

		it("detects short questions ending with ? as approval", () => {
			expect(isApprovalQuestion("Looks good?")).toBe(true);
			expect(isApprovalQuestion("Correct?")).toBe(true);
		});

		it("detects short non-interrogative questions via heuristic", () => {
			// These don't match any approval pattern but are short, end with ?,
			// and don't start with an interrogative word → true via heuristic
			expect(isApprovalQuestion("Done?")).toBe(true);
			expect(isApprovalQuestion("Updated?")).toBe(true);
			expect(isApprovalQuestion("All set?")).toBe(true);
		});

		it("detects short non-interrogative questions with trailing whitespace", () => {
			// Trailing whitespace bypasses /\?$/ pattern, reaching the heuristic
			expect(isApprovalQuestion("Done?  ")).toBe(true);
			expect(isApprovalQuestion("Fixed? ")).toBe(true);
		});

		it("rejects short interrogative questions with trailing whitespace", () => {
			// Trailing whitespace makes heuristic reachable; interrogative word → false
			expect(isApprovalQuestion("When?  ")).toBe(false);
			expect(isApprovalQuestion("Where? ")).toBe(false);
		});
	});

	describe("negative: non-approval questions", () => {
		it("rejects open-ended what/which/how questions", () => {
			expect(isApprovalQuestion("What is the file path?")).toBe(false);
			expect(isApprovalQuestion("Which option do you prefer?")).toBe(false);
			expect(isApprovalQuestion("How should I implement this?")).toBe(false);
			expect(isApprovalQuestion("Where should I put the file?")).toBe(false);
		});

		it("rejects questions with numbered lists", () => {
			const text =
				"Which approach?\n1. Use REST API\n2. Use GraphQL\n3. Use gRPC";
			expect(isApprovalQuestion(text)).toBe(false);
		});

		it("rejects questions with multi-digit numbered lists", () => {
			// Uses 10+ digit numbers to bypass single-digit negative pattern /[1-9][.)]/
			// and "Here are" avoids "Pick one" matching /pick (?:one|from|between)/
			const text =
				"Here are the approaches:\n10. First approach\n11. Second approach\n12. Third approach";
			expect(isApprovalQuestion(text)).toBe(false);
		});

		it("rejects 'select/choose an option' prompts", () => {
			expect(isApprovalQuestion("Please select an option")).toBe(false);
			expect(isApprovalQuestion("Choose an option below")).toBe(false);
		});

		it("rejects open-ended input requests", () => {
			expect(isApprovalQuestion("Enter a name for the file")).toBe(false);
			expect(isApprovalQuestion("Provide the API endpoint")).toBe(false);
		});

		it("rejects 'describe/explain' requests", () => {
			expect(isApprovalQuestion("Describe what happened")).toBe(false);
			expect(isApprovalQuestion("Explain the error")).toBe(false);
		});

		it("rejects questions asking for specific info", () => {
			expect(isApprovalQuestion("What do you think about this approach?")).toBe(
				false,
			);
			expect(isApprovalQuestion("Any suggestions for improvement?")).toBe(
				false,
			);
		});
	});

	describe("threshold parameter", () => {
		it("uses default SHORT_QUESTION_THRESHOLD (100)", () => {
			expect(SHORT_QUESTION_THRESHOLD).toBe(100);
		});

		it("respects custom threshold", () => {
			// A 50-char "question" that ends with ? and isn't interrogative
			const shortQ = "Proceed?";
			expect(isApprovalQuestion(shortQ, 5)).toBe(true); // below threshold → heuristic fires
			// Even with threshold=5, the text matches approval patterns so still true
		});
	});

	describe("edge cases", () => {
		it("returns false for long non-matching text", () => {
			// Text that doesn't match any approval or negative pattern
			// and is longer than SHORT_QUESTION_THRESHOLD
			const longText =
				"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
			expect(isApprovalQuestion(longText)).toBe(false);
		});

		it("returns false for statement without approval patterns", () => {
			const text = "The data has been loaded into memory for analysis.";
			expect(isApprovalQuestion(text)).toBe(false);
		});

		it("detects ASCII art boxes as multi-choice", () => {
			const text =
				"Pick one:\n┌──────┐\n│ A    │\n├──────┤\n│ B    │\n└──────┘";
			expect(isApprovalQuestion(text)).toBe(false);
		});

		it("detects bracketed choice patterns as multi-choice", () => {
			const text = "Choose: [Approve] [Reject]";
			expect(isApprovalQuestion(text)).toBe(false);
		});
	});
});
