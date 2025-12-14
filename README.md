
<h1>TaskSync</h1>

This simple prompt instructions helps you work more efficiently, reduce premium request usage, and allow you to give the agent new instructions or feedback after completing a task. This is similar to Interactive/Enhanced Feedback MCP.

## What This Does

TaskSync is a **terminal-based task agent** with direct terminal communication. Your coding agent will actively requests tasks or feedback through terminal command `python -c "import sys; sys.stdin.read()"` , executes tasks autonomously, and operates forever until you stop it.

https://github.com/user-attachments/assets/3d604b0a-a89b-447f-ba87-5539f1f7444d

## Features

- **Human-in-the-loop workflow** - Provide feedback or new task, saving you premium requests on your AI IDEs
- **Terminal-based agent interaction** - Your AI becomes a persistent terminal agent that actively requests tasks
- **Autonomous operation** - Agent runs continuously requesting and executing tasks
- **Never terminates automatically** - maintains persistent operation until you explicitly say "stop", "end", "terminate", or "quit"

## Getting Started

1. **Get the TaskSync Prompt**: Copy or download the prompt from [here](https://github.com/4regab/TaskSync/blob/main/Prompt/tasksync-v5.md).

**Optional: Specs Workflow** _(Alternative structured approach)_: For users who prefer Kiro-style spec-driven development, you can use the [Specs-Tasksync](https://github.com/4regab/TaskSync/blob/main/Prompt/specs-tasksync.md) instead. This approach transforms ideas into structured requirements, design documents, and task lists before implementation. Simply provide the TaskSync or Specs Workflow file as context, then specify in chat which file your agent will follow.

3. **Initialize Agent**: Provide the TaskSync v5 protocol file (`tasksync.md`) or (`specs-tasksync.md`) as context to your AI IDE or agent and type in chat: `Strictly follow TaskSync Protocol #tasksync.md or specs-tasksync.md` to activate or copy the prompt use it as custom chat mode in copilot.
4. **Agent Activation**: The agent immediately becomes a terminal-based autonomous agent and announces initialization.
5. **Task Input**: Agent executes `python -c "import sys; sys.stdin.read()"` and waits for your input.

**Note:** Task can be entered in multiple lines. Press enter to move to new line and use `Ctrl+D` (Linux/Mac) or `Ctrl+Z + Enter` (Windows) to signal end of input. When pasting in terminal, click "Paste as Multiple Lines". While you can enter multiple lines, once you are in the next line, you cannot go back to previous lines to edit.

## Best Practices and VS Code Copilot Settings
For GPT Models Use Tasksync MCP.

Because agent mode depends heavily on tool calling, it's recommended that you turn on "Auto Approve" in the settings. Note that this will allow the agent to execute commands in your terminal without asking for permission. I also recommend bumping "Max Requests" to 999 to keep the agent working on long running tasks without asking you if you want it to continue.

You can do that through the settings UI or via your user settings json file:

```json
"chat.agent.maxRequests": 999
```
In recent VS Code update they limited the max requests to 40. However, you may ignore that since clicking continue button does not consume premium request as of this writing.

It's best to keep the TaskSync session for 1-2 hours maximum since the longer the conversation, the more hallucinations may occur. Start it in a new chat session when needed for optimal performance. This works best as custom chatmode.

### Alternative Option 

#### TaskSync MCP Server

For users who prefer MCP (Model Context Protocol) Server integration for feedback-oriented development workflows:

[![TaskSync MCP](https://badge.mcpx.dev?type=server)](https://github.com/4regab/tasksync-mcp)

This MCP server enables continuous feedback loops during AI-assisted development by letting users provide real-time feedback through a `feedback.md` file. 


_Setup instructions available at: [TaskSync MCP Server](https://github.com/4regab/tasksync-mcp)_


## 🤝 Discussions

The TaskSync community can be found on [GitHub Discussions](https://github.com/4regab/TaskSync/discussions) where you can ask questions, voice ideas, and share your prompts with other people. Contributions to TaskSync are welcome and highly appreciated.

## 📊 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=4regab/TaskSync&type=Date)](https://www.star-history.com/#4regab/TaskSync&Date)

⭐ Drop a star if you find this useful!
