#!/usr/bin/env node
/**
 * Standalone MCP Server for TaskSync
 *
 * This script is launched by external AI tools (Claude Desktop, Cursor, etc.)
 * as a spawned process. It communicates with the AI tool via stdio (MCP protocol)
 * and connects back to the VS Code extension's remote WebSocket server to relay
 * ask_user requests.
 *
 * Usage: node dist/mcp-server.js --port=3580 [--pin=XXXX]
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";

const MCP_SERVER_NAME = "tasksync";
const MCP_SERVER_VERSION = "1.0.0";

interface McpAskUserResult {
	type: "mcpAskUserResult";
	response?: string;
	sessionId?: string;
	attachments?: string[];
	queue?: boolean;
	error?: string;
}

function parseArgs(): { port: number; pin: string | undefined } {
	let port = 3580;
	let pin: string | undefined;

	for (const arg of process.argv.slice(2)) {
		if (arg.startsWith("--port=")) {
			const parsed = Number.parseInt(arg.slice(7), 10);
			if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
				port = parsed;
			}
		} else if (arg.startsWith("--pin=")) {
			pin = arg.slice(6);
		}
	}

	return { port, pin };
}

function connectToExtension(
	port: number,
	pin: string | undefined,
	question: string,
	sessionId: string,
): Promise<McpAskUserResult> {
	return new Promise((resolve, reject) => {
		const wsUrl = `ws://127.0.0.1:${port}`;
		const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
		let settled = false;

		const timeout = setTimeout(() => {
			if (!settled) {
				settled = true;
				ws.terminate();
				reject(new Error("Timeout waiting for response from extension"));
			}
		}, 300000); // 5 minute timeout

		ws.on("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				reject(
					new Error(
						`Failed to connect to TaskSync extension at ${wsUrl}: ${err.message}`,
					),
				);
			}
		});

		ws.on("close", () => {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				reject(new Error("WebSocket closed before receiving response"));
			}
		});

		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());

				if (msg.type === "requireAuth" && pin) {
					ws.send(JSON.stringify({ type: "auth", pin }));
					return;
				}

				if (msg.type === "connected" || msg.type === "authSuccess") {
					// Authenticated successfully, send the ask_user request
					ws.send(
						JSON.stringify({
							type: "mcpAskUser",
							question,
							sessionId,
						}),
					);
					return;
				}

				if (msg.type === "mcpAskUserResult") {
					settled = true;
					clearTimeout(timeout);
					ws.close();
					resolve(msg as McpAskUserResult);
					return;
				}

				if (msg.type === "error") {
					settled = true;
					clearTimeout(timeout);
					ws.close();
					reject(new Error(msg.message || "Error from extension"));
					return;
				}
			} catch {
				// Ignore parse errors for non-relevant messages
			}
		});

		ws.on("open", () => {
			// If no PIN required, the server sends "connected" directly
			// If PIN required, the server sends "requireAuth" first
			// Both cases are handled in the message handler above
		});
	});
}

async function main(): Promise<void> {
	const { port, pin } = parseArgs();

	const server = new McpServer({
		name: MCP_SERVER_NAME,
		version: MCP_SERVER_VERSION,
	});

	server.tool(
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
			try {
				const result = await connectToExtension(
					port,
					pin,
					question,
					session_id,
				);

				if (result.error) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({ error: result.error }),
							},
						],
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								session_id: result.sessionId,
								response: result.response,
								attachments: result.attachments || [],
								queued: result.queue || undefined,
							}),
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : "ask_user failed";
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ error: message }),
						},
					],
					isError: true,
				};
			}
		},
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
	// Server is now running, waiting for MCP messages on stdio
}

main().catch((err) => {
	console.error("Fatal MCP server error:", err);
	process.exit(1);
});
