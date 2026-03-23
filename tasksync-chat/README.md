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
- Add multiple prompts that cycle in order (1→2→3→1...) with each `ask_user` call
- Drag to reorder, edit, or delete individual prompts in the Settings modal
- Toggle on/off from the Autopilot switch below the send button, or in Settings
- **Queue priority**: queued prompts are ALWAYS sent first — Autopilot only triggers when the queue is empty
- Perfect for varying instructions mid-session or hands-free operation on well-defined tasks

### Remote Access
Control TaskSync from your phone or any browser while away from your desk:
- **LAN Mode**: Connect from any device on your network with a 4-6 digit PIN
- **Internet Access via Tailscale**: Install [Tailscale](https://tailscale.com/download) on your Mac and phone for free — access TaskSync from anywhere over an encrypted mesh VPN, no port forwarding needed
- **PWA**: Install as an app on your phone for quick access
- **Code Review**: View diffs, stage/discard changes, commit and push from your phone
- **Sound Notifications**: Get alerted when the AI needs your input
- Never miss a prompt - respond from the couch, during lunch, or anywhere

### Response Timeout (Auto-respond when idle)
Prevent tool calls from waiting indefinitely when you're away:
- Configure timeout duration in VS Code Settings, including disabled (`0` minutes), `5` minutes, and options up to `240` minutes (4 hours)
- When timeout elapses, TaskSync auto-responds with Autopilot text
- **Consecutive limit**: After N consecutive immediate Autopilot responses (configurable, default 5), Autopilot is automatically disabled to prevent infinite loops
- Timeout-based auto-responses **do** count toward this consecutive limit
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

### File & Context References
Reference files, folders, context, and tools directly in your responses using `#` mentions:
- Type `#` to trigger autocomplete
- Search and select from: workspace files/folders, `#terminal` (recent commands), `#problems` (diagnostics), and VS Code tools
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
2. When an AI agent calls `ask_user`, TaskSync automatically responds with the next prompt in your cycling list
3. Add multiple prompts in Settings (gear icon) → Autopilot Prompts — they cycle 1→2→3→1...
4. Drag to reorder, click to edit, or delete individual prompts
5. **Queue priority**: queued prompts are always sent first — Autopilot only triggers when the queue is empty
6. Toggle off anytime to return to manual interaction

### File References
1. Type `#` in the input field
2. Search for files, folders, context (`#terminal`, `#problems`), or tools
3. Select to attach — the reference appears as a tag
4. Multiple attachments supported per message

### Remote Access (Phone/Browser Control)

Control TaskSync from your phone while away from your desk. Never miss an AI prompt again.

#### Starting Remote Access

**Option 1: LAN Mode (Same Network)**
1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Run `TaskSync: Start Remote Access (LAN)`
3. Note the URL and 4-6 digit PIN shown in the notification
4. On your phone, open the URL (e.g., `http://192.168.1.x:3580`)
5. Enter the PIN when prompted
6. You're connected!

**Option 2: Internet Access via Tailscale (Anywhere)**
1. Install [Tailscale](https://tailscale.com/download) on your Mac/PC and phone (free for personal use — 3 users, 100 devices)
2. Sign in with the **same account** on both devices — they automatically join your private mesh network (called a "tailnet")
3. Each device gets a unique, stable **Tailscale IP** (`100.x.y.z`) — this IP stays the same no matter what network the device is on
4. Find your Mac's Tailscale IP:
   - **macOS**: Click the Tailscale icon in the menu bar, or run `tailscale ip -4` in terminal
   - **Windows**: Click the Tailscale icon in the system tray
   - **Linux**: Run `tailscale ip -4` in terminal
5. Start Remote Access in LAN mode (Option 1 above)
6. On your phone, replace the LAN IP with your Mac's **Tailscale IP** (e.g., `http://100.85.123.45:3580` instead of `http://192.168.1.5:3580`)
7. Enter PIN as normal — works from anywhere with end-to-end encrypted WireGuard tunnel

> **No exit node needed** — Tailscale creates a direct peer-to-peer connection between your devices. Traffic never leaves the encrypted tunnel. Works across different Wi-Fi networks, cellular data, and even behind NAT/firewalls.

#### Using the PWA

**Questions Tab**
- See the current AI question/prompt
- Tap choice buttons or type a response
- Send responses back to VS Code
- Add context with the "+" button (terminal, problems, files)

**Queue Tab**
- View and manage your prompt queue
- Add new prompts to the queue
- Remove items by tapping ×

**Changes Tab (Code Review)**
- View all uncommitted changes
- Tap a file to see the diff
- Stage or discard changes
- Commit with a message
- Push to remote

**Settings Tab**
- Toggle Autopilot on/off
- Toggle Queue mode on/off
- View session info
- Start a new session

#### Stopping Remote Access

1. Open Command Palette
2. Run `TaskSync: Stop Remote Access`

Or simply close VS Code - the server stops automatically.

#### Configuration

In VS Code Settings (search "tasksync"):

**Remote Access:**
- `tasksync.remotePort`: Server port (default: 3580)
- `tasksync.remotePinEnabled`: Require PIN for LAN mode (default: true)
- `tasksync.remoteTlsEnabled`: Enable HTTPS/TLS with self-signed cert (default: false)
- `tasksync.remotePin`: Custom 4-6 digit PIN (auto-generated if empty)
- `tasksync.remoteDebugLogging`: Verbose remote server logging (default: false)

**MCP Server:**
- `tasksync.mcpEnabled`: Always start MCP server on activation (default: false)
- `tasksync.mcpAutoStartIfClients`: Auto-start if client configs detected (default: true)
- `tasksync.mcpPort`: MCP server port (default: 3579)
- `tasksync.autoRegisterMcp`: Auto-register with Kiro/Antigravity (default: true)

**Debug:**
- `tasksync.debugLogging`: Verbose extension debug logging (default: false)

All other settings (Autopilot, timeout, human-like delay, sound, etc.) are managed through the TaskSync Settings modal (gear icon).


### MCP Server Integration
TaskSync runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Antigravity** (auto-configured)
- **Cursor** and any MCP-compatible client (manual config)


## MCP Configuration for other IDEs (Not needed with Copilot)

TaskSync automatically registers with Kiro and Antigravity. For other clients, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "tasksync": {
      "url": "http://localhost:3579/sse"
    }
  }
}
```

## Requirements

- VS Code 1.99.0 or higher

## E2E Automation Scaffold

A Playwright-based remote smoke scaffold is available in [e2e/README.md](e2e/README.md).

- Install browser: `npm run e2e:install`
- Run: `TASKSYNC_E2E_BASE_URL=http://127.0.0.1:3580 npm run e2e`
- Optional login assertion: set `TASKSYNC_E2E_PIN=4..6 digit pin`

## License

MIT
