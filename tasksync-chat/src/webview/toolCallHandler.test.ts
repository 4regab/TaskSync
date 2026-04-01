import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import { handleResponseTimeout, waitForUserResponse } from "./toolCallHandler";

describe("waitForUserResponse", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("replaces an older unanswered ask_user in the same session", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const oldResolve = vi.fn();
		const session = {
			id: "1",
			title: "Agent 1",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [
				{
					id: "tc_old",
					sessionId: "1",
					prompt: "Old question?",
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
			pendingToolCallId: "tc_old",
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map([["tc_old", oldResolve]]),
			_toolCallSessionMap: new Map([["tc_old", "1"]]),
			_currentSessionCallsMap: new Map([
				[
					"tc_old",
					{
						id: "tc_old",
						sessionId: "1",
						prompt: "Old question?",
						response: "",
						timestamp: 1,
						isFromQueue: false,
						status: "pending",
					},
				],
			]),
			_currentToolCallId: "tc_old",
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(() => {
				p._currentToolCallId = session.pendingToolCallId;
			}),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		const promise = waitForUserResponse(p, "New question?", "1");

		expect(oldResolve).toHaveBeenCalledWith(
			expect.objectContaining({
				cancelled: true,
			}),
		);
		expect(session.pendingToolCallId).not.toBe("tc_old");
		expect(session.unread).toBe(false);
		expect(session.history).toHaveLength(1);
		expect(session.history[0].prompt).toBe("New question?");
		expect(session.history[0].status).toBe("pending");
		expect(p._currentSessionCallsMap.has("tc_old")).toBe(false);
		expect(p._currentSessionCallsMap.has(session.pendingToolCallId)).toBe(true);

		const newResolve = p._pendingRequests.get(session.pendingToolCallId);
		expect(typeof newResolve).toBe("function");
		newResolve({
			value: "Answer",
			queue: false,
			attachments: [],
		});

		await expect(promise).resolves.toMatchObject({
			value: "Answer",
			queue: false,
			attachments: [],
		});
	});

	it("recomputes active state before creating a replacement pending ask_user", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const activeSessionId = { current: "1" };
		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [
				{
					id: "tc_old",
					sessionId: "2",
					prompt: "Old question?",
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
			pendingToolCallId: "tc_old",
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const postMessage = vi.fn();
		const show = vi.fn();
		const oldResolve = vi.fn();
		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => activeSessionId.current,
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map([["tc_old", oldResolve]]),
			_toolCallSessionMap: new Map([["tc_old", "2"]]),
			_currentSessionCallsMap: new Map([
				[
					"tc_old",
					{
						id: "tc_old",
						sessionId: "2",
						prompt: "Old question?",
						response: "",
						timestamp: 1,
						isFromQueue: false,
						status: "pending",
					},
				],
			]),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: undefined,
			_VIEW_OPEN_TIMEOUT_MS: 10,
			_VIEW_OPEN_POLL_INTERVAL_MS: 1,
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(() => {
				p._currentToolCallId = session.pendingToolCallId;
			}),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		vi.spyOn(vscode.commands, "executeCommand").mockImplementation(async () => {
			activeSessionId.current = "2";
			p._view = {
				webview: { postMessage },
				show,
			};
		});

		const promise = waitForUserResponse(p, "Replacement question?", "2");
		await Promise.resolve();

		expect(session.unread).toBe(false);
		expect(show).toHaveBeenCalledWith(true);
		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "toolCallPending",
				sessionId: "2",
				prompt: "Replacement question?",
			}),
		);
		expect(p._remoteServer.broadcast).toHaveBeenCalledWith(
			"toolCallPending",
			expect.objectContaining({
				sessionId: "2",
				prompt: "Replacement question?",
			}),
		);

		const resolvePending = p._pendingRequests.get(session.pendingToolCallId);
		expect(typeof resolvePending).toBe("function");
		resolvePending({
			value: "Answer",
			queue: false,
			attachments: [],
		});

		await expect(promise).resolves.toMatchObject({
			value: "Answer",
			queue: false,
			attachments: [],
		});
	});

	it("plays notification sound for a new pending ask_user even when the session is not active", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: false,
			waitingOnUser: false,
			createdAt: Date.now(),
			pendingToolCallId: null,
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		const promise = waitForUserResponse(p, "Off-thread question?", "2");
		expect(p.playNotificationSound).toHaveBeenCalledTimes(1);

		const resolvePending = p._pendingRequests.get(session.pendingToolCallId);
		expect(typeof resolvePending).toBe("function");
		resolvePending({
			value: "Answer",
			queue: false,
			attachments: [],
		});

		await expect(promise).resolves.toMatchObject({
			value: "Answer",
			queue: false,
			attachments: [],
		});
	});

	it("marks a non-active real pending ask_user as unread", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: false,
			waitingOnUser: false,
			unread: false,
			createdAt: Date.now(),
			pendingToolCallId: null,
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		const promise = waitForUserResponse(p, "Unread question?", "2");

		expect(session.unread).toBe(true);
		expect(session.history[0]).toMatchObject({
			prompt: "Unread question?",
			status: "pending",
		});

		const resolvePending = p._pendingRequests.get(session.pendingToolCallId);
		expect(typeof resolvePending).toBe("function");
		resolvePending({
			value: "Answer",
			queue: false,
			attachments: [],
		});

		await expect(promise).resolves.toMatchObject({
			value: "Answer",
			queue: false,
			attachments: [],
		});
	});

	it("does not mark an active pending ask_user as unread", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const session = {
			id: "1",
			title: "Agent 1",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: false,
			waitingOnUser: false,
			unread: false,
			createdAt: Date.now(),
			pendingToolCallId: null,
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(() => {
				p._currentToolCallId = session.pendingToolCallId;
			}),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		const promise = waitForUserResponse(p, "Open question?", "1");

		expect(session.unread).toBe(false);

		const resolvePending = p._pendingRequests.get(session.pendingToolCallId);
		expect(typeof resolvePending).toBe("function");
		resolvePending({
			value: "Answer",
			queue: false,
			attachments: [],
		});

		await expect(promise).resolves.toMatchObject({
			value: "Answer",
			queue: false,
			attachments: [],
		});
	});

	it("does not create unread when queue auto-responds without a real pending entry", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout" ? "0" : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [{ id: "q-1", prompt: "Queued answer" }],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: false,
			waitingOnUser: false,
			unread: false,
			createdAt: Date.now(),
			pendingToolCallId: null,
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		await expect(
			waitForUserResponse(p, "Queue question?", "2"),
		).resolves.toMatchObject({
			value: "Queued answer",
			queue: false,
			attachments: [],
		});

		expect(session.unread).toBe(false);
		expect(session.history[0]).toMatchObject({
			status: "completed",
			isFromQueue: true,
		});
	});

	it("does not create unread when autopilot auto-responds without a real pending entry", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "responseTimeout"
					? "0"
					: key === "maxConsecutiveAutoResponses"
						? 3
						: defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: true,
			autopilotText: "Autopilot answer",
			waitingOnUser: false,
			unread: false,
			createdAt: Date.now(),
			pendingToolCallId: null,
			sessionStartTime: null,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};

		const p = {
			_bindSession: vi.fn(() => session),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_pendingRequests: new Map(),
			_toolCallSessionMap: new Map(),
			_currentSessionCallsMap: new Map(),
			_currentToolCallId: null,
			_webviewReady: true,
			_view: {
				webview: {
					postMessage: vi.fn(),
				},
				show: vi.fn(),
			},
			playNotificationSound: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_syncActiveSessionState: vi.fn(),
			_clearResponseTimeoutTimer: vi.fn(),
			_applyHumanLikeDelay: vi.fn(),
			_remoteServer: { broadcast: vi.fn() },
		} as any;

		await expect(
			waitForUserResponse(p, "Autopilot question?", "2"),
		).resolves.toMatchObject({
			value: "Autopilot answer",
			queue: false,
			attachments: [],
		});

		expect(session.unread).toBe(false);
		expect(session.history[0]).toMatchObject({
			status: "completed",
			isFromQueue: false,
		});
	});
});

describe("handleResponseTimeout", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("clears unread when a pending ask_user times out", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn((key: string, defaultValue?: unknown) =>
				key === "maxConsecutiveAutoResponses" ? 3 : defaultValue,
			),
			inspect: vi.fn(),
		} as any);

		const resolve = vi.fn();
		const session = {
			id: "2",
			title: "Agent 2",
			status: "active",
			queue: [],
			queueEnabled: true,
			history: [],
			attachments: [],
			autopilotEnabled: true,
			autopilotText: "Autopilot timeout answer",
			waitingOnUser: true,
			unread: true,
			createdAt: Date.now(),
			pendingToolCallId: "tc_timeout",
			sessionStartTime: Date.now() - 1000,
			sessionFrozenElapsed: null,
			sessionTerminated: false,
			sessionWarningShown: false,
			aiTurnActive: false,
			consecutiveAutoResponses: 0,
			autopilotIndex: 0,
		};
		const pendingEntry = {
			id: "tc_timeout",
			sessionId: "2",
			prompt: "Timeout question?",
			response: "",
			timestamp: 1,
			isFromQueue: false,
			status: "pending",
		};

		const p = {
			_SESSION_TERMINATION_TEXT:
				"Session terminated. Do not use askUser tool again.",
			_responseTimeoutTimers: new Map([["tc_timeout", 123 as any]]),
			_getSession: vi.fn(() => session),
			_pendingRequests: new Map([["tc_timeout", resolve]]),
			_currentSessionCallsMap: new Map([["tc_timeout", pendingEntry]]),
			_toolCallSessionMap: new Map([["tc_timeout", "2"]]),
			_applyHumanLikeDelay: vi.fn(),
			_sessionManager: {
				getActiveSessionId: () => "1",
				isDeletedSessionId: () => false,
			},
			_view: { webview: { postMessage: vi.fn() } },
			_syncActiveSessionState: vi.fn(),
			_updateSessionsUI: vi.fn(),
			_saveSessionsToDisk: vi.fn(),
			_clearResponseTimeoutTimer: vi.fn(),
		} as any;

		await handleResponseTimeout(p, "tc_timeout", "2");

		expect(session.unread).toBe(false);
		expect(session.pendingToolCallId).toBeNull();
		expect(session.waitingOnUser).toBe(false);
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ value: "Autopilot timeout answer" }),
		);
	});
});

describe("waitForUserResponse — session_id defensive validation", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects with missing session_id when sessionId is undefined", async () => {
		const p = {} as any;
		const result = await waitForUserResponse(p, "Test?", undefined);
		expect(result.cancelled).toBe(true);
		expect(result.value).toContain("session_id is required");
	});

	it("rejects when sessionId is a number (defensive — should be coerced upstream)", async () => {
		const p = {} as any;
		const result = await waitForUserResponse(
			p,
			"Test?",
			42 as unknown as string,
		);
		expect(result.cancelled).toBe(true);
		expect(result.value).toContain("session_id is required");
	});

	it("rejects when sessionId is null", async () => {
		const p = {} as any;
		const result = await waitForUserResponse(
			p,
			"Test?",
			null as unknown as string,
		);
		expect(result.cancelled).toBe(true);
		expect(result.value).toContain("session_id is required");
	});

	it("rejects with terminated message when session is terminated", async () => {
		const terminatedSession = {
			id: "5",
			sessionTerminated: true,
			pendingToolCallId: null,
			queue: [],
			queueEnabled: false,
		};
		const p = {
			_bindSession: vi.fn(() => terminatedSession),
			_sessionManager: {
				getActiveSessionId: () => "5",
				isDeletedSessionId: () => false,
			},
		} as any;

		const result = await waitForUserResponse(p, "Test?", "5");
		expect(result.cancelled).toBe(true);
		expect(result.value).toContain("already terminated");
	});

	it("rejects at boundary when session ID is tombstoned (before creating session)", async () => {
		const p = {
			_bindSession: vi.fn(),
			_sessionManager: {
				isDeletedSessionId: vi.fn((id: string) => id === "deleted-99"),
			},
		} as any;

		const result = await waitForUserResponse(p, "Test?", "deleted-99");
		expect(result.cancelled).toBe(true);
		expect(result.value).toContain("session was deleted");
		// _bindSession must NOT have been called — no session object created
		expect(p._bindSession).not.toHaveBeenCalled();
	});

	it("repeated stale ask_user calls with deleted ID never create sessions", async () => {
		const bindCalls: string[] = [];
		const p = {
			_bindSession: vi.fn((id: string) => {
				bindCalls.push(id);
				return { id, sessionTerminated: false };
			}),
			_sessionManager: {
				isDeletedSessionId: vi.fn((id: string) => id === "7"),
			},
		} as any;

		// Simulate 3 rapid calls from stale LLM context
		const r1 = await waitForUserResponse(p, "Q1", "7");
		const r2 = await waitForUserResponse(p, "Q2", "7");
		const r3 = await waitForUserResponse(p, "Q3", "7");

		// All rejected, none created sessions
		expect(r1.cancelled).toBe(true);
		expect(r2.cancelled).toBe(true);
		expect(r3.cancelled).toBe(true);
		expect(bindCalls).toHaveLength(0);
	});
});
