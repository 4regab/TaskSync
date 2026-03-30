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

	it("targets the specified session when sessionId is provided", async () => {
		const { cancelPendingToolCall } = await import("./remoteApiHandlers");
		const targetSession = {
			id: "sess_2",
			pendingToolCallId: "tc_2",
			waitingOnUser: true,
			aiTurnActive: true,
			consecutiveAutoResponses: 0,
			queue: [],
		};
		const provider = createProvider({
			_getSession: vi.fn((id: string) =>
				id === "sess_2" ? targetSession : undefined,
			),
			_currentToolCallId: "tc_1",
			_pendingRequests: new Map([["tc_2", vi.fn()]]),
			_toolCallSessionMap: new Map([["tc_2", "sess_2"]]),
			_responseTimeoutTimers: new Map(),
			_currentSessionCallsMap: new Map([
				[
					"tc_2",
					{
						id: "tc_2",
						sessionId: "sess_2",
						prompt: "Q2",
						response: "",
						status: "pending",
						timestamp: 1,
						attachments: [],
					},
				],
			]),
		});
		const result = cancelPendingToolCall(
			provider,
			"[Cancelled by user]",
			"sess_2",
		);
		expect(result).toBe(true);
		expect(targetSession.pendingToolCallId).toBeNull();
		expect(targetSession.aiTurnActive).toBe(false);
		// Active session (tc_1) should NOT have been touched
		expect(provider._currentToolCallId).toBe("tc_1");
	});
});

describe("getRemoteSessionSummaries", () => {
	it("returns lightweight summaries with first history prompt", async () => {
		const { getRemoteSessionSummaries } = await import("./remoteApiHandlers");
		const provider = createProvider({
			_sessionManager: {
				getAllSessions: () => [
					{
						id: "s1",
						title: "Agent 1",
						status: "active",
						waitingOnUser: true,
						createdAt: 1000,
						history: [{ prompt: "first question" }, { prompt: "second" }],
					},
					{
						id: "s2",
						title: "Agent 2",
						status: "archived",
						waitingOnUser: false,
						createdAt: 2000,
						history: [],
					},
				],
				getActiveSessionId: () => "s1",
				getActiveSession: () => null,
			},
		});

		const summaries = getRemoteSessionSummaries(provider);

		expect(summaries).toHaveLength(2);
		expect(summaries[0]).toEqual({
			id: "s1",
			title: "Agent 1",
			status: "active",
			waitingOnUser: true,
			createdAt: 1000,
			history: [{ prompt: "first question" }],
		});
		expect(summaries[1]).toEqual({
			id: "s2",
			title: "Agent 2",
			status: "archived",
			waitingOnUser: false,
			createdAt: 2000,
			history: [],
		});
	});

	it("truncates long prompt previews to 200 chars", async () => {
		const { getRemoteSessionSummaries } = await import("./remoteApiHandlers");
		const longPrompt = "X".repeat(500);
		const provider = createProvider({
			_sessionManager: {
				getAllSessions: () => [
					{
						id: "s1",
						title: "T",
						status: "active",
						waitingOnUser: false,
						createdAt: 0,
						history: [{ prompt: longPrompt }],
					},
				],
				getActiveSessionId: () => "s1",
				getActiveSession: () => null,
			},
		});

		const summaries = getRemoteSessionSummaries(provider);
		expect(summaries[0].history[0].prompt).toHaveLength(200);
	});
});

describe("getRemoteState", () => {
	it("includes sessions and activeSessionId", async () => {
		const { getRemoteState } = await import("./remoteApiHandlers");
		const sessions = [
			{
				id: "s1",
				title: "Agent 1",
				status: "active" as const,
				waitingOnUser: false,
				createdAt: 100,
				history: [],
			},
		];
		const provider = createProvider({
			_currentToolCallId: null,
			_promptQueue: [],
			_queueVersion: 0,
			_currentSessionCalls: [],
			_sessionStartTime: null,
			_sessionFrozenElapsed: null,
			_aiTurnActive: false,
			_lastKnownModel: "gpt-4",
			_sessionManager: {
				getAllSessions: () => sessions,
				getActiveSession: () => sessions[0],
				getActiveSessionId: () => "s1",
			},
		});

		const state = getRemoteState(provider);

		expect(state.sessions).toHaveLength(1);
		expect(state.sessions[0].id).toBe("s1");
		expect(state.activeSessionId).toBe("s1");
	});
});
