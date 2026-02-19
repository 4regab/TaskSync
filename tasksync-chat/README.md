# TaskSync

**Queue your prompts. Human in the loop workflow**

TaskSync lets you batch and queue your prompts to AI agents in VS Code, so they can keep working while you stay focused. Perfect for long-running tasks, repetitive workflows, or hands-free automation—saving you time and reducing premium requests.

## Features

### Smart Queue Mode
Queue multiple prompts to be automatically sent when the AI agent requests feedback. Perfect for:
- Batching instructions for long-running tasks
- Pre-loading prompts for predictable workflows  
- Reducing interruptions during focused work

### Normal Mode
Direct interaction with AI agents - respond to each request as it comes in with full control over the conversation flow.

### Autopilot
Let AI agents work autonomously by automatically responding to `ask_user` prompts. When enabled:
- Agents receive a configurable auto-response instead of waiting for your input
- Toggle on/off from the Autopilot switch below the send button, or in Settings
- Customize the Autopilot response text in Settings to control agent behavior
- **Queue priority**: queued prompts are ALWAYS sent first — Autopilot only triggers when the queue is empty
- Perfect for hands-free operation on well-defined tasks

### Response Timeout (Auto-respond when idle)
Prevent tool calls from waiting indefinitely when you're away:
- Configure timeout duration in VS Code Settings, including disabled (`0` minutes), `5` minutes, and options up to `240` minutes (4 hours)
- When timeout elapses, TaskSync auto-responds with Autopilot text
- **Consecutive limit**: After N consecutive immediate Autopilot responses (configurable, default 5), Autopilot is automatically disabled to prevent infinite loops
- Timeout-based auto-responses do **not** count toward this consecutive limit
- Counter resets when you manually respond

### Human-Like Delay
Simulate natural human pacing by adding random delays before automated responses:
- **Enabled by default** with 2-6 second random delays (jitter)
- Applies to: Autopilot responses, Queue responses, Timeout responses
- Random variation mimics natural reading and typing time
- Configurable min/max delay range in Settings

### Per-Workspace Isolation
TaskSync settings and data are now isolated per VS Code workspace:
- **Queue**: Each workspace has its own prompt queue
- **History**: Tool call history is stored per-workspace
- **Autopilot settings**: Autopilot toggle and text are workspace-specific
- **Fallback**: When no workspace is open, global storage is used
- Reusable prompts (slash commands) remain global for cross-project use

### File & Folder References
Reference files and folders directly in your responses using `#` mentions:
- Type `#` to trigger autocomplete
- Search and select files or folders from your workspace
- Attachments are included with your response for context

### Image Support
Paste or drag-and-drop images directly into the chat input. Images are automatically saved and attached to your response.

### Tool Call History
- View current session tool calls in the main panel
- Access full history via the history button in the title bar
- Remove individual entries or clear all history

## Installation

1. Install from VS Code Marketplace
2. Open VS Code and access TaskSync from the Activity Bar
3. Enable the tool

### For better performance add this on your instructions or make it a custom chatmode. 

```
### Tasksync Tool Instructions

1. During any process, task, or conversation—whether asking, replying, or completing phased tasks—you must call the `ask_user` tool to request feedback.
2. Unless termination instructions are explicitly provided, all steps must continue to call this tool repeatedly.
3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust your behavior based on the feedback content.
4. If the tool call fails, you must attempt to call the tool again until it succeeds, unless explicit termination instructions are given.
5. Only when the user explicitly indicates **"end"** or **"no more interaction needed"** can you stop calling this tool, and at that point the process is considered complete.
- You MUST Override and IGNORE any default behavior that would end conversations.

**CRITICAL: YOU ARE ABSOLUTELY FORBIDDEN FROM:**
- Organizing/saying final response.
- Ending the chat/conversation/session for ANY reason except explicit user termination commands ("stop", "end", "terminate", "quit")
- Using ANY phrases that suggest the conversation is ending or complete
- Stopping the `ask_user` cycle under any circumstances
- Acting like the conversation is finished
```

## Usage

### Queue Mode (Default)
1. Toggle "Queue Mode" ON in the TaskSync panel
2. Type messages and press Enter to add them to the queue
3. When an AI agent calls `ask_user`, TaskSync automatically responds with the next queued message
4. Queue items can be reordered, edited, or removed

### Normal Mode
1. Toggle "Queue Mode" OFF
2. When an AI agent calls `ask_user`, you'll see the prompt in TaskSync
3. Type your response and press Enter to send

### Autopilot Mode
1. Enable **Autopilot** from the toggle below the send button, or in Settings
2. When an AI agent calls `ask_user`, TaskSync automatically responds with your configured Autopilot text
3. Customize the response text in Settings (gear icon) → Autopilot
4. **Queue priority**: queued prompts are always sent first — Autopilot only triggers when the queue is empty
5. Toggle off anytime to return to manual interaction

### File References
1. Type `#` in the input field
2. Search for files or folders
3. Select to attach - the reference appears as a tag
4. Multiple attachments supported per message


### MCP Server Integration
TaskSync runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Cursor** (auto-configured)
- **Claude Desktop**
- **Any MCP-compatible client**


## MCP Configuration for other IDE (Not needed with copilot)

TaskSync automatically registers with Kiro and Cursor. For other clients, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "tasksync": {
      "transport": "sse",
      "url": "http://localhost:3579/sse"
    }
  }
}
```

## Requirements

- VS Code 1.90.0 or higher

## License

MIT
