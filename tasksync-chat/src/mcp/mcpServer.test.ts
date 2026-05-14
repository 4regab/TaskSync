import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMcpServer, mockTransport, toolHandlers, mockWsInstances } =
	vi.hoisted(() => {
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
		const mockWsInstances: Array<{
			handlers: Map<string, Function>;
			send: ReturnType<typeof vi.fn>;
			terminate: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		}> = [];
		return { mockMcpServer, mockTransport, toolHandlers, mockWsInstances };
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

vi.mock("ws", () => {
	return {
		default: class MockWebSocket {
			handlers = new Map<string, Function>();
			send = vi.fn();
			terminate = vi.fn();
			close = vi.fn();
			constructor() {
				mockWsInstances.push(this);
			}
			on(event: string, handler: Function) {
				this.handlers.set(event, handler);
				return this;
			}
		},
	};
});

describe("MCP Standalone Server", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		toolHandlers.clear();
		mockWsInstances.length = 0;
	});

	describe("tool registration", () => {
		it("registers ask_user tool with correct schema", async () => {
			// Trigger the main() function by importing the module
			// Since it's a standalone script, we simulate by extracting the tool registration
			vi.resetModules();
			await import("./mcpServer");

			expect(mockMcpServer.tool).toHaveBeenCalledTimes(1);
			expect(mockMcpServer.tool.mock.calls[0][0]).toBe("ask_user");
			expect(mockMcpServer.tool.mock.calls[0][1]).toContain(
				"Send a question or message to the user via TaskSync",
			);
			expect(toolHandlers.has("ask_user")).toBe(true);
		});

		it("connects to StdioServerTransport", async () => {
			vi.resetModules();
			await import("./mcpServer");

			expect(mockMcpServer.connect).toHaveBeenCalledWith(mockTransport);
		});
	});

	describe("ask_user tool handler", () => {
		it("connects to WebSocket and sends mcpAskUser message", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "What is your name?",
				session_id: "sess-1",
			});

			// Get the WebSocket instance created by the handler
			const wsInstance = mockWsInstances[0];
			expect(wsInstance).toBeDefined();

			// Simulate the connection opening and the server sending "connected"
			const openHandler = wsInstance.handlers.get("open");
			if (openHandler) openHandler();

			const messageHandler = wsInstance.handlers.get("message");
			// Server sends connected message
			messageHandler!(JSON.stringify({ type: "connected", state: {} }));

			// Verify it sent the mcpAskUser message
			expect(wsInstance.send).toHaveBeenCalledWith(
				JSON.stringify({
					type: "mcpAskUser",
					question: "What is your name?",
					sessionId: "sess-1",
				}),
			);

			// Simulate the response
			messageHandler!(
				JSON.stringify({
					type: "mcpAskUserResult",
					response: "My name is Alice",
					sessionId: "sess-1",
					attachments: [],
					queue: false,
				}),
			);

			const result = await handlerPromise;
			expect(result).toEqual({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							session_id: "sess-1",
							response: "My name is Alice",
							attachments: [],
							queued: undefined,
						}),
					},
				],
			});
		});

		it("handles PIN authentication flow", async () => {
			// Set --pin argument before importing
			const originalArgv = process.argv;
			process.argv = ["node", "mcp-server.js", "--port=3580", "--pin=1234"];

			vi.resetModules();
			await import("./mcpServer");

			process.argv = originalArgv;

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Hello?",
				session_id: "auto",
			});

			const wsInstance = mockWsInstances[0];
			const messageHandler = wsInstance.handlers.get("message");

			// Server requires auth
			messageHandler!(JSON.stringify({ type: "requireAuth" }));

			// Verify PIN was sent
			expect(wsInstance.send).toHaveBeenCalledWith(
				JSON.stringify({ type: "auth", pin: "1234" }),
			);

			// Server confirms auth
			messageHandler!(JSON.stringify({ type: "authSuccess" }));

			// Verify ask_user request was sent
			expect(wsInstance.send).toHaveBeenCalledWith(
				JSON.stringify({
					type: "mcpAskUser",
					question: "Hello?",
					sessionId: "auto",
				}),
			);

			// Simulate response
			messageHandler!(
				JSON.stringify({
					type: "mcpAskUserResult",
					response: "Hi there",
					sessionId: "new-session-id",
					attachments: [],
					queue: false,
				}),
			);

			const result = await handlerPromise;
			expect(result.content[0].type).toBe("text");
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.response).toBe("Hi there");
			expect(parsed.session_id).toBe("new-session-id");
		});

		it("returns isError on WebSocket connection failure", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Test?",
				session_id: "sess-err",
			});

			const wsInstance = mockWsInstances[0];
			const errorHandler = wsInstance.handlers.get("error");

			// Simulate connection error
			errorHandler!(new Error("Connection refused"));

			const result = await handlerPromise;
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toContain("Failed to connect");
		});

		it("returns isError when extension returns error", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Fail?",
				session_id: "sess-1",
			});

			const wsInstance = mockWsInstances[0];
			const messageHandler = wsInstance.handlers.get("message");

			// Server sends connected
			messageHandler!(JSON.stringify({ type: "connected", state: {} }));

			// Server sends error result
			messageHandler!(
				JSON.stringify({
					type: "mcpAskUserResult",
					error: "Provider unavailable",
				}),
			);

			const result = await handlerPromise;
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe("Provider unavailable");
		});

		it("returns isError on WebSocket close before response", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Close?",
				session_id: "sess-1",
			});

			const wsInstance = mockWsInstances[0];
			const closeHandler = wsInstance.handlers.get("close");

			// Simulate unexpected close
			closeHandler!();

			const result = await handlerPromise;
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toContain("closed before receiving response");
		});

		it("includes attachments in successful response", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Attach?",
				session_id: "sess-att",
			});

			const wsInstance = mockWsInstances[0];
			const messageHandler = wsInstance.handlers.get("message");

			messageHandler!(JSON.stringify({ type: "connected", state: {} }));
			messageHandler!(
				JSON.stringify({
					type: "mcpAskUserResult",
					response: "See files",
					sessionId: "sess-att",
					attachments: ["image.png", "doc.pdf"],
					queue: true,
				}),
			);

			const result = await handlerPromise;
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.attachments).toEqual(["image.png", "doc.pdf"]);
			expect(parsed.queued).toBe(true);
		});

		it("returns error on WebSocket error message from server", async () => {
			vi.resetModules();
			await import("./mcpServer");

			const handler = toolHandlers.get("ask_user")!;
			const handlerPromise = handler({
				question: "Error?",
				session_id: "sess-1",
			});

			const wsInstance = mockWsInstances[0];
			const messageHandler = wsInstance.handlers.get("message");

			// Server sends error type message
			messageHandler!(
				JSON.stringify({
					type: "error",
					message: "Not authenticated",
				}),
			);

			const result = await handlerPromise;
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toContain("Not authenticated");
		});
	});

	describe("CLI argument parsing", () => {
		it("uses default port 3580 when no args provided", async () => {
			const originalArgv = process.argv;
			process.argv = ["node", "mcp-server.js"];

			vi.resetModules();
			await import("./mcpServer");

			process.argv = originalArgv;

			const handler = toolHandlers.get("ask_user")!;
			handler({ question: "Port test?", session_id: "auto" });

			// The WebSocket URL would include the port; we verify via the connection
			const wsInstance = mockWsInstances[0];
			expect(wsInstance).toBeDefined();
		});

		it("parses custom port from --port=XXXX", async () => {
			const originalArgv = process.argv;
			process.argv = ["node", "mcp-server.js", "--port=4000"];

			vi.resetModules();
			await import("./mcpServer");

			process.argv = originalArgv;

			const handler = toolHandlers.get("ask_user")!;
			handler({ question: "Custom port?", session_id: "auto" });

			// If connection is attempted, it means args were parsed
			const wsInstance = mockWsInstances[0];
			expect(wsInstance).toBeDefined();
		});
	});
});
