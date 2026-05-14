/**
 * Type definitions for the MCP server module.
 */

export interface McpToolCallResult {
	response: string;
	sessionId: string;
	attachments: string[];
	queue: boolean;
}

export type McpAskUserHandler = (
	question: string,
	sessionId: string,
) => Promise<McpToolCallResult>;

export interface McpServerOptions {
	askUserHandler: McpAskUserHandler;
	debug?: boolean;
}
