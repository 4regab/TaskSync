import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

function loadAdapterHarness() {
	const source = readFileSync(join(__dirname, "adapter.js"), "utf8");
	const factory = new Function(
		"acquireVsCodeApi",
		"localStorage",
		"sessionStorage",
		"SESSION_KEYS",
		"WebSocket",
		"window",
		"document",
		"console",
		"setTimeout",
		"clearTimeout",
		"setInterval",
		"clearInterval",
		"renderCurrentSession",
		"hideApprovalModal",
		"hideChoicesBar",
		"updateWelcomeSectionVisibility",
		"updateRemoteSessionTimerState",
		"showAutocomplete",
		"showSlashDropdown",
		"applyChangesState",
		"applyChangeDiff",
		"refreshChangesState",
		"alert",
		"TASKSYNC_PROTOCOL_VERSION",
		"pendingToolCall",
		"pendingMessage",
		"chatStreamArea",
		"currentSessionCalls",
		"lastPendingContentHtml",
		"isProcessingResponse",
		"changesPanelVisible",
		"changesError",
		"queueVersion",
		"promptQueue",
		"updateQueueVisibility",
		"updateCardSelection",
		"remoteSessionTimerInterval",
		`${source}\nreturn {\n\tclearRemoteSessionState,\n\tflushQueuedOutboundMessages,\n\tsetPendingCriticalMessage: (value) => (pendingCriticalMessage = value),\n\tgetPendingCriticalMessage: () => pendingCriticalMessage,\n\tsetPendingToolCall: (value) => (pendingToolCall = value),\n\tsetWs: (value) => (ws = value),\n};`,
	);

	const classList = { add: vi.fn(), remove: vi.fn() };
	const pendingMessage = { classList, innerHTML: "" };
	const chatStreamArea = { innerHTML: "content", classList };
	const updateRemoteSessionTimerState = vi.fn();
	const renderCurrentSession = vi.fn();
	const hideApprovalModal = vi.fn();
	const hideChoicesBar = vi.fn();
	const updateWelcomeSectionVisibility = vi.fn();
	const acquireVsCodeApi = vi.fn(() => ({ postMessage: vi.fn() }));
	const noop = vi.fn();
	const sessionStorageMock = {
		getItem: vi.fn(),
		removeItem: vi.fn(),
		setItem: vi.fn(),
	};
	const windowMock = { addEventListener: vi.fn(), location: { href: "" } };
	const documentMock = { body: { classList }, getElementById: vi.fn() };
	const outboundHandlers = Array.from({ length: 6 }, () => noop);
	const uiHelpers = [noop, noop];
	const harness = factory(
		acquireVsCodeApi,
		{ getItem: vi.fn() },
		sessionStorageMock,
		{ STATE: "state", CONNECTED: "connected" },
		{ OPEN: 1 },
		windowMock,
		documentMock,
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		renderCurrentSession,
		hideApprovalModal,
		hideChoicesBar,
		updateWelcomeSectionVisibility,
		updateRemoteSessionTimerState,
		...outboundHandlers,
		"test-protocol",
		null,
		pendingMessage,
		chatStreamArea,
		[],
		"",
		false,
		false,
		"",
		0,
		[],
		...uiHelpers,
		null,
	);

	return {
		harness,
		pendingMessage,
		updateRemoteSessionTimerState,
		renderCurrentSession,
	};
}

describe("clearRemoteSessionState", () => {
	it("drops any buffered remote reply when the session is reset", () => {
		const { harness, updateRemoteSessionTimerState } = loadAdapterHarness();
		const send = vi.fn();

		harness.setWs({ readyState: 1, send });
		harness.setPendingToolCall({ id: "tc_1" });
		harness.setPendingCriticalMessage({
			type: "respond",
			id: "tc_1",
			value: "stale",
		});

		harness.clearRemoteSessionState();
		harness.flushQueuedOutboundMessages();

		expect(harness.getPendingCriticalMessage()).toBeNull();
		expect(updateRemoteSessionTimerState).toHaveBeenCalledWith(null, null);
		expect(send).not.toHaveBeenCalled();
	});
});
