import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createClassListStub() {
	return {
		add: vi.fn(),
		remove: vi.fn(),
	};
}

function loadHistoryHarness(options?: {
	isRemoteMode?: boolean;
	currentSessionCalls?: Array<unknown>;
	persistedHistory?: Array<unknown>;
}) {
	const source = readFileSync(join(__dirname, "history.js"), "utf8");
	const historyModalOverlay = { classList: createClassListStub() };
	const vscode = { postMessage: vi.fn() };
	const renderHistoryModal = vi.fn();
	const focusDialogSurface = vi.fn();
	const restoreDialogFocus = vi.fn();

	const factory = new Function(
		"historyModalOverlay",
		"isRemoteMode",
		"currentSessionCalls",
		"persistedHistory",
		"renderHistoryModal",
		"vscode",
		"focusDialogSurface",
		"restoreDialogFocus",
		source +
			"\nreturn { openHistoryModal, closeHistoryModal, getPersistedHistory: function () { return persistedHistory; } };",
	);

	const harness = factory(
		historyModalOverlay,
		options?.isRemoteMode ?? false,
		options?.currentSessionCalls ?? [],
		options?.persistedHistory ?? [],
		renderHistoryModal,
		vscode,
		focusDialogSurface,
		restoreDialogFocus,
	);

	return {
		harness,
		historyModalOverlay,
		vscode,
		renderHistoryModal,
		focusDialogSurface,
		restoreDialogFocus,
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("openHistoryModal", () => {
	it("opens the modal and focuses the dialog container instead of the close button", () => {
		const { harness, historyModalOverlay, focusDialogSurface, vscode } =
			loadHistoryHarness();

		harness.openHistoryModal();

		expect(historyModalOverlay.classList.remove).toHaveBeenCalledWith("hidden");
		expect(focusDialogSurface).toHaveBeenCalledWith(
			historyModalOverlay,
			"#history-modal",
		);
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openHistoryModal",
		});
	});

	it("renders remote history locally before opening when running in remote mode", () => {
		const calls = [{ id: "1" }, { id: "2" }];
		const { harness, renderHistoryModal, vscode } = loadHistoryHarness({
			isRemoteMode: true,
			currentSessionCalls: calls,
		});

		harness.openHistoryModal();

		expect(renderHistoryModal).toHaveBeenCalledTimes(1);
		expect(vscode.postMessage).not.toHaveBeenCalled();
		expect(harness.getPersistedHistory()).toEqual(calls.slice().reverse());
	});
});

describe("closeHistoryModal", () => {
	it("hides the modal and restores focus", () => {
		const { harness, historyModalOverlay, restoreDialogFocus } =
			loadHistoryHarness();

		harness.closeHistoryModal();

		expect(historyModalOverlay.classList.add).toHaveBeenCalledWith("hidden");
		expect(restoreDialogFocus).toHaveBeenCalledWith(historyModalOverlay);
	});
});
