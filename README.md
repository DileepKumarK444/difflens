# DiffLens

Local-first AI code review for your own machine. Binds to `127.0.0.1:4317` only.

Status: **Phase 2 of 7** (local git: repositories, status, diffs for five scopes, Monaco diff viewer).
GitHub PRs (Phase 3) and the AI engine (Phase 4) arrive later; pages for them say so.

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
