# DiffLens

Local-first AI code review for your own machine. Binds to `127.0.0.1:4317` only.

Status: **Phase 1 of 7** (foundation: layout, dashboard, SQLite + Drizzle, request guards).
Reviewing code, GitHub PRs and the AI engine arrive in later phases; pages for them say so.

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
