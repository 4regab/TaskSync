import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createOverlay(hidden = false) {
	return {
		__tasksyncReturnFocus: null as unknown,
		classList: {
			contains: vi.fn((className: string) => {
				if (className !== "hidden") {
					return false;
				}
				return hidden;
			}),
		},
		contains: vi.fn(() => false),
		querySelector: vi.fn(() => null),
		focus: vi.fn(),
	};
}

function loadEventsHarness(overrides?: {
	document?: {
		activeElement: unknown;
		body: unknown;
		contains: (value: unknown) => boolean;
	};
	newSessionModalOverlay?: {
		classList: { contains: (className: string) => boolean };
	} | null;
	settingsModalOverlay?: {
		classList: { contains: (className: string) => boolean };
	} | null;
}) {
	const source = readFileSync(join(__dirname, "events.js"), "utf8");
	const closeHistoryModal = vi.fn();
	const closeSettingsModal = vi.fn();
	const closeSessionSettingsModal = vi.fn();
	const closeSessionActionModal = vi.fn();
	const cancelTimeoutWarning = vi.fn();
	const closeSimpleAlert = vi.fn();
	const toggleChangesPanel = vi.fn();
	const chatInput = { focus: vi.fn() };
	const documentRef = overrides?.document ?? {
		activeElement: null,
		body: null,
		contains: () => false,
	};
	const [
		historyModalOverlay,
		defaultSettingsModalOverlay,
		sessionSettingsOverlay,
		defaultNewSessionModalOverlay,
		resetSessionModalOverlay,
		disableAgentOrchestrationModalOverlay,
		timeoutWarningModalOverlay,
		simpleAlertModalOverlay,
		changesModalOverlay,
	] = Array.from({ length: 9 }, () => createOverlay(true));

	const factory = new Function(
		"document",
		"historyModalOverlay",
		"settingsModalOverlay",
		"sessionSettingsOverlay",
		"newSessionModalOverlay",
		"resetSessionModalOverlay",
		"disableAgentOrchestrationModalOverlay",
		"timeoutWarningModalOverlay",
		"simpleAlertModalOverlay",
		"changesModalOverlay",
		"closeHistoryModal",
		"closeSettingsModal",
		"closeSessionSettingsModal",
		"closeSessionActionModal",
		"cancelTimeoutWarning",
		"closeSimpleAlert",
		"chatInput",
		"toggleChangesPanel",
		source +
			"\nreturn { focusDialogSurface, restoreDialogFocus, handleGlobalDocumentKeydown };",
	);

	const harness = factory(
		documentRef,
		historyModalOverlay,
		overrides?.settingsModalOverlay ?? defaultSettingsModalOverlay,
		sessionSettingsOverlay,
		overrides?.newSessionModalOverlay ?? defaultNewSessionModalOverlay,
		resetSessionModalOverlay,
		disableAgentOrchestrationModalOverlay,
		timeoutWarningModalOverlay,
		simpleAlertModalOverlay,
		changesModalOverlay,
		closeHistoryModal,
		closeSettingsModal,
		closeSessionSettingsModal,
		closeSessionActionModal,
		cancelTimeoutWarning,
		closeSimpleAlert,
		chatInput,
		toggleChangesPanel,
	);

	return {
		harness,
		closeHistoryModal,
		closeSettingsModal,
		closeSessionSettingsModal,
		closeSessionActionModal,
		cancelTimeoutWarning,
		closeSimpleAlert,
		chatInput,
		toggleChangesPanel,
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("handleGlobalDocumentKeydown", () => {
	it("moves focus into the preferred dialog control after the opener click finishes", () => {
		vi.useFakeTimers();
		const activeElement = { focus: vi.fn() };
		const preferredTarget = { focus: vi.fn() };
		const overlay = createOverlay(false);
		overlay.querySelector = vi
			.fn()
			.mockReturnValueOnce(preferredTarget)
			.mockReturnValueOnce(null)
			.mockReturnValueOnce(null);
		const { harness } = loadEventsHarness({
			document: {
				activeElement,
				body: {},
				contains: () => true,
			},
		});

		harness.focusDialogSurface(overlay, "#preferred");

		expect(preferredTarget.focus).not.toHaveBeenCalled();
		vi.runAllTimers();

		expect(overlay.querySelector).toHaveBeenCalledWith("#preferred");
		expect(preferredTarget.focus).toHaveBeenCalledTimes(1);
		expect(overlay.__tasksyncReturnFocus).toBe(activeElement);
	});

	it("restores focus after the dialog closes", () => {
		const previousTarget = { focus: vi.fn() };
		const overlay = createOverlay(false);
		overlay.__tasksyncReturnFocus = previousTarget;
		const { harness } = loadEventsHarness({
			document: {
				activeElement: null,
				body: {},
				contains: (value) => value === previousTarget,
			},
		});

		harness.restoreDialogFocus(overlay);

		expect(previousTarget.focus).toHaveBeenCalledTimes(1);
		expect(overlay.__tasksyncReturnFocus).toBeNull();
	});

	it("falls back to the chat input instead of restoring focus to an opener button", () => {
		const openerButton = {
			focus: vi.fn(),
			tagName: "BUTTON",
			getAttribute: vi.fn(() => null),
			classList: { contains: vi.fn(() => false) },
		};
		const overlay = createOverlay(false);
		overlay.__tasksyncReturnFocus = openerButton;
		const { harness, chatInput } = loadEventsHarness({
			document: {
				activeElement: null,
				body: {},
				contains: (value) => value === openerButton,
			},
		});

		harness.restoreDialogFocus(overlay);

		expect(openerButton.focus).not.toHaveBeenCalled();
		expect(chatInput.focus).toHaveBeenCalledTimes(1);
	});

	it("closes the new session dialog on Escape", () => {
		const newSessionModalOverlay = createOverlay(false);
		const { harness, closeSessionActionModal, closeSettingsModal } =
			loadEventsHarness({
				newSessionModalOverlay,
				settingsModalOverlay: createOverlay(false),
			});
		const event = {
			key: "Escape",
			defaultPrevented: false,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};

		harness.handleGlobalDocumentKeydown(event);

		expect(closeSessionActionModal).toHaveBeenCalledWith(
			newSessionModalOverlay,
		);
		expect(closeSettingsModal).not.toHaveBeenCalled();
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it("does nothing when Escape was already handled elsewhere", () => {
		const { harness, closeSessionActionModal, closeSettingsModal } =
			loadEventsHarness({
				newSessionModalOverlay: createOverlay(false),
				settingsModalOverlay: createOverlay(false),
			});
		const event = {
			key: "Escape",
			defaultPrevented: true,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};

		harness.handleGlobalDocumentKeydown(event);

		expect(closeSessionActionModal).not.toHaveBeenCalled();
		expect(closeSettingsModal).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});
});
