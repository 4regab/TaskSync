import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";
import {
	DEFAULT_HUMAN_LIKE_DELAY_MAX,
	DEFAULT_HUMAN_LIKE_DELAY_MIN,
	DEFAULT_REMOTE_MAX_DEVICES,
	DEFAULT_SESSION_WARNING_HOURS,
	HUMAN_DELAY_MAX_LOWER,
	HUMAN_DELAY_MAX_UPPER,
	HUMAN_DELAY_MIN_LOWER,
	HUMAN_DELAY_MIN_UPPER,
	MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
	MIN_REMOTE_MAX_DEVICES,
	RESPONSE_TIMEOUT_DEFAULT_MINUTES,
	SESSION_WARNING_HOURS_MAX,
	SESSION_WARNING_HOURS_MIN,
} from "../constants/remoteConstants";
import {
	AGENT_ORCHESTRATION_MULTI_WAITING_WARNING,
	applyAutoAppendToResponse,
	broadcastAllSettingsToRemote,
	buildSettingsPayload,
	getAutopilotDefaultText,
	handleAddAutopilotPrompt,
	handleAddReusablePrompt,
	handleEditAutopilotPrompt,
	handleEditReusablePrompt,
	handleRemoveAutopilotPrompt,
	handleRemoveReusablePrompt,
	handleReorderAutopilotPrompts,
	handleSearchSlashCommands,
	handleStopSessionsAndDisableAgentOrchestration,
	handleUpdateAgentOrchestrationSetting,
	handleUpdateAutoAppendSetting,
	handleUpdateAutoAppendText,
	handleUpdateAutopilotSetting,
	handleUpdateAutopilotText,
	handleUpdateHumanDelayMax,
	handleUpdateHumanDelayMin,
	handleUpdateHumanDelaySetting,
	handleUpdateInteractiveApprovalSetting,
	handleUpdateMaxConsecutiveAutoResponses,
	handleUpdateRemoteMaxDevices,
	handleUpdateResponseTimeout,
	handleUpdateSendWithCtrlEnterSetting,
	handleUpdateSessionWarningHours,
	handleUpdateSoundSetting,
	loadSettings,
	normalizeAutopilotText,
	readResponseTimeoutMinutes,
	saveAutopilotPrompts,
	saveReusablePrompts,
	updateSettingsUI,
} from "../webview/settingsHandlers";

// ─── Mock P factory ─────────────────────────────────────────

function createMockP(overrides: Partial<any> = {}) {
	const activeSession = {
		id: "1",
		autopilotEnabled: overrides._autopilotEnabled ?? false,
		consecutiveAutoResponses: overrides._consecutiveAutoResponses ?? 0,
	};
	return {
		_soundEnabled: true,
		_interactiveApprovalEnabled: true,
		_agentOrchestrationEnabled: true,
		_autoAppendEnabled: false,
		_autoAppendText: "",
		_sendWithCtrlEnter: false,
		_autopilotEnabled: false,
		_autopilotText: "Continue",
		_autopilotPrompts: [] as string[],
		_autopilotIndex: 0,
		_reusablePrompts: [] as any[],
		_queueEnabled: true,
		_humanLikeDelayEnabled: true,
		_humanLikeDelayMin: DEFAULT_HUMAN_LIKE_DELAY_MIN,
		_humanLikeDelayMax: DEFAULT_HUMAN_LIKE_DELAY_MAX,
		_sessionWarningHours: DEFAULT_SESSION_WARNING_HOURS,
		_sessionFrozenElapsed: null,
		_consecutiveAutoResponses: 0,
		_isUpdatingConfig: false,
		_AUTOPILOT_DEFAULT_TEXT: "Continue",
		_stopSessionTimerInterval: vi.fn(),
		_updateViewTitle: vi.fn(),
		_view: {
			webview: {
				postMessage: vi.fn(),
			},
		},
		_remoteServer: null as any,
		_updateSessionsUI: vi.fn(),
		_getSingleSession: vi.fn(() => activeSession),
		cancelPendingToolCall: vi.fn(() => true),
		_saveSessionsToDisk: vi.fn(),
		_sessionManager: {
			getActiveSession: () => activeSession,
			getActiveSessions: () => [activeSession],
			getActiveSessionId: () => activeSession.id,
		},
		...overrides,
	} as any;
}

function createMockConfig(values: Record<string, any> = {}) {
	return {
		get: vi.fn((key: string, defaultValue?: any) =>
			key in values ? values[key] : defaultValue,
		),
		update: vi.fn().mockResolvedValue(undefined),
		inspect: vi.fn((_key: string): Record<string, any> | undefined => {
			if (_key in values) {
				return { globalValue: values[_key] };
			}
			return undefined;
		}),
	};
}

// ─── getAutopilotDefaultText ────────────────────────────────

describe("getAutopilotDefaultText", () => {
	it("returns inspected default value when it has content", () => {
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "My Default" });
		const p = createMockP();
		expect(getAutopilotDefaultText(p, config as any)).toBe("My Default");
	});

	it("returns p._AUTOPILOT_DEFAULT_TEXT when inspected default is empty", () => {
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "" });
		const p = createMockP({ _AUTOPILOT_DEFAULT_TEXT: "Fallback" });
		expect(getAutopilotDefaultText(p, config as any)).toBe("Fallback");
	});

	it("returns p._AUTOPILOT_DEFAULT_TEXT when no inspected default", () => {
		const config = createMockConfig();
		config.inspect.mockReturnValue({});
		const p = createMockP({ _AUTOPILOT_DEFAULT_TEXT: "Fallback" });
		expect(getAutopilotDefaultText(p, config as any)).toBe("Fallback");
	});

	it("uses workspace configuration when no config param provided", () => {
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "FromConfig" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		expect(getAutopilotDefaultText(p)).toBe("FromConfig");
	});
});

// ─── normalizeAutopilotText ─────────────────────────────────

describe("normalizeAutopilotText", () => {
	it("returns text when non-empty", () => {
		const p = createMockP();
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "Default" });
		expect(normalizeAutopilotText(p, "Custom text", config as any)).toBe(
			"Custom text",
		);
	});

	it("returns default when text is empty", () => {
		const p = createMockP();
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "Default" });
		expect(normalizeAutopilotText(p, "", config as any)).toBe("Default");
	});

	it("returns default when text is whitespace-only", () => {
		const p = createMockP();
		const config = createMockConfig();
		config.inspect.mockReturnValue({ defaultValue: "Default" });
		expect(normalizeAutopilotText(p, "   ", config as any)).toBe("Default");
	});
});

describe("applyAutoAppendToResponse", () => {
	it("returns original response when auto append is disabled", () => {
		const p = createMockP({
			_autoAppendEnabled: false,
			_autoAppendText: "Always call askUser",
		});
		expect(applyAutoAppendToResponse(p, "Answer")).toBe("Answer");
	});

	it("appends configured text when auto append is enabled", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Always call askUser",
		});
		expect(applyAutoAppendToResponse(p, "Answer")).toBe(
			"Answer\n\nAlways call askUser",
		);
	});
});

// ─── readResponseTimeoutMinutes ─────────────────────────────

describe("readResponseTimeoutMinutes", () => {
	it("reads and normalizes config value", () => {
		const config = createMockConfig({ responseTimeout: "30" });
		expect(readResponseTimeoutMinutes(config as any)).toBe(30);
	});

	it("uses default when value is invalid", () => {
		const config = createMockConfig({ responseTimeout: "abc" });
		expect(readResponseTimeoutMinutes(config as any)).toBe(
			RESPONSE_TIMEOUT_DEFAULT_MINUTES,
		);
	});

	it("falls back to workspace config when no param", () => {
		const config = createMockConfig();
		config.get.mockReturnValue(String(RESPONSE_TIMEOUT_DEFAULT_MINUTES));
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		expect(readResponseTimeoutMinutes()).toBe(RESPONSE_TIMEOUT_DEFAULT_MINUTES);
	});
});

// ─── loadSettings ───────────────────────────────────────────

describe("loadSettings", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("loads basic settings from config", () => {
		const config = createMockConfig({
			notificationSound: false,
			interactiveApproval: false,
			sendWithCtrlEnter: true,
			humanLikeDelay: false,
			humanLikeDelayMin: 5,
			humanLikeDelayMax: 10,
			sessionWarningHours: 3,
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);

		expect(p._soundEnabled).toBe(false);
		expect(p._interactiveApprovalEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
		expect(p._autoAppendText).toBe("");
		expect(p._sendWithCtrlEnter).toBe(true);
		expect(p._humanLikeDelayEnabled).toBe(false);
	});

	it("ignores deprecated workspace autoAppend settings", () => {
		const config = createMockConfig({
			askUserVerbosePayload: true,
			autoAppendEnabled: true,
			autoAppendText: "Legacy append text",
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._autoAppendEnabled).toBe(false);
		expect(p._autoAppendText).toBe("");
	});

	it("ignores deprecated workspace autopilot toggle", () => {
		const config = createMockConfig({ autopilot: true });
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _sessionManager: undefined });
		loadSettings(p);
		expect(p._autopilotEnabled).toBe(false);
	});

	it("defaults autopilotEnabled to false when no keys are set", () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._autopilotEnabled).toBe(false);
	});

	it("does not load autopilot prompts from workspace config", () => {
		const config = createMockConfig({
			autopilotPrompts: ["prompt1", "prompt2", ""],
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._autopilotPrompts).toEqual([]);
	});

	it("clamps autopilotIndex when prompts array shrinks", () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _autopilotIndex: 5 });
		loadSettings(p);
		expect(p._autopilotIndex).toBe(0);
	});

	it("loads reusable prompts with generated IDs", () => {
		const config = createMockConfig({
			reusablePrompts: [
				{ name: "fix", prompt: "Fix the bug" },
				{ name: "test", prompt: "Write tests" },
			],
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._reusablePrompts).toHaveLength(2);
		expect(p._reusablePrompts[0].name).toBe("fix");
		expect(p._reusablePrompts[0].id).toMatch(/^rp_/);
	});

	it("ensures humanLikeDelayMin <= humanLikeDelayMax", () => {
		const config = createMockConfig({
			humanLikeDelayMin: 15,
			humanLikeDelayMax: 5,
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._humanLikeDelayMin).toBe(p._humanLikeDelayMax);
	});

	it("clamps sessionWarningHours within bounds", () => {
		const config = createMockConfig({
			sessionWarningHours: 999,
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._sessionWarningHours).toBe(SESSION_WARNING_HOURS_MAX);
	});

	it("handles non-finite sessionWarningHours", () => {
		const config = createMockConfig({
			sessionWarningHours: NaN,
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		loadSettings(p);
		expect(p._sessionWarningHours).toBe(DEFAULT_SESSION_WARNING_HOURS);
	});

	it("keeps autopilot prompts empty when a session has none configured", () => {
		const config = createMockConfig({
			autopilotPrompts: [],
			autopilotText: "Custom text",
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _AUTOPILOT_DEFAULT_TEXT: "Continue" });
		loadSettings(p);
		expect(p._autopilotPrompts).toEqual([]);
		expect(p._autopilotText).toBe("Continue");
	});

	it("keeps default singleton collapse but can skip it for config refresh", () => {
		const config = createMockConfig({
			notificationSound: false,
			interactiveApproval: false,
			agentOrchestration: false,
		});
		config.inspect.mockReturnValue(undefined);
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();

		// Default callers must keep the existing collapse behavior.
		loadSettings(p);
		expect(p._soundEnabled).toBe(false);
		expect(p._interactiveApprovalEnabled).toBe(false);
		expect(p._agentOrchestrationEnabled).toBe(false);
		expect(p._getSingleSession).toHaveBeenCalledTimes(1);

		p._getSingleSession.mockClear();
		p._soundEnabled = true;
		p._interactiveApprovalEnabled = true;
		p._agentOrchestrationEnabled = true;

		// The config-refresh opt-in should still reload settings while skipping collapse.
		loadSettings(p, { skipSingleSessionCollapse: true });
		expect(p._soundEnabled).toBe(false);
		expect(p._interactiveApprovalEnabled).toBe(false);
		expect(p._agentOrchestrationEnabled).toBe(false);
		expect(p._getSingleSession).not.toHaveBeenCalled();
	});
});

// ─── buildSettingsPayload ───────────────────────────────────

describe("buildSettingsPayload", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("builds complete payload from P state", () => {
		const config = createMockConfig({
			responseTimeout: "30",
			maxConsecutiveAutoResponses: 5,
			remoteMaxDevices: 4,
		});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_soundEnabled: false,
			_autopilotEnabled: true,
			_autopilotText: "Go ahead",
			_autopilotPrompts: ["p1"],
			_queueEnabled: false,
		});

		const payload = buildSettingsPayload(p);
		expect(payload.soundEnabled).toBe(false);
		expect(payload.agentOrchestrationEnabled).toBe(true);
		expect(payload.autoAppendEnabled).toBe(false);
		expect(payload.autoAppendText).toBe("");
		expect(payload.autopilotEnabled).toBe(true);
		expect(payload.autopilotText).toBe("Go ahead");
		expect(payload.autopilotPrompts).toEqual(["p1"]);
		expect(payload.queueEnabled).toBe(false);
		expect(payload.responseTimeout).toBe(30);
		expect(payload.maxConsecutiveAutoResponses).toBe(5);
		expect(payload.remoteMaxDevices).toBe(4);
	});
});

// ─── updateSettingsUI ───────────────────────────────────────

describe("updateSettingsUI", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("posts updateSettings message to webview", () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		updateSettingsUI(p);
		expect(p._view.webview.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "updateSettings" }),
		);
	});
});

// ─── broadcastAllSettingsToRemote ────────────────────────────

describe("broadcastAllSettingsToRemote", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("broadcasts when remote server exists", () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const broadcast = vi.fn();
		const p = createMockP({ _remoteServer: { broadcast } });
		broadcastAllSettingsToRemote(p);
		expect(broadcast).toHaveBeenCalledWith(
			"settingsChanged",
			expect.objectContaining({ soundEnabled: true }),
		);
	});

	it("does nothing when no remote server", () => {
		const p = createMockP({ _remoteServer: null });
		broadcastAllSettingsToRemote(p);
		// should not throw
	});
});

// ─── Settings update handlers ───────────────────────────────

describe("handleUpdateSoundSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates sound and writes config", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateSoundSetting(p, false);
		expect(p._soundEnabled).toBe(false);
		expect(config.update).toHaveBeenCalledWith(
			"notificationSound",
			false,
			vscode.ConfigurationTarget.Global,
		);
	});
});

describe("handleUpdateInteractiveApprovalSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates interactive approval setting", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateInteractiveApprovalSetting(p, false);
		expect(p._interactiveApprovalEnabled).toBe(false);
		expect(config.update).toHaveBeenCalled();
	});
});

describe("handleUpdateAgentOrchestrationSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates the workspace setting and resolves the singleton when disabled", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const broadcast = vi.fn();

		const p = createMockP({
			_remoteServer: { broadcast },
		});
		await handleUpdateAgentOrchestrationSetting(p, false);

		expect(p._agentOrchestrationEnabled).toBe(false);
		expect(config.update).toHaveBeenCalledWith(
			"agentOrchestration",
			false,
			vscode.ConfigurationTarget.Workspace,
		);
		expect(p._getSingleSession).toHaveBeenCalledTimes(1);
		expect(p._updateSessionsUI).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(
			"settingsChanged",
			expect.objectContaining({ agentOrchestrationEnabled: false }),
		);
	});

	it("does not resolve a singleton session when left enabled", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateAgentOrchestrationSetting(p, true);

		expect(p._agentOrchestrationEnabled).toBe(true);
		expect(p._getSingleSession).not.toHaveBeenCalled();
	});

	it("refuses to disable when multiple active sessions are already waiting", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const warningSpy = vi
			.spyOn(vscode.window, "showWarningMessage")
			.mockResolvedValue(undefined as any);

		const p = createMockP();
		const activeSession = p._sessionManager.getActiveSession();
		activeSession.waitingOnUser = true;
		activeSession.pendingToolCallId = "tc_1";
		const secondWaitingSession = {
			...activeSession,
			id: "2",
			title: "Agent 2",
			pendingToolCallId: "tc_2",
		};
		p._sessionManager.getActiveSessions = () => [
			activeSession,
			secondWaitingSession,
		];

		await handleUpdateAgentOrchestrationSetting(p, false);

		expect(p._agentOrchestrationEnabled).toBe(true);
		expect(config.update).not.toHaveBeenCalled();
		expect(p._getSingleSession).not.toHaveBeenCalled();
		expect(warningSpy).toHaveBeenCalledWith(
			AGENT_ORCHESTRATION_MULTI_WAITING_WARNING,
		);
		expect(p._updateSessionsUI).toHaveBeenCalledTimes(1);
	});

	it("stops waiting sessions and then disables orchestration", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const broadcast = vi.fn();

		const p = createMockP({
			_remoteServer: { broadcast },
		});
		const activeSession = p._sessionManager.getActiveSession();
		activeSession.waitingOnUser = true;
		activeSession.pendingToolCallId = "tc_1";
		activeSession.sessionStartTime = 123;
		activeSession.aiTurnActive = false;
		activeSession.unread = true;
		activeSession.sessionTerminated = false;
		const secondWaitingSession = {
			...activeSession,
			id: "2",
			title: "Agent 2",
			pendingToolCallId: "tc_2",
			sessionFrozenElapsed: null,
		};
		p._sessionManager.getActiveSessions = () => [
			activeSession,
			secondWaitingSession,
		];

		await handleStopSessionsAndDisableAgentOrchestration(p);

		expect(p.cancelPendingToolCall).toHaveBeenCalledWith(
			"[Session stopped before disabling Agent Orchestration]",
			"1",
		);
		expect(p.cancelPendingToolCall).toHaveBeenCalledWith(
			"[Session stopped before disabling Agent Orchestration]",
			"2",
		);
		expect(activeSession.sessionTerminated).toBe(true);
		expect(secondWaitingSession.sessionTerminated).toBe(true);
		expect(config.update).toHaveBeenCalledWith(
			"agentOrchestration",
			false,
			vscode.ConfigurationTarget.Workspace,
		);
		expect(p._agentOrchestrationEnabled).toBe(false);
		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(
			"settingsChanged",
			expect.objectContaining({ agentOrchestrationEnabled: false }),
		);
	});
});

describe("handleUpdateAutoAppendSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates autoAppendEnabled setting when text is present", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _autoAppendText: "Always use tools" });
		await handleUpdateAutoAppendSetting(p, true);
		expect(p._autoAppendEnabled).toBe(true);
		expect(config.update).not.toHaveBeenCalled();
	});

	it("forces autoAppendEnabled=false when text is empty", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateAutoAppendSetting(p, true);
		expect(p._autoAppendEnabled).toBe(false);
	});
});

describe("handleUpdateAutoAppendText", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates autoAppendText setting", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateAutoAppendText(p, "Always call askUser at the end.");
		expect(p._autoAppendText).toBe("Always call askUser at the end.");
		expect(config.update).not.toHaveBeenCalled();
	});

	it("normalizes empty text to blank", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateAutoAppendText(p, "   ");
		expect(p._autoAppendText).toBe("");
	});
});

describe("handleUpdateAutopilotSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates autopilot and resets consecutive counter", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _consecutiveAutoResponses: 5 });
		await handleUpdateAutopilotSetting(p, true);
		expect(p._autopilotEnabled).toBe(true);
		expect(p._consecutiveAutoResponses).toBe(0);
	});
});

describe("handleUpdateAutopilotText", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("normalizes and saves autopilot text", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateAutopilotText(p, "New text");
		expect(p._autopilotText).toBe("New text");
		expect(config.update).not.toHaveBeenCalled();
	});
});

describe("handleUpdateSendWithCtrlEnterSetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates sendWithCtrlEnter setting", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateSendWithCtrlEnterSetting(p, true);
		expect(p._sendWithCtrlEnter).toBe(true);
		expect(config.update).toHaveBeenCalledWith(
			"sendWithCtrlEnter",
			true,
			vscode.ConfigurationTarget.Global,
		);
	});
});

describe("handleUpdateHumanDelaySetting", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates humanLikeDelay setting", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateHumanDelaySetting(p, false);
		expect(p._humanLikeDelayEnabled).toBe(false);
	});
});

// ─── Human delay min/max with cross-field adjustment ────────

describe("handleUpdateHumanDelayMin", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates min delay within valid range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _humanLikeDelayMax: 10 });
		await handleUpdateHumanDelayMin(p, 3);
		expect(p._humanLikeDelayMin).toBe(3);
	});

	it("adjusts max when min exceeds max", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _humanLikeDelayMax: 5 });
		await handleUpdateHumanDelayMin(p, 8);
		expect(p._humanLikeDelayMin).toBe(8);
		expect(p._humanLikeDelayMax).toBe(8);
		// Should have written both min and max
		expect(config.update).toHaveBeenCalledTimes(2);
	});

	it("ignores values below range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const originalMin = p._humanLikeDelayMin;
		await handleUpdateHumanDelayMin(p, HUMAN_DELAY_MIN_LOWER - 1);
		expect(p._humanLikeDelayMin).toBe(originalMin);
	});

	it("ignores values above range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const originalMin = p._humanLikeDelayMin;
		await handleUpdateHumanDelayMin(p, HUMAN_DELAY_MIN_UPPER + 1);
		expect(p._humanLikeDelayMin).toBe(originalMin);
	});
});

describe("handleUpdateHumanDelayMax", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates max delay within valid range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _humanLikeDelayMin: 1 });
		await handleUpdateHumanDelayMax(p, 15);
		expect(p._humanLikeDelayMax).toBe(15);
	});

	it("adjusts min when max drops below min", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _humanLikeDelayMin: 10 });
		await handleUpdateHumanDelayMax(p, 5);
		expect(p._humanLikeDelayMax).toBe(5);
		expect(p._humanLikeDelayMin).toBe(5);
		expect(config.update).toHaveBeenCalledTimes(2);
	});

	it("ignores values below range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const originalMax = p._humanLikeDelayMax;
		await handleUpdateHumanDelayMax(p, HUMAN_DELAY_MAX_LOWER - 1);
		expect(p._humanLikeDelayMax).toBe(originalMax);
	});

	it("ignores values above range", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const originalMax = p._humanLikeDelayMax;
		await handleUpdateHumanDelayMax(p, HUMAN_DELAY_MAX_UPPER + 1);
		expect(p._humanLikeDelayMax).toBe(originalMax);
	});
});

// ─── Session warning hours ──────────────────────────────────

describe("handleUpdateSessionWarningHours", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("clamps value to max", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateSessionWarningHours(p, 999);
		expect(p._sessionWarningHours).toBe(SESSION_WARNING_HOURS_MAX);
	});

	it("clamps value to min", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateSessionWarningHours(p, 0);
		expect(p._sessionWarningHours).toBe(SESSION_WARNING_HOURS_MIN);
	});

	it("floors fractional values", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateSessionWarningHours(p, 3.7);
		expect(p._sessionWarningHours).toBe(3);
	});

	it("rejects non-finite values", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const original = p._sessionWarningHours;
		await handleUpdateSessionWarningHours(p, NaN);
		expect(p._sessionWarningHours).toBe(original);
	});
});

// ─── Max consecutive auto responses ─────────────────────────

describe("handleUpdateMaxConsecutiveAutoResponses", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("clamps to limit", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateMaxConsecutiveAutoResponses(p, 9999);
		expect(config.update).toHaveBeenCalledWith(
			"maxConsecutiveAutoResponses",
			MAX_CONSECUTIVE_AUTO_RESPONSES_LIMIT,
			vscode.ConfigurationTarget.Workspace,
		);
	});

	it("clamps to minimum of 1", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateMaxConsecutiveAutoResponses(p, 0);
		expect(config.update).toHaveBeenCalledWith(
			"maxConsecutiveAutoResponses",
			1,
			vscode.ConfigurationTarget.Workspace,
		);
	});

	it("rejects non-finite values", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateMaxConsecutiveAutoResponses(p, Infinity);
		expect(config.update).not.toHaveBeenCalled();
	});
});

describe("handleUpdateRemoteMaxDevices", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("updates with provided value", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateRemoteMaxDevices(p, 6);
		expect(config.update).toHaveBeenCalledWith(
			"remoteMaxDevices",
			6,
			vscode.ConfigurationTarget.Global,
		);
	});

	it("clamps to minimum", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateRemoteMaxDevices(p, 0);
		expect(config.update).toHaveBeenCalledWith(
			"remoteMaxDevices",
			MIN_REMOTE_MAX_DEVICES,
			vscode.ConfigurationTarget.Global,
		);
	});

	it("rejects non-finite values", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateRemoteMaxDevices(p, Number.NaN);
		expect(config.update).not.toHaveBeenCalled();
	});

	it("defaults payload value when config is invalid", () => {
		const config = createMockConfig({
			responseTimeout: "30",
			maxConsecutiveAutoResponses: 5,
			remoteMaxDevices: Number.NaN,
		});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		const payload = buildSettingsPayload(p);
		expect(payload.remoteMaxDevices).toBe(DEFAULT_REMOTE_MAX_DEVICES);
	});
});

// ─── Response timeout ───────────────────────────────────────

describe("handleUpdateResponseTimeout", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("normalizes and saves as string", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleUpdateResponseTimeout(p, 30);
		expect(config.update).toHaveBeenCalledWith(
			"responseTimeout",
			"30",
			vscode.ConfigurationTarget.Workspace,
		);
	});
});

// ─── Autopilot prompts management ───────────────────────────

describe("handleAddAutopilotPrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("adds non-empty prompt", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleAddAutopilotPrompt(p, "New prompt");
		expect(p._autopilotPrompts).toContain("New prompt");
		expect(p._view.webview.postMessage).toHaveBeenCalled();
	});

	it("ignores empty prompt", async () => {
		const p = createMockP();
		await handleAddAutopilotPrompt(p, "   ");
		expect(p._autopilotPrompts).toHaveLength(0);
	});
});

describe("handleEditAutopilotPrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("edits prompt at valid index", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({ _autopilotPrompts: ["old"] });
		await handleEditAutopilotPrompt(p, 0, "new");
		expect(p._autopilotPrompts[0]).toBe("new");
	});

	it("rejects invalid index", async () => {
		const p = createMockP({ _autopilotPrompts: ["old"] });
		await handleEditAutopilotPrompt(p, 5, "new");
		expect(p._autopilotPrompts[0]).toBe("old");
	});

	it("rejects negative index", async () => {
		const p = createMockP({ _autopilotPrompts: ["old"] });
		await handleEditAutopilotPrompt(p, -1, "new");
		expect(p._autopilotPrompts[0]).toBe("old");
	});

	it("rejects empty prompt", async () => {
		const p = createMockP({ _autopilotPrompts: ["old"] });
		await handleEditAutopilotPrompt(p, 0, "  ");
		expect(p._autopilotPrompts[0]).toBe("old");
	});
});

describe("handleRemoveAutopilotPrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("removes prompt and adjusts index when before current", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c"],
			_autopilotIndex: 2,
		});
		await handleRemoveAutopilotPrompt(p, 0);
		expect(p._autopilotPrompts).toEqual(["b", "c"]);
		expect(p._autopilotIndex).toBe(1); // decremented
	});

	it("clamps index when removing at/after current", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b"],
			_autopilotIndex: 1,
		});
		await handleRemoveAutopilotPrompt(p, 1);
		expect(p._autopilotPrompts).toEqual(["a"]);
		expect(p._autopilotIndex).toBe(0); // clamped
	});

	it("rejects invalid index", async () => {
		const p = createMockP({ _autopilotPrompts: ["a"] });
		await handleRemoveAutopilotPrompt(p, -1);
		expect(p._autopilotPrompts).toHaveLength(1);
	});

	it("rejects out-of-bounds index", async () => {
		const p = createMockP({ _autopilotPrompts: ["a"] });
		await handleRemoveAutopilotPrompt(p, 5);
		expect(p._autopilotPrompts).toHaveLength(1);
	});

	it("keeps index unchanged when removing after current index", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c"],
			_autopilotIndex: 0,
		});
		await handleRemoveAutopilotPrompt(p, 2);
		expect(p._autopilotPrompts).toEqual(["a", "b"]);
		expect(p._autopilotIndex).toBe(0); // unchanged
	});
});

// ─── Autopilot prompt reordering with index tracking ────────

describe("handleReorderAutopilotPrompts", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("reorders prompts and tracks moved index", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c"],
			_autopilotIndex: 0,
		});
		await handleReorderAutopilotPrompts(p, 0, 2);
		expect(p._autopilotPrompts).toEqual(["b", "c", "a"]);
		expect(p._autopilotIndex).toBe(2); // moved with the item
	});

	it("adjusts index when item moves past current", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c"],
			_autopilotIndex: 1,
		});
		// Move item from before index (0) to after index (2)
		await handleReorderAutopilotPrompts(p, 0, 2);
		expect(p._autopilotIndex).toBe(0); // decremented
	});

	it("adjusts index when item moves before current", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c"],
			_autopilotIndex: 1,
		});
		// Move item from after index (2) to at/before index (0)
		await handleReorderAutopilotPrompts(p, 2, 0);
		expect(p._autopilotIndex).toBe(2); // incremented
	});

	it("rejects same from/to index", async () => {
		const p = createMockP({ _autopilotPrompts: ["a", "b"] });
		await handleReorderAutopilotPrompts(p, 0, 0);
		// no change
		expect(p._autopilotPrompts).toEqual(["a", "b"]);
	});

	it("rejects out-of-bounds indices", async () => {
		const p = createMockP({ _autopilotPrompts: ["a", "b"] });
		await handleReorderAutopilotPrompts(p, -1, 0);
		expect(p._autopilotPrompts).toEqual(["a", "b"]);
	});

	it("does not adjust index when move does not cross it", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_autopilotPrompts: ["a", "b", "c", "d"],
			_autopilotIndex: 0,
		});
		// Move within range that doesn't include index 0
		await handleReorderAutopilotPrompts(p, 2, 3);
		expect(p._autopilotIndex).toBe(0); // unchanged
	});
});

// ─── Reusable prompts ───────────────────────────────────────

describe("handleAddReusablePrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("adds a new reusable prompt", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleAddReusablePrompt(p, "Fix Bug", "Fix the bug in the code");
		expect(p._reusablePrompts).toHaveLength(1);
		expect(p._reusablePrompts[0].name).toBe("fix-bug");
		expect(p._reusablePrompts[0].prompt).toBe("Fix the bug in the code");
	});

	it("normalizes name to lowercase with hyphens", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP();
		await handleAddReusablePrompt(p, "  Run  Tests  ", "test");
		expect(p._reusablePrompts[0].name).toBe("run-tests");
	});

	it("rejects empty name", async () => {
		const p = createMockP();
		await handleAddReusablePrompt(p, "", "prompt");
		expect(p._reusablePrompts).toHaveLength(0);
	});

	it("rejects empty prompt", async () => {
		const p = createMockP();
		await handleAddReusablePrompt(p, "name", "");
		expect(p._reusablePrompts).toHaveLength(0);
	});

	it("rejects duplicate names", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);

		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Fix it" }],
		});
		await handleAddReusablePrompt(p, "Fix", "Another fix");
		expect(p._reusablePrompts).toHaveLength(1);
		expect(vscode.window.showWarningMessage).toHaveBeenCalled();
	});
});

describe("handleEditReusablePrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("edits an existing prompt", async () => {
		const config = createMockConfig({});
		config.inspect.mockReturnValue({ defaultValue: "Continue" });
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Old" }],
		});
		await handleEditReusablePrompt(p, "rp_1", "fix", "New prompt");
		expect(p._reusablePrompts[0].prompt).toBe("New prompt");
	});

	it("rejects duplicate name when renaming", async () => {
		vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);

		const p = createMockP({
			_reusablePrompts: [
				{ id: "rp_1", name: "fix", prompt: "Fix" },
				{ id: "rp_2", name: "test", prompt: "Test" },
			],
		});
		await handleEditReusablePrompt(p, "rp_1", "test", "New prompt");
		// Should not have changed
		expect(p._reusablePrompts[0].name).toBe("fix");
		expect(vscode.window.showWarningMessage).toHaveBeenCalled();
	});

	it("does nothing for non-existent ID", async () => {
		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Fix" }],
		});
		await handleEditReusablePrompt(p, "rp_999", "fix", "New");
		expect(p._reusablePrompts[0].prompt).toBe("Fix");
	});

	it("rejects empty name in edit", async () => {
		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Fix" }],
		});
		await handleEditReusablePrompt(p, "rp_1", "", "New prompt");
		expect(p._reusablePrompts[0].prompt).toBe("Fix");
	});

	it("rejects empty prompt in edit", async () => {
		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Fix" }],
		});
		await handleEditReusablePrompt(p, "rp_1", "fix", "  ");
		expect(p._reusablePrompts[0].prompt).toBe("Fix");
	});
});

describe("handleRemoveReusablePrompt", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("removes a reusable prompt by ID", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_reusablePrompts: [
				{ id: "rp_1", name: "fix", prompt: "Fix" },
				{ id: "rp_2", name: "test", prompt: "Test" },
			],
		});
		await handleRemoveReusablePrompt(p, "rp_1");
		expect(p._reusablePrompts).toHaveLength(1);
		expect(p._reusablePrompts[0].id).toBe("rp_2");
	});
});

// ─── Slash command search ───────────────────────────────────

describe("handleSearchSlashCommands", () => {
	it("returns matching prompts by name", () => {
		const p = createMockP({
			_reusablePrompts: [
				{ id: "rp_1", name: "fix-bug", prompt: "Fix the bug" },
				{ id: "rp_2", name: "write-test", prompt: "Write tests" },
				{ id: "rp_3", name: "refactor", prompt: "Refactor code" },
			],
		});
		handleSearchSlashCommands(p, "fix");
		expect(p._view.webview.postMessage).toHaveBeenCalledWith({
			type: "slashCommandResults",
			prompts: [{ id: "rp_1", name: "fix-bug", prompt: "Fix the bug" }],
		});
	});

	it("returns matching prompts by prompt content", () => {
		const p = createMockP({
			_reusablePrompts: [
				{ id: "rp_1", name: "fix-bug", prompt: "Fix the bug" },
				{ id: "rp_2", name: "write-test", prompt: "Write tests" },
			],
		});
		handleSearchSlashCommands(p, "tests");
		expect(p._view.webview.postMessage).toHaveBeenCalledWith({
			type: "slashCommandResults",
			prompts: [{ id: "rp_2", name: "write-test", prompt: "Write tests" }],
		});
	});

	it("is case-insensitive", () => {
		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "Fix-Bug", prompt: "FIX" }],
		});
		handleSearchSlashCommands(p, "fix");
		const call = p._view.webview.postMessage.mock.calls[0][0];
		expect(call.prompts).toHaveLength(1);
	});
});

// ─── saveReusablePrompts ────────────────────────────────────

describe("saveReusablePrompts", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("saves prompts without IDs", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const p = createMockP({
			_reusablePrompts: [{ id: "rp_1", name: "fix", prompt: "Fix it" }],
		});
		await saveReusablePrompts(p);
		expect(config.update).toHaveBeenCalledWith(
			"reusablePrompts",
			[{ name: "fix", prompt: "Fix it" }],
			vscode.ConfigurationTarget.Global,
		);
	});
});

// ─── saveAutopilotPrompts ───────────────────────────────────

describe("saveAutopilotPrompts", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("saves autopilot prompts array", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session: Record<string, unknown> = { id: "s1" };
		const p = createMockP({
			_autopilotPrompts: ["a", "b"],
			_sessionManager: { getActiveSession: () => session },
		});
		await saveAutopilotPrompts(p);
		expect(config.update).not.toHaveBeenCalled();
		expect(session.autopilotPrompts).toEqual(["a", "b"]);
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});
});

// ─── withConfigGuard error handling ─────────────────────────

describe("config guard error handling", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("catches and logs config update errors", async () => {
		const config = createMockConfig({});
		config.update.mockRejectedValue(new Error("config write failed"));
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const p = createMockP();
		await handleUpdateSoundSetting(p, false);
		// Should not throw, and should have logged error
		expect(errorSpy).toHaveBeenCalledWith(
			"[TaskSync] Config update failed:",
			expect.any(Error),
		);
		// _isUpdatingConfig should be reset (finally block)
		expect(p._isUpdatingConfig).toBe(false);
	});
});

describe("per-session settings sync", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("handleUpdateAutoAppendSetting saves to active session", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: false,
			autopilotText: "",
			autopilotPrompts: [] as string[],
			autoAppendEnabled: false,
			autoAppendText: "some instructions",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(true);
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});

	it("handleUpdateAutoAppendText saves to active session", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: false,
			autopilotText: "",
			autopilotPrompts: [] as string[],
			autoAppendEnabled: false,
			autoAppendText: "",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendText(p, "Custom text");
		expect(session.autoAppendText).toBe("Custom text");
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});

	it("handleUpdateAutopilotText saves to active session", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: false,
			autopilotText: "",
			autopilotPrompts: [] as string[],
			autoAppendEnabled: false,
			autoAppendText: "",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutopilotText(p, "Do the thing");
		expect(session.autopilotText).toBe("Do the thing");
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});

	it("handleAddAutopilotPrompt saves prompts to active session", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: false,
			autopilotText: "",
			autopilotPrompts: [] as string[],
			autoAppendEnabled: false,
			autoAppendText: "",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		await handleAddAutopilotPrompt(p, "new prompt");
		expect(session.autopilotPrompts).toEqual(["new prompt"]);
		expect(p._saveSessionsToDisk).toHaveBeenCalled();
	});

	it("loadSettings restores per-session autopilotText from active session", () => {
		const config = createMockConfig({
			autopilotText: "Config text",
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: true,
			autopilotText: "Session text",
			autopilotPrompts: ["Prompt A", "Prompt B"],
			autoAppendEnabled: true,
			autoAppendText: "Session auto-append",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		loadSettings(p);
		expect(p._autopilotText).toBe("Session text");
		expect(p._autopilotPrompts).toEqual(["Prompt A", "Prompt B"]);
		expect(p._autoAppendEnabled).toBe(true);
		expect(p._autoAppendText).toBe("Session auto-append");
	});

	it("loadSettings uses TaskSync defaults when session fields are empty", () => {
		const config = createMockConfig({
			autopilotText: "Config text",
			autoAppendEnabled: true,
			autoAppendText: "Config auto-append",
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session = {
			id: "s1",
			autopilotEnabled: false,
			autopilotText: "",
			autopilotPrompts: [],
			autoAppendEnabled: undefined,
			autoAppendText: "",
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		loadSettings(p);
		expect(p._autopilotText).toBe("Continue");
		expect(p._autoAppendEnabled).toBe(false);
		expect(p._autoAppendText).toBe("");
	});

	it("loadSettings uses TaskSync defaults when session fields are undefined", () => {
		const config = createMockConfig({
			autopilotText: "Config text",
			autoAppendEnabled: true,
			autoAppendText: "Config auto-append",
			autopilotPrompts: ["Config prompt"],
		});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		// Old session without per-session fields — all undefined
		const session = {
			id: "s1",
			autopilotEnabled: false,
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_sessionManager: { getActiveSession: () => session },
		});
		loadSettings(p);
		expect(p._autopilotText).toBe("Continue");
		expect(p._autopilotPrompts).toEqual([]);
		expect(p._autoAppendEnabled).toBe(false);
		expect(p._autoAppendText).toBe("");
	});

	it("auto append updates only the active session fields it owns", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		// Start with old session — no per-session fields
		const session: Record<string, unknown> = {
			id: "s1",
			autopilotEnabled: false,
			consecutiveAutoResponses: 0,
		};
		const p = createMockP({
			_autopilotText: "Custom text",
			_autopilotPrompts: ["A", "B"],
			_autoAppendEnabled: true,
			_autoAppendText: "Custom append",
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(true);
		// Text is seeded from provider mirror when session has none
		expect(session.autoAppendText).toBe("Custom append");
		// Unrelated session fields are not touched
		expect(session.autopilotText).toBeUndefined();
		expect(session.autopilotPrompts).toBeUndefined();
	});
});

// ─── FND-002 regression: cross-session auto-append isolation ─────────

describe("FND-002 regression: auto-append session isolation", () => {
	it("session-aware helper must not read provider mirror text", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Active session text",
		});
		const bgSession = { autoAppendEnabled: true, autoAppendText: undefined };
		// Must NOT append "Active session text" from the provider mirror
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("legacy undefined fields produce no append", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Active text",
		});
		const bgSession = {
			autoAppendEnabled: undefined,
			autoAppendText: undefined,
		};
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("enabling auto-append persists session text from mirror", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session: Record<string, unknown> = {
			id: "s1",
			autoAppendEnabled: false,
		};
		const p = createMockP({
			_autoAppendText: "Persisted instructions",
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(true);
		expect(session.autoAppendText).toBe("Persisted instructions");
	});

	it("invalid enabled-without-text state is normalized to disabled", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Should not appear",
		});
		const bgSession = { autoAppendEnabled: true, autoAppendText: undefined };
		// enabled=true but no text → must not append anything
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("session with own text appends correctly", () => {
		const p = createMockP({
			_autoAppendEnabled: false,
			_autoAppendText: "Wrong text",
		});
		const bgSession = {
			autoAppendEnabled: true,
			autoAppendText: "Correct session text",
		};
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe(
			"Answer\n\nCorrect session text",
		);
	});

	it("enabling auto-append with no mirror text stays disabled", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session: Record<string, unknown> = {
			id: "s1",
			autoAppendEnabled: false,
		};
		const p = createMockP({
			_autoAppendText: "",
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
		expect(session.autopilotText).toBeUndefined();
		expect(session.autopilotPrompts).toBeUndefined();
	});
});

// ─── FND-002 regression: cross-session auto-append isolation ─────────

describe("FND-002 regression: auto-append session isolation", () => {
	it("session-aware helper must not read provider mirror text", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Active session text",
		});
		const bgSession = { autoAppendEnabled: true, autoAppendText: undefined };
		// Must NOT append "Active session text" from the provider mirror
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("legacy undefined fields produce no append", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Active text",
		});
		const bgSession = {
			autoAppendEnabled: undefined,
			autoAppendText: undefined,
		};
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("enabling auto-append persists session text from mirror", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session: Record<string, unknown> = {
			id: "s1",
			autoAppendEnabled: false,
		};
		const p = createMockP({
			_autoAppendText: "Persisted instructions",
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(true);
		expect(session.autoAppendText).toBe("Persisted instructions");
	});

	it("invalid enabled-without-text state is normalized to disabled", () => {
		const p = createMockP({
			_autoAppendEnabled: true,
			_autoAppendText: "Should not appear",
		});
		const bgSession = { autoAppendEnabled: true, autoAppendText: undefined };
		// enabled=true but no text → must not append anything
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe("Answer");
	});

	it("session with own text appends correctly", () => {
		const p = createMockP({
			_autoAppendEnabled: false,
			_autoAppendText: "Wrong text",
		});
		const bgSession = {
			autoAppendEnabled: true,
			autoAppendText: "Correct session text",
		};
		expect(applyAutoAppendToResponse(p, "Answer", bgSession)).toBe(
			"Answer\n\nCorrect session text",
		);
	});

	it("enabling auto-append with no mirror text stays disabled", async () => {
		const config = createMockConfig({});
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(
			config as any,
		);

		const session: Record<string, unknown> = {
			id: "s1",
			autoAppendEnabled: false,
		};
		const p = createMockP({
			_autoAppendText: "",
			_sessionManager: { getActiveSession: () => session },
		});
		await handleUpdateAutoAppendSetting(p, true);
		expect(session.autoAppendEnabled).toBe(false);
		expect(p._autoAppendEnabled).toBe(false);
	});
});
