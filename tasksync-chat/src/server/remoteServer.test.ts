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

		expect(provider.startNewSessionAndResetCopilotChat).toHaveBeenCalledWith(
			"Fix the failing tests",
			false,
		);
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
});
