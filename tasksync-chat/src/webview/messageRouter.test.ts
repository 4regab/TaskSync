import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { handleWebviewMessage } from "./messageRouter";

/**
 * Create the smallest provider stub needed to verify session-routing behavior.
 */
function createMockP(overrides: Partial<any> = {}) {
	return {
		startNewSession: vi.fn(),
		startNewSessionAndResetCopilotChat: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as any;
}

/**
 * Reset spies between tests so each route assertion starts clean.
 */
beforeEach(() => {
	vi.restoreAllMocks();
});

/**
 * Verify that webview session actions route to the correct provider methods.
 */
describe("handleWebviewMessage session actions", () => {
	/**
	 * Keep existing behavior: full new session still resets state and opens a fresh chat.
	 */
	it("routes newSession to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, { type: "newSession" });

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledTimes(1);
		expect(p.startNewSession).not.toHaveBeenCalled();
	});

	/**
	 * New reset-only action must clear session state without opening a fresh chat.
	 */
	it("routes resetSession to startNewSession without opening a fresh chat", () => {
		const p = createMockP();

		handleWebviewMessage(p, { type: "resetSession" });

		expect(p.startNewSession).toHaveBeenCalledTimes(1);
		expect(p.startNewSessionAndResetCopilotChat).not.toHaveBeenCalled();
	});
});
