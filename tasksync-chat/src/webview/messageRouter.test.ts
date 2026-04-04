import { beforeEach, describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { ChatSessionManager } from "./chatSessionManager";
import {
	handleSubmit,
	handleWebviewMessage,
	handleWebviewReady,
} from "./messageRouter";
import * as settingsH from "./settingsHandlers";

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
		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: undefined,
			useQueuedPrompt: undefined,
			stopCurrentSession: undefined,
		});
		expect(p.startNewSession).not.toHaveBeenCalled();
	});

	it("passes initialPrompt to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			initialPrompt: "Build the login page",
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: "Build the login page",
			useQueuedPrompt: undefined,
			stopCurrentSession: undefined,
		});
	});

	it("passes useQueuedPrompt true to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			useQueuedPrompt: true,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: undefined,
			useQueuedPrompt: true,
			stopCurrentSession: undefined,
		});
	});

	it("passes useQueuedPrompt false to opt out of dequeuing", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			useQueuedPrompt: false,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: undefined,
			useQueuedPrompt: false,
			stopCurrentSession: undefined,
		});
	});

	it("passes both initialPrompt and useQueuedPrompt", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			initialPrompt: "Fix tests",
			useQueuedPrompt: true,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: "Fix tests",
			useQueuedPrompt: true,
			stopCurrentSession: undefined,
		});
	});

	it("passes stopCurrentSession to startNewSessionAndResetCopilotChat", () => {
		const p = createMockP();

		handleWebviewMessage(p, {
			type: "newSession",
			stopCurrentSession: true,
		});

		expect(p.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: undefined,
			useQueuedPrompt: undefined,
			stopCurrentSession: true,
		});
	});

	it("routes resetSession to startNewSession without opening a fresh chat", () => {
		const p = createMockP();

		handleWebviewMessage(p, { type: "resetSession" });

		expect(p.startNewSession).toHaveBeenCalledTimes(1);
		expect(p.startNewSessionAndResetCopilotChat).not.toHaveBeenCalled();
	});
});

describe("handleWebviewMessage settings actions", () => {
	it("routes updateAgentOrchestrationSetting to the settings handler", () => {
		const p = createMockP();
		const spy = vi
			.spyOn(settingsH, "handleUpdateAgentOrchestrationSetting")
			.mockResolvedValue(undefined);

		handleWebviewMessage(p, {
			type: "updateAgentOrchestrationSetting",
			enabled: false,
		});

		expect(spy).toHaveBeenCalledWith(p, false);
	});

	it("routes disableAgentOrchestrationAndStopSessions to the settings handler", () => {
		const p = createMockP();
		const spy = vi
			.spyOn(settingsH, "handleStopSessionsAndDisableAgentOrchestration")
			.mockResolvedValue(undefined);

		handleWebviewMessage(p, {
			type: "disableAgentOrchestrationAndStopSessions",
		});

		expect(spy).toHaveBeenCalledWith(p);
	});
});

describe("handleWebviewReady", () => {
	function createReadyMockP(overrides: Partial<any> = {}) {
		return {
			_webviewReady: false,
			_pendingToolCallMessage: null,
			_currentToolCallId: null,
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_updateSettingsUI: vi.fn(),
			_updateQueueUI: vi.fn(),
			_updateCurrentSessionUI: vi.fn(),
			_updatePersistedHistoryUI: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_sessionManager: {
				getActiveSessionId: () => "1",
			},
			...overrides,
		} as any;
	}

	it("sets _webviewReady and sends initial state including persisted history", () => {
		const p = createReadyMockP();

		handleWebviewReady(p);

		expect(p._webviewReady).toBe(true);
		expect(p._updateSettingsUI).toHaveBeenCalledTimes(1);
		expect(p._updateQueueUI).toHaveBeenCalledTimes(1);
		expect(p._updateCurrentSessionUI).toHaveBeenCalledTimes(1);
		expect(p._updatePersistedHistoryUI).toHaveBeenCalledTimes(1);
	});

	it("sends deferred toolCallPending when pendingToolCallMessage exists", () => {
		const postMessage = vi.fn();
		const p = createReadyMockP({
			_pendingToolCallMessage: {
				id: "tc-1",
				sessionId: "1",
				prompt: "What next?",
			},
			_view: { webview: { postMessage } },
		});

		handleWebviewReady(p);

		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "toolCallPending", id: "tc-1" }),
		);
		expect(p._pendingToolCallMessage).toBeNull();
	});

	it("re-sends pending tool call when webview is recreated mid-request", () => {
		const postMessage = vi.fn();
		const pendingRequests = new Map([
			["tc-2", { resolve: vi.fn(), reject: vi.fn() }],
		]);
		const sessionMap = new Map([
			["tc-2", { status: "pending", sessionId: "1", prompt: "Continue?" }],
		]);
		const p = createReadyMockP({
			_currentToolCallId: "tc-2",
			_pendingRequests: pendingRequests,
			_currentSessionCallsMap: sessionMap,
			_view: { webview: { postMessage } },
		});

		handleWebviewReady(p);

		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "toolCallPending", id: "tc-2" }),
		);
	});

	it("preserves unread while replaying a live pending tool call after webview restore", () => {
		const postMessage = vi.fn();
		const activeSession = { id: "1", unread: false };
		const unreadSession = { id: "2", unread: true };
		const pendingRequests = new Map([["tc-restore", vi.fn()]]);
		const sessionMap = new Map([
			[
				"tc-restore",
				{ status: "pending", sessionId: "1", prompt: "Restore pending?" },
			],
		]);
		const p = createReadyMockP({
			_currentToolCallId: "tc-restore",
			_pendingRequests: pendingRequests,
			_currentSessionCallsMap: sessionMap,
			_view: { webview: { postMessage } },
			_sessionManager: {
				getActiveSessionId: () => "1",
				getActiveSession: () => activeSession,
				getAllSessions: () => [activeSession, unreadSession],
			},
		});

		handleWebviewReady(p);

		expect(activeSession.unread).toBe(false);
		expect(unreadSession.unread).toBe(true);
		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "toolCallPending", id: "tc-restore" }),
		);
	});
});

describe("handleWebviewMessage archive/delete unread state", () => {
	function createSessionStateProvider(
		manager: ChatSessionManager,
		overrides: Partial<any> = {},
	) {
		return {
			_getSession: (id: string) => manager.getSession(id),
			_sessionManager: manager,
			_currentSessionCallsMap: new Map(),
			_currentSessionCalls: [],
			_promptQueue: [],
			_attachments: [],
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
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_responseTimeoutTimers: new Map(),
			_clearResponseTimeoutTimer: vi.fn(),
			_updateViewTitle: vi.fn(),
			_updateCurrentSessionUI: vi.fn(),
			_updateQueueUI: vi.fn(),
			_updateAttachmentsUI: vi.fn(),
			_loadSettings: vi.fn(),
			_updateSettingsUI: vi.fn(),
			_startSessionTimerInterval: vi.fn(),
			_stopSessionTimerInterval: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_view: { webview: { postMessage: vi.fn() } },
			...overrides,
		} as any;
	}

	it("clears unread on the reassigned active session after archiving the current one", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const { cancelPendingToolCall } = await import("./remoteApiHandlers");
		const manager = new ChatSessionManager();
		const unreadSuccessor = manager.createSession("Agent 1");
		const archivedSession = manager.createSession("Agent 2");
		unreadSuccessor.unread = true;
		archivedSession.pendingToolCallId = "tc-archive";
		archivedSession.waitingOnUser = true;
		archivedSession.history.unshift({
			id: "tc-archive",
			sessionId: archivedSession.id,
			prompt: "Archive me?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending",
		});

		const provider = createSessionStateProvider(manager, {
			_currentSessionCallsMap: new Map([
				["tc-archive", archivedSession.history[0]],
			]),
			_toolCallSessionMap: new Map([["tc-archive", archivedSession.id]]),
			_pendingRequests: new Map([["tc-archive", vi.fn()]]),
		});
		provider._syncActiveSessionState =
			TaskSyncWebviewProvider.prototype._syncActiveSessionState.bind(provider);
		provider.cancelPendingToolCall = (reason: string, sessionId?: string) =>
			cancelPendingToolCall(provider, reason, sessionId);

		handleWebviewMessage(provider, {
			type: "archiveSession",
			sessionId: archivedSession.id,
		});

		expect(manager.getActiveSession()?.id).toBe(unreadSuccessor.id);
		expect(unreadSuccessor.unread).toBe(false);
		expect(manager.getSession(archivedSession.id)).toMatchObject({
			status: "archived",
			pendingToolCallId: null,
			waitingOnUser: false,
		});
	});

	it("clears unread on the reassigned active session after deleting the current one", async () => {
		const { TaskSyncWebviewProvider } = await import("./webviewProvider");
		const { cancelPendingToolCall } = await import("./remoteApiHandlers");
		const manager = new ChatSessionManager();
		const unreadSuccessor = manager.createSession("Agent 1");
		const deletedSession = manager.createSession("Agent 2");
		unreadSuccessor.unread = true;
		deletedSession.pendingToolCallId = "tc-delete";
		deletedSession.waitingOnUser = true;
		deletedSession.history.unshift({
			id: "tc-delete",
			sessionId: deletedSession.id,
			prompt: "Delete me?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending",
		});

		const provider = createSessionStateProvider(manager, {
			_currentSessionCallsMap: new Map([
				["tc-delete", deletedSession.history[0]],
			]),
			_toolCallSessionMap: new Map([["tc-delete", deletedSession.id]]),
			_pendingRequests: new Map([["tc-delete", vi.fn()]]),
		});
		provider._syncActiveSessionState =
			TaskSyncWebviewProvider.prototype._syncActiveSessionState.bind(provider);
		provider.cancelPendingToolCall = (reason: string, sessionId?: string) =>
			cancelPendingToolCall(provider, reason, sessionId);

		handleWebviewMessage(provider, {
			type: "deleteSession",
			sessionId: deletedSession.id,
		});

		expect(manager.getSession(deletedSession.id)).toBeUndefined();
		expect(manager.getActiveSession()?.id).toBe(unreadSuccessor.id);
		expect(unreadSuccessor.unread).toBe(false);
	});
});

describe("handleWebviewMessage archiveSession", () => {
	it("cleans _currentSessionCallsMap and _toolCallSessionMap on archive", () => {
		const callsMap = new Map([
			["tc-1", { id: "tc-1", prompt: "p1" }],
			["tc-2", { id: "tc-2", prompt: "p2" }],
		]);
		const sessionMap = new Map([
			["tc-1", "ses-1"],
			["tc-2", "ses-1"],
		]);
		const p = createMockP({
			_getSession: vi.fn().mockReturnValue({
				id: "ses-1",
				history: [
					{ id: "tc-1", prompt: "p1" },
					{ id: "tc-2", prompt: "p2" },
				],
			}),
			_sessionManager: {
				archiveSession: vi.fn().mockReturnValue(true),
			},
			_currentSessionCallsMap: callsMap,
			_toolCallSessionMap: sessionMap,
			_syncActiveSessionState: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_updateSessionsUI: vi.fn(),
		});

		handleWebviewMessage(p, { type: "archiveSession", sessionId: "ses-1" });

		expect(callsMap.has("tc-1")).toBe(false);
		expect(callsMap.has("tc-2")).toBe(false);
		expect(sessionMap.has("tc-1")).toBe(false);
		expect(sessionMap.has("tc-2")).toBe(false);
		expect(p._sessionManager.archiveSession).toHaveBeenCalledWith("ses-1");
	});
});

describe("handleWebviewMessage updateSessionTitle", () => {
	it("routes updateSessionTitle to sessionManager.renameSession", () => {
		const p = createMockP({
			_sessionManager: {
				renameSession: vi.fn().mockReturnValue(true),
			},
			_saveSessionsToDisk: vi.fn(),
			_updateSessionsUI: vi.fn(),
		});

		handleWebviewMessage(p, {
			type: "updateSessionTitle",
			sessionId: "ses-1",
			title: "My Agent",
		});

		expect(p._sessionManager.renameSession).toHaveBeenCalledWith(
			"ses-1",
			"My Agent",
		);
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
		expect(p._updateSessionsUI).toHaveBeenCalled();
	});

	it("does not save when renameSession returns false", () => {
		const p = createMockP({
			_sessionManager: {
				renameSession: vi.fn().mockReturnValue(false),
			},
			_saveSessionsToDisk: vi.fn(),
			_updateSessionsUI: vi.fn(),
		});

		handleWebviewMessage(p, {
			type: "updateSessionTitle",
			sessionId: "nonexistent",
			title: "Title",
		});

		expect(p._saveSessionsToDisk).not.toHaveBeenCalled();
		expect(p._updateSessionsUI).not.toHaveBeenCalled();
	});
});

describe("handleSubmit", () => {
	it("clears unread when the user submits a response for the open session", () => {
		const resolve = vi.fn();
		const activeSession = {
			id: "ses-1",
			queue: [],
			attachments: [],
			waitingOnUser: true,
			unread: true,
			pendingToolCallId: "tc-1",
			consecutiveAutoResponses: 1,
			aiTurnActive: false,
		};
		const p = createMockP({
			_SESSION_TERMINATION_TEXT:
				"Session terminated. Do not use askUser tool again.",
			_sessionManager: {
				getActiveSession: () => activeSession,
				getActiveSessionId: () => activeSession.id,
			},
			_pendingRequests: new Map([["tc-1", resolve]]),
			_toolCallSessionMap: new Map([["tc-1", "ses-1"]]),
			_currentSessionCallsMap: new Map([
				[
					"tc-1",
					{
						id: "tc-1",
						sessionId: "ses-1",
						prompt: "Question?",
						response: "",
						timestamp: 1,
						isFromQueue: false,
						status: "pending",
					},
				],
			]),
			_view: { webview: { postMessage: vi.fn() } },
			_clearResponseTimeoutTimer: vi.fn(),
			_updateCurrentSessionUI: vi.fn(),
			_syncActiveSessionState: vi.fn(() => {
				activeSession.unread = false;
			}),
			_saveSessionsToDisk: vi.fn(),
			_updateAttachmentsUI: vi.fn(),
			_attachments: [],
		});

		handleSubmit(p, "ses-1", "tc-1", "Answer", []);

		expect(activeSession.unread).toBe(false);
		expect(activeSession.pendingToolCallId).toBeNull();
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ value: "Answer" }),
		);
	});
});
