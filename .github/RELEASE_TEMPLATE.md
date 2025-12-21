# Auto Release

Every push to `main` that modifies `tasksync-chat/` automatically:
1. ✅ Bumps the patch version (2.0.5 → 2.0.6)
2. ✅ Updates CHANGELOG.md with commit message
3. ✅ Publishes to VS Code Marketplace
4. ✅ Creates GitHub Release with VSIX attached

## Just Commit!

```bash
git add .
git commit -m "fix: resolve queue duplication bug"
git push origin main
```

That's it. The workflow handles versioning, changelog, and publishing.

## Commit Message Tips

Your commit message becomes the changelog entry:
- `fix: resolve queue duplication bug`
- `feat: add keyboard shortcuts`
- `perf: optimize file search`

## Required Secret

Add `VSCE_PAT` to GitHub (`Settings → Secrets → Actions`):
- Get from: https://dev.azure.com/
- Scope: "Marketplace: Manage"

## Skip Release

If you're making a docs-only change:
```bash
git commit -m "docs: update readme [skip ci]"
```
