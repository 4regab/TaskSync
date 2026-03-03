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
    │   ├── constants/              # Shared constants
    │   ├── context/                # Context providers (files, terminal, problems)
    │   ├── mcp/
    │   │   └── mcpServer.ts        # MCP server (SSE transport)
    │   ├── utils/                  # Shared utilities
    │   └── webview/
    │       └── webviewProvider.ts  # Sidebar webview and ask_user tool handler
    ├── media/                      # Icons, webview JS/CSS assets
    ├── package.json
    ├── tsconfig.json
    ├── biome.json                  # Linter/formatter config
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
| Build (bundle for distribution) | `npm run build` |
| Type-check (TypeScript) | `npm run compile` |
| Lint | `npm run lint` |
| Watch mode | `npm run watch` |
| Package VSIX | `npx vsce package` |

> **Build output** goes to `tasksync-chat/dist/`. This directory is excluded from version control via `.gitignore` and `.vscodeignore`.

---

## Code Conventions

- **Language:** TypeScript with `"strict": true`
- **Target:** ES2022, CommonJS modules
- **Indentation:** Tabs (enforced by Biome)
- **Quotes:** Double quotes for JavaScript/TypeScript strings (enforced by Biome)
- **Linter/Formatter:** [Biome](https://biomejs.dev/) — run `npm run lint` before committing
- **Imports:** Organised automatically by Biome (`organizeImports: on`)
- **Error handling:** Use `console.error` only; remove `console.log`/`console.warn` from production paths
- **Async I/O:** Prefer async file operations over synchronous equivalents
- **Promises:** `IncomingRequest` objects must store both `resolve` and `reject` for proper cleanup on dispose

---

## Key Architectural Notes

- The `ask_user` VS Code language model tool is the core interaction primitive. It is registered in `tools.ts` and handled in `webviewProvider.ts`.
- Queue, history, and settings are **per-workspace** (workspace-scoped storage with global fallback).
- The MCP server (`mcpServer.ts`) runs on a fixed port (default `3579`) using SSE transport and auto-registers with Kiro (AWS AI IDE), Cursor, and Antigravity on activation.
- Session state uses a boolean `sessionTerminated` flag — do not use string matching for termination detection.
- Debounced history saves (2 s) are used for disk I/O performance.

---

## Changelog & Versioning

- Update `CHANGELOG.md` with every user-facing change using the existing format: `## TaskSync vX.Y.Z (MM-DD-YY)` (two-digit year, e.g. `02-25-26`).

---

## Security & Responsible Use

- Do not commit secrets or credentials.
- Do not introduce synchronous blocking calls on the VS Code extension host.
- Remove all `console.log`/`console.warn` statements once all issues are fixed; use `console.error` for genuine errors only.
