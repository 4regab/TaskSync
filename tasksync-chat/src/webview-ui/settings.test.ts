import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

function loadSettingsHarness(options?: {
	agentOrchestrationEnabled?: boolean;
	splitViewEnabled?: boolean;
	waitingSessions?: Array<unknown>;
}) {
	const source = readFileSync(join(__dirname, "settings.js"), "utf8");
	const vscode = { postMessage: vi.fn() };
	const showSimpleAlert = vi.fn();
	const openStopSessionsAndDisableAgentOrchestrationModal = vi.fn();
	const setToggle = vi.fn();
	const syncClientSessionSelection = vi.fn();
	const renderSessionsList = vi.fn();
	const updateWelcomeSectionVisibility = vi.fn();
	const saveWebviewState = vi.fn();
	const createPromptListUI = vi.fn(() => ({ bindEvents: vi.fn() }));
	const waitingSessions = options?.waitingSessions ?? [];

	const factory = new Function(
		"setToggle",
		"settingsModalOverlay",
		"hideAddPromptForm",
		"soundEnabled",
		"soundToggle",
		"interactiveApprovalEnabled",
		"interactiveApprovalToggle",
		"agentOrchestrationEnabled",
		"agentOrchestrationToggle",
		"autoAppendEnabled",
		"autoAppendToggle",
		"autoAppendTextRow",
		"showSimpleAlert",
		"openStopSessionsAndDisableAgentOrchestrationModal",
		"getWaitingActiveSessions",
		"splitViewEnabled",
		"syncClientSessionSelection",
		"serverActiveSessionId",
		"activeSessionId",
		"renderSessionsList",
		"updateWelcomeSectionVisibility",
		"saveWebviewState",
		"vscode",
		"createPromptListUI",
		source +
			"\nreturn { toggleAgentOrchestrationSetting, stopSessionsAndDisableAgentOrchestration, getAgentOrchestrationEnabled: function () { return agentOrchestrationEnabled; }, getSplitViewEnabled: function () { return splitViewEnabled; } };",
	);

	const harness = factory(
		setToggle,
		null,
		vi.fn(),
		true,
		null,
		true,
		null,
		options?.agentOrchestrationEnabled ?? true,
		{},
		false,
		null,
		null,
		showSimpleAlert,
		openStopSessionsAndDisableAgentOrchestrationModal,
		() => waitingSessions,
		options?.splitViewEnabled ?? true,
		syncClientSessionSelection,
		null,
		null,
		renderSessionsList,
		updateWelcomeSectionVisibility,
		saveWebviewState,
		vscode,
		createPromptListUI,
	);

	return {
		harness,
		showSimpleAlert,
		openStopSessionsAndDisableAgentOrchestrationModal,
		vscode,
		syncClientSessionSelection,
		renderSessionsList,
		updateWelcomeSectionVisibility,
		saveWebviewState,
	};
}

describe("toggleAgentOrchestrationSetting", () => {
	it("shows a blocking modal when multiple sessions are already waiting", () => {
		const {
			harness,
			openStopSessionsAndDisableAgentOrchestrationModal,
			vscode,
			saveWebviewState,
		} = loadSettingsHarness({
			waitingSessions: [{ id: "1" }, { id: "2" }],
		});

		harness.toggleAgentOrchestrationSetting();

		expect(
			openStopSessionsAndDisableAgentOrchestrationModal,
		).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }]);
		expect(vscode.postMessage).not.toHaveBeenCalled();
		expect(saveWebviewState).not.toHaveBeenCalled();
		expect(harness.getAgentOrchestrationEnabled()).toBe(true);
	});

	it("posts the stop-and-disable action when the modal confirm path runs", () => {
		const { harness, vscode } = loadSettingsHarness();

		harness.stopSessionsAndDisableAgentOrchestration();

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "disableAgentOrchestrationAndStopSessions",
		});
	});

	it("disables orchestration when the transition is safe", () => {
		const { harness, vscode, syncClientSessionSelection, saveWebviewState } =
			loadSettingsHarness({
				waitingSessions: [{ id: "1" }],
			});

		harness.toggleAgentOrchestrationSetting();

		expect(syncClientSessionSelection).toHaveBeenCalledTimes(1);
		expect(saveWebviewState).toHaveBeenCalledTimes(1);
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateAgentOrchestrationSetting",
			enabled: false,
		});
		expect(harness.getAgentOrchestrationEnabled()).toBe(false);
		expect(harness.getSplitViewEnabled()).toBe(false);
	});
});
