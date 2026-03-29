import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";

const broadcastToolCallCompletedMock = vi.fn();
const sessionHasQueuedItemsMock = vi.fn(() => false);

vi.mock("./webviewUtils", () => ({
	broadcastToolCallCompleted: broadcastToolCallCompletedMock,
	debugLog: vi.fn(),
	generateId: vi.fn(),
	getFileIcon: vi.fn(),
	sessionHasQueuedItems: sessionHasQueuedItemsMock,
	notifyQueueChanged: vi.fn(),
}));

function createProvider(overrides: Partial<any> = {}) {
	const activeSession = {
		id: "1",
		pendingToolCallId: "tc_1",
		waitingOnUser: true,
		aiTurnActive: true,
	};
	const provider = {
		_currentToolCallId: "tc_1",
		_pendingRequests: new Map(),
		_toolCallSessionMap: new Map(),
		_responseTimeoutTimers: new Map([["tc_1", 123 as any]]),
		_currentSessionCallsMap: new Map([
			[
				"tc_1",
				{
					id: "tc_1",
					sessionId: "1",
					prompt: "Question",
					response: "",
					status: "pending",
					timestamp: 1,
					attachments: ["keep-me"],
				},
			],
		]),
		_aiTurnActive: true,
		_updateCurrentSessionUI: vi.fn(),
		_updateSessionsUI: vi.fn(),
		_syncActiveSessionState: vi.fn(() => {
			provider._currentToolCallId = activeSession.pendingToolCallId;
			provider._aiTurnActive = activeSession.aiTurnActive;
		}),
		_saveSessionsToDisk: vi.fn(),
		_clearResponseTimeoutTimer: vi.fn((toolCallId: string) => {
			const timer = provider._responseTimeoutTimers.get(toolCallId);
			if (timer) {
				clearTimeout(timer);
				provider._responseTimeoutTimers.delete(toolCallId);
			}
		}),
		_sessionManager: {
			getActiveSession: () => activeSession,
			getActiveSessionId: () => activeSession.id,
		},
		...overrides,
	} as any;
	return provider;
}

describe("cancelPendingToolCall", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("clears stale tool-call state even when the resolver is already missing", async () => {
		const { cancelPendingToolCall } = await import("./remoteApiHandlers");
		const clearTimeoutSpy = vi
			.spyOn(globalThis, "clearTimeout")
			.mockImplementation(() => undefined);
		const provider = createProvider();

		const result = cancelPendingToolCall(provider, "[Session reset by user]");

		expect(result).toBe(true);
		expect(provider._currentToolCallId).toBeNull();
		expect(provider._aiTurnActive).toBe(false);
		expect(provider._responseTimeoutTimers.size).toBe(0);
		expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
		expect(provider._syncActiveSessionState).toHaveBeenCalledTimes(1);
		expect(provider._currentSessionCallsMap.get("tc_1")).toMatchObject({
			response: "[Session reset by user]",
			status: "cancelled",
			attachments: [],
		});
		expect(broadcastToolCallCompletedMock).toHaveBeenCalledTimes(1);
	});
});
