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
	const currentSessionCalls = overrides._currentSessionCalls
		? [...(overrides._currentSessionCalls as any[])]
		: ([] as any[]);
	const attachments = overrides._attachments
		? [...(overrides._attachments as any[])]
		: ([] as any[]);
	const activeSession = {
		id: "1",
		history: currentSessionCalls,
		queue: [],
		queueEnabled: true,
		attachments,
		pendingToolCallId: overrides._currentToolCallId ?? null,
		waitingOnUser: Boolean(overrides._currentToolCallId),
		sessionStartTime: overrides._sessionStartTime ?? 123,
		sessionFrozenElapsed: overrides._sessionFrozenElapsed ?? 456,
		sessionTerminated: overrides._sessionTerminated ?? false,
		sessionWarningShown: overrides._sessionWarningShown ?? true,
		aiTurnActive: overrides._aiTurnActive ?? false,
		consecutiveAutoResponses: overrides._consecutiveAutoResponses ?? 2,
		autopilotIndex: overrides._autopilotIndex ?? 3,
	};
	const provider = {
		_responseTimeoutTimers: new Map<string, any>(),
		_currentToolCallId: activeSession.pendingToolCallId,
		_currentSessionCalls: currentSessionCalls,
		_attachments: attachments,
		_aiTurnActive: activeSession.aiTurnActive,
		_sessionTerminated: activeSession.sessionTerminated,
		_pendingRequests: new Map(),
		_toolCallSessionMap: new Map(),
		_consecutiveAutoResponses: activeSession.consecutiveAutoResponses,
		_autopilotIndex: activeSession.autopilotIndex,
		cancelPendingToolCall: vi.fn().mockReturnValue(false),
		saveCurrentSessionToHistory: vi.fn(),
		_currentSessionCallsMap: new Map(),
		_sessionStartTime: activeSession.sessionStartTime,
		_sessionFrozenElapsed: activeSession.sessionFrozenElapsed,
		_stopSessionTimerInterval: vi.fn(),
		_sessionWarningShown: activeSession.sessionWarningShown,
		_updateViewTitle: vi.fn(() => {
			if (
				provider._sessionStartTime === null &&
				provider._sessionFrozenElapsed === null
			) {
				provider._view.badge = undefined;
			}
		}),
		_updateCurrentSessionUI: vi.fn(),
		_updateQueueUI: vi.fn(),
		_updateAttachmentsUI: vi.fn(),
		_updateSettingsUI: vi.fn(),
		_updatePersistedHistoryUI: vi.fn(),
		_updateSessionsUI: vi.fn(),
		_saveSessionsToDisk: vi.fn(),
		_clearResponseTimeoutTimer: vi.fn(),
		_syncActiveSessionState: vi.fn(() => {
			provider._currentToolCallId = activeSession.pendingToolCallId;
			provider._currentSessionCalls = activeSession.history;
			provider._attachments = activeSession.attachments;
			provider._sessionStartTime = activeSession.sessionStartTime;
			provider._sessionFrozenElapsed = activeSession.sessionFrozenElapsed;
			provider._sessionTerminated = activeSession.sessionTerminated;
			provider._sessionWarningShown = activeSession.sessionWarningShown;
			provider._aiTurnActive = activeSession.aiTurnActive;
			provider._consecutiveAutoResponses =
				activeSession.consecutiveAutoResponses;
			provider._autopilotIndex = activeSession.autopilotIndex;
			provider._stopSessionTimerInterval();
			provider._updateViewTitle();
			provider._updateCurrentSessionUI();
			provider._updateQueueUI();
			provider._updateAttachmentsUI();
			provider._updateSettingsUI();
		}),
		_view: {
			badge: { value: 2, tooltip: "Session timer and tool call count" },
			webview: { postMessage },
		},
		_remoteServer: { broadcast },
		_sessionManager: {
			getActiveSession: () => activeSession,
		},
		...overrides,
	} as any;
	provider._currentSessionCalls = currentSessionCalls;
	provider._currentToolCallId = activeSession.pendingToolCallId;
	provider._sessionStartTime = activeSession.sessionStartTime;
	provider._sessionFrozenElapsed = activeSession.sessionFrozenElapsed;
	provider._sessionTerminated = activeSession.sessionTerminated;
	provider._sessionWarningShown = activeSession.sessionWarningShown;
	provider._aiTurnActive = activeSession.aiTurnActive;
	provider._consecutiveAutoResponses = activeSession.consecutiveAutoResponses;
	provider._autopilotIndex = activeSession.autopilotIndex;
	return provider;
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
