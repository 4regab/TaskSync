import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function extractSessionActionModalSource() {
	const source = readFileSync(join(__dirname, "init.js"), "utf8");
	const start = source.indexOf("function createSessionActionModal(config) {");
	const end = source.indexOf("function createNewSessionModal() {");
	return source.slice(start, end);
}

function createElementStub() {
	return {
		className: "",
		id: "",
		textContent: "",
		innerHTML: "",
		tabIndex: 0,
		children: [] as unknown[],
		classList: {
			add: vi.fn(),
			remove: vi.fn(),
		},
		setAttribute: vi.fn(),
		appendChild(child: unknown) {
			this.children.push(child);
			return child;
		},
		addEventListener: vi.fn(),
	};
}

function loadSessionActionHarness() {
	const source = extractSessionActionModalSource();
	const focusDialogSurface = vi.fn();
	const restoreDialogFocus = vi.fn();
	const body = { appendChild: vi.fn() };
	const documentRef = {
		body,
		createElement: vi.fn(() => createElementStub()),
	};
	const vscode = { postMessage: vi.fn() };

	const factory = new Function(
		"document",
		"vscode",
		"focusDialogSurface",
		"restoreDialogFocus",
		source +
			"\nreturn { createSessionActionModal, openSessionActionModal, closeSessionActionModal };",
	);

	const harness = factory(
		documentRef,
		vscode,
		focusDialogSurface,
		restoreDialogFocus,
	);

	return {
		harness,
		focusDialogSurface,
		restoreDialogFocus,
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("session action modal focus", () => {
	it("stores the preferred selector and focuses it when the modal opens", () => {
		const { harness, focusDialogSurface } = loadSessionActionHarness();
		const overlay = harness.createSessionActionModal({
			overlayId: "new-session-modal-overlay",
			titleId: "new-session-modal-title",
			title: "New Session",
			warningText: "warning",
			initialFocusSelector: "#new-session-prompt",
			confirmLabel: "Continue",
			messageType: "newSession",
		});

		harness.openSessionActionModal(overlay);

		expect(overlay.__taskSyncInitialFocusSelector).toBe("#new-session-prompt");
		expect(overlay.classList.remove).toHaveBeenCalledWith("hidden");
		expect(focusDialogSurface).toHaveBeenCalledWith(
			overlay,
			"#new-session-prompt",
		);
	});

	it("restores focus when the modal closes", () => {
		const { harness, restoreDialogFocus } = loadSessionActionHarness();
		const overlay = harness.createSessionActionModal({
			overlayId: "reset-session-modal-overlay",
			titleId: "reset-session-modal-title",
			title: "Reset Session",
			warningText: "warning",
			confirmLabel: "Reset",
			messageType: "resetSession",
		});

		harness.closeSessionActionModal(overlay);

		expect(overlay.classList.add).toHaveBeenCalledWith("hidden");
		expect(restoreDialogFocus).toHaveBeenCalledWith(overlay);
	});
});
