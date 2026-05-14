/**
 * MCP Server Manager
 *
 * Creates and manages an MCP server that exposes the ask_user tool
 * over stdio transport. External AI tools (Claude Desktop, Cursor, etc.)
 * can connect to this server to interact with the user via TaskSync.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	MCP_SERVER_NAME,
	MCP_SERVER_VERSION,
} from "../constants/remoteConstants";
import type { McpAskUserHandler, McpServerOptions } from "./mcpTypes";

export class McpServerManager {
	private server: McpServer | undefined;
	private transport: StdioServerTransport | undefined;
	private askUserHandler: McpAskUserHandler;
	private debug: boolean;
	private running = false;

	constructor(options: McpServerOptions) {
		this.askUserHandler = options.askUserHandler;
		this.debug = options.debug ?? false;
	}

	private log(...args: unknown[]): void {
		if (this.debug) {
			console.info("[TaskSync MCP]", ...args);
		}
	}

	async start(): Promise<void> {
		if (this.running) {
			this.log("Server already running, skipping start");
			return;
		}

		this.server = new McpServer({
			name: MCP_SERVER_NAME,
			version: MCP_SERVER_VERSION,
		});

		this.server.tool(
			"ask_user",
			"Send a question or message to the user via TaskSync. The user can ONLY see messages sent through this tool. Returns the user response, session ID, and any attachments.",
			{
				question: z
					.string()
					.describe("The question or prompt to display to the user"),
				session_id: z
					.string()
					.describe(
						'Session ID for tracking conversation context. Use "auto" on first call.',
					),
			},
			async ({ question, session_id }) => {
				this.log("ask_user called — question:", question.slice(0, 80));

				const result = await this.askUserHandler(question, session_id);

				this.log(
					"ask_user result — response:",
					result.response.slice(0, 80),
					"sessionId:",
					result.sessionId,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								session_id: result.sessionId,
								response: result.response,
								attachments: result.attachments,
								queued: result.queue || undefined,
							}),
						},
					],
				};
			},
		);

		this.transport = new StdioServerTransport();
		await this.server.connect(this.transport);
		this.running = true;
		this.log("MCP server started on stdio transport");
	}

	async stop(): Promise<void> {
		if (!this.running) {
			return;
		}

		this.log("Stopping MCP server");
		if (this.server) {
			await this.server.close();
			this.server = undefined;
		}
		this.transport = undefined;
		this.running = false;
		this.log("MCP server stopped");
	}

	isRunning(): boolean {
		return this.running;
	}
}
