import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import * as vscode from "../__mocks__/vscode";
import { ChatSessionManager } from "./chatSessionManager";
import * as settingsH from "./settingsHandlers";

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
		_saveSessionsToDisk: vi.fn(),
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

describe("TaskSyncWebviewProvider single-session helpers", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		loadSessionsFromDiskAsyncMock.mockReset();
	});

	it("reuses the active singleton for missing session ids when orchestration is off", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
			},
		);

		const resolvedSession = provider.createSessionForMissingId();

		expect(resolvedSession.id).toBe(activeSession.id);
		expect(manager.size).toBe(1);
	});

	it("binds arbitrary incoming ids to the singleton session when orchestration is off", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
			},
		);

		const resolvedSession = provider._bindSession("99");

		expect(resolvedSession.id).toBe(activeSession.id);
		expect(manager.size).toBe(1);
	});

	it("prefers the waiting session when collapsing into a singleton", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");
		const waitingSession = manager.createSession("Agent 2");
		waitingSession.waitingOnUser = true;
		waitingSession.pendingToolCallId = "tc_waiting";
		manager.setActiveSession(activeSession.id);

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
			},
		);

		const resolvedSession = provider._getSingleSession();

		expect(resolvedSession.id).toBe(waitingSession.id);
		expect(manager.getActiveSessionId()).toBe(waitingSession.id);
		expect(provider._updateSessionsUI).toHaveBeenCalledTimes(1);
	});

	it("creates a fresh singleton when the only active session is terminated", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const terminatedSession = manager.createSession("Agent 1");
		terminatedSession.sessionTerminated = true;

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
			},
		);

		const resolvedSession = provider._getSingleSession();

		expect(resolvedSession.id).not.toBe(terminatedSession.id);
		expect(resolvedSession.sessionTerminated).toBe(false);
		expect(manager.size).toBe(2);
	});

	it("reloads settings when agentOrchestration changes through VS Code config", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_isUpdatingConfig: false,
			},
		);
		const broadcastSpy = vi
			.spyOn(settingsH, "broadcastAllSettingsToRemote")
			.mockImplementation(() => {});
		const sessionSettingsSpy = vi
			.spyOn(settingsH, "sendSessionSettingsToWebview")
			.mockImplementation(() => {});

		provider._handleConfigurationChange({
			affectsConfiguration: (key: string) =>
				key === "tasksync.agentOrchestration",
		} as any);

		expect(provider._loadSettings).toHaveBeenCalledTimes(1);
		expect(provider._updateSettingsUI).toHaveBeenCalledTimes(1);
		expect(sessionSettingsSpy).toHaveBeenCalledWith(provider);
		expect(broadcastSpy).toHaveBeenCalledWith(provider);
	});

	it("reverts an external disable when multiple sessions are already waiting", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const firstWaitingSession = manager.createSession("Agent 1");
		firstWaitingSession.waitingOnUser = true;
		firstWaitingSession.pendingToolCallId = "tc_1";
		const secondWaitingSession = manager.createSession("Agent 2");
		secondWaitingSession.waitingOnUser = true;
		secondWaitingSession.pendingToolCallId = "tc_2";
		manager.setActiveSession(firstWaitingSession.id);

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_isUpdatingConfig: false,
				_agentOrchestrationEnabled: true,
			},
		);
		provider._loadSettings = vi.fn(() => {
			provider._agentOrchestrationEnabled = false;
		});
		const warningSpy = vi
			.spyOn(vscode.window, "showWarningMessage")
			.mockResolvedValue(undefined as any);
		const revertSpy = vi
			.spyOn(settingsH, "handleUpdateAgentOrchestrationSetting")
			.mockResolvedValue(undefined);

		provider._handleConfigurationChange({
			affectsConfiguration: (key: string) =>
				key === "tasksync.agentOrchestration",
		} as any);

		expect(warningSpy).toHaveBeenCalledWith(
			settingsH.AGENT_ORCHESTRATION_MULTI_WAITING_WARNING,
		);
		expect(revertSpy).toHaveBeenCalledWith(provider, true);
	});
});
