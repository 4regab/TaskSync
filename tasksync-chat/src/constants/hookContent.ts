/**
 * Copilot hook content constants (SSOT)
 *
 * Used by:
 * - extension.ts → setupHooksCmd (generates ~/.copilot/hooks/tasksync.json)
 */

export const HOOK_SESSION_START_MESSAGE =
	"MANDATORY: You MUST call ask_user with session_id after EVERY completed task and whenever you need user input. Plain chat is invisible to the user. Reuse the previous session_id. NEVER finish silently.";

export const HOOK_PRECOMPACT_MESSAGE =
	"CRITICAL: You MUST keep calling ask_user with session_id on every turn after compaction. Reuse the previous session_id. NEVER end without ask_user.";

export const HOOK_SUBAGENT_START_MESSAGE =
	"MANDATORY: You are a subagent. NEVER call ask_user. Return results to the main agent, then STOP.";

function buildAdditionalContextCommand(
	hookEventName: "SessionStart" | "SubagentStart",
	additionalContext: string,
): string {
	const payload = JSON.stringify({
		hookSpecificOutput: {
			hookEventName,
			additionalContext,
		},
	});

	return `echo '${payload}'`;
}

/** Build the full hook file JSON object for writing to disk. */
export function buildHookFileContent(): object {
	return {
		hooks: {
			SessionStart: [
				{
					type: "command",
					command: buildAdditionalContextCommand(
						"SessionStart",
						HOOK_SESSION_START_MESSAGE,
					),
				},
			],
			PreCompact: [
				{
					type: "command",
					command: `echo '{"systemMessage":"${HOOK_PRECOMPACT_MESSAGE}"}'`,
				},
			],
			SubagentStart: [
				{
					type: "command",
					command: buildAdditionalContextCommand(
						"SubagentStart",
						HOOK_SUBAGENT_START_MESSAGE,
					),
				},
			],
		},
	};
}
