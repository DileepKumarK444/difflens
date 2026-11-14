# DiffLens

Local-first AI code review for your own machine. Binds to `127.0.0.1:4317` only.

Status: **Phase 3 of 7** (GitHub PRs through `gh`, on top of local git).
The AI engine (Phase 4), findings UI (5), history/export/posting (6) arrive later; pages for them say so.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:4317
npm test           # vitest
npm run typecheck
```

Data lives in `~/Library/Application Support/DiffLens/` (override with `DIFFLENS_DATA_DIR`).
Migrations in `drizzle/` run automatically at startup; regenerate with `npm run db:generate`.

## Security model

- Requests with a non-loopback `Host`, a cross-origin `Origin`, or (for POST/PUT/PATCH/DELETE) a missing or wrong CSRF token are rejected in `src/proxy.ts`.
- Git and `gh` access (Phase 2+) is read-only and uses `execFile` with argument arrays.

## Local git (Phase 2)

- Add a repo by its absolute top-level path. DiffLens resolves it with `realpath`, confirms it is a git work tree, and only ever reads repos you added.
- Scopes: current branch vs base (merge-base, like a PR), unstaged + untracked, staged, one commit, a range. The base is detected from `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`, and can be overridden.
- Every git call is `execFile` with an argument array, an allowlist of read-only subcommands, `-c core.fsmonitor=false -c core.hooksPath=/dev/null`, `--no-ext-diff --no-textconv`, `GIT_OPTIONAL_LOCKS=0`. Revisions are resolved to commit SHAs before use. Tests include repos whose config tries to run code.
- Monaco is served from `public/monaco` (copied from `node_modules` by `scripts/copy-monaco.mjs`), not a CDN.
- Keys in the workspace: `j` / `k` move between files.

## GitHub pull requests (Phase 3)

- Uses the `gh` CLI you are already logged into. DiffLens never asks for, stores or logs a token by default. Optional token accounts live only in the macOS Keychain (Settings).
- New review → **Team PRs**: pick an added repo (its GitHub `owner/repo` is read from the `origin` remote), all added repos at once, or type `owner/repo`. Filters: all open, waiting for my review (`review-requested:@me`), my PRs (`author:@me`). Up to 100 open PRs per repo, with draft state, +/- lines and review decision.
- New review → **PR link**: paste a `https://github.com/owner/repo/pull/123` link. Only `github.com` and the optional Enterprise host (Settings) are accepted; credentials, ports and other hosts are rejected before any request is made.
- Pick which GitHub account to use per request (default account, whichever `gh` has active, or a specific one).
- The PR diff comes from `gh pr diff`; the two sides of each file come from the contents API at the merge-base and head commits, so the viewer matches what GitHub shows.
- Read-only: Phase 3 never posts anything to GitHub.
