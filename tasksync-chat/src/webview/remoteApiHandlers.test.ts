import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";

const broadcastToolCallCompletedMock = vi.fn();
const hasQueuedItemsMock = vi.fn(() => false);

vi.mock("./webviewUtils", () => ({
	broadcastToolCallCompleted: broadcastToolCallCompletedMock,
	debugLog: vi.fn(),
	generateId: vi.fn(),
	getFileIcon: vi.fn(),
	hasQueuedItems: hasQueuedItemsMock,
	notifyQueueChanged: vi.fn(),
}));

function createProvider(overrides: Partial<any> = {}) {
	return {
		_currentToolCallId: "tc_1",
		_pendingRequests: new Map(),
		_responseTimeoutTimer: 123 as any,
		_currentSessionCallsMap: new Map([
			[
				"tc_1",
				{
					id: "tc_1",
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
		...overrides,
	} as any;
}

describe("cancelPendingToolCall", () => {
	beforeEach(() => {
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
		expect(provider._responseTimeoutTimer).toBeNull();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
		expect(provider._updateCurrentSessionUI).toHaveBeenCalledTimes(1);
		expect(provider._currentSessionCallsMap.get("tc_1")).toMatchObject({
			response: "[Session reset by user]",
			status: "cancelled",
			attachments: [],
		});
		expect(broadcastToolCallCompletedMock).toHaveBeenCalledTimes(1);
	});
});
