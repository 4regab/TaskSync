---
applyTo: "**/*.test.ts"
---

# Testing Standards

## Framework
- Vitest with 384+ tests across 14 test files (~98% coverage)
- VS Code API is mocked in `src/__mocks__/vscode.ts`

## Test Setup
- Tests that use git operations must set `(vscode.workspace as any).workspaceFolders` in `beforeEach`
- Always call `vi.restoreAllMocks()` in `beforeEach` to prevent test pollution

## Coverage
- Maintain or improve the current ~98% coverage
- Add tests for security-sensitive code (auth, path validation, input parsing)
- Add tests for edge cases (IPv6, ports, special characters, Windows paths)
- Add tests for error handling paths

## Patterns
- Use `describe` blocks grouped by function or class method
- Use descriptive test names: "throws for invalid file path", "strips port from hostname"
- Test both happy paths and error conditions
- For async operations, use `await expect(...).rejects.toThrow()`
