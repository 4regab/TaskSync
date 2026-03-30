import { describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import {
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
} from "../constants/remoteConstants";
import {
	handleResetSessionSettings,
	handleUpdateAutopilotSetting,
	handleUpdateSessionSettings,
	loadSettings,
	normalizeResponseTimeout,
} from "./settingsHandlers";

describe("normalizeResponseTimeout", () => {
	it("accepts valid allowed values", () => {
		for (const v of RESPONSE_TIMEOUT_ALLOWED_VALUES) {
			expect(normalizeResponseTimeout(v)).toBe(v);
		}
	});

	it("returns default for non-allowed numbers", () => {
		expect(normalizeResponseTimeout(7)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout(99)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout(-1)).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
	});

	it("returns default for non-integer numbers", () => {
		expect(normalizeResponseTimeout(2.5)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(NaN)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(Infinity)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("parses valid string values", () => {
		expect(normalizeResponseTimeout("5")).toBe(5);
		expect(normalizeResponseTimeout("10")).toBe(10);
		expect(normalizeResponseTimeout("60")).toBe(60);
	});

	it("returns default for invalid string values", () => {
		expect(normalizeResponseTimeout("abc")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout("2.5")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("returns default for empty/whitespace strings", () => {
		expect(normalizeResponseTimeout("")).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout("  ")).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("returns default for non-number/string types", () => {
		expect(normalizeResponseTimeout(null)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(undefined)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout(true)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
		expect(normalizeResponseTimeout({})).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
		expect(normalizeResponseTimeout([])).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
	});
});

describe("handleUpdateAutopilotSetting", () => {
	it("updates per-session state without writing to workspace config", () => {
		const activeSession = {
			autopilotEnabled: false,
			consecutiveAutoResponses: 5,
		};
		const p = {
			_autopilotEnabled: false,
			_consecutiveAutoResponses: 3,
			_sessionManager: {
				getActiveSession: () => activeSession,
			},
			_saveSessionsToDisk: vi.fn(),
			_remoteServer: null,
		} as any;

		handleUpdateAutopilotSetting(p, true);

		expect(p._autopilotEnabled).toBe(true);
		expect(p._consecutiveAutoResponses).toBe(0);
		expect(activeSession.autopilotEnabled).toBe(true);
		expect(activeSession.consecutiveAutoResponses).toBe(0);
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});

	it("broadcasts settings to remote when server is available", () => {
		const broadcast = vi.fn();
		const p = {
			_autopilotEnabled: true,
			_consecutiveAutoResponses: 0,
			_sessionManager: {
				getActiveSession: () => null,
			},
			_saveSessionsToDisk: vi.fn(),
			_remoteServer: { broadcast },
			// Fields read by buildSettingsPayload
			_soundEnabled: false,
			_interactiveApproval: false,
			_queueEnabled: false,
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_alwaysAppendReminder: false,
			_autopilotText: "",
			_autopilotPrompts: [],
			_responseTimeoutMinutes: 0,
			_sessionWarningHours: 0,
			_askUserVerbosePayload: false,
			_maxConsecutiveAutoResponses: 0,
			_humanDelayEnabled: false,
			_humanDelayMin: 0,
			_humanDelayMax: 0,
			_sendWithCtrlEnter: false,
		} as any;

		handleUpdateAutopilotSetting(p, false);

		expect(broadcast).toHaveBeenCalledWith(
			"settingsChanged",
			expect.objectContaining({ autopilotEnabled: false }),
		);
	});
});

// ─── handleUpdateSessionSettings ─────────────────────────────

describe("handleUpdateSessionSettings", () => {
	function makeP(sessionOverrides: Record<string, unknown> = {}) {
		const session = {
			autoAppendEnabled: false,
			autoAppendText: "",
			autopilotEnabled: false,
			autopilotPrompts: [],
			...sessionOverrides,
		};
		return {
			p: {
				_autopilotEnabled: false,
				_autoAppendEnabled: false,
				_autoAppendText: "",
				_autopilotText: "",
				_autopilotPrompts: [] as string[],
				_sessionManager: { getActiveSession: () => session },
				_saveSessionsToDisk: vi.fn(),
				_view: { webview: { postMessage: vi.fn() } },
				_remoteServer: null,
				// Fields for buildSettingsPayload / buildSessionSettingsPayload
				_soundEnabled: false,
				_interactiveApproval: false,
				_queueEnabled: false,
				_alwaysAppendReminder: false,
				_responseTimeoutMinutes: 0,
				_sessionWarningHours: 0,
				_askUserVerbosePayload: false,
				_maxConsecutiveAutoResponses: 0,
				_humanDelayEnabled: false,
				_humanDelayMin: 0,
				_humanDelayMax: 0,
				_sendWithCtrlEnter: false,
				_consecutiveAutoResponses: 0,
			} as any,
			session,
		};
	}

	it("forces autoAppendEnabled=false when text is empty", () => {
		const { p, session } = makeP();

		handleUpdateSessionSettings(p, {
			autoAppendEnabled: true,
			autoAppendText: "",
		});

		expect(session.autoAppendEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
	});

	it("forces autoAppendEnabled=false when text is only whitespace", () => {
		const { p, session } = makeP();

		handleUpdateSessionSettings(p, {
			autoAppendEnabled: true,
			autoAppendText: "   ",
		});

		expect(session.autoAppendEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
	});

	it("allows autoAppendEnabled=true when text is present", () => {
		const { p, session } = makeP();

		handleUpdateSessionSettings(p, {
			autoAppendEnabled: true,
			autoAppendText: "Always use tools",
		});

		expect(session.autoAppendEnabled).toBe(true);
		expect(p._autoAppendEnabled).toBe(true);
		expect(session.autoAppendText).toBe("Always use tools");
	});

	it("uses existing session text when msg text is undefined", () => {
		const { p, session } = makeP({
			autoAppendText: "existing text",
		});

		handleUpdateSessionSettings(p, {
			autoAppendEnabled: true,
		});

		expect(session.autoAppendEnabled).toBe(true);
		expect(p._autoAppendEnabled).toBe(true);
	});

	it("disables when enabling with no text in session or message", () => {
		const { p, session } = makeP({
			autoAppendText: "",
		});

		handleUpdateSessionSettings(p, {
			autoAppendEnabled: true,
		});

		expect(session.autoAppendEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
	});
});

// ─── handleResetSessionSettings ──────────────────────────────

describe("handleResetSessionSettings", () => {
	it("resets autopilot fields to hardcoded defaults", () => {
		// Mock getConfiguration to return defaults (loadSettings uses config.get)
		const getConfigSpy = vi.spyOn(vscode.workspace, "getConfiguration");
		getConfigSpy.mockReturnValue({
			get: (_key: string, defaultVal?: unknown) => defaultVal,
			update: vi.fn(),
			inspect: () => undefined,
		} as any);

		const session = {
			autopilotEnabled: true,
			autopilotText: "some text",
			autopilotPrompts: ["p1"],
			autoAppendEnabled: true,
			autoAppendText: "some append",
		};
		const p = {
			_autopilotEnabled: true,
			_autoAppendEnabled: true,
			_autoAppendText: "some append",
			_autopilotText: "some text",
			_autopilotPrompts: ["p1"],
			_autopilotIndex: 0,
			_alwaysAppendReminder: false,
			_interactiveApprovalEnabled: false,
			_sessionManager: { getActiveSession: () => session },
			_saveSessionsToDisk: vi.fn(),
			_view: { webview: { postMessage: vi.fn() } },
			_remoteServer: null,
			_soundEnabled: false,
			_interactiveApproval: false,
			_queueEnabled: false,
			_responseTimeoutMinutes: 0,
			_sessionWarningHours: 0,
			_askUserVerbosePayload: false,
			_maxConsecutiveAutoResponses: 0,
			_humanDelayEnabled: false,
			_humanLikeDelayEnabled: false,
			_humanDelayMin: 0,
			_humanDelayMax: 0,
			_humanLikeDelayMin: 0,
			_humanLikeDelayMax: 0,
			_sendWithCtrlEnter: false,
			_consecutiveAutoResponses: 0,
			_reusablePrompts: [],
		} as any;

		handleResetSessionSettings(p);

		expect(session.autopilotEnabled).toBe(false);
		expect(session.autopilotText).toBeUndefined();
		expect(session.autopilotPrompts).toEqual([]);
		// autoAppend defaults from config.get which returns the default value (false / "")
		expect(session.autoAppendEnabled).toBe(false);
		expect(session.autoAppendText).toBe("");
		expect(p._saveSessionsToDisk).toHaveBeenCalled();

		getConfigSpy.mockRestore();
	});
});

describe("loadSettings", () => {
	it("auto-disables autoAppend when session has enabled=true but empty text", () => {
		const getConfigSpy = vi.spyOn(vscode.workspace, "getConfiguration");
		getConfigSpy.mockReturnValue({
			get: (_key: string, defaultVal?: unknown) => defaultVal,
			update: vi.fn(),
			inspect: () => undefined,
		} as any);

		const session = {
			autoAppendEnabled: true,
			autoAppendText: "",
			autopilotEnabled: false,
		} as any;
		const p = {
			_autoAppendEnabled: false,
			_autoAppendText: "",
			_autopilotEnabled: false,
			_autopilotText: "",
			_autopilotPrompts: [],
			_autopilotIndex: 0,
			_alwaysAppendReminder: false,
			_interactiveApprovalEnabled: false,
			_soundEnabled: false,
			_sendWithCtrlEnter: false,
			_consecutiveAutoResponses: 0,
			_reusablePrompts: [],
			_humanLikeDelayEnabled: false,
			_humanLikeDelayMin: 0,
			_humanLikeDelayMax: 0,
			_sessionWarningHours: 0,
			_AUTOPILOT_DEFAULT_TEXT: "Continue",
			_sessionManager: { getActiveSession: () => session },
		} as any;

		loadSettings(p);

		expect(p._autoAppendEnabled).toBe(false);
		expect(session.autoAppendEnabled).toBe(false);

		getConfigSpy.mockRestore();
	});
});
