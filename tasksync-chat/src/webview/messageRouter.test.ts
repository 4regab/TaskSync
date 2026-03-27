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
	it("routes newSession to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, { type: "newSession" });

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledTimes(1);
		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith(
			undefined,
			undefined,
		);
		expect(p.startNewSession).not.toHaveBeenCalled();
	});

	it("passes initialPrompt to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			initialPrompt: "Build the login page",
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith(
			"Build the login page",
			undefined,
		);
	});

	it("passes useQueuedPrompt to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			useQueuedPrompt: true,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith(
			undefined,
			true,
		);
	});

	it("passes both initialPrompt and useQueuedPrompt", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			initialPrompt: "Fix tests",
			useQueuedPrompt: true,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith(
			"Fix tests",
			true,
		);
	});

	it("routes resetSession to startNewSession without opening a fresh chat", () => {
		const p = createMockP();

		handleWebviewMessage(p, { type: "resetSession" });

		expect(p.startNewSession).toHaveBeenCalledTimes(1);
		expect(p.startNewSessionAndResetCopilotChat).not.toHaveBeenCalled();
	});
});
