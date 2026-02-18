# Changelog

All notable changes to this project will be documented in this file.

## TaskSync v2.0.19 (02-18-26)
- Update tasksync-chat/media/webview.js


## TaskSync v2.0.18 (02-18-26)
- feat: add markdown link handling and styling in webview


## TaskSync v2.0.17 (02-18-26)
- **Response Timeout**: Auto-respond to pending tool calls if user doesn't respond within a configurable time window (5–120 min); sends Autopilot text when Autopilot is enabled, or a session termination message when disabled
- **Max Consecutive Auto-responses** (`tasksync.maxConsecutiveAutoResponses`): Limit the number of consecutive timeout auto-responses (default 5) before the session is automatically terminated, preventing infinite loops
- **Per-workspace Isolation**: Queue, history, and settings are now stored per-workspace using workspace-scoped storage with fallback to global; no more cross-project contamination
- **New Session replaces Clear Session**: "Clear Current Session" command replaced with "New Session" — properly cancels pending requests, resets the timeout timer, and clears the auto-response counter before starting fresh
- **Session Timer in Title Bar**: Elapsed session time now displayed in the view title bar; timer freezes on session termination with a visual indicator
- **Session Health Tip**: Welcome section now shows "It is advisable to start a new session after 4 hours or 50 tool calls to lessen the risks"; badge tooltip echoes this recommendation
- **Structured Session Termination**: Session termination now uses a boolean `sessionTerminated` flag (replacing string matching) for reliable state tracking in both provider and webview
- fix: `startNewSession()` now correctly cancels pending requests, timeout timer, and resets the auto-response counter
- fix: `onDidChangeConfiguration` now handles live updates to `responseTimeout` and `maxConsecutiveAutoResponses` settings
- fix: History persistence updated to use workspace-aware storage path (`_getStorageUri()`)
- fix: Removed noisy `console.log` statements from timeout timer
- fix: Webview properly receives and uses the `sessionTerminated` parameter
- Update settings UI: timeout dropdown and max auto-response controls added to Settings modal
- Update welcome section Autopilot info and tooltip for session management context
- update welcome autopilot info and tooltip for session management


## TaskSync v2.0.16 (02-13-26)
- fix: enhance markdown list conversion and inline code handling in webview


## TaskSync v2.0.15 (02-13-26)
- fix: improve markdown parsing for italic text in webview


## TaskSync v2.0.14 (02-07-26)
- refactor: rename Auto Answer to Autopilot, improve UI and settings
- - Rename all autoAnswer references to autopilot across codebase
-   (package.json, webviewProvider.ts, webview.js, CHANGELOG, READMEs)
- - Add backward-compatible settings migration from old keys
-   (tasksync.autoAnswer  tasksync.autopilot, tasksync.autoAnswerText  tasksync.autopilotText)
- - Move Autopilot toggle beside the send button in the action bar
- - Remove redundant autopilot-bar row to eliminate unnecessary spacing
- - Update welcome section info tip with clearer Autopilot description
- - Replace toggle switch in Settings modal with Edit button for Autopilot prompt
-   (on/off control remains solely in the action bar toggle)


## TaskSync v2.0.13 
- **Autopilot Mode** (renamed from Auto Answer): Automatically respond to `ask_user` prompts with configurable text for hands-free agent operation
- Autopilot toggle below the send button for quick access
- Customizable Autopilot response text via settings (`tasksync.autopilot`, `tasksync.autopilotText`)
- Queue priority: queued prompts are ALWAYS sent before Autopilot triggers
- Show tool call name preview in chat (truncated to 40 chars)
- Fix queue state reporting to accurately reflect whether response came from queue
- Fix stale settings overwriting user input for Autopilot text
- Fix redundant settings load in settings modal

## TaskSync v2.0.12 (01-06-26)
- Modified card rendering to add 'expanded' class only to the latest tool call
- Older tool call cards are now collapsed by default

## TaskSync v2.0.11 (12-24-25)
- Add context references (#terminal, #problems) for attaching terminal output and workspace diagnostics
- Integrate context items into file autocomplete dropdown
- Display attachments in tool call history cards
- Add ReDoS protection for markdown table parsing (prevent regex backtracking attacks)
- Fix memory leaks: proper cancellation cleanup, stale terminal execution tracking
- Add input length validation (500KB max for questions, 100KB for queue prompts)
- Use async file I/O for MCP client registration (non-blocking activation)
- Extract context providers into dedicated modules (ContextManager, TerminalContext, ProblemsContext)
- Consolidate duplicate CSS rules for code blocks and markdown
- Remove unused CSS (.welcome-tips, duplicate inline-code styles)
- Clean up JavaScript: remove unused variables, improve accessibility (ARIA labels)
- Fix race conditions in queue handling and request superseding
- Prevent orphaned promises when multiple ask_user calls occur
- Fix temp image cleanup timing (now cleaned on session clear/dispose)
- Improve webview ready state handling to prevent message race conditions
- Better error handling with proper cancellation support
- Cache context items dynamically (don't cache with file results)
- Debounced history saves (2s) for better disk I/O performance
- Process markdown tables line-by-line to avoid ReDoS vulnerability

## TaskSync v2.0.10 (12-24-25)
- feat: v2.1.0 - Settings Modal, Reusable Prompts, Notification Sound & Codebase Cleanup
- New Features:
- - Add in-sidebar Settings Modal with gear icon in title bar
- - Reusable Prompts with /slash command support and autocomplete
- - Clear Current Session command with trash icon and confirmation
- - Interactive Approval UI improvements with toggle setting
- - Notification sound for incoming tool calls
- Codebase Cleanup & Refactoring:
- - Extract shared utilities (fileExclusions.ts, imageUtils.ts)
- - Remove 5 unused SVG files from media folder
- - Clean up logging (remove console.log/warn, keep console.error)
- - Eliminate duplicate code and outdated comments
- - Update dependencies and clean up package.json



## TaskSync v2.0.9 (12-21-25)
- fix(workflow): properly handle multi-line commit messages in release notes
- - Use heredoc syntax (EOF delimiter) for multi-line GitHub Actions output
- - Removes URL encoding (%0A) that was appearing in release descriptions
- - Properly formats each line of commit message in CHANGELOG



## TaskSync v2.0.8 (12-21-25)
- fix(sidebar): resolve race condition preventing AI questions from displaying in the TaskSync sidebar when using ask_user tool; auto-opens sidebar, adds polling for view and webview readiness, and improves error handling


## TaskSync v2.0.6 (12-21-25)
- Merge branch 'main' of https://github.com/4regab/TaskSync


## TaskSync v2.0.5 (12-21-25)
- fix: update auto-release workflow to trigger on changes to the workflow file


## TaskSync Chat Extension v2.0.0 (12-17-25)
- New VS Code sidebar extension with dedicated UI (`tasksync-chat/` folder)
- Smart Queue Mode: batch responses for AI agents automatically
- Normal Mode: direct interaction with tool calls
- File/folder references with `#` autocomplete
- Image paste and drag-drop support
- Built-in MCP server with SSE transport (auto-registers with Kiro/Cursor)
- Tool call history with session tracking
- Performance optimizations: O(1) lookups, file search caching, async disk I/O

## TaskSync Prompt v5.2
- Added `readline` import for better terminal input handling (arrow keys, history)
- Added reminder message after input: "Once done, ensure to follow ./tasksync.md file and ask for input again"
- Uses `python3` instead of `python` for better cross-platform compatibility

## TaskSync Prompt v5.1
- Changed from `input()` to `sys.stdin.read()` for better multi-line input support
- Added "Enter Task:" prompt before input
- Improved cross-platform terminal compatibility

## TaskSync Prompt v5.0
- Simplified terminal command: `python -c "task = input('')"`
- 20 PRIMARY DIRECTIVES for absolute protocol compliance
- Emergency anti-termination protocols
- Task continuation priority system
- Urgent override handling

## Version 4.0 (08-12-25)
- Terminal-based autonomous agent protocol: AI becomes persistent terminal application using PowerShell Read-Host commands
- PRIMARY DIRECTIVE system: Eight critical behavioral rules ensuring absolute protocol compliance
- Zero file dependencies: Eliminates file monitoring overhead for direct terminal communication
- Enhanced session management: Improved task continuation priority and manual termination controls
- Cross-platform PowerShell compatibility and full backward support for TaskSync v3

## Version 3.0 (07-23-25)
- TaskSync Monitor UI: Web-based interface with real-time monitoring
- Improved TaskSync protocol prompt for better agent persistence and reliability and better file reference handling.
- Added Kiro IDE steerings file

## Version 2.0 (07-15-25)
- PowerShell word count monitoring system for efficient file change detection
- Protocol standardization: identical files, IDE-specific paths, and template system
- Fixed timing (180s/30s), mandatory Start-Sleep for monitoring, and never end session enforcement
- Multi-session log support: auto session creation, session numbering, and clear separation in log.txt
- Enhanced enforcement: session termination prevention, urgent override detection, and task continuation priority
- Improved documentation: configuration, usage, protocol, and changelog updates

## Version 1.0 (07-14-25)
- Initial release with infinite monitoring and basic file/task execution
- Dual file system: separate tasks.txt for instructions and log.txt for monitoring history
- Status logging: count-based monitoring, structured log format, and session tracking
- Manual termination only: agent never ends session automatically, explicit keywords required
- Robust error handling, improved user experience, and comprehensive documentation
