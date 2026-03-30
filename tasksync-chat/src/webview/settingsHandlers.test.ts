import { describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import {
	RESPONSE_TIMEOUT_ALLOWED_VALUES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
} from "../constants/remoteConstants";
import {
	handleUpdateAutopilotSetting,
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
