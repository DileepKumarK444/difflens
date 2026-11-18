import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "@/lib/paths";
import { redact, run as realRun, type RunOptions, type RunResult } from "@/lib/exec";
import { ProviderError, type CompleteRequest, type ProviderStatus, type ReviewProvider } from "./types";

type Runner = (file: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/** Variables Claude Code may use. Everything else (including any ANTHROPIC_*, CLAUDE_* from a parent session) is dropped. */
const KEEP_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LC_[A-Z]+|TERM|XDG_[A-Z_]+|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/;

/**
 * A clean environment so Claude Code uses *your own login*, not a token or settings inherited
 * from whatever started DiffLens, and never silently uses an API key.
 */
export function claudeEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && KEEP_ENV.test(k)) env[k] = v;
  return env;
}

/** Best-effort deny rules for credential files, on top of Claude Code's own read-only sandbox. */
export const DENY_TOOLS = [
  "Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)", "Read(**/id_rsa*)", "Read(**/id_ed25519*)",
  "Read(**/.npmrc)", "Read(**/.netrc)", "Read(**/credentials*)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.config/gh/**)", "Read(~/.claude/**)",
];

export function claudeArgs(model: string | null): string[] {
  const args = [
    "-p", "--output-format", "json",
    "--tools", "Read,Grep,Glob",
    "--allowedTools", "Read,Grep,Glob",
    "--disallowedTools", DENY_TOOLS.join(","),
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--max-turns", "15",
  ];
  if (model) args.push("--model", model);
  return args;
}

const CliResult = z.object({ is_error: z.boolean().optional(), result: z.string().optional(), subtype: z.string().optional() }).passthrough();

function friendly(text: string): string {
  const t = text.toLowerCase();
  if (/not logged in|\/login|invalid bearer|authenticat|401/.test(t)) return "Claude Code isn’t logged in. Open a terminal, run claude, and log in with /login";
  if (/rate limit|usage limit|429|overloaded|quota/.test(t)) return "Claude Code hit a usage or rate limit. Try again later";
  if (/econnrefused|enotfound|network|firewall|proxy|etimedout/.test(t)) return "Claude Code couldn’t reach Anthropic. Check your connection";
  if (/max.?turns/.test(t)) return "Claude Code used too many steps on this chunk";
  // Unknown failure: show a short, redacted first line so the real cause (e.g. an unsupported
  // flag in an older Claude Code, or a missing login) is visible instead of a bare message.
  const detail = redact(text.trim().split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").slice(0, 200);
  return detail ? `Claude Code returned an error: ${detail}` : "Claude Code returned an error";
}

export function createClaudeCodeProvider(opts: { model?: string; run?: Runner; bin?: string } = {}): ReviewProvider {
  const run = opts.run ?? realRun;
  const bin = opts.bin ?? "claude";
  const model = opts.model?.trim() || null;
  return {
    id: "claude-code",
    label: "Claude Code (headless)",
    leavesMachine: true,
    readsRepo: true,
    model,
    async status(): Promise<ProviderStatus> {
      const v = await run(bin, ["--version"], { replaceEnv: claudeEnv(), timeoutMs: 10_000 });
      if (v.code !== 0) return { ok: false, detail: "The claude command wasn’t found. Install Claude Code and log in" };
      const a = await run(bin, ["auth", "status"], { replaceEnv: claudeEnv(), timeoutMs: 10_000 });
      try {
        const s = JSON.parse(a.stdout) as { loggedIn?: boolean };
        if (s.loggedIn) return { ok: true, detail: `Claude Code ${v.stdout.trim().split(" ")[0]} is installed and logged in` };
        return { ok: false, detail: "Claude Code is installed but not logged in. Run claude and use /login" };
      } catch {
        return { ok: true, detail: `Claude Code ${v.stdout.trim().split(" ")[0]} is installed (couldn’t confirm login)` };
      }
    },
    async complete(req: CompleteRequest): Promise<string> {
      let cwd = req.cwd;
      let temp: string | null = null;
      if (!cwd) {
        // No repository to read: run in an empty folder so the tools have nothing to see.
        const base = path.join(dataDir(), "tmp");
        fs.mkdirSync(base, { recursive: true, mode: 0o700 });
        temp = fs.mkdtempSync(path.join(base, "claude-"));
        cwd = temp;
      }
      try {
        const r = await run(bin, claudeArgs(model), { cwd, input: req.prompt, replaceEnv: claudeEnv(), timeoutMs: req.timeoutMs });
        const last = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
        if (!last) throw new ProviderError(friendly(r.stderr || r.stdout));
        let parsed;
        try {
          parsed = CliResult.parse(JSON.parse(last));
        } catch {
          throw new ProviderError("Claude Code returned output DiffLens couldn’t read");
        }
        if (parsed.is_error || r.code !== 0) throw new ProviderError(friendly(parsed.result ?? r.stderr));
        if (typeof parsed.result !== "string" || !parsed.result.trim()) throw new ProviderError("Claude Code returned an empty reply");
        return parsed.result;
      } finally {
        if (temp) fs.rmSync(temp, { recursive: true, force: true });
      }
    },
  };
}

export { redact };
