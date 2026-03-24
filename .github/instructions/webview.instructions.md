---
applyTo: "tasksync-chat/src/webview/**"
---

# Webview Architecture

## Handler Pattern
- All handler modules (`*Handlers.ts`) receive a `P` interface (from `webviewTypes.ts`)
- Do not import directly from `webviewProvider.ts` — this prevents circular dependencies
- `webviewProvider.ts` is the orchestrator: owns state, creates webview, delegates to handlers

## Shared Helpers (DRY)
- Shared logic lives in `webviewUtils.ts`: `debugLog()`, `mergeAndDedup()`, `notifyQueueChanged()`, `hasQueuedItems()`
- When the same pattern appears in 3+ handler files, extract it to `webviewUtils.ts`

## Types
- Shared types live in `webviewTypes.ts` — one canonical definition per message type
- Use `satisfies` for message type validation (e.g., `} satisfies ToWebviewMessage`)

## Session State
- Uses a boolean `sessionTerminated` flag — do not use string matching for termination detection
- Debounced history saves (2 s) for disk I/O performance

## Storage
- Queue, history, and settings are per-workspace (workspace-scoped storage with global fallback)
