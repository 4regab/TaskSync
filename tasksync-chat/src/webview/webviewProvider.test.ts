import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import * as vscode from "../__mocks__/vscode";
import { CONFIG_SECTION } from "../constants/remoteConstants";
import * as chatSessionUtils from "../utils/chatSessionUtils";
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
		_attachments: [],
		_pendingRequests: new Map(),
		_queueEnabled: true,
		_currentToolCallId: null,
		_soundEnabled: true,
		_interactiveApprovalEnabled: true,
		_agentOrchestrationEnabled: true,
		_autoAppendEnabled: false,
		_autoAppendText: "",
		_alwaysAppendReminder: false,
		_autopilotEnabled: false,
		_autopilotText: "Continue",
		_autopilotPrompts: [],
		_reusablePrompts: [],
		_humanLikeDelayEnabled: true,
		_humanLikeDelayMin: 1,
		_humanLikeDelayMax: 5,
		_sessionWarningHours: 2,
		_sendWithCtrlEnter: false,
		_AUTOPILOT_DEFAULT_TEXT: "Continue",
		_sessionStartTime: null,
		_sessionFrozenElapsed: null,
		_sessionTerminated: false,
		_sessionWarningShown: false,
		_aiTurnActive: false,
		_consecutiveAutoResponses: 0,
		_autopilotIndex: 0,
		_view: {
			show: vi.fn(),
			webview: {
				postMessage: vi.fn(),
			},
		},
		_remoteServer: null,
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
		_responseTimeoutTimers: new Map(),
	};
}

/**
 * Keep config-driven tests on the same mock shape used across the suite.
 */
function createMockConfig(values: Record<string, unknown> = {}) {
	return {
		get: vi.fn((key: string, defaultValue?: unknown) =>
			Object.prototype.hasOwnProperty.call(values, key)
				? values[key]
				: defaultValue,
		),
		update: vi.fn().mockResolvedValue(undefined),
		inspect: vi.fn(() => undefined),
	};
}

/**
 * Route the test through the real settings helpers so config-refresh side effects are observable.
 */
function enableRealSettingsRefreshFlow(
	provider: ReturnType<typeof createProviderHarness>,
	TaskSyncWebviewProvider: typeof import("./webviewProvider").TaskSyncWebviewProvider,
) {
	Object.assign(provider, {
		_loadSettings:
			TaskSyncWebviewProvider.prototype._loadSettings.bind(provider),
		_updateSettingsUI:
			TaskSyncWebviewProvider.prototype._updateSettingsUI.bind(provider),
	});
}

/**
 * Inspect only the posted messages relevant to the behavior under test.
 */
function getPostedMessages(
	provider: ReturnType<typeof createProviderHarness>,
	type: string,
) {
	return provider._view.webview.postMessage.mock.calls
		.map((call) => call[0])
		.filter((message) => message?.type === type);
}

/**
 * Assert the latest remote chat bootstrap call without repeating the same
 * shape checks in each single-session fresh-chat regression.
 */
function expectLatestStartNewSessionChatCall(
	spy: { mock: { calls: unknown[][] } },
	expectedSessionId: string,
) {
	const latestCall = spy.mock.calls.at(-1);
	expect(latestCall).toBeDefined();
	if (!latestCall) {
		throw new Error("expected startNewSessionChat to be called");
	}
	expect(latestCall[0]).toBe(expectedSessionId);
	for (const argument of latestCall.slice(1)) {
		expect(argument).toEqual(expect.any(String));
	}
}

/**
 * Build a minimal configuration-change event with only the VS Code surface this provider uses.
 */
function createConfigurationChangeEvent(affectedKeys: string[]) {
	return {
		affectsConfiguration: (key: string) => affectedKeys.includes(key),
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

describe("TaskSyncWebviewProvider modal commands", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("focuses the webview before opening settings from the title bar", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
		);

		provider.openSettingsModal();

		expect(provider._view.show).toHaveBeenCalledWith(false);
		expect(provider._view.webview.postMessage).toHaveBeenCalledWith({
			type: "openSettingsModal",
		});
	});

	it("focuses the webview before opening a new session dialog from the title bar", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
		);

		const opened = provider.openNewSessionModal();

		expect(opened).toBe(true);
		expect(provider._view.show).toHaveBeenCalledWith(false);
		expect(provider._view.webview.postMessage).toHaveBeenCalledWith({
			type: "openNewSessionModal",
		});
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
		const broadcast = vi.fn();
		const remoteState = { activeSessionId: waitingSession.id, sessions: [] };

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
				_remoteServer: { broadcast },
				getRemoteState: vi.fn(() => remoteState),
			},
		);

		const resolvedSession = provider._getSingleSession();

		expect(resolvedSession.id).toBe(waitingSession.id);
		expect(manager.getActiveSessionId()).toBe(waitingSession.id);
		expect(provider._updateSessionsUI).toHaveBeenCalledTimes(1);
		expect(provider.getRemoteState).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith("state", remoteState);
	});

	it("creates a fresh singleton when the only active session is terminated", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const manager = new ChatSessionManager();
		const terminatedSession = manager.createSession("Agent 1");
		terminatedSession.sessionTerminated = true;
		const broadcast = vi.fn();
		const remoteState = { activeSessionId: "next", sessions: [] };

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
				_remoteServer: { broadcast },
				getRemoteState: vi.fn(() => remoteState),
			},
		);

		const resolvedSession = provider._getSingleSession();

		expect(resolvedSession.id).not.toBe(terminatedSession.id);
		expect(resolvedSession.sessionTerminated).toBe(false);
		expect(manager.size).toBe(2);
		expect(provider.getRemoteState).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith("state", remoteState);
	});

	it("rejects an external disable without singleton collapse side effects", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const config = createMockConfig({
			agentOrchestration: false,
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");
		const firstWaitingSession = manager.createSession("Agent 2");
		firstWaitingSession.waitingOnUser = true;
		firstWaitingSession.pendingToolCallId = "tc_1";
		const secondWaitingSession = manager.createSession("Agent 3");
		secondWaitingSession.waitingOnUser = true;
		secondWaitingSession.pendingToolCallId = "tc_2";
		manager.setActiveSession(activeSession.id);
		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_isUpdatingConfig: false,
			},
		);
		enableRealSettingsRefreshFlow(provider, TaskSyncWebviewProvider);
		const warningSpy = vi
			.spyOn(vscode.window, "showWarningMessage")
			.mockImplementation(async () => undefined);
		const revertSpy = vi
			.spyOn(settingsH, "handleUpdateAgentOrchestrationSetting")
			.mockResolvedValue(undefined);

		provider._handleConfigurationChange(
			createConfigurationChangeEvent([`${CONFIG_SECTION}.agentOrchestration`]),
		);

		expect(warningSpy).toHaveBeenCalledWith(
			settingsH.AGENT_ORCHESTRATION_MULTI_WAITING_WARNING,
		);
		expect(revertSpy).toHaveBeenCalledWith(provider, true);
		expect(manager.getActiveSessionId()).toBe(activeSession.id);
		expect(getPostedMessages(provider, "updateSettings")).toHaveLength(0);
		expect(provider._updateSessionsUI).not.toHaveBeenCalled();
		expect(provider._saveSessionsToDisk).not.toHaveBeenCalled();
	});

	it("reloads another setting from the same rejected config event", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const config = createMockConfig({
			agentOrchestration: false,
			notificationSound: false,
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const manager = new ChatSessionManager();
		const activeSession = manager.createSession("Agent 1");
		const firstWaitingSession = manager.createSession("Agent 1");
		firstWaitingSession.waitingOnUser = true;
		firstWaitingSession.pendingToolCallId = "tc_1";
		const secondWaitingSession = manager.createSession("Agent 2");
		secondWaitingSession.waitingOnUser = true;
		secondWaitingSession.pendingToolCallId = "tc_2";
		manager.setActiveSession(activeSession.id);

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_isUpdatingConfig: false,
			},
		);
		enableRealSettingsRefreshFlow(provider, TaskSyncWebviewProvider);
		const warningSpy = vi
			.spyOn(vscode.window, "showWarningMessage")
			.mockImplementation(async () => undefined);
		const revertSpy = vi.spyOn(
			settingsH,
			"handleUpdateAgentOrchestrationSetting",
		);

		provider._handleConfigurationChange(
			createConfigurationChangeEvent([
				`${CONFIG_SECTION}.agentOrchestration`,
				`${CONFIG_SECTION}.notificationSound`,
			]),
		);

		expect(warningSpy).toHaveBeenCalledWith(
			settingsH.AGENT_ORCHESTRATION_MULTI_WAITING_WARNING,
		);
		expect(provider._soundEnabled).toBe(false);
		expect(revertSpy).toHaveBeenCalledWith(provider, true);
		await revertSpy.mock.results[0]?.value;

		expect(getPostedMessages(provider, "updateSettings").at(-1)).toEqual(
			expect.objectContaining({
				type: "updateSettings",
				soundEnabled: false,
				agentOrchestrationEnabled: true,
			}),
		);
	});

	it("still collapses to the preferred waiting session when external disable is allowed", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const config = createMockConfig({
			agentOrchestration: false,
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
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
				_isUpdatingConfig: false,
			},
		);
		enableRealSettingsRefreshFlow(provider, TaskSyncWebviewProvider);
		const warningSpy = vi
			.spyOn(vscode.window, "showWarningMessage")
			.mockImplementation(async () => undefined);
		const revertSpy = vi.spyOn(
			settingsH,
			"handleUpdateAgentOrchestrationSetting",
		);

		provider._handleConfigurationChange(
			createConfigurationChangeEvent([`${CONFIG_SECTION}.agentOrchestration`]),
		);

		expect(warningSpy).not.toHaveBeenCalled();
		expect(revertSpy).not.toHaveBeenCalled();
		expect(manager.getActiveSessionId()).toBe(waitingSession.id);
		expect(provider._updateSessionsUI).toHaveBeenCalledTimes(1);
		expect(provider._saveSessionsToDisk).toHaveBeenCalledTimes(1);
	});

	it("starts plain single-session New Session with a fresh TaskSync session id", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const config = createMockConfig({
			agentOrchestration: false,
			tremoteChatCommand: "chat.command",
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const startNewSessionChatSpy = vi
			.spyOn(chatSessionUtils, "startNewSessionChat")
			.mockResolvedValue(undefined);
		const manager = new ChatSessionManager();
		const previousSession = manager.createSession("Agent 1");
		previousSession.waitingOnUser = true;
		previousSession.unread = true;
		previousSession.pendingToolCallId = "tc-old";
		const pendingEntry = {
			id: "tc-old",
			sessionId: previousSession.id,
			prompt: "Old question?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending" as const,
		};
		previousSession.history.unshift(pendingEntry);
		const resolver = vi.fn();

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
				_pendingRequests: new Map([["tc-old", resolver]]),
				_toolCallSessionMap: new Map([["tc-old", previousSession.id]]),
				_currentSessionCallsMap: new Map([["tc-old", pendingEntry]]),
				_remoteServer: { broadcast: vi.fn() },
			},
		);

		await provider.startNewSessionAndResetCopilotChat();

		const newActiveSessionId = manager.getActiveSessionId();
		expect(newActiveSessionId).toBeDefined();
		if (!newActiveSessionId) {
			throw new Error("expected a fresh single-session id to be created");
		}
		expect(newActiveSessionId).not.toBe(previousSession.id);
		expect(previousSession.sessionTerminated).toBe(false);
		expect(previousSession.pendingToolCallId).toBeNull();
		expect(previousSession.waitingOnUser).toBe(false);
		expect(previousSession.unread).toBe(false);
		expect(previousSession.history[0]).toMatchObject({
			status: "cancelled",
			response: "[Session reset by user]",
		});
		expect(resolver).toHaveBeenCalledWith(
			expect.objectContaining({
				value: "[Session reset by user]",
				cancelled: true,
			}),
		);
		expect(provider._getSingleSession().id).toBe(newActiveSessionId);
		expectLatestStartNewSessionChatCall(
			startNewSessionChatSpy,
			newActiveSessionId,
		);
	});

	it("starts stopCurrentSession in single-session mode with a fresh TaskSync session id", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const config = createMockConfig({
			agentOrchestration: false,
			tremoteChatCommand: "chat.command",
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const startNewSessionChatSpy = vi
			.spyOn(chatSessionUtils, "startNewSessionChat")
			.mockResolvedValue(undefined);
		const manager = new ChatSessionManager();
		const previousSession = manager.createSession("Agent 1");
		previousSession.waitingOnUser = true;
		previousSession.unread = true;
		previousSession.pendingToolCallId = "tc-stop";
		previousSession.sessionStartTime = Date.now() - 1000;
		const pendingEntry = {
			id: "tc-stop",
			sessionId: previousSession.id,
			prompt: "Stop question?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending" as const,
		};
		previousSession.history.unshift(pendingEntry);
		const resolver = vi.fn();

		const provider = Object.assign(
			Object.create(TaskSyncWebviewProvider.prototype),
			createProviderHarness(manager),
			{
				_agentOrchestrationEnabled: false,
				_pendingRequests: new Map([["tc-stop", resolver]]),
				_toolCallSessionMap: new Map([["tc-stop", previousSession.id]]),
				_currentSessionCallsMap: new Map([["tc-stop", pendingEntry]]),
				_remoteServer: { broadcast: vi.fn() },
			},
		);

		await provider.startNewSessionAndResetCopilotChat({
			stopCurrentSession: true,
		});

		const newActiveSessionId = manager.getActiveSessionId();
		expect(newActiveSessionId).toBeDefined();
		if (!newActiveSessionId) {
			throw new Error("expected a fresh single-session id to be created");
		}
		expect(newActiveSessionId).not.toBe(previousSession.id);
		expect(previousSession.sessionTerminated).toBe(true);
		expect(previousSession.pendingToolCallId).toBeNull();
		expect(previousSession.waitingOnUser).toBe(false);
		expect(previousSession.history[0]).toMatchObject({
			status: "cancelled",
			response: "[Session stopped by user]",
		});
		expect(resolver).toHaveBeenCalledWith(
			expect.objectContaining({
				value: "[Session stopped by user]",
				cancelled: true,
			}),
		);
		expect(previousSession.sessionFrozenElapsed).not.toBeNull();
		expect(provider._getSingleSession().id).toBe(newActiveSessionId);
		expectLatestStartNewSessionChatCall(
			startNewSessionChatSpy,
			newActiveSessionId,
		);
	});
});
