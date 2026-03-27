import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { startNewSession } from "./lifecycleHandlers";

vi.mock("./fileHandlers", () => ({
	cleanupTempImagesFromEntries: vi.fn(),
}));

/**
 * Build a focused provider stub for lifecycle reset tests.
 */
function createMockP(overrides: Partial<any> = {}) {
	const postMessage = vi.fn();
	const broadcast = vi.fn();
	return {
		_responseTimeoutTimer: null,
		_currentToolCallId: null,
		_currentSessionCalls: [],
		_aiTurnActive: false,
		_sessionTerminated: false,
		_pendingRequests: new Map(),
		_consecutiveAutoResponses: 2,
		_autopilotIndex: 3,
		cancelPendingToolCall: vi.fn().mockReturnValue(false),
		saveCurrentSessionToHistory: vi.fn(),
		_currentSessionCallsMap: new Map(),
		_sessionStartTime: 123,
		_sessionFrozenElapsed: 456,
		_stopSessionTimerInterval: vi.fn(),
		_sessionWarningShown: true,
		_updateViewTitle: vi.fn(),
		_updateCurrentSessionUI: vi.fn(),
		_updatePersistedHistoryUI: vi.fn(),
		_view: {
			badge: { value: 2, tooltip: "Session timer and tool call count" },
			webview: { postMessage },
		},
		_remoteServer: { broadcast },
		...overrides,
	} as any;
}

/**
 * Restore mock state between tests so lifecycle assertions stay isolated.
 */
beforeEach(() => {
	vi.restoreAllMocks();
});

/**
 * Verify the clear payload used by reset-only and full new-session flows.
 */
describe("startNewSession clear payload", () => {
	/**
	 * Plain reset must cancel pending ask_user work and clear all visible session state.
	 */
	it("cancels pending work, clears state, and broadcasts resetSession", () => {
		const p = createMockP({
			_currentToolCallId: "tc_1",
			_currentSessionCalls: [
				{
					id: "tc_1",
					prompt: "Question",
					response: "",
					timestamp: 1,
					isFromQueue: false,
					status: "pending",
				},
			],
			_currentSessionCallsMap: new Map([
				[
					"tc_1",
					{
						id: "tc_1",
						prompt: "Question",
						response: "",
						timestamp: 1,
						isFromQueue: false,
						status: "pending",
					},
				],
			]),
			_aiTurnActive: true,
			_sessionTerminated: true,
		});

		startNewSession(p);

		expect(p.cancelPendingToolCall).toHaveBeenCalledWith(
			"[Session reset by user]",
		);
		expect(p._currentSessionCalls).toEqual([]);
		expect(p._currentSessionCallsMap.size).toBe(0);
		expect(p._sessionStartTime).toBeNull();
		expect(p._sessionFrozenElapsed).toBeNull();
		expect(p._sessionTerminated).toBe(false);
		expect(p._sessionWarningShown).toBe(false);
		expect(p._aiTurnActive).toBe(false);
		expect(p._consecutiveAutoResponses).toBe(0);
		expect(p._autopilotIndex).toBe(0);
		expect(p._view.badge).toBeUndefined();
		expect(p._view.webview.postMessage).toHaveBeenCalledWith({ type: "clear" });
		expect(p._remoteServer.broadcast).toHaveBeenCalledWith("resetSession", {});
	});

	/**
	 * Full new-session flow should keep the existing remote event and follow-up status.
	 */
	it("includes a status message when the caller requests one", () => {
		const p = createMockP();

		startNewSession(p, {
			remoteEventType: "newSession",
			statusMessage: "New session started — waiting for AI",
		});

		expect(p._view.webview.postMessage).toHaveBeenCalledWith({
			type: "clear",
			statusMessage: "New session started — waiting for AI",
		});
		expect(p._remoteServer.broadcast).toHaveBeenCalledWith("newSession", {
			statusMessage: "New session started — waiting for AI",
		});
	});
});
