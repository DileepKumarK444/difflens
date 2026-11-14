# DiffLens

A local-first AI code review tool for one person. Review your own changes before you push, review your team's pull requests, triage the findings, and optionally leave the good ones on GitHub as one review comment.

It runs only on your machine (`127.0.0.1:4317`). Git and GitHub access is read-only, apart from one confirmed action: posting a review comment to a pull request.

## What you can do

- **Review before you push.** Pick a repository you've added and review the current branch against its base (closest to a PR), unstaged changes plus new files, staged changes, one commit, or a range.
- **Review team PRs.** List open PRs (up to 100) for one repo or all your added repos, filtered to all open, waiting for your review, or your own. Or paste a PR link.
- **See findings in the code.** A three-panel workspace: changed files with open-finding counts, a Monaco diff with markers on the flagged lines, and a findings panel with cards, filters and search.
- **Triage.** Mark each finding Open, Resolved or Ignored and add a private note. Everything is saved in SQLite.
- **Keep history.** Reopen any past review exactly as it was, compare two reviews, export Markdown, delete.
- **Fix your own issues.** *Copy fix prompt* builds a prompt to paste into Claude Code or your editor. DiffLens never edits your files.
- **Comment on GitHub (optional).** Tick findings on a PR review, check the exact comments in a confirmation dialog, and post them as a single review with event `COMMENT`.

## Requirements

| Needed for | What |
|---|---|
| Everything | Node.js 22 or newer, `git` |
| GitHub PRs | The [GitHub CLI](https://cli.github.com) (`gh`), logged in with `gh auth login` |
| AI review (default) | [Claude Code](https://claude.com/claude-code) installed and logged in (`claude`, then `/login`) |
| AI review (local) | [Ollama](https://ollama.com) running, with a model pulled (optional) |
| AI review (API) | `ANTHROPIC_API_KEY` in the environment DiffLens runs in (optional) |

macOS is the supported platform. Token accounts use the macOS Keychain.

## Set up

```bash
git clone https://github.com/DileepKumarK444/difflens.git
cd difflens
npm install        # also copies the Monaco editor into public/monaco (no CDN)
npm run dev        # http://127.0.0.1:4317
```

Then:

1. **Settings → AI review.** Choose a provider, save, then click **Send test message**. It sends one fixed line (no code) to prove the provider works from this app.
2. **Repositories → Add.** Paste the absolute path of a git repository's top-level folder.
3. **New review.** Choose Local changes, Team PRs or PR link, open the diff, and click **Run review**.

For a production build: `npm run build && npm start` (also bound to `127.0.0.1:4317`).

### Several GitHub accounts

Settings → GitHub accounts lists every account from `gh auth login` and lets you choose a default, or pick one per request on New review. You can also add a token account; its token is stored only in the macOS Keychain. For GitHub Enterprise, add the host in Settings and log in with `gh auth login --hostname <host>`.

## Privacy

- The banner at the top always says where your code goes: **Local only** (Ollama on this machine) or **Code is sent to Anthropic** (Claude Code or the Anthropic API).
- Before anything is sent to Anthropic, DiffLens shows a dialog naming the review, the files, the size and the provider. You can change this to "once per session" or "never" in Settings.
- Only the selected provider is ever contacted. The Anthropic API key is read from an environment variable on the server and never reaches the browser.
- Your data lives in `~/Library/Application Support/DiffLens/` (`difflens.sqlite`, plus a `tmp` folder). Override the location with `DIFFLENS_DATA_DIR`. Delete that folder to reset everything.

## How a review works

1. The diff is split into parts (at most 12 by default) and lock files and binaries are skipped.
2. Each part goes to the model with every line numbered, inside a random boundary, with an instruction to treat it as untrusted data.
3. Replies must be JSON matching a schema. An invalid reply gets exactly one repair attempt, then a clear error.
4. Every finding is checked against the diff that was reviewed. Invented files are dropped. Lines outside the diff are moved to the nearest changed line and downgraded, or dropped if far away. Duplicates are merged, and findings below your minimum severity are removed.
5. A diff too large for the part limit is marked **partial** and lists what was skipped.

Claude Code is run as `claude -p --output-format json` with only `Read,Grep,Glob`, `--permission-mode dontAsk`, no MCP servers and no saved session. The prompt goes in on stdin, and the process gets a clean environment so your own login is used. It runs inside the repository only when that repository is exactly the code under review.

## Security model

- Binds to `127.0.0.1` only. Requests with a non-loopback `Host`, a cross-origin `Origin`, or a missing CSRF token on a mutating route are rejected (`src/proxy.ts`). Pages carry a strict Content-Security-Policy.
- Every program is started with `execFile` or `spawn` and an argument array, in one module (`src/lib/exec.ts`). There is no shell.
- Git runs through an allowlist of read-only subcommands with `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c protocol.ext.allow=never`, `--no-ext-diff --no-textconv` and `GIT_OPTIONAL_LOCKS=0`. Branch names and revisions are validated, and resolved to commit SHAs before they reach git, so a repository's own config can't run code.
- `gh` runs through an allowlist too: read-only commands, plus exactly one write, posting a review to a pull request.
- Repository paths must be absolute, free of `..`, real git work trees, and are stored by real path. Only added repositories are ever read.
- Diffs, repository content and model output are untrusted: they are shown as escaped text, never as HTML.
- Nothing logs source code, tokens or keys (there is no logging of request or file content at all).

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm start            # production server
npm test             # unit tests (Vitest)
npm run typecheck    # TypeScript, strict mode
npm run lint
npm run db:generate  # create a new migration after editing src/lib/db/schema.ts
```

Migrations in `drizzle/` run automatically when the app starts.

## Tests

`npm test` runs about 240 tests, including:

- git argument handling, an allowlist of read-only subcommands, and repositories whose own config tries to run code (it must not)
- path, branch and revision validation, PR link and remote parsing
- finding validation against the diff, downgrading, dropping and de-duplication
- the provider layer against a fake `claude`, a stub Ollama server and a mocked Anthropic API
- the review service, confirmation policy, persistence and cascading deletes
- posting: previews post nothing, a confirmation must match the repository and PR number, the event is always `COMMENT`, and every refusal
- static checks that fail if someone adds a `console.log`, raw HTML, a shell, a non-loopback bind, or a new place that writes to disk

## Project layout

```
src/app            pages and API routes
src/components     UI (layout, review workspace, findings, history, settings)
src/lib/git        read-only git: validation, exec wrapper, scopes, diff parser
src/lib/gh         gh: accounts, PR list and diff, allowlist, posting
src/lib/ai         providers, prompts, chunking, engine, verification
src/lib/reviews    jobs, persistence, service
src/lib/db         schema, migrations helper, settings
drizzle/           SQL migrations
tests/             Vitest tests
```

## Troubleshooting

- **"Claude Code isn't logged in".** Run `claude` in a terminal and use `/login`. DiffLens deliberately ignores `ANTHROPIC_*` and `CLAUDE_*` variables inherited from whatever started it, so a stale token in your shell can't break reviews.
- **Nothing happens when you start apps from a folder under `Documents`.** macOS can evict iCloud-synced files, which makes git hang and kills programs. Keep projects outside iCloud, for example `~/Developer`.
- **The page keeps reloading in development.** A stale build cache. Delete `.next` and restart. (The dev disk cache is switched off in `next.config.ts` for this reason.)
- **Posting says the PR has new commits.** Run the review again, so the comments match the current code.

## Known issues

- `npm audit` reports one critical advisory for `dompurify`, which is bundled inside Monaco 0.57.0 (the latest release; the patched DOMPurify 3.4.17 isn't in a Monaco release yet). The advisory concerns DOMPurify's `IN_PLACE` mode with hooks. DiffLens never passes markdown or HTML to Monaco (findings are shown as plain-text markers and escaped React text), so the vulnerable path isn't reachable from your data, but upgrade Monaco when a fixed release appears.

## Not verified end to end

Things the automated tests can't reach, so check them on your first real use:

- A live Claude Code review (use Settings → Send test message first).
- Posting a real review to GitHub. It is covered with a fake `gh` and previews, but start with a PR you're comfortable commenting on.
- Ollama and the Anthropic API against the real services.
