import * as vscode from "vscode";

const STOP_CHAT_COMMAND_CANDIDATES = [
	"workbench.action.chat.cancel",
	"workbench.action.chat.stop",
	"workbench.action.chat.stopWorking",
	"github.copilot.chat.stopSession",
];

/**
 * Best-effort attempt to stop an active Copilot/Chat run before starting a fresh session.
 * Silently ignores missing/unsupported commands across VS Code versions.
 */
export async function stopActiveCopilotChatBestEffort(): Promise<void> {
	for (const commandId of STOP_CHAT_COMMAND_CANDIDATES) {
		try {
			await vscode.commands.executeCommand(commandId);
			return;
		} catch {
			// Try next candidate.
		}
	}
}

/**
 * Stop any active run, start a fresh chat, then send the query via the configured chat command.
 */
export async function startFreshCopilotChatWithQuery(
	primaryChatCommand: string,
	query: string,
	fallbackChatCommand?: string,
): Promise<void> {
	await stopActiveCopilotChatBestEffort();
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
