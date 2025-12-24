# Changelog

All notable changes to this project will be documented in this file.

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


## TaskSync v2.1.0 (12-25-25)
- **feat(settings)**: Add in-sidebar Settings Modal with gear icon in title bar
  - Configure TaskSync options directly within the sidebar
  - Manage reusable prompts from the Settings panel
- **feat(prompts)**: Reusable Prompts with `/slash` command support
  - Create, edit, and delete saved prompts accessible via `/command` syntax
  - Autocomplete dropdown when typing `/` in the input field
  - Prompts persist across sessions via `tasksync.reusablePrompts` setting
- **feat(session)**: Add "Clear Current Session" command with trash icon in title bar
  - Quickly clear all tool calls from current session
  - Confirmation modal to prevent accidental data loss
- **feat(ui)**: Interactive Approval UI improvements
  - New `tasksync.interactiveApproval` setting to toggle approval buttons
  - Enhanced Yes/No and multiple choice button rendering
- **feat(notifications)**: Notification sound for incoming tool calls
  - Audio alert when AI requests user input
  - Helps users notice pending questions while multitasking
- **refactor(utils)**: Extract shared utility functions into dedicated modules
  - New `src/constants/fileExclusions.ts` for centralized file exclusion patterns
  - New `src/utils/imageUtils.ts` for image processing utilities
- **chore(assets)**: Remove 5 unused SVG files from `media/` folder
- **refactor(logging)**: Clean up logging statements across the codebase
  - Remove all `console.log` and `console.warn` statements
  - Retain only `console.error` for critical error handling
- **refactor(code)**: Eliminate duplicate code and improve maintainability
  - Extract shared constants and utility functions
  - Clean up outdated and redundant comments
- **chore(deps)**: Update dependencies and clean up `package.json`


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
