import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import { waitForUserResponse } from "./toolCallHandler";

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
});
