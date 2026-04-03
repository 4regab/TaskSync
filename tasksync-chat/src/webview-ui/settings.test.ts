import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createClassListStub() {
	return {
		add: vi.fn(),
		remove: vi.fn(),
	};
}

function normalizeSelectorList(selectorText: string) {
	return selectorText
		.split(",")
		.map((selector) => selector.trim())
		.filter(Boolean)
		.sort()
		.join(",");
}

function findCssDeclarations(
	css: string,
	expectedSelectors: string[],
): string | undefined {
	const normalizedExpected = normalizeSelectorList(expectedSelectors.join(","));

	for (const block of css.split("}")) {
		const parts = block.split("{");
		if (parts.length !== 2) continue;

		const selectorText = parts[0]?.trim();
		const declarations = parts[1]?.trim();
		if (!selectorText || !declarations) continue;

		if (normalizeSelectorList(selectorText) === normalizedExpected) {
			return declarations;
		}
	}

	return undefined;
}

function loadSettingsHarness(options?: {
	agentOrchestrationEnabled?: boolean;
	splitViewEnabled?: boolean;
	waitingSessions?: Array<unknown>;
}) {
	const source = readFileSync(join(__dirname, "settings.js"), "utf8");
	const vscode = { postMessage: vi.fn() };
	const settingsModalOverlay = { classList: createClassListStub() };
	const hideAddPromptForm = vi.fn();
	const showSimpleAlert = vi.fn();
	const openStopSessionsAndDisableAgentOrchestrationModal = vi.fn();
	const setToggle = vi.fn();
	const focusDialogSurface = vi.fn();
	const restoreDialogFocus = vi.fn();
	const syncClientSessionSelection = vi.fn();
	const renderSessionsList = vi.fn();
	const updateWelcomeSectionVisibility = vi.fn();
	const saveWebviewState = vi.fn();
	const createPromptListUI = vi.fn(() => ({ bindEvents: vi.fn() }));
	const waitingSessions = options?.waitingSessions ?? [];

	const factory = new Function(
		"setToggle",
		"settingsModalOverlay",
		"focusDialogSurface",
		"restoreDialogFocus",
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
			"\nreturn { openSettingsModal, closeSettingsModal, toggleAgentOrchestrationSetting, stopSessionsAndDisableAgentOrchestration, getAgentOrchestrationEnabled: function () { return agentOrchestrationEnabled; }, getSplitViewEnabled: function () { return splitViewEnabled; } };",
	);

	const harness = factory(
		setToggle,
		settingsModalOverlay,
		focusDialogSurface,
		restoreDialogFocus,
		hideAddPromptForm,
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
		settingsModalOverlay,
		focusDialogSurface,
		restoreDialogFocus,
		hideAddPromptForm,
		showSimpleAlert,
		openStopSessionsAndDisableAgentOrchestrationModal,
		vscode,
		syncClientSessionSelection,
		renderSessionsList,
		updateWelcomeSectionVisibility,
		saveWebviewState,
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("openSettingsModal", () => {
	it("opens the modal locally without triggering a redundant settings refresh round-trip", () => {
		const { harness, settingsModalOverlay, focusDialogSurface, vscode } =
			loadSettingsHarness();

		harness.openSettingsModal();

		expect(settingsModalOverlay.classList.remove).toHaveBeenCalledWith(
			"hidden",
		);
		expect(focusDialogSurface).toHaveBeenCalledWith(
			settingsModalOverlay,
			"#settings-modal",
		);
		expect(vscode.postMessage).not.toHaveBeenCalled();
	});
});

describe("dialog focus visibility", () => {
	it("keeps dialog surfaces visible while overlays stay outline-free", () => {
		const mainCss = readFileSync(
			join(__dirname, "../../media/main.css"),
			"utf8",
		);
		const overlayDeclarations = findCssDeclarations(mainCss, [
			".settings-modal-overlay:focus",
			".settings-modal-overlay:focus-visible",
			".history-modal-overlay:focus",
			".history-modal-overlay:focus-visible",
		]);
		const dialogDeclarations = findCssDeclarations(mainCss, [
			".settings-modal:focus",
			".settings-modal:focus-visible",
			".history-modal:focus",
			".history-modal:focus-visible",
		]);

		expect(overlayDeclarations).toContain("outline: none;");
		expect(dialogDeclarations).toContain("outline: none;");
		expect(dialogDeclarations).toContain("outline: none;");
	});
});

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
