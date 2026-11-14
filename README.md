# DiffLens

Local-first AI code review for your own machine. Binds to `127.0.0.1:4317` only.

Status: **Phase 6 of 7** (history, compare, export, copy-fix prompts and optional GitHub posting).
Polish and the remaining test pass are Phase 7.

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

## AI review engine (Phase 4)

Pick a provider in Settings. Only the selected one is ever contacted, and the banner always says whether code leaves your machine.

| Provider | Needs | Code goes to |
|---|---|---|
| Claude Code (default) | `claude` installed and logged in | Anthropic, through your own login (no API key) |
| Ollama | Ollama running, a model pulled | This machine (or the server you name) |
| Anthropic API | `ANTHROPIC_API_KEY` in the environment DiffLens runs in | Anthropic |

How a review works: the diff is split into parts (at most 12 by default) and each part is sent as untrusted data inside a random boundary, with every line numbered. Replies must be JSON matching a Zod schema; an invalid reply gets exactly one repair attempt, then a clear error. Every finding is then checked against the diff you reviewed: invented files are dropped, lines outside the diff are moved to the nearest changed line and downgraded (or dropped if far away), duplicates are merged, and findings below your minimum severity are removed. Big diffs are marked **partial** and list what was skipped.

Claude Code is run as `claude -p --output-format json` with only `Read,Grep,Glob`, `--permission-mode dontAsk`, no MCP servers, no session saved, the prompt on stdin, and a clean environment (your own login is used; any inherited `ANTHROPIC_*` or `CLAUDE_*` variables are dropped). It runs in the repository only when it is exactly the code under review.

Before anything is sent to Anthropic, DiffLens shows what will be sent and waits for you (Settings can change this to once per session or never).

Use **Settings → Send test message** to check a provider end to end without sending any code.

## Findings UI (Phase 5)

- Findings appear in the right panel as cards, worst first, with severity, category, confidence, the explanation, why it matters, a suggested fix and an example. Everything from the model is shown as plain text.
- Triage each finding as **Open**, **Resolved** or **Ignored**, and keep a personal note (saved automatically). Both persist in SQLite and feed the dashboard counts.
- Filter by status, severity and category, and search titles, descriptions, files and your notes.
- Click a finding's location (or press a key) to jump to the changed code: the file is selected, the line is revealed, and Monaco shows a severity-coloured marker in the gutter with a plain-text hover. Clicking a gutter marker selects its card.
- The file list shows how many findings in each file are still open.
- A review stays attached to the page through `?review=<id>`, so a reload brings the findings back.

Keys: `j` / `k` move between files, `]` / `[` move to the next / previous finding in the current filter, `r` resolve, `i` ignore, `o` reopen the selected finding.

## History, export and posting (Phase 6)

- **History** lists every saved review (search, filter by source and status). **Open** shows it exactly as it was reviewed, rebuilt from the saved diff, so it works even if the branch or PR has since changed. **Open the live diff** jumps back to the current code.
- **Compare** two reviews: findings are matched by file and wording (line numbers drift), and shown as no longer reported, new, or still there.
- **Export** a review as Markdown (all findings, statuses and your notes), or **delete** it (findings, notes and the saved diff go too).
- **Fix your own issues**: *Copy fix prompt* (one finding, or all open ones in the current filter) builds a prompt for Claude Code or your editor. DiffLens never edits your files.
- **Post to GitHub** (pull request reviews only, never local ones, never automatic): tick findings, optionally tick *as a suggestion* (GitHub's one-click Commit suggestion, only when you tick it), and click Post. A dialog first shows exactly what will be posted to which `owner/repo #N`, lets you edit every comment, and only then posts. It is always one review with event `COMMENT` (never approve or request changes), from the GitHub account chosen for that PR.
  - Each comment is placed on its line when GitHub will accept it. If any comment can't be placed on the diff (or GitHub rejects the positions), everything is posted as one general comment and you are told.
  - Refused: a closed PR, a PR with new commits since the review (re-run the review), a confirmation that names the wrong repo or number, and any local review.
  - Findings you posted are marked *posted*.
