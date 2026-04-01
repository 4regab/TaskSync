import { describe, expect, it, vi } from "vitest";
import * as vscode from "../__mocks__/vscode";

vi.mock("vscode", async () => await import("../__mocks__/vscode"));

vi.mock("./remoteAuthService", () => ({
	RemoteAuthService: class {
		public authenticatedClients = new Set();
		public pinEnabled = false;
		public onAuthFailure = undefined;

		normalizeIp(ip: string) {
			return ip;
		}

		removeClient(): void {}
		handleAuth(): void {}
	},
}));

vi.mock("./remoteHtmlService", () => ({
	RemoteHtmlService: class {
		async preloadTemplates(): Promise<void> {}
	},
}));

vi.mock("./gitService", () => ({
	GitService: class {
		async initialize(): Promise<void> {}
	},
}));

vi.mock("./remoteGitHandlers", () => ({
	dispatchGitMessage: vi.fn().mockResolvedValue(false),
}));

vi.mock("./remoteSettingsHandler", () => ({
	dispatchSettingsMessage: vi.fn().mockResolvedValue(false),
}));

function createProvider() {
	return {
		startNewSession: vi.fn(),
		startNewSessionAndResetCopilotChat: vi.fn().mockResolvedValue(undefined),
		cancelPendingToolCall: vi.fn().mockReturnValue(true),
		_handleWebviewMessage: vi.fn(),
	} as any;
}

async function createServer(provider = createProvider()) {
	const extensionUri = vscode.Uri.file("/workspace/tasksync-chat") as any;
	const context = { globalState: { get: vi.fn(), update: vi.fn() } } as any;
	const { RemoteServer } = await import("./remoteServer");

	return {
		provider,
		server: new RemoteServer(provider, extensionUri, context),
	};
}

describe("RemoteServer session actions", () => {
	it("routes resetSession to startNewSession without opening a fresh chat", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "resetSession",
		});

		expect(provider.startNewSession).toHaveBeenCalledTimes(1);
		expect(provider.startNewSessionAndResetCopilotChat).not.toHaveBeenCalled();
	});

	it("keeps newSession routed to the fresh-chat path", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "newSession",
		});

		expect(provider.startNewSessionAndResetCopilotChat).toHaveBeenCalledTimes(
			1,
		);
		expect(provider.startNewSession).not.toHaveBeenCalled();
	});

	it("routes startSession through the session-aware fresh-chat path", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "startSession",
			prompt: "Fix the failing tests",
		});

		expect(provider.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			initialPrompt: "Fix the failing tests",
			useQueuedPrompt: false,
		});
		expect(provider.startNewSession).not.toHaveBeenCalled();
	});

	it("routes newSession stopCurrentSession through the fresh-chat path", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "newSession",
			stopCurrentSession: true,
		});

		expect(provider.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith({
			stopCurrentSession: true,
			initialPrompt: undefined,
			useQueuedPrompt: false,
		});
		expect(provider.startNewSession).not.toHaveBeenCalled();
	});

	it("routes chatCancel with sessionId to cancelPendingToolCall", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "chatCancel",
			sessionId: "sess_42",
		});

		expect(provider.cancelPendingToolCall).toHaveBeenCalledWith(
			"[Cancelled by user]",
			"sess_42",
		);
	});

	it("routes chatCancel without sessionId using undefined", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "chatCancel",
		});

		expect(provider.cancelPendingToolCall).toHaveBeenCalledWith(
			"[Cancelled by user]",
			undefined,
		);
	});

	it("routes switchSession to _handleWebviewMessage", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "switchSession",
			sessionId: "sess_1",
		});

		expect(provider._handleWebviewMessage).toHaveBeenCalledWith({
			type: "switchSession",
			sessionId: "sess_1",
		});
	});

	it("rejects switchSession without sessionId", async () => {
		const { server, provider } = await createServer();
		const ws = { send: vi.fn(), readyState: 1 } as any;

		await server["handleMessage"](ws, "127.0.0.1", {
			type: "switchSession",
		});

		expect(provider._handleWebviewMessage).not.toHaveBeenCalled();
		expect(ws.send).toHaveBeenCalled();
		const sent = JSON.parse(ws.send.mock.calls[0][0]);
		expect(sent.code).toBe("INVALID_INPUT");
	});

	it("routes deleteSession to _handleWebviewMessage", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "deleteSession",
			sessionId: "sess_2",
		});

		expect(provider._handleWebviewMessage).toHaveBeenCalledWith({
			type: "deleteSession",
			sessionId: "sess_2",
		});
	});

	it("routes archiveSession to _handleWebviewMessage", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "archiveSession",
			sessionId: "sess_3",
		});

		expect(provider._handleWebviewMessage).toHaveBeenCalledWith({
			type: "archiveSession",
			sessionId: "sess_3",
		});
	});

	it("routes updateSessionTitle to _handleWebviewMessage with trimmed title", async () => {
		const { server, provider } = await createServer();

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "updateSessionTitle",
			sessionId: "sess_4",
			title: "  New Title  ",
		});

		expect(provider._handleWebviewMessage).toHaveBeenCalledWith({
			type: "updateSessionTitle",
			sessionId: "sess_4",
			title: "New Title",
		});
	});

	it("rejects updateSessionTitle with empty title", async () => {
		const { server, provider } = await createServer();
		const ws = { send: vi.fn(), readyState: 1 } as any;

		await server["handleMessage"](ws, "127.0.0.1", {
			type: "updateSessionTitle",
			sessionId: "sess_4",
			title: "   ",
		});

		expect(provider._handleWebviewMessage).not.toHaveBeenCalled();
		expect(ws.send).toHaveBeenCalled();
	});

	it("truncates long session titles to 100 characters", async () => {
		const { server, provider } = await createServer();
		const longTitle = "A".repeat(200);

		await server["handleMessage"]({} as any, "127.0.0.1", {
			type: "updateSessionTitle",
			sessionId: "sess_5",
			title: longTitle,
		});

		const call = provider._handleWebviewMessage.mock.calls[0][0];
		expect(call.title).toHaveLength(100);
	});
});
