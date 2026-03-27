import { describe, expect, it } from "vitest";
import { AUTO_APPEND_DEFAULT_TEXT } from "./constants/remoteConstants";
import { buildFinalResponse } from "./tools";

describe("buildFinalResponse", () => {
	const userResponse = "Here is my answer";
	const customText = "Always call askUser when done.";

	// ── Case 1: Auto Append OFF ──────────────────────────────────
	describe("Case 1: autoAppend OFF", () => {
		it("returns response unchanged when autoAppend is disabled", () => {
			expect(
				buildFinalResponse(
					userResponse,
					false,
					AUTO_APPEND_DEFAULT_TEXT,
					false,
				),
			).toBe(userResponse);
		});

		it("returns response unchanged even if alwaysAppendReminder is also OFF", () => {
			expect(buildFinalResponse(userResponse, false, customText, false)).toBe(
				userResponse,
			);
		});
	});

	// ── Case 2: Auto Append ON, default REQUIRED text ────────────
	describe("Case 2: autoAppend ON, default REQUIRED text", () => {
		it("appends AUTO_APPEND_DEFAULT_TEXT when autoAppend is enabled", () => {
			const result = buildFinalResponse(
				userResponse,
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				false,
			);
			expect(result).toBe(`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("returns just the default text when response is empty", () => {
			const result = buildFinalResponse(
				"",
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				false,
			);
			expect(result).toBe(AUTO_APPEND_DEFAULT_TEXT);
		});
	});

	// ── Case 3: Auto Append ON, custom text ──────────────────────
	describe("Case 3: autoAppend ON, custom text", () => {
		it("appends custom text instead of default", () => {
			const result = buildFinalResponse(userResponse, true, customText, false);
			expect(result).toBe(`${userResponse}\n\n${customText}`);
		});

		it("returns just custom text when response is empty", () => {
			const result = buildFinalResponse("", true, customText, false);
			expect(result).toBe(customText);
		});
	});

	// ── Case 4: Auto Append ON + custom text + Always Append Reminder ON ──
	describe("Case 4: autoAppend ON + custom text + alwaysAppendReminder ON", () => {
		it("appends both custom text and REQUIRED text", () => {
			const result = buildFinalResponse(userResponse, true, customText, true);
			expect(result).toBe(
				`${userResponse}\n\n${customText}\n\n${AUTO_APPEND_DEFAULT_TEXT}`,
			);
		});

		it("appends both when response is empty", () => {
			const result = buildFinalResponse("", true, customText, true);
			expect(result).toBe(`${customText}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});
	});

	// ── Case 5: alwaysAppendReminder ON but autoAppend OFF ───────
	describe("Case 5: alwaysAppendReminder ON, autoAppend OFF", () => {
		it("returns response unchanged (reminder only applies when autoAppend is ON)", () => {
			const result = buildFinalResponse(userResponse, false, customText, true);
			expect(result).toBe(userResponse);
		});

		it("returns empty when response is empty", () => {
			const result = buildFinalResponse("", false, customText, true);
			expect(result).toBe("");
		});
	});

	// ── Case 6: Auto Append ON, default text + Always Append Reminder ON ──
	describe("Case 6: autoAppend ON + default text + alwaysAppendReminder ON", () => {
		it("appends default text twice (both flags active with same text)", () => {
			const result = buildFinalResponse(
				userResponse,
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				true,
			);
			expect(result).toBe(
				`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}\n\n${AUTO_APPEND_DEFAULT_TEXT}`,
			);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────
	describe("edge cases", () => {
		it("handles whitespace-only response", () => {
			const result = buildFinalResponse("   ", true, customText, false);
			expect(result).toBe(`${customText}`);
		});

		it("handles whitespace-only append text (no append happens)", () => {
			const result = buildFinalResponse(userResponse, true, "   ", false);
			expect(result).toBe(userResponse);
		});

		it("handles response with trailing whitespace", () => {
			const result = buildFinalResponse(
				"Answer  \n\n",
				true,
				customText,
				false,
			);
			expect(result).toBe(`Answer\n\n${customText}`);
		});

		it("handles multiline response", () => {
			const multiline = "Line 1\nLine 2\nLine 3";
			const result = buildFinalResponse(multiline, true, customText, false);
			expect(result).toBe(`${multiline}\n\n${customText}`);
		});

		it("handles empty append text with alwaysAppendReminder ON", () => {
			const result = buildFinalResponse(userResponse, true, "", true);
			// Empty append text → appendAutoAppendText returns response unchanged
			// Then alwaysAppendReminder appends REQUIRED text
			expect(result).toBe(`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("handles all flags OFF — response unchanged", () => {
			expect(buildFinalResponse(userResponse, false, "", false)).toBe(
				userResponse,
			);
		});

		it("handles all flags OFF with empty response", () => {
			expect(buildFinalResponse("", false, "", false)).toBe("");
		});

		it("handles append text containing internal newlines", () => {
			const multilineAppend = "Rule 1: call askUser\nRule 2: never stop";
			const result = buildFinalResponse(
				userResponse,
				true,
				multilineAppend,
				false,
			);
			expect(result).toBe(`${userResponse}\n\n${multilineAppend}`);
		});

		it("handles unicode and emoji in response and append text", () => {
			const emojiResponse = "Here's your answer 👍";
			const emojiAppend = "必ず askUser を呼んでください 🔄";
			const result = buildFinalResponse(
				emojiResponse,
				true,
				emojiAppend,
				false,
			);
			expect(result).toBe(`${emojiResponse}\n\n${emojiAppend}`);
		});

		it("handles unicode with alwaysAppendReminder (no effect when autoAppend OFF)", () => {
			const emojiResponse = "Réponse complète ✅";
			const result = buildFinalResponse(emojiResponse, false, "", true);
			// alwaysAppendReminder has no effect when autoAppend is OFF
			expect(result).toBe(emojiResponse);
		});

		it("handles response that already contains append text (no dedup)", () => {
			const responseWithAppend = `Done.\n\n${customText}`;
			const result = buildFinalResponse(
				responseWithAppend,
				true,
				customText,
				false,
			);
			// Should append again — no deduplication
			expect(result).toBe(`${responseWithAppend}\n\n${customText}`);
		});

		it("handles very long response string", () => {
			const longResponse = "x".repeat(10000);
			const result = buildFinalResponse(longResponse, true, customText, false);
			expect(result).toBe(`${longResponse}\n\n${customText}`);
			expect(result.length).toBe(10000 + 2 + customText.length);
		});

		it("handles tab and carriage return in response", () => {
			const tabbedResponse = "Step 1:\tDone\r\nStep 2:\tDone";
			const result = buildFinalResponse(
				tabbedResponse,
				true,
				customText,
				false,
			);
			expect(result).toBe(`${tabbedResponse}\n\n${customText}`);
		});
import { beforeEach, describe, expect, it, vi } from "vitest";

const registerToolMock = vi.fn();
const showErrorMessageMock = vi.fn();

class MockCancellationError extends Error {}
class MockLanguageModelToolResult {
	constructor(public readonly parts: unknown[]) {}
}
class MockLanguageModelTextPart {
	constructor(public readonly value: string) {}
}

const vscodeMock = {
	CancellationError: MockCancellationError,
	ConfigurationTarget: {
		Workspace: 2,
	},
	LanguageModelDataPart: {
		image: vi.fn(),
	},
	LanguageModelTextPart: MockLanguageModelTextPart,
	LanguageModelToolResult: MockLanguageModelToolResult,
	lm: {
		registerTool: registerToolMock,
	},
	window: {
		showErrorMessage: showErrorMessageMock,
	},
	workspace: {
		getConfiguration: () => ({
			get: (_key: string, fallback: unknown) => fallback,
		}),
	},
};

vi.mock("vscode", () => vscodeMock);

/**
 * Build a stable cancellation token stub for ask_user tests.
 */
function createToken() {
	return {
		isCancellationRequested: false,
		onCancellationRequested: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	};
}

/**
 * Reload the tools module cleanly so each test gets a fresh registerTool capture.
 */
beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	(
		globalThis as { __TASKSYNC_VSCODE_MOCK__?: unknown }
	).__TASKSYNC_VSCODE_MOCK__ = vscodeMock;
});

/**
 * Verify that cancelled ask_user results stop the LM turn instead of becoming fake replies.
 */
describe("askUser cancellation handling", () => {
	/**
	 * A cancelled provider result must propagate as a cancellation error.
	 */
	it("throws CancellationError when waitForUserResponse returns a cancelled result", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "[Session reset by user]",
				attachments: [],
				queue: false,
				cancelled: true,
			}),
		};

		await expect(
			askUser({ question: "Reset?" }, provider as any, createToken() as any),
		).rejects.toBeInstanceOf(MockCancellationError);
	});

	/**
	 * The registered LM tool must rethrow cancellation so Copilot stops the old turn cleanly.
	 */
	it("rethrows CancellationError from the registered tool invoke handler", async () => {
		const { registerTools } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "[Session reset by user]",
				attachments: [],
				queue: false,
				cancelled: true,
			}),
		};
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		await expect(
			toolDefinition.invoke(
				{ input: { question: "Reset?" } },
				createToken() as any,
			),
		).rejects.toBeInstanceOf(MockCancellationError);
		expect(showErrorMessageMock).not.toHaveBeenCalled();
	});
});
