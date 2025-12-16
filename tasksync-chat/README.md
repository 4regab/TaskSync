# TaskSync

Manage tasks seamlessly within VS Code that lets you prompt queue easily or queue all tasks and reduce premium requests.

## Features

### Smart Queue Mode
Queue multiple responses to be automatically sent when the AI agent requests feedback. Perfect for:
- Batching instructions for long-running tasks
- Pre-loading responses for predictable workflows
- Reducing interruptions during focused work

### Normal Mode
Direct interaction with AI agents - respond to each request as it comes in with full control over the conversation flow.

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

### MCP Server Integration
TaskSync runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Cursor** (auto-configured)
- **Claude Desktop**
- **Any MCP-compatible client**

## Installation

1. Install from VS Code Marketplace or download the `.vsix` file
2. Open VS Code and access TaskSync from the Activity Bar
3. The MCP server starts automatically on activation

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

### File References
1. Type `#` in the input field
2. Search for files or folders
3. Select to attach - the reference appears as a tag
4. Multiple attachments supported per message

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
