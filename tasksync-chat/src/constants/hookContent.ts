/**
 * Copilot hook content constants (SSOT)
 *
 * Used by:
 * - extension.ts → setupHooksCmd (generates .github/hooks/tasksync-stop.json)
 * - .github/hooks/tasksync-stop.json (committed copy for this repo)
 * - tasksync.agent.md (agent-scoped hooks — wording should match)
 */

export const HOOK_STOP_REASON =
	"MANDATORY: Call ask_user with session_id before ending. The user CANNOT see your response without ask_user. Reuse the session_id from your previous ask_user result. NEVER end without calling ask_user.";

export const HOOK_PRECOMPACT_MESSAGE =
	"CRITICAL: After compaction, continue calling ask_user with session_id on every turn. Reuse the session_id from your previous ask_user result. NEVER end without calling ask_user.";

export const HOOK_SUBAGENT_START_MESSAGE =
	"You are a subagent. DO NOT call ask_user. Complete your task and return results. STOP after returning.";

/** Build the full hook file JSON object for writing to disk. */
export function buildHookFileContent(): object {
	return {
		hooks: {
			Stop: [
				{
					type: "command",
					command: `echo '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"${HOOK_STOP_REASON}"}}'`,
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
					command: `echo '{"systemMessage":"${HOOK_SUBAGENT_START_MESSAGE}"}'`,
				},
			],
		},
	};
}
