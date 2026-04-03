import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ASKUSER_SUPERSEDED_MESSAGE,
	AUTO_APPEND_DEFAULT_TEXT,
} from "./constants/remoteConstants";
import { buildFinalResponse } from "./tools";

const {
	MockCancellationError,
	registerToolMock,
	showErrorMessageMock,
	vscodeMock,
} = vi.hoisted(() => {
	const registerToolMock = vi.fn();
	const showErrorMessageMock = vi.fn();

	class MockCancellationError extends Error {}
	class MockLanguageModelToolResult {
		constructor(public readonly parts: unknown[]) {}
	}
	class MockLanguageModelTextPart {
		constructor(public readonly value: string) {}
	}

	const vscodeMock = {
		CancellationError: MockCancellationError,
		ConfigurationTarget: {
			Workspace: 2,
		},
		LanguageModelDataPart: {
			image: vi.fn(),
		},
		LanguageModelTextPart: MockLanguageModelTextPart,
		LanguageModelToolResult: MockLanguageModelToolResult,
		lm: {
			registerTool: registerToolMock,
		},
		window: {
			showErrorMessage: showErrorMessageMock,
		},
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, fallback: unknown) => fallback,
			}),
		},
	};

	(
		globalThis as { __TASKSYNC_VSCODE_MOCK__?: unknown }
	).__TASKSYNC_VSCODE_MOCK__ = vscodeMock;

	return {
		MockCancellationError,
		registerToolMock,
		showErrorMessageMock,
		vscodeMock,
	};
});

vi.mock("vscode", () => vscodeMock);

describe("buildFinalResponse", () => {
	const userResponse = "Here is my answer";
	const customText = "Always call askUser when done.";

	// ── Case 1: Auto Append OFF ──────────────────────────────────
	describe("Case 1: autoAppend OFF", () => {
		it("returns response unchanged when autoAppend is disabled", () => {
			expect(
				buildFinalResponse(
					userResponse,
					false,
					AUTO_APPEND_DEFAULT_TEXT,
					false,
				),
			).toBe(userResponse);
		});

		it("returns response unchanged even if alwaysAppendReminder is also OFF", () => {
			expect(buildFinalResponse(userResponse, false, customText, false)).toBe(
				userResponse,
			);
		});
	});

	// ── Case 2: Auto Append ON, default REQUIRED text ────────────
	describe("Case 2: autoAppend ON, default REQUIRED text", () => {
		it("appends AUTO_APPEND_DEFAULT_TEXT when autoAppend is enabled", () => {
			const result = buildFinalResponse(
				userResponse,
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				false,
			);
			expect(result).toBe(`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("returns just the default text when response is empty", () => {
			const result = buildFinalResponse(
				"",
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				false,
			);
			expect(result).toBe(AUTO_APPEND_DEFAULT_TEXT);
		});
	});

	// ── Case 3: Auto Append ON, custom text ──────────────────────
	describe("Case 3: autoAppend ON, custom text", () => {
		it("appends custom text instead of default", () => {
			const result = buildFinalResponse(userResponse, true, customText, false);
			expect(result).toBe(`${userResponse}\n\n${customText}`);
		});

		it("returns just custom text when response is empty", () => {
			const result = buildFinalResponse("", true, customText, false);
			expect(result).toBe(customText);
		});
	});

	// ── Case 4: Auto Append ON + custom text + Always Append Reminder ON ──
	describe("Case 4: autoAppend ON + custom text + alwaysAppendReminder ON", () => {
		it("appends both custom text and REQUIRED text", () => {
			const result = buildFinalResponse(userResponse, true, customText, true);
			expect(result).toBe(
				`${userResponse}\n\n${customText}\n\n${AUTO_APPEND_DEFAULT_TEXT}`,
			);
		});

		it("appends both when response is empty", () => {
			const result = buildFinalResponse("", true, customText, true);
			expect(result).toBe(`${customText}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});
	});

	// ── Case 5: alwaysAppendReminder ON but autoAppend OFF ───────
	describe("Case 5: alwaysAppendReminder ON, autoAppend OFF", () => {
		it("appends the reminder even when autoAppend is disabled", () => {
			const result = buildFinalResponse(userResponse, false, customText, true);
			expect(result).toBe(`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("returns the reminder when response is empty", () => {
			const result = buildFinalResponse("", false, customText, true);
			expect(result).toBe(AUTO_APPEND_DEFAULT_TEXT);
		});
	});

	// ── Case 6: Auto Append ON, default text + Always Append Reminder ON ──
	describe("Case 6: autoAppend ON + default text + alwaysAppendReminder ON", () => {
		it("appends default text twice (both flags active with same text)", () => {
			const result = buildFinalResponse(
				userResponse,
				true,
				AUTO_APPEND_DEFAULT_TEXT,
				true,
			);
			expect(result).toBe(
				`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}\n\n${AUTO_APPEND_DEFAULT_TEXT}`,
			);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────
	describe("edge cases", () => {
		it("handles whitespace-only response", () => {
			const result = buildFinalResponse("   ", true, customText, false);
			expect(result).toBe(`${customText}`);
		});

		it("handles whitespace-only append text (no append happens)", () => {
			const result = buildFinalResponse(userResponse, true, "   ", false);
			expect(result).toBe(userResponse);
		});

		it("handles response with trailing whitespace", () => {
			const result = buildFinalResponse(
				"Answer  \n\n",
				true,
				customText,
				false,
			);
			expect(result).toBe(`Answer\n\n${customText}`);
		});

		it("handles multiline response", () => {
			const multiline = "Line 1\nLine 2\nLine 3";
			const result = buildFinalResponse(multiline, true, customText, false);
			expect(result).toBe(`${multiline}\n\n${customText}`);
		});

		it("handles empty append text with alwaysAppendReminder ON", () => {
			const result = buildFinalResponse(userResponse, true, "", true);
			// Empty append text → appendAutoAppendText returns response unchanged
			// Then alwaysAppendReminder appends REQUIRED text
			expect(result).toBe(`${userResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("handles all flags OFF — response unchanged", () => {
			expect(buildFinalResponse(userResponse, false, "", false)).toBe(
				userResponse,
			);
		});

		it("handles all flags OFF with empty response", () => {
			expect(buildFinalResponse("", false, "", false)).toBe("");
		});

		it("handles append text containing internal newlines", () => {
			const multilineAppend = "Rule 1: call askUser\nRule 2: never stop";
			const result = buildFinalResponse(
				userResponse,
				true,
				multilineAppend,
				false,
			);
			expect(result).toBe(`${userResponse}\n\n${multilineAppend}`);
		});

		it("handles unicode and emoji in response and append text", () => {
			const emojiResponse = "Here's your answer 👍";
			const emojiAppend = "必ず askUser を呼んでください 🔄";
			const result = buildFinalResponse(
				emojiResponse,
				true,
				emojiAppend,
				false,
			);
			expect(result).toBe(`${emojiResponse}\n\n${emojiAppend}`);
		});

		it("handles unicode with alwaysAppendReminder when autoAppend is OFF", () => {
			const emojiResponse = "Réponse complète ✅";
			const result = buildFinalResponse(emojiResponse, false, "", true);
			expect(result).toBe(`${emojiResponse}\n\n${AUTO_APPEND_DEFAULT_TEXT}`);
		});

		it("handles response that already contains append text (no dedup)", () => {
			const responseWithAppend = `Done.\n\n${customText}`;
			const result = buildFinalResponse(
				responseWithAppend,
				true,
				customText,
				false,
			);
			// Should append again — no deduplication
			expect(result).toBe(`${responseWithAppend}\n\n${customText}`);
		});

		it("handles very long response string", () => {
			const longResponse = "x".repeat(10000);
			const result = buildFinalResponse(longResponse, true, customText, false);
			expect(result).toBe(`${longResponse}\n\n${customText}`);
			expect(result.length).toBe(10000 + 2 + customText.length);
		});

		it("handles tab and carriage return in response", () => {
			const tabbedResponse = "Step 1:\tDone\r\nStep 2:\tDone";
			const result = buildFinalResponse(
				tabbedResponse,
				true,
				customText,
				false,
			);
			expect(result).toBe(`${tabbedResponse}\n\n${customText}`);
		});
	});
});

/**
 * Build a stable cancellation token stub for ask_user tests.
 */
function createToken() {
	return {
		isCancellationRequested: false,
		onCancellationRequested: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	};
}

/**
 * Build a minimal single-session provider stub for invoke() regressions that
 * must exercise the real stale-session boundary without reaching singleton rebinding.
 */
function createSingleSessionInvokeProvider(
	overrides: Record<string, unknown> = {},
) {
	return {
		_agentOrchestrationEnabled: false,
		_bindSession: vi.fn(() => {
			throw new Error(
				"_bindSession should not run for stale single-session rejections",
			);
		}),
		_getSession: vi.fn(() => undefined),
		_sessionManager: {
			getActiveSessionId: () => "1",
			getSession: vi.fn(() => undefined),
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
		_alwaysAppendReminder: false,
		playNotificationSound: vi.fn(),
		_updateSessionsUI: vi.fn(),
		_saveSessionsToDisk: vi.fn(),
		_syncActiveSessionState: vi.fn(),
		_clearResponseTimeoutTimer: vi.fn(),
		_applyHumanLikeDelay: vi.fn(),
		_remoteServer: { broadcast: vi.fn() },
		...overrides,
	} as any;
}

/**
 * Reload the tools module cleanly so each test gets a fresh registerTool capture.
 */
beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	(
		globalThis as { __TASKSYNC_VSCODE_MOCK__?: unknown }
	).__TASKSYNC_VSCODE_MOCK__ = vscodeMock;
});

/**
 * Verify that cancelled ask_user results are returned as normal text
 * (NOT CancellationError) so the LLM can see the message and call ask_user again.
 * CancellationError kills the ToolCallingLoop — only real token cancellation should throw it.
 */
describe("askUser cancellation handling", () => {
	/**
	 * A superseded provider result must return as normal text, not throw.
	 */
	it("returns cancelled message as normal result when waitForUserResponse returns a cancelled result", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: ASKUSER_SUPERSEDED_MESSAGE,
				attachments: [],
				queue: false,
				cancelled: true,
				directive: {
					kind: "cancelled",
					reason: "superseded",
					action: "call_ask_user_again",
					sessionId: "1",
					reaskExactSameQuestion: true,
				},
			}),
		};

		const result = await askUser(
			{ question: "Reset?", session_id: "1" },
			provider as any,
			createToken() as any,
		);
		expect(result.response).toBe(ASKUSER_SUPERSEDED_MESSAGE);
		expect(result.attachments).toEqual([]);
		expect(result.queue).toBe(false);
		expect(result.directive).toMatchObject({
			kind: "cancelled",
			reason: "superseded",
			action: "call_ask_user_again",
			sessionId: "1",
			reaskExactSameQuestion: true,
		});
	});

	/**
	 * The registered LM tool must return a LanguageModelToolResult (not throw)
	 * for superseded requests so the LLM sees the message.
	 */
	it("returns LanguageModelToolResult for superseded requests from the registered tool invoke handler", async () => {
		const { registerTools } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: ASKUSER_SUPERSEDED_MESSAGE,
				attachments: [],
				queue: false,
				cancelled: true,
				directive: {
					kind: "cancelled",
					reason: "superseded",
					action: "call_ask_user_again",
					sessionId: "1",
					reaskExactSameQuestion: true,
				},
			}),
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_alwaysAppendReminder: false,
		};
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		const result = await toolDefinition.invoke(
			{ input: { question: "Reset?", session_id: "1" } },
			createToken() as any,
		);
		// Should return a result, not throw
		expect(result).toBeTruthy();
		expect(result.parts).toBeDefined();
		expect(result.parts.length).toBe(1);
		// The response text should contain the cancelled message
		const textPart = result.parts[0];
		const parsed = JSON.parse(textPart.value);
		expect(parsed.session_id).toBe("1");
		expect(parsed.response).toBe(ASKUSER_SUPERSEDED_MESSAGE);
		expect(parsed.directive).toEqual({
			kind: "cancelled",
			reason: "superseded",
			action: "call_ask_user_again",
			session_id: "1",
			reask_exact_same_question: true,
		});
		expect(showErrorMessageMock).not.toHaveBeenCalled();
	});

	it("includes bootstrap directive in the registered tool payload when session_id is auto", async () => {
		const { registerTools } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "12" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Handled",
				attachments: [],
				queue: false,
			}),
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_alwaysAppendReminder: false,
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		const result = await toolDefinition.invoke(
			{ input: { question: "Bootstrap", session_id: "auto" } },
			createToken() as any,
		);

		const textPart = result.parts[0];
		const parsed = JSON.parse(textPart.value);
		expect(parsed.session_id).toBe("12");
		expect(parsed.directive).toEqual({
			kind: "bootstrap",
			reason: "auto_assigned_session",
			action: "call_ask_user_again",
			session_id: "12",
		});
	});

	it("always includes session_id in the registered tool payload", async () => {
		const { registerTools } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Handled",
				attachments: [],
				queue: true,
			}),
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_alwaysAppendReminder: false,
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		const result = await toolDefinition.invoke(
			{ input: { question: "Continue", session_id: "12" } },
			createToken() as any,
		);

		const textPart = result.parts[0];
		const parsed = JSON.parse(textPart.value);
		expect(parsed.session_id).toBe("12");
		expect(parsed.response).toBe("Handled");
		expect(parsed.queued).toBe(true);
	});

	/**
	 * Deleted single-session stale recovery must not leak the old auto-bootstrap
	 * wording through the final registered ask_user payload.
	 */
	it("returns deleted single-session stale recovery without auto bootstrap text from the registered tool invoke handler", async () => {
		const { registerTools } = await import("./tools");
		const { waitForUserResponse } = await import("./webview/toolCallHandler");
		const provider = createSingleSessionInvokeProvider({
			_sessionManager: {
				getActiveSessionId: () => "1",
				getSession: vi.fn(() => undefined),
				isDeletedSessionId: vi.fn((id: string) => id === "deleted-99"),
			},
		});
		provider.waitForUserResponse = (question: string, sessionId: string) =>
			waitForUserResponse(provider as any, question, sessionId);
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		const result = await toolDefinition.invoke(
			{ input: { question: "Recover deleted", session_id: "deleted-99" } },
			createToken() as any,
		);

		const textPart = result.parts[0];
		const parsed = JSON.parse(textPart.value);
		expect(parsed.session_id).toBe("deleted-99");
		expect(parsed.response).toContain(
			'REJECTED. session_id "deleted-99" WAS DELETED.',
		);
		expect(parsed.response).toContain(
			"START A NEW CHAT TO GET A NEW session_id.",
		);
		expect(parsed.response).not.toContain(
			'CALL ask_user AGAIN WITH session_id "auto".',
		);
		expect(parsed.directive).toEqual({
			kind: "rejected",
			reason: "deleted_session",
			action: "start_new_chat_with_new_session_id",
		});
		expect(provider._bindSession).not.toHaveBeenCalled();
	});

	/**
	 * Terminated single-session stale recovery must stay aligned with the new-chat
	 * directive so the model is not pointed back at the singleton bootstrap path.
	 */
	it("returns terminated single-session stale recovery without auto bootstrap text from the registered tool invoke handler", async () => {
		const { registerTools } = await import("./tools");
		const { waitForUserResponse } = await import("./webview/toolCallHandler");
		const terminatedSession = {
			id: "terminated-5",
			sessionTerminated: true,
			pendingToolCallId: null,
			queue: [],
			queueEnabled: false,
		};
		const provider = createSingleSessionInvokeProvider({
			_getSession: vi.fn((id: string) =>
				id === "terminated-5" ? terminatedSession : undefined,
			),
		});
		provider.waitForUserResponse = (question: string, sessionId: string) =>
			waitForUserResponse(provider as any, question, sessionId);
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		const result = await toolDefinition.invoke(
			{ input: { question: "Recover terminated", session_id: "terminated-5" } },
			createToken() as any,
		);

		const textPart = result.parts[0];
		const parsed = JSON.parse(textPart.value);
		expect(parsed.session_id).toBe("terminated-5");
		expect(parsed.response).toContain(
			'REJECTED. session_id "terminated-5" IS TERMINATED.',
		);
		expect(parsed.response).toContain(
			"START A NEW CHAT TO GET A NEW session_id.",
		);
		expect(parsed.response).not.toContain(
			'CALL ask_user AGAIN WITH session_id "auto".',
		);
		expect(parsed.directive).toEqual({
			kind: "rejected",
			reason: "terminated_session",
			action: "start_new_chat_with_new_session_id",
		});
		expect(provider._bindSession).not.toHaveBeenCalled();
	});

	/**
	 * Real token cancellation (CancellationToken fires) must still throw CancellationError.
	 */
	it("throws CancellationError when token is already cancelled before starting", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn(),
		};

		const cancelledToken = {
			isCancellationRequested: true,
			onCancellationRequested: vi.fn(() => ({
				dispose: vi.fn(),
			})),
		};

		await expect(
			askUser(
				{ question: "Test?", session_id: "1" },
				provider as any,
				cancelledToken as any,
			),
		).rejects.toBeInstanceOf(MockCancellationError);
	});

	/**
	 * Mid-flight cancellation: token fires while waitForUserResponse is still pending.
	 * The createCancellationPromise race must cause askUser to reject with CancellationError.
	 */
	it("throws CancellationError when token fires mid-flight during waitForUserResponse", async () => {
		const { askUser } = await import("./tools");

		// waitForUserResponse never resolves — simulates the user hasn't responded yet
		const provider = {
			waitForUserResponse: vi.fn(() => new Promise<never>(() => {})),
		};

		// Capture the onCancellationRequested callback so we can fire it manually
		let cancelCallback: (() => void) | undefined;
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((cb: () => void) => {
				cancelCallback = cb;
				return { dispose: vi.fn() };
			}),
		};

		const promise = askUser(
			{ question: "Pending?", session_id: "1" },
			provider as any,
			token as any,
		);

		// Fire the cancellation callback to simulate the Stop button
		expect(cancelCallback).toBeDefined();
		cancelCallback!();

		await expect(promise).rejects.toBeInstanceOf(MockCancellationError);
	});
});

describe("askUser session_id coercion", () => {
	it("coerces numeric session_id to string instead of crashing on .trim()", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "OK",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		// Simulate LLM sending session_id as a number (common with numeric IDs)
		const result = await askUser(
			{ question: "Hello", session_id: 7 as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.waitForUserResponse).toHaveBeenCalledWith("Hello", "7");
		expect(result.response).toBe("OK");
		expect(result.sessionId).toBe("7");
	});

	it("coerces session_id 0 (falsy number) to string '0' instead of auto-assigning", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Zero",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		const result = await askUser(
			{ question: "Falsy?", session_id: 0 as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.waitForUserResponse).toHaveBeenCalledWith("Falsy?", "0");
		expect(result.response).toBe("Zero");
	});

	it("treats null session_id as missing and auto-assigns", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "5" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Assigned",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		const result = await askUser(
			{ question: "Null?", session_id: null as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(provider.waitForUserResponse).toHaveBeenCalledWith("Null?", "5");
		expect(result.response).toContain("TaskSync assigned session_id");
		expect(result.response).toContain("Do not reply in plain chat");
		expect(result.response).toContain("CALL ask_user again now");
		expect(result.directive).toMatchObject({
			kind: "bootstrap",
			reason: "auto_assigned_session",
			action: "call_ask_user_again",
			sessionId: "5",
		});
	});

	it("treats undefined session_id as missing and auto-assigns", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "6" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Assigned",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		const result = await askUser(
			{ question: "Undef?", session_id: undefined as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(provider.waitForUserResponse).toHaveBeenCalledWith("Undef?", "6");
		expect(result.response).toContain("TaskSync assigned session_id");
	});

	it("treats object session_id as missing and auto-assigns", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "8" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Assigned",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		const result = await askUser(
			{ question: "Obj?", session_id: {} as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(result.response).toContain("TaskSync assigned session_id");
	});

	it("treats whitespace-only session_id as missing and auto-assigns", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "10" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Assigned",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		const result = await askUser(
			{ question: "Spaces?", session_id: "   " },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(result.response).toContain("TaskSync assigned session_id");
	});

	it("invoke handler coerces numeric session_id before passing to askUser", async () => {
		const { registerTools } = await import("./tools");
		const provider = {
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Invoked",
				attachments: [],
				queue: false,
			}),
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_alwaysAppendReminder: false,
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};
		const context = { subscriptions: [] as unknown[] };

		registerTools(context as any, provider as any);

		const toolDefinition = registerToolMock.mock.calls[0]?.[1];
		expect(toolDefinition).toBeTruthy();

		// Invoke with numeric session_id — must not crash
		const result = await toolDefinition.invoke(
			{ input: { question: "Via invoke", session_id: 3 } },
			createToken() as any,
		);

		expect(result).toBeTruthy();
		expect(result.parts).toBeDefined();
		// Verify it coerced to string "3"
		expect(provider.waitForUserResponse).toHaveBeenCalledWith(
			"Via invoke",
			"3",
		);
	});

	it("treats non-string non-number session_id as empty and auto-assigns", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "9" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Assigned",
				attachments: [],
				queue: false,
			}),
			_sessionManager: { getSession: vi.fn(() => undefined) },
		};

		// Simulate LLM sending session_id as a boolean
		const result = await askUser(
			{ question: "Test", session_id: true as unknown as string },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(provider.waitForUserResponse).toHaveBeenCalledWith("Test", "9");
		expect(result.response).toContain("TaskSync assigned session_id");
	});

	it("auto-assigns a session_id when the tool is invoked without one", async () => {
		const { askUser } = await import("./tools");
		const provider = {
			createSessionForMissingId: vi.fn(() => ({ id: "7" })),
			waitForUserResponse: vi.fn().mockResolvedValue({
				value: "Handled",
				attachments: [],
				queue: false,
			}),
		};

		const result = await askUser(
			{ question: "Start from Copilot chat", session_id: "auto" },
			provider as any,
			createToken() as any,
		);

		expect(provider.createSessionForMissingId).toHaveBeenCalledTimes(1);
		expect(provider.waitForUserResponse).toHaveBeenCalledWith(
			"Start from Copilot chat",
			"7",
		);
		expect(result.response).toContain('TaskSync assigned session_id "7"');
		expect(result.response).toContain(
			"Use this exact session_id on every ask_user call.",
		);
		expect(result.response).toContain(
			'CALL ask_user again now with session_id "7".',
		);
		expect(result.directive).toMatchObject({
			kind: "bootstrap",
			reason: "auto_assigned_session",
			action: "call_ask_user_again",
			sessionId: "7",
		});
	});
});
