# TaskSync — Copilot Repository Instructions

## What This Repository Does

TaskSync is a human-in-the-loop workflow toolkit for AI-assisted development. The primary codebase is the VS Code extension in `tasksync-chat/`. It provides a sidebar with smart prompt queuing, Autopilot mode, and remote access via WebSocket.

## Project Layout

- `tasksync-chat/src/extension.ts` — Extension entry point
- `tasksync-chat/src/tools.ts` — VS Code language model tool definitions (`ask_user`)
- `tasksync-chat/src/webview/webviewProvider.ts` — Orchestrator: owns state, creates webview, delegates to handlers
- `tasksync-chat/src/webview/webviewTypes.ts` — Shared types (`P` interface, message unions)
- `tasksync-chat/src/webview/webviewUtils.ts` — Shared helpers (`debugLog()`, `mergeAndDedup()`, `notifyQueueChanged()`)
- `tasksync-chat/src/webview/*Handlers.ts` — Handler modules receive a `P` interface (no circular imports)
- `tasksync-chat/src/server/` — Remote server, auth, git operations, HTML service
- `tasksync-chat/src/constants/` — Shared constants (config keys, file exclusions, remote constants)
- `tasksync-chat/src/context/` — Context providers (files, terminal, problems)
- `tasksync-chat/src/utils/` — Utilities (ID generation, image handling)
- `tasksync-chat/esbuild.js` — Build script (extension, webview, shared constants, mermaid)
- `tasksync-chat/biome.json` — Biome linter/formatter config
- `tasksync-chat/vitest.config.ts` — Test config
- `tasksync-chat/web/` — Remote access PWA (login, service worker)
- `tasksync-chat/src/constants/hookContent.ts` — Copilot hook message SSOT
- `Prompt/` — Standalone prompt/protocol markdown files (not actively developed)

## Build, Test, and Validate

All commands run from `tasksync-chat/`:

```bash
cd tasksync-chat
npm install          # Always run first
npm run validate     # Full validation: build + tsc + test + lint + code quality scanner
```

Or run individually:

```bash
node esbuild.js      # Build → dist/extension.js, media/webview.js, web/shared-constants.js
npx tsc --noEmit     # Type-check (must produce 0 errors)
npx vitest run       # Run all tests (387+ tests, must all pass)
npm run lint         # Biome lint (must produce 0 issues)
npm run check-code        # Code quality scanner (duplicates, sync I/O, etc.)
```

Always run these four checks (build, tsc, vitest, lint) after making changes. The CI workflow (`.github/workflows/auto-release.yml`) runs on pushes to `main` — it installs deps, builds, version-bumps, packages VSIX, and creates a GitHub release.

Build output: `dist/` (extension bundle), `media/webview.js` (webview bundle), `web/shared-constants.js` (auto-generated for remote PWA).

## Code Style and Conventions

- **TypeScript** with `"strict": true`, ES2022 target, CommonJS modules
- **Indentation:** Tabs (enforced by Biome)
- **Quotes:** Double quotes (enforced by Biome)
- **Imports:** Auto-organized by Biome (`organizeImports: on`)
- **Type assertions:** Use `satisfies` over `as` (e.g., `} satisfies ToWebviewMessage`). `satisfies` validates shape at compile time; `as` silently bypasses checks.
- **Async I/O:** Always prefer async file operations over synchronous equivalents. Never use synchronous blocking calls on the extension host.
- **Logging:** Use `debugLog()` from `webviewUtils.ts` (gated behind `tasksync.debugLogging` config). Use `console.error` only for genuine errors. Never use `console.log` or `console.warn` in production code.
- **Changelog:** Update `CHANGELOG.md` for every user-facing change using the format `## TaskSync vX.Y.Z (MM-DD-YY)` (two-digit year).

## SSOT / DRY / KISS / YAGNI Principles

These principles are mandatory for all changes:

- **Single Source of Truth (SSOT):** Every concept, constant, type, or piece of logic must have exactly one canonical definition. Do not duplicate config keys, message types, validation logic, or shared helpers. Constants live in `src/constants/`. Shared types live in `webviewTypes.ts`. Shared helpers live in `webviewUtils.ts`.
- **Don't Repeat Yourself (DRY):** If logic is used in more than one place, extract it into a shared helper. Examples already in the codebase: `debugLog()`, `mergeAndDedup()`, `notifyQueueChanged()`, `hasQueuedItems()`, `resolveFilePath()` (gitService). When you see the same pattern in 3+ call sites, extract it.
- **Keep It Simple, Stupid (KISS):** Prefer the simplest solution that works. Do not add abstraction layers, configuration options, or indirection without clear justification. A small amount of duplication is acceptable if the alternative is a complex abstraction for only 2 call sites.
- **You Aren't Gonna Need It (YAGNI):** Do not add features, parameters, or code paths "just in case." Only implement what is needed for the current task. Do not design for hypothetical future requirements.
- **Handler pattern:** All handler modules (`*Handlers.ts`) receive a `P` interface — do not add direct imports from `webviewProvider.ts`. This prevents circular dependencies.

## Security Best Practices

Follow OWASP Top 10 principles. Specific patterns enforced in this codebase:

- **Timing-safe comparison:** Use `crypto.timingSafeEqual` with fixed-length digests (SHA-256) for PIN/secret comparison — never early-return on length differences. See `remoteAuthService.ts` `comparePinTimingSafe()`.
- **Path traversal prevention:** All file paths from remote clients must be validated with `isValidFilePath()` in `gitService.ts` — rejects `..`, absolute paths (when no workspace), null bytes, backticks, and shells metacharacters. Use `path.isAbsolute()` instead of `startsWith("/")` for cross-platform correctness.
- **Command injection prevention:** Use `child_process.spawn` with argument arrays — never `exec` or string interpolation in shell commands. See `gitService.ts` `unstage()`.
- **No credentials in code:** Never commit secrets, API keys, or tokens. Auth uses ephemeral PINs with session tokens and lockout after failed attempts.
- **Input validation at boundaries:** Validate all user/remote input at the entry point. Trust internal code and framework guarantees — do not add redundant validation deep in call stacks.
- **TLS certificates:** `generateSelfSignedCert` strips ports and brackets from hosts before SAN detection. Always test IPv4, IPv6 (`::1`), bracketed IPv6 (`[::1]:port`), and hostname:port formats.
- **Security headers:** Set `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and `X-XSS-Protection` on all HTTP responses. See `serverUtils.ts` `setSecurityHeaders()`.
- **Origin validation:** Check `Origin` and `Host` headers on WebSocket upgrade requests. See `serverUtils.ts` `isAllowedOrigin()`.

## Testing Strategy

- **Framework:** Vitest, 14 test files, 387+ tests, ~98% coverage
- **VS Code mock:** `src/__mocks__/vscode.ts` — mocks VS Code API for unit tests
- **Test setup:** Tests that use git operations must set `(vscode.workspace as any).workspaceFolders` in `beforeEach`
- **Coverage requirement:** Maintain or improve coverage. Add tests for new logic, especially:
  - Security-sensitive code (auth, path validation, input parsing)
  - Edge cases in parsing (IPv6, ports, special characters)
  - Error handling paths

## Architecture Notes

- The `ask_user` tool (registered in `tools.ts`, handled in `toolCallHandler.ts`) is the core interaction primitive.
- Queue, history, and settings are per-workspace (workspace-scoped storage with global fallback).
- Session state uses a boolean `sessionTerminated` flag — do not use string matching for termination detection.
- Debounced history saves (2 s) for disk I/O performance.
- Remote server uses WebSocket over HTTP with PIN-based auth and session tokens.
- `esbuild.js` watch mode monitors `remoteConstants.ts` changes and rebuilds shared constants with 100ms debounce.
- **Copilot Hooks:** Hook messages are defined in `src/constants/hookContent.ts` (SSOT). The default hook file is generated to `~/.copilot/hooks/tasksync.json` and adds non-blocking `SessionStart`, `PreCompact`, and `SubagentStart` guidance. This repository also keeps a matching workspace copy at `.github/hooks/tasksync.json`. The `TaskSync: Setup Global Copilot Hooks` command generates the user-scoped hook file from the SSOT. Agent-scoped hooks can also be set in `.agent.md` frontmatter.
