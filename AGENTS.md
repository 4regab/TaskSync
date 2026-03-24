# AGENTS.md — TaskSync Development Guide

This file provides guidance for AI coding agents working on the TaskSync repository.

---

## Repository Overview

TaskSync is a human-in-the-loop workflow toolkit for AI-assisted development. It provides three integration options:

1. **TaskSync VS Code Extension** (`tasksync-chat/`) — A sidebar extension with smart prompt queuing, Autopilot, and an MCP server.
2. **TaskSync Prompt** (`Prompt/`) — Terminal-based agent protocols (Markdown prompts for use as AI instructions).
3. **TaskSync MCP Server** — An external MCP server ([tasksync-mcp](https://github.com/4regab/tasksync-mcp)).

The primary active codebase is the VS Code extension in `tasksync-chat/`.

---

## Repository Structure

```
TaskSync/
├── AGENTS.md               # This file
├── CHANGELOG.md            # Release history
├── README.md               # Project overview
├── LICENSE
├── Prompt/                 # Standalone prompt/protocol markdown files
│   ├── tasksync-v5.2.md
│   ├── tasksync-v5.1.md
│   ├── tasksync-v5.md
│   ├── tasksync_v4.md
│   └── specs-tasksync.md
└── tasksync-chat/          # VS Code extension (main codebase)
    ├── src/
    │   ├── extension.ts            # Extension entry point
    │   ├── tools.ts                # VS Code language model tool definitions
    │   ├── constants/              # Shared constants (config keys, file exclusions)
    │   ├── context/                # Context providers (files, terminal, problems)
    │   ├── mcp/
    │   │   └── mcpServer.ts        # MCP server (SSE transport)
    │   ├── server/                 # Remote access server, auth, git, HTML service
    │   ├── utils/                  # Shared utilities (ID generation, image handling)
    │   └── webview/
    │       ├── webviewProvider.ts  # Sidebar webview provider (orchestrator)
    │       ├── webviewTypes.ts     # Shared types (P interface, message unions)
    │       ├── webviewUtils.ts     # Shared helpers (debugLog, mergeAndDedup, etc.)
    │       ├── messageRouter.ts    # Webview ↔ extension message dispatch
    │       ├── toolCallHandler.ts  # ask_user tool lifecycle and AI turn tracking
    │       ├── choiceParser.ts     # Parse approval/choice questions into UI buttons
    │       ├── queueHandlers.ts    # Queue operations (add, remove, reorder, toggle)
    │       ├── lifecycleHandlers.ts# Setup, dispose, new session
    │       ├── sessionManager.ts   # Session timer, sound notifications
    │       ├── persistence.ts      # Disk I/O for queue and history
    │       ├── settingsHandlers.ts # Settings read/write, UI sync
    │       ├── fileHandlers.ts     # File search, attachments, context references
    │       └── remoteApiHandlers.ts# Remote client message handling
    │   └── webview-ui/             # Webview frontend (JS/CSS, no framework)
    ├── media/                      # Icons, webview JS/CSS assets
    ├── web/                        # Remote access PWA (login page, service worker)
    ├── e2e/                        # Playwright e2e smoke tests
    ├── package.json
    ├── tsconfig.json
    ├── biome.json                  # Linter/formatter config
    ├── vitest.config.ts            # Test config
    └── esbuild.js                  # Bundler config
```

---

## Development Setup

All commands run from the `tasksync-chat/` directory.

```bash
cd tasksync-chat
npm install
```

| Task | Command |
|---|---|
| Build | `node esbuild.js` |
| Type-check | `npx tsc --noEmit` |
| Test | `npx vitest run` |
| Lint | `npm run lint` |
| Watch mode | `npm run watch` |
| Package VSIX | `npx vsce package` |

> **Build output** goes to `dist/` (extension bundle), `media/webview.js` (webview bundle), and `web/shared-constants.js` (auto-generated for the remote PWA).
>
> Always run build, tsc, vitest, and lint after making changes.

---

## Code Conventions

- **Language:** TypeScript with `"strict": true`
- **Target:** ES2022, CommonJS modules
- **Indentation:** Tabs (enforced by Biome)
- **Quotes:** Double quotes for JavaScript/TypeScript strings (enforced by Biome)
- **Linter/Formatter:** [Biome](https://biomejs.dev/) — run `npm run lint` before committing
- **Imports:** Organised automatically by Biome (`organizeImports: on`)
- **Debug logging:** Use `debugLog()` from `webviewUtils.ts` — gated behind `tasksync.debugLogging` config setting. Never use `console.log` or `console.warn` in production code.
- **Error logging:** Use `console.error` only for genuine error/failure paths.
- **Type assertions:** Use `satisfies` over `as` for message types (e.g., `} satisfies ToWebviewMessage)`). The `satisfies` keyword validates shape at compile time; `as` silently bypasses checks.
- **Async I/O:** Prefer async file operations over synchronous equivalents.
- **Promises:** `IncomingRequest` objects must store both `resolve` and `reject` for proper cleanup on dispose.
- **DRY:** Shared logic goes in `webviewUtils.ts`. Examples: `debugLog()`, `mergeAndDedup()`, `notifyQueueChanged()`, `hasQueuedItems()`, `resolveFilePath()` (gitService).

---

## SSOT / DRY / KISS / YAGNI Principles

These principles are mandatory for all changes:

- **Single Source of Truth (SSOT):** Every concept, constant, type, or piece of logic must have exactly one canonical definition. Constants live in `src/constants/`. Shared types live in `webviewTypes.ts`. Shared helpers live in `webviewUtils.ts`.
- **Don't Repeat Yourself (DRY):** If logic is used in more than one place, extract it into a shared helper. When you see the same pattern in 3+ call sites, extract it.
- **Keep It Simple, Stupid (KISS):** Prefer the simplest solution that works. Do not add abstraction layers without clear justification. A small amount of duplication is acceptable if the alternative is a complex abstraction for only 2 call sites.
- **You Aren't Gonna Need It (YAGNI):** Do not add features, parameters, or code paths "just in case." Only implement what is needed for the current task.
- **Handler pattern:** All handler modules (`*Handlers.ts`) receive a `P` interface — do not add direct imports from `webviewProvider.ts`. This prevents circular dependencies.

---

## Key Architectural Notes

- The `ask_user` VS Code language model tool is the core interaction primitive. It is registered in `tools.ts` and handled in `toolCallHandler.ts`.
- `webviewProvider.ts` is the orchestrator — it owns state, creates the webview, and delegates to handler modules.
- Handler modules (`*Handlers.ts`) receive a `P` interface (defined in `webviewTypes.ts`) that exposes provider state and methods without circular imports.
- Queue, history, and settings are **per-workspace** (workspace-scoped storage with global fallback).
- The MCP server (`mcpServer.ts`) runs on a configurable port (default `3579`) using Streamable HTTP transport (with `/sse` backward-compat routing) and auto-registers with Kiro and Antigravity on activation.
- Session state uses a boolean `sessionTerminated` flag — do not use string matching for termination detection.
- Debounced history saves (2 s) are used for disk I/O performance.
- The remote server (`server/`) uses plain WebSocket over HTTP. Auth is PIN-based with session tokens.

---

## Testing

- **Framework:** Vitest (14 test files, 384+ tests, ~98% coverage)
- **Mocks:** VS Code API is mocked in `src/__mocks__/vscode.ts`
- **Test setup:** Tests that use git operations must set `(vscode.workspace as any).workspaceFolders` in `beforeEach`
- **Coverage:** Maintain or improve coverage. Add tests for security-sensitive code, edge cases, and error handling paths.
- Run `npx vitest run` to execute all tests. Always verify tests pass after changes.

---

## Changelog & Versioning

- Update `CHANGELOG.md` with every user-facing change using the existing format: `## TaskSync vX.Y.Z (MM-DD-YY)` (two-digit year, e.g. `02-25-26`).

---

## Security & Responsible Use

Follow OWASP Top 10 principles. Specific patterns enforced in this codebase:

- **No credentials in code:** Never commit secrets, API keys, or tokens.
- **No blocking calls:** Do not introduce synchronous blocking calls on the VS Code extension host.
- **No console.log/warn:** Use `debugLog()` for debug output and `console.error` for genuine errors.
- **Timing-safe comparison:** Use `crypto.timingSafeEqual` with SHA-256 digests for PIN/secret comparison. See `remoteAuthService.ts`.
- **Path traversal prevention:** Validate all remote file paths with `isValidFilePath()` in `gitService.ts`. Use `path.isAbsolute()` instead of `startsWith("/")`.
- **Command injection prevention:** Use `child_process.spawn` with argument arrays — never `exec` or string interpolation.
- **Input validation at boundaries:** Validate all user/remote input at the entry point. Trust internal code deeper in call stacks.
- **Security headers:** Set CSP, X-Content-Type-Options, X-Frame-Options, and X-XSS-Protection on all HTTP responses.
- **Origin validation:** Check `Origin` and `Host` headers on WebSocket upgrade requests.
