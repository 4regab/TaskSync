---
applyTo: "tasksync-chat/src/server/**"
---

# Security Standards (Server Code)

All code in `src/server/` handles remote client connections and must follow strict security practices.

## Timing-Safe Comparison
- Use `crypto.timingSafeEqual` with fixed-length SHA-256 digests for PIN/secret comparison
- Never early-return on length differences — hash both inputs first
- See `remoteAuthService.ts` `comparePinTimingSafe()` for the pattern

## Path Traversal Prevention
- All file paths from remote clients must be validated with `isValidFilePath()` in `gitService.ts`
- Reject `..`, null bytes, backticks, and shell metacharacters
- Use `path.isAbsolute()` instead of `startsWith("/")` for cross-platform correctness
- Use the shared `resolveFilePath()` helper for getDiff/stage/unstage/discard operations

## Command Injection Prevention
- Use `child_process.spawn` with argument arrays — never `exec` or string interpolation
- See `gitService.ts` `unstage()` for the correct pattern

## Auth
- Auth uses ephemeral PINs with session tokens and lockout after failed attempts
- Never commit secrets, API keys, or tokens

## Input Validation
- Validate all user/remote input at the entry point (system boundary)
- Trust internal code and framework guarantees — no redundant validation deep in call stacks

## TLS Certificates
- `generateSelfSignedCert` strips ports and brackets from hosts before SAN detection
- Always test IPv4, IPv6 (`::1`), bracketed IPv6 (`[::1]:port`), and hostname:port formats

## HTTP Security
- Set `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection` on all responses
- Check `Origin` and `Host` headers on WebSocket upgrade requests
- See `serverUtils.ts` `setSecurityHeaders()` and `isAllowedOrigin()`
