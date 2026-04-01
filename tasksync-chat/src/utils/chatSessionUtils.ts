import * as vscode from "vscode";

/**
 * Create a new VS Code chat session and send a query via the configured chat command.
 * Does NOT cancel the currently active chat — VS Code supports parallel sessions
 * (v1.107+), so existing agents keep running while the new session starts.
 */
export async function startFreshCopilotChatWithQuery(
	primaryChatCommand: string,
	query: string,
	fallbackChatCommand?: string,
): Promise<void> {
	await vscode.commands.executeCommand("workbench.action.chat.newChat");

	try {
		await vscode.commands.executeCommand(primaryChatCommand, { query });
	} catch (err) {
		if (fallbackChatCommand && fallbackChatCommand !== primaryChatCommand) {
			await vscode.commands.executeCommand(fallbackChatCommand, { query });
			return;
		}
		throw err;
	}
}

/**
 * Start a new Copilot chat with session_id injected as a system instruction.
 * The session_id is embedded in the opening prompt so that Copilot will pass
 * it back in all subsequent tool invocations.
 */
export async function startNewSessionChat(
	sessionId: string,
	chatCommand: string,
	initialPrompt?: string,
	fallbackChatCommand?: string,
): Promise<void> {
	const sessionInstruction = `[SYSTEM]: You are operating in TaskSync Session ID: ${sessionId}. On EVERY ask_user tool call, you MUST include "session_id": "${sessionId}" in the tool input. Never omit it and never use a different value.`;
	const fullQuery = initialPrompt
		? `${sessionInstruction}\n\n${initialPrompt}`
		: sessionInstruction;

	await startFreshCopilotChatWithQuery(
		chatCommand,
		fullQuery,
		fallbackChatCommand,
	);
}
