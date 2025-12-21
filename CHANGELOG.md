# Changelog

All notable changes to this project will be documented in this file.

## TaskSync v2.0.9 (12-21-25)
- fix(workflow): properly handle multi-line commit messages in release notes
- - Use heredoc syntax (EOF delimiter) for multi-line GitHub Actions output
- - Removes URL encoding (%0A) that was appearing in release descriptions
- - Properly formats each line of commit message in CHANGELOG


## TaskSync v2.0.8 (12-21-25)
- fix(sidebar): resolve race condition preventing AI questions from displaying%0A%0APROBLEM:%0A- TaskSync sidebar was not receiving/displaying questions from AI tool calls%0A- ask_user tool was returning empty responses immediately%0A- Users saw no question in sidebar, tool call ended without user input%0A%0AROOT CAUSE:%0A1. waitForUserResponse() threw 'Webview not visible' error when sidebar was closed%0A2. Error was silently swallowed in catch block, returning empty response%0A3. No mechanism to auto-open sidebar when AI called ask_user tool%0A4. Race condition: messages sent before webview JS was initialized were lost%0A%0AFIXES:%0A- Auto-open sidebar via 'taskSyncView.focus' command when view is undefined%0A- Add polling loop to wait for view resolution (up to 5 seconds)%0A- Add polling loop to wait for webview JS ready state (up to 3 seconds)%0A- Improved error handling: log errors and show user-facing error message%0A- Added missing 'numberedLinePattern' regex for choice parsing%0A- Re-send pending questions when webview is recreated (tab switch recovery)%0A%0AAFFECTED FILES:%0A- src/webview/webviewProvider.ts: Auto-open sidebar, wait for ready state%0A- src/tools.ts: Better error logging, user-facing error messages%0A- media/webview.js: Debug logging for message flow (retained for diagnosis)%0A%0AFixes issue where sidebar didn't show AI questions during ask_user calls


## TaskSync v2.0.7 (12-21-25)
- fix: handle merge commits in release notes, fix vsix path for attestation


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
