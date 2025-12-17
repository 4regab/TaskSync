
<h1>TaskSync</h1>

Reduce premium AI requests and manage tasks seamlessly with human-in-the-loop workflows. TaskSync provides three options to integrate feedback loops into your AI-assisted development.

## Choose Your Option

### Option 1: [TaskSync](https://marketplace.visualstudio.com/items?itemName=4regab.tasksync-chat) (VS Code Extension) - Recommended


https://github.com/user-attachments/assets/25b8c794-3d97-41b7-984b-2c18dadee402


A dedicated VS Code sidebar extension with smart prompt queue system. _Setup instructions here: [tasksync-chat](https://github.com/4regab/TaskSync/tree/main/tasksync-chat) folder._

**Features:**
- Smart Queue Mode - batch responses for AI agents
- Give new tasks/feedback using ask_user tool
- File/folder references with `#` autocomplete
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
3. Type: `Strictly follow TaskSync Protocol #tasksync.md`
4. Agent executes `python -c "import sys; sys.stdin.read()"` and waits for input

For spec-driven development, use [Specs-Tasksync](https://github.com/4regab/TaskSync/blob/main/Prompt/specs-tasksync.md) instead.

**Note:** Use `Ctrl+D` (Linux/Mac) or `Ctrl+Z + Enter` (Windows) to signal end of input.

---

### Option 3: TaskSync MCP Server

[![TaskSync MCP](https://badge.mcpx.dev?type=server)](https://github.com/4regab/tasksync-mcp)

This is an MCP server that helps with  feedback-oriented development workflows in AI-assisted development by letting users give feedback while the agent is working. It uses the `get_feedback` tool to collect your input from the `feedback.md` file in the workspace, which is sent back to the agent when you save.
_Setup instructions: [TaskSync MCP Server](https://github.com/4regab/tasksync-mcp)_

---

## Best Practices (VS Code Copilot)

For GPT models, use TaskSync MCP or Extension.

Recommended settings for agent mode:
```json
"chat.agent.maxRequests": 999
```

**Note:** The `maxRequests` setting on newer versions introduces a 30 cap of maxrequests. You may downgrade to [VS Code 1.106](https://code.visualstudio.com/updates/v1_106) or older to have the the 999 max request.
**Enable "Auto Approve" in settings for uninterrupted agent operation. Keep sessions to 1-2 hours max to avoid hallucinations.**

## Discussions

The TaskSync community can be found on [GitHub Discussions](https://github.com/4regab/TaskSync/discussions) where you can ask questions, voice ideas, and share your prompts with other people. Contributions to TaskSync are welcome and highly appreciated.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=4regab/TaskSync&type=Date)](https://www.star-history.com/#4regab/TaskSync&Date)

⭐ Drop a star if you find this useful!
