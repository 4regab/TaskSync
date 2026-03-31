import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { ChatSessionManager } from "./chatSessionManager";

const loadSessionsFromDiskAsyncMock = vi.fn();

vi.mock("./persistence", () => ({
	loadSessionsFromDiskAsync: loadSessionsFromDiskAsyncMock,
}));

/**
 * Create a provider-shaped object without running the real constructor.
 * This keeps the tests focused on shared unread state behavior.
 */
function createProviderHarness(manager: ChatSessionManager) {
	return {
		_sessionManager: manager,
		_currentSessionCallsMap: new Map(),
		_currentSessionCalls: [],
		_promptQueue: [],
		attachments: [],
		_pendingRequests: new Map(),
		_queueEnabled: true,
		_currentToolCallId: null,
		_autopilotEnabled: false,
		_sessionStartTime: null,
		_sessionFrozenElapsed: null,
		_sessionTerminated: false,
		_sessionWarningShown: false,
		_aiTurnActive: false,
		_consecutiveAutoResponses: 0,
		_autopilotIndex: 0,
		_updateViewTitle: vi.fn(),
		_updateCurrentSessionUI: vi.fn(),
		_updateQueueUI: vi.fn(),
		_updateAttachmentsUI: vi.fn(),
		_loadSettings: vi.fn(),
		_updateSettingsUI: vi.fn(),
		_startSessionTimerInterval: vi.fn(),
		_stopSessionTimerInterval: vi.fn(),
		_updateSessionsUI: vi.fn(),
	};
}

describe("TaskSyncWebviewProvider unread shared state", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		loadSessionsFromDiskAsyncMock.mockReset();
	});

	it("clears unread when syncing an open active session", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");
		activeSession.unread = true;

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
		);

		provider._syncActiveSessionState();

		expect(activeSession.unread).toBe(false);
	});

	it("clears unread during stale persisted rehydrate cleanup", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		loadSessionsFromDiskAsyncMock.mockImplementation(
			async (p: { _sessionManager: ChatSessionManager }) => {
				p._sessionManager.fromJSON({
					activeSessionId: "1",
					sessions: [
						{
							id: "1",
							title: "Agent 1",
							status: "active",
							queue: [],
							queueEnabled: true,
							history: [
								{
									id: "tc-stale",
									sessionId: "1",
									prompt: "Stale question?",
									response: "",
									timestamp: 1,
									isFromQueue: false,
									status: "pending",
								},
							],
							attachments: [],
							autopilotEnabled: false,
							waitingOnUser: true,
							unread: true,
							createdAt: Date.now(),
							pendingToolCallId: "tc-stale",
							sessionStartTime: null,
							sessionFrozenElapsed: null,
							sessionTerminated: false,
							sessionWarningShown: false,
							aiTurnActive: true,
							consecutiveAutoResponses: 0,
							autopilotIndex: 0,
						},
					],
				});
			},
		);

		const manager = new ChatSessionManager();
		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
		);

		await provider._loadSessionsFromDiskAsync();

		const session = manager.getSession("1");
		expect(session).toBeDefined();
		if (!session) {
			throw new Error("expected session 1 to exist after stale cleanup");
		}
		expect(session.pendingToolCallId).toBeNull();
		expect(session.waitingOnUser).toBe(false);
		expect(session.aiTurnActive).toBe(false);
		expect(session.unread).toBe(false);
		expect(session.history[0]).toMatchObject({
			status: "completed",
		});
		expect(provider._updateSessionsUI).toHaveBeenCalledTimes(1);
	});

	it("preserves a live in-flight pending request during async rehydrate", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		loadSessionsFromDiskAsyncMock.mockImplementation(
			async (p: { _sessionManager: ChatSessionManager }) => {
				p._sessionManager.fromJSON({
					activeSessionId: "1",
					sessions: [
						{
							id: "1",
							title: "Agent 1",
							status: "active",
							queue: [],
							queueEnabled: true,
							history: [
								{
									id: "tc-stale-disk",
									sessionId: "1",
									prompt: "Stale disk question?",
									response: "",
									timestamp: 1,
									isFromQueue: false,
									status: "pending",
								},
							],
							attachments: [],
							autopilotEnabled: false,
							waitingOnUser: true,
							unread: true,
							createdAt: Date.now(),
							pendingToolCallId: "tc-stale-disk",
							sessionStartTime: null,
							sessionFrozenElapsed: null,
							sessionTerminated: false,
							sessionWarningShown: false,
							aiTurnActive: true,
							consecutiveAutoResponses: 0,
							autopilotIndex: 0,
						},
					],
				});
			},
		);

		const manager = new ChatSessionManager();
		const liveSession = manager.createSession("Agent 1");
		liveSession.pendingToolCallId = "tc-live";
		liveSession.waitingOnUser = true;
		liveSession.aiTurnActive = true;
		liveSession.history.unshift({
			id: "tc-live",
			sessionId: liveSession.id,
			prompt: "Live question?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending",
		});

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_pendingRequests: new Map([["tc-live", vi.fn()]]),
			},
		);

		await provider._loadSessionsFromDiskAsync();

		const session = manager.getSession("1");
		expect(session).toBeDefined();
		if (!session) {
			throw new Error("expected session 1 to exist after rehydrate");
		}
		expect(session.pendingToolCallId).toBe("tc-live");
		expect(session.waitingOnUser).toBe(true);
		expect(session.aiTurnActive).toBe(true);
		expect(session.history[0]).toMatchObject({
			id: "tc-live",
			status: "pending",
		});
		expect(provider._updateSessionsUI).toHaveBeenCalledTimes(1);
	});
});
