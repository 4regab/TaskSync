> [!WARNING]
> **GitHub Security Notice:**  
> GitHub prohibits use of their servers for excessive automated bulk activity or any activity that places undue burden on their infrastructure.
> Please review:
>
> - [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github)
> - [GitHub Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
>   
> **Use TaskSync responsibly and at your own risk. You are responsible for ensuring your usage complies with GitHub's terms of service.**
<h1>TaskSync</h1>

Reduce premium AI requests and manage tasks seamlessly with human-in-the-loop workflows. TaskSync provides three options to integrate feedback loops into your AI-assisted development.

## Choose Your Option

### Option 1: [TaskSync](https://marketplace.visualstudio.com/items?itemName=4regab.tasksync-chat) (VS Code Extension) - Recommended

https://github.com/user-attachments/assets/f7e5a694-9cfe-4e7a-9065-6cc826f89031

A dedicated VS Code sidebar extension with smart prompt queue system. _Setup instructions here: [tasksync-chat](https://github.com/4regab/TaskSync/tree/main/tasksync-chat) folder._

**Features:**
- Smart Queue Mode - batch responses for AI agents
- Autopilot - let agents work autonomously with customizable auto-responses
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
3. Send a prompt to the agent
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

**Enable "Auto Approve" in settings for uninterrupted agent operation. Sessions beyond 2 hours may produce lower-quality results — TaskSync will warn you when it's time to consider starting a fresh session.**

## Discussions

The TaskSync community can be found on [GitHub Discussions](https://github.com/4regab/TaskSync/discussions) where you can ask questions, voice ideas, and share your prompts with other people. Contributions to TaskSync are welcome and highly appreciated.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=4regab/TaskSync&type=Date)](https://www.star-history.com/#4regab/TaskSync&Date)

⭐ Drop a star if you find this useful!
