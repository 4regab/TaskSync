> # **This project now only works for the old request-based system.** Unfortunately, Taskysync is deprecated due to recent changes in Copilot billing: [GitHub Copilot is moving to usage-based billing](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)

Reduce premium AI requests and manage tasks seamlessly with human-in-the-loop workflows. TaskSync provides three options to integrate feedback loops into your AI-assisted development.

## Choose Your Option

### Option 1: [TaskSync](https://marketplace.visualstudio.com/items?itemName=4regab.tasksync-chat) (VS Code Extension) - Recommended



https://github.com/user-attachments/assets/53290a1c-3193-4830-8f13-cb6ae9682a58


A dedicated VS Code sidebar extension with smart prompt queue system. _Setup instructions here: [tasksync-chat](https://github.com/4regab/TaskSync/tree/main/tasksync-chat) folder._

**Features:**
- Smart Queue Mode - batch responses for AI agents
- Autopilot - let agents work autonomously with customizable auto-responses
- Agent orchestration toggle - switch between multi-session routing and a single-session lane per workspace
- Remote Access - control from your phone via LAN or Tailscale, with PWA and code review
- Give new tasks/feedback using ask_user tool
- File, folder, tool, and context references with `#` autocomplete
- Image paste support (copilot will view your image)
- Tool call history with session tracking

**Installation:** Install from VS Code Marketplace or build from source with `npx vsce package`.

---

### Option 2: TaskSync Prompt

https://github.com/user-attachments/assets/3d604b0a-a89b-447f-ba87-5539f1f7444d

A terminal-based task agent protocol. Your coding agent actively requests tasks or feedback through terminal commands, executes tasks autonomously, and operates until you stop it.

**Features:**
- Human-in-the-loop workflow - provide feedback or new tasks
- Terminal-based agent interaction
- Autonomous operation - runs continuously
- Never terminates automatically

**Getting Started:**
1. Choose your preferred prompt [TaskSync Prompt](https://github.com/4regab/TaskSync/blob/main/Prompt)
2. Provide it as context to your AI IDE
3. Send a prompt to the agent
4. Agent executes `python -c "import sys; sys.stdin.read()"` and waits for input

For spec-driven development, use [Specs-Tasksync](https://github.com/4regab/TaskSync/blob/main/Prompt/specs-tasksync.md) instead.

**Note:** Use `Ctrl+D` (Linux/Mac) or `Ctrl+Z + Enter` (Windows) to signal end of input.

---

### Option 3: TaskSync MCP Server

[![TaskSync MCP](https://badge.mcpx.dev?type=server)](https://github.com/4regab/tasksync-mcp)

This is an MCP server that helps with feedback-oriented development workflows in AI-assisted development by letting users give feedback while the agent is working. It uses the `get_feedback` tool to collect your input from the `feedback.md` file in the workspace, which is sent back to the agent when you save.
_Setup instructions: [TaskSync MCP Server](https://github.com/4regab/tasksync-mcp)_

---

## Best Practices (VS Code Copilot)

For GPT models, use TaskSync Extension.

Recommended settings for agent mode:
```json
"chat.agent.maxRequests": 999
```

**Enable "Auto Approve" in settings for uninterrupted agent operation. Sessions beyond 2 hours may produce lower-quality results — TaskSync will warn you when it's time to consider starting a fresh session.**

### Copilot Hooks (Preview)

TaskSync includes [Copilot hooks](https://code.visualstudio.com/docs/copilot/customization/hooks) that inject the `ask_user` contract at session start and preserve it through context compaction. Run **`TaskSync: Setup Global Copilot Hooks`** from the command palette to generate `~/.copilot/hooks/tasksync.json` in your user profile. This repo also keeps a matching workspace hook file at `.github/hooks/tasksync.json`. This adds:

- **SessionStart hook** — injects the `ask_user` contract when a session begins
- **PreCompact hook** — reminds the agent to preserve `session_id` after context compaction
- **SubagentStart hook** — tells subagents not to call `ask_user`

The default hook set is non-blocking, so it does not force extra turns at stop time. In this repository, the committed workspace hook file mirrors the same hook content, so workspace scope wins without changing behavior.

This is a user-scoped setup by default, so it applies across workspaces. If a workspace hook exists for the same event, VS Code will prefer the workspace hook.

Copilot Hooks require VS Code 1.109.3+ and the `chat.agent.hooks` setting enabled. The extension itself runs on older supported VS Code versions without hooks.

## Discussions

The TaskSync community can be found on [GitHub Discussions](https://github.com/4regab/TaskSync/discussions) where you can ask questions, voice ideas, and share your prompts with other people. Contributions to TaskSync are welcome and highly appreciated.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=4regab/TaskSync&type=Date)](https://www.star-history.com/#4regab/TaskSync&Date)

⭐ Drop a star if you find this useful!
