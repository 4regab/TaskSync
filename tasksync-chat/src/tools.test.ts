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
