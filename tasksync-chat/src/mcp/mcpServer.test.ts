import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerOptions, McpToolCallResult } from "./mcpTypes";

const { mockMcpServer, mockTransport, toolHandlers } = vi.hoisted(() => {
	const toolHandlers = new Map<string, Function>();
	const mockMcpServer = {
		tool: vi.fn(
			(
				name: string,
				_description: string,
				_schema: unknown,
				handler: Function,
			) => {
				toolHandlers.set(name, handler);
			},
		),
		connect: vi.fn(),
		close: vi.fn(),
	};
	const mockTransport = {};
	return { mockMcpServer, mockTransport, toolHandlers };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: function McpServer() {
		return mockMcpServer;
	},
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	StdioServerTransport: function StdioServerTransport() {
		return mockTransport;
	},
}));

vi.mock("../constants/remoteConstants", () => ({
	MCP_SERVER_NAME: "tasksync",
	MCP_SERVER_VERSION: "1.0.0",
}));

describe("McpServerManager", () => {
	let McpServerManager: typeof import("./mcpServer").McpServerManager;

	beforeEach(async () => {
		vi.clearAllMocks();
		toolHandlers.clear();
		const mod = await import("./mcpServer");
		McpServerManager = mod.McpServerManager;
	});

	function createOptions(
		overrides: Partial<McpServerOptions> = {},
	): McpServerOptions {
		return {
			askUserHandler: vi.fn(),
			debug: false,
			...overrides,
		};
	}

	describe("instantiation", () => {
		it("can be instantiated with valid options", () => {
			const manager = new McpServerManager(createOptions());
			expect(manager).toBeDefined();
			expect(manager.isRunning()).toBe(false);
		});

		it("can be instantiated with debug enabled", () => {
			const manager = new McpServerManager(createOptions({ debug: true }));
			expect(manager).toBeDefined();
			expect(manager.isRunning()).toBe(false);
		});
	});

	describe("start()", () => {
		it("creates server and connects transport", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();

			expect(mockMcpServer.connect).toHaveBeenCalledWith(mockTransport);
			expect(manager.isRunning()).toBe(true);
		});

		it("registers the ask_user tool", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();

			expect(mockMcpServer.tool).toHaveBeenCalledTimes(1);
			expect(mockMcpServer.tool.mock.calls[0][0]).toBe("ask_user");
			expect(toolHandlers.has("ask_user")).toBe(true);
		});

		it("is idempotent - second start is a no-op", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();
			await manager.start();

			expect(mockMcpServer.connect).toHaveBeenCalledTimes(1);
			expect(manager.isRunning()).toBe(true);
		});
	});

	describe("stop()", () => {
		it("disconnects cleanly after start", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();
			await manager.stop();

			expect(mockMcpServer.close).toHaveBeenCalledTimes(1);
			expect(manager.isRunning()).toBe(false);
		});

		it("is safe to call on a non-running server", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.stop();

			expect(mockMcpServer.close).not.toHaveBeenCalled();
			expect(manager.isRunning()).toBe(false);
		});

		it("is safe to call multiple times after start", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();
			await manager.stop();
			await manager.stop();

			expect(mockMcpServer.close).toHaveBeenCalledTimes(1);
			expect(manager.isRunning()).toBe(false);
		});
	});

	describe("ask_user tool handler", () => {
		it("invokes askUserHandler with correct parameters", async () => {
			const mockResult: McpToolCallResult = {
				response: "User said hello",
				sessionId: "session-1",
				attachments: [],
				queue: false,
			};
			const askUserHandler = vi.fn().mockResolvedValue(mockResult);
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			expect(handler).toBeDefined();

			await handler!({
				question: "What is your name?",
				session_id: "session-1",
			});

			expect(askUserHandler).toHaveBeenCalledWith(
				"What is your name?",
				"session-1",
			);
		});

		it("passes session_id 'auto' through correctly", async () => {
			const mockResult: McpToolCallResult = {
				response: "Bootstrap response",
				sessionId: "new-session",
				attachments: [],
				queue: false,
			};
			const askUserHandler = vi.fn().mockResolvedValue(mockResult);
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			await handler!({ question: "Hello", session_id: "auto" });

			expect(askUserHandler).toHaveBeenCalledWith("Hello", "auto");
		});

		it("returns proper MCP content format", async () => {
			const mockResult: McpToolCallResult = {
				response: "My answer",
				sessionId: "sess-42",
				attachments: ["file.txt"],
				queue: true,
			};
			const askUserHandler = vi.fn().mockResolvedValue(mockResult);
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			const result = await handler!({
				question: "Test?",
				session_id: "sess-42",
			});

			expect(result).toEqual({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							session_id: "sess-42",
							response: "My answer",
							attachments: ["file.txt"],
							queued: true,
						}),
					},
				],
			});
		});

		it("returns queued as undefined when queue is false", async () => {
			const mockResult: McpToolCallResult = {
				response: "Direct response",
				sessionId: "sess-1",
				attachments: [],
				queue: false,
			};
			const askUserHandler = vi.fn().mockResolvedValue(mockResult);
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			const result = await handler!({
				question: "Direct?",
				session_id: "sess-1",
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.queued).toBeUndefined();
			expect(parsed.session_id).toBe("sess-1");
			expect(parsed.response).toBe("Direct response");
			expect(parsed.attachments).toEqual([]);
		});

		it("propagates error when askUserHandler throws", async () => {
			const askUserHandler = vi
				.fn()
				.mockRejectedValue(new Error("Handler failed"));
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			await expect(
				handler!({ question: "Fail?", session_id: "sess-err" }),
			).rejects.toThrow("Handler failed");
		});

		it("includes attachments in the response", async () => {
			const mockResult: McpToolCallResult = {
				response: "See attached",
				sessionId: "sess-att",
				attachments: ["image.png", "doc.pdf"],
				queue: false,
			};
			const askUserHandler = vi.fn().mockResolvedValue(mockResult);
			const manager = new McpServerManager(createOptions({ askUserHandler }));
			await manager.start();

			const handler = toolHandlers.get("ask_user");
			const result = await handler!({
				question: "Attachments?",
				session_id: "sess-att",
			});

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.attachments).toEqual(["image.png", "doc.pdf"]);
		});
	});

	describe("isRunning()", () => {
		it("returns false before start", () => {
			const manager = new McpServerManager(createOptions());
			expect(manager.isRunning()).toBe(false);
		});

		it("returns true after start", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();
			expect(manager.isRunning()).toBe(true);
		});

		it("returns false after stop", async () => {
			const manager = new McpServerManager(createOptions());
			await manager.start();
			await manager.stop();
			expect(manager.isRunning()).toBe(false);
		});
	});
});
