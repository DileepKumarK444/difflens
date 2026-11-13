import { run } from "@/lib/exec";
import { GitError } from "./validate";

/** Subcommands DiffLens may run. Everything here only reads. */
const READ_ONLY = new Set([
  "rev-parse", "status", "diff", "show", "log", "branch", "symbolic-ref", "merge-base",
  "ls-files", "for-each-ref", "remote", "cat-file", "rev-list",
]);
/** Options that could write files or start programs, refused wherever they appear. */
const FORBIDDEN = /^(--output|--open-files-in-pager|--ext-diff|--textconv|--exec|-o$|-O)/;

/**
 * Flags placed before every git command so a repository's own config cannot run code:
 * fsmonitor and hooks are disabled, external protocols are blocked, no pager.
 */
export const SAFE_GIT_PREFIX = [
  "--no-pager",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "protocol.ext.allow=never",
  "-c", "core.quotepath=false",
];

export const GIT_ENV: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_EXTERNAL_DIFF: "",
  LC_ALL: "C",
};

export function buildGitArgs(repo: string, args: string[]): string[] {
  const sub = args[0];
  if (!READ_ONLY.has(sub)) throw new GitError(`git ${sub} is not allowed`);
  for (const a of args) if (FORBIDDEN.test(a)) throw new GitError("Unsafe git option refused");
  return [...SAFE_GIT_PREFIX, "-C", repo, ...args];
}

export interface GitResult {
  stdout: string;
  code: number;
  stderr: string;
}

/** Run a read-only git command with execFile and an argument array (no shell). */
export async function git(repo: string, args: string[], opts: { timeoutMs?: number; allowFail?: boolean } = {}): Promise<GitResult> {
  const r = await run("git", buildGitArgs(repo, args), { env: GIT_ENV, timeoutMs: opts.timeoutMs ?? 30_000 });
  if (r.code !== 0 && !opts.allowFail) {
    throw new GitError(firstLine(r.stderr) || `git ${args[0]} failed`);
  }
  return r;
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0]?.slice(0, 300) ?? "";
}
