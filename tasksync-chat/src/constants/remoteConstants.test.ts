import { describe, expect, it } from "vitest";
import {
	ASKUSER_LOOP_TEXT,
	ASKUSER_VISIBILITY_TEXT,
	buildAskUserFollowUpQuery,
	buildAskUserRequestQuery,
	CONFIG_SECTION,
	DEFAULT_HUMAN_LIKE_DELAY_MAX,
	DEFAULT_HUMAN_LIKE_DELAY_MIN,
	DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES,
	DEFAULT_REMOTE_PORT,
	DEFAULT_REMOTE_SESSION_QUERY,
	DEFAULT_SESSION_WARNING_HOURS,
	ErrorCode,
	HUMAN_DELAY_MAX_LOWER,
	HUMAN_DELAY_MAX_UPPER,
	HUMAN_DELAY_MIN_LOWER,
	HUMAN_DELAY_MIN_UPPER,
	isValidQueueId,
	MAX_ATTACHMENT_NAME_LENGTH,
	MAX_ATTACHMENT_URI_LENGTH,
	MAX_ATTACHMENTS,
	MAX_COMMIT_MESSAGE_LENGTH,
	MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
	MAX_DIFF_SIZE,
	MAX_FILE_PATH_LENGTH,
	MAX_IMAGE_PASTE_BYTES,
	MAX_QUEUE_PROMPT_LENGTH,
	MAX_QUEUE_SIZE,
	MAX_REMOTE_HISTORY_ITEMS,
	MAX_RESPONSE_LENGTH,
	MAX_SEARCH_QUERY_LENGTH,
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
	SESSION_WARNING_HOURS_MAX,
	SESSION_WARNING_HOURS_MIN,
	truncateDiff,
	VALID_QUEUE_ID_PATTERN,
	WS_MAX_PAYLOAD,
	WS_PROTOCOL_VERSION,
} from "../constants/remoteConstants";

describe("remoteConstants", () => {
	describe("constant values sanity checks", () => {
		it("has expected config section name", () => {
			expect(CONFIG_SECTION).toBe("tasksync");
		});

		it("has sensible default ports", () => {
			expect(DEFAULT_REMOTE_PORT).toBe(3580);
		});

		it("limits are positive numbers", () => {
			for (const limit of [
				WS_MAX_PAYLOAD,
				MAX_RESPONSE_LENGTH,
				MAX_QUEUE_PROMPT_LENGTH,
				MAX_QUEUE_SIZE,
				MAX_DIFF_SIZE,
				MAX_COMMIT_MESSAGE_LENGTH,
				MAX_REMOTE_HISTORY_ITEMS,
				MAX_ATTACHMENTS,
				MAX_ATTACHMENT_URI_LENGTH,
				MAX_ATTACHMENT_NAME_LENGTH,
				MAX_FILE_PATH_LENGTH,
				MAX_SEARCH_QUERY_LENGTH,
				MAX_IMAGE_PASTE_BYTES,
			]) {
				expect(limit).toBeGreaterThan(0);
			}
		});

		it("has valid WS protocol version", () => {
			expect(WS_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
		});
	});

	describe("ErrorCode", () => {
		it("contains expected error codes", () => {
			expect(ErrorCode.INVALID_INPUT).toBe("INVALID_INPUT");
			expect(ErrorCode.ALREADY_ANSWERED).toBe("ALREADY_ANSWERED");
			expect(ErrorCode.QUEUE_FULL).toBe("QUEUE_FULL");
			expect(ErrorCode.ITEM_NOT_FOUND).toBe("ITEM_NOT_FOUND");
			expect(ErrorCode.GIT_UNAVAILABLE).toBe("GIT_UNAVAILABLE");
		});
	});

	describe("human-like delay ranges", () => {
		it("default min < default max", () => {
			expect(DEFAULT_HUMAN_LIKE_DELAY_MIN).toBeLessThan(
				DEFAULT_HUMAN_LIKE_DELAY_MAX,
			);
		});

		it("min range is valid", () => {
			expect(HUMAN_DELAY_MIN_LOWER).toBeLessThan(HUMAN_DELAY_MIN_UPPER);
		});

		it("max range is valid", () => {
			expect(HUMAN_DELAY_MAX_LOWER).toBeLessThan(HUMAN_DELAY_MAX_UPPER);
		});

		it("max lower >= min lower", () => {
			expect(HUMAN_DELAY_MAX_LOWER).toBeGreaterThanOrEqual(
				HUMAN_DELAY_MIN_LOWER,
			);
		});
	});

	describe("session warning hours", () => {
		it("default is within valid range", () => {
			expect(DEFAULT_SESSION_WARNING_HOURS).toBeGreaterThanOrEqual(
				SESSION_WARNING_HOURS_MIN,
			);
			expect(DEFAULT_SESSION_WARNING_HOURS).toBeLessThanOrEqual(
				SESSION_WARNING_HOURS_MAX,
			);
		});
	});

	describe("auto-responses", () => {
		it("default < limit", () => {
			expect(DEFAULT_MAX_CONSECUTIVE_AUTO_RESPONSES).toBeLessThan(
				MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
			);
		});
	});

	describe("response timeout", () => {
		it("allowed values is a non-empty Set", () => {
			expect(RESPONSE_TIMEOUT_ALLOWED_VALUES.size).toBeGreaterThan(0);
		});

		it("default is in allowed values", () => {
			expect(
				RESPONSE_TIMEOUT_ALLOWED_VALUES.has(RESPONSE_TIMEOUT_DEFAULT_MINUTES),
			).toBe(true);
		});

		it("0 (disabled) is an allowed value", () => {
			expect(RESPONSE_TIMEOUT_ALLOWED_VALUES.has(0)).toBe(true);
		});
	});

	describe("default remote session query", () => {
		it("is a non-empty string", () => {
			expect(DEFAULT_REMOTE_SESSION_QUERY.length).toBeGreaterThan(0);
		});

		it("includes shared askUser guidance fragments", () => {
			expect(DEFAULT_REMOTE_SESSION_QUERY).toContain(ASKUSER_VISIBILITY_TEXT);
			expect(DEFAULT_REMOTE_SESSION_QUERY).toContain("#askUser");
		});
	});

	describe("askUser prompt builders", () => {
		it("buildAskUserRequestQuery includes request and loop instruction", () => {
			const query = buildAskUserRequestQuery("fix login bug");
			expect(query).toContain("fix login bug");
			expect(query).toContain(ASKUSER_VISIBILITY_TEXT);
			expect(query).toContain(ASKUSER_LOOP_TEXT);
		});

		it("buildAskUserFollowUpQuery includes follow-up and askUser requirement", () => {
			const query = buildAskUserFollowUpQuery("add tests too");
			expect(query).toContain("add tests too");
			expect(query).toContain(ASKUSER_VISIBILITY_TEXT);
			expect(query).toContain("Call #askUser to respond");
		});
	});
});

// ─── isValidQueueId ──────────────────────────────────────────

describe("isValidQueueId", () => {
	it("accepts valid queue IDs", () => {
		expect(isValidQueueId("q_1234567890_abc123def")).toBe(true);
		expect(isValidQueueId("q_0_a")).toBe(true);
		expect(isValidQueueId("q_999_z9z9z9")).toBe(true);
	});

	it("rejects non-string values", () => {
		expect(isValidQueueId(123)).toBe(false);
		expect(isValidQueueId(null)).toBe(false);
		expect(isValidQueueId(undefined)).toBe(false);
		expect(isValidQueueId({})).toBe(false);
		expect(isValidQueueId([])).toBe(false);
	});

	it("rejects strings not matching pattern", () => {
		expect(isValidQueueId("")).toBe(false);
		expect(isValidQueueId("q_")).toBe(false);
		expect(isValidQueueId("q_123")).toBe(false); // missing random part
		expect(isValidQueueId("x_123_abc")).toBe(false); // wrong prefix
		expect(isValidQueueId("q_abc_def")).toBe(false); // timestamp not digits
		expect(isValidQueueId("q_123_ABC")).toBe(false); // uppercase not allowed
		expect(isValidQueueId("q_123_abc!")).toBe(false); // special chars
	});

	it("acts as a type guard", () => {
		const val: unknown = "q_1_a";
		if (isValidQueueId(val)) {
			// TypeScript should narrow val to string here
			const s: string = val;
			expect(s).toBe("q_1_a");
		}
	});
});

// ─── truncateDiff ────────────────────────────────────────────

describe("truncateDiff", () => {
	it("returns short diffs unchanged", () => {
		const diff = "small diff content";
		expect(truncateDiff(diff)).toBe(diff);
	});

	it("returns exact-limit diffs unchanged", () => {
		const diff = "x".repeat(MAX_DIFF_SIZE);
		expect(truncateDiff(diff)).toBe(diff);
	});

	it("truncates diffs exceeding MAX_DIFF_SIZE", () => {
		const diff = "x".repeat(MAX_DIFF_SIZE + 100);
		const result = truncateDiff(diff);
		expect(result.length).toBeLessThan(diff.length);
		expect(result).toContain("... (diff truncated");
	});

	it("preserves content up to MAX_DIFF_SIZE", () => {
		const diff = "A".repeat(MAX_DIFF_SIZE) + "Z".repeat(100);
		const result = truncateDiff(diff);
		expect(result.startsWith("A".repeat(MAX_DIFF_SIZE))).toBe(true);
		expect(result).not.toContain("Z");
	});

	it("returns empty string unchanged", () => {
		expect(truncateDiff("")).toBe("");
	});
});

// ─── VALID_QUEUE_ID_PATTERN ──────────────────────────────────

describe("VALID_QUEUE_ID_PATTERN", () => {
	it("matches the documented format q_{digits}_{alphanumeric}", () => {
		expect(VALID_QUEUE_ID_PATTERN.test("q_12345_abc09")).toBe(true);
	});

	it("rejects patterns with extra segments", () => {
		expect(VALID_QUEUE_ID_PATTERN.test("q_12345_abc_extra")).toBe(false);
	});
});
