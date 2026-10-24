# Working on Boards

Instructions for AI coding tools (Claude Code, Codex) and anyone new to the repo.

## Branches and pull requests

This repo uses Git Flow; the full process is in [docs/RELEASING.md](docs/RELEASING.md).

- Start work from `develop`: `git switch develop && git pull --ff-only && git switch -c feature/<name>` (or `bugfix/<name>`).
- Open pull requests **into `develop`**: `gh pr create --base develop`. Never into `master`.
- Only `release/X.Y.Z` (PR titled `Release X.Y.Z`) and `hotfix/<name>` (PR titled `Hotfix X.Y.Z`) merge into `master`. The `branch-policy` check fails any other PR into `master`.
- Every release or hotfix is back-merged into `develop` afterwards (docs/RELEASING.md, "Back-merge").
- PR titles are Conventional Commits (`feat: …`, `fix: …`): PRs are squash-merged and the title drives the version bump.
- Don't edit version numbers by hand (`.cz.toml`, `package.json`, `Cargo.toml`, the lock files); CI bumps them.

## Before you open a pull request

```bash
npm test
npm run build                      # type-checks and bundles
cd src-tauri && cargo test && cargo clippy
```

## Releases

- A release's notes go at the top of `RELEASE_NOTES` in `src/lib/releaseNotes.ts`. Users see them once in What's New after updating.
- Never write to a real Azure DevOps organisation while testing; use the web demo (`npm run dev`) or a test project.
