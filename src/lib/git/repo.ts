import fs from "node:fs/promises";
import path from "node:path";
import { git } from "./exec";
import { GitError, SHA_RE, isInside, isSafeRelPath, isValidRev, resolveRepoPath } from "./validate";
import type { Scope } from "./scopes";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_UNTRACKED_FILES = 200;
const DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];

/** Confirm `input` is the top-level folder of a real git work tree; return its real path. */
export async function validateRepo(input: string): Promise<string> {
  const real = await resolveRepoPath(input);
  const inside = await git(real, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside.code !== 0 || inside.stdout.trim() !== "true") throw new GitError("That folder is not a git repository");
  const top = (await git(real, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const topReal = await fs.realpath(top).catch(() => top);
  if (topReal !== real) throw new GitError(`Choose the repository's top-level folder: ${topReal}`);
  return real;
}

/** Turn any branch, tag or commit into a full commit SHA (the only form that reaches git later). */
export async function resolveRev(repo: string, rev: string): Promise<string> {
  if (!isValidRev(rev)) throw new GitError("Not a valid branch, tag or commit");
  const r = await git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], { allowFail: true });
  const sha = r.stdout.trim();
  if (r.code !== 0 || !SHA_RE.test(sha)) throw new GitError(`Unknown revision: ${rev}`);
  return sha;
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  const r = await git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", ref], { allowFail: true });
  return r.code === 0;
}

export interface BaseInfo {
  base: string | null;
  source: "origin/HEAD" | "fallback" | "none";
}

/** origin/HEAD first, then origin/main, origin/master, main, master. */
export async function detectBase(repo: string): Promise<BaseInfo> {
  const sym = await git(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFail: true });
  const head = sym.stdout.trim();
  if (sym.code === 0 && head && isValidRev(head) && (await refExists(repo, `refs/remotes/${head}`))) {
    return { base: head, source: "origin/HEAD" };
  }
  for (const c of ["origin/main", "origin/master", "main", "master"]) {
    const full = c.startsWith("origin/") ? `refs/remotes/${c}` : `refs/heads/${c}`;
    if (await refExists(repo, full)) return { base: c, source: "fallback" };
  }
  return { base: null, source: "none" };
}

export interface StatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
}

export async function statusCounts(repo: string): Promise<StatusCounts> {
  const out = (await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout;
  const counts: StatusCounts = { staged: 0, unstaged: 0, untracked: 0 };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 3) continue;
    const x = e[0];
    const y = e[1];
    if (x === "?" && y === "?") counts.untracked++;
    else {
      if (x !== " " && x !== "!") counts.staged++;
      if (y !== " " && y !== "!") counts.unstaged++;
    }
    if (x === "R" || x === "C") i++; // renames carry a second path entry
  }
  return counts;
}

export interface CommitInfo {
  sha: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export async function recentCommits(repo: string, limit = 30): Promise<CommitInfo[]> {
  const r = await git(repo, ["log", `-n${limit}`, "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e"], { allowFail: true });
  if (r.code !== 0) return []; // e.g. a repo with no commits yet
  return r.stdout
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [sha, short, author, date, subject] = rec.split("\x1f");
      return { sha, short, author, date, subject };
    });
}

export async function listBranches(repo: string): Promise<string[]> {
  const r = await git(repo, ["for-each-ref", "--format=%(refname:short)", "--count=300", "refs/heads", "refs/remotes"], { allowFail: true });
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.endsWith("/HEAD") && isValidRev(s));
}

export interface RepoInfo {
  branch: string | null;
  headShort: string | null;
  remoteUrl: string | null;
  status: StatusCounts;
  base: BaseInfo;
  ahead: number | null;
  behind: number | null;
  commits: CommitInfo[];
  branches: string[];
}

export async function repoInfo(repo: string): Promise<RepoInfo> {
  const [branchR, headR, remoteR, status, base, commits, branches] = await Promise.all([
    git(repo, ["branch", "--show-current"], { allowFail: true }),
    git(repo, ["rev-parse", "--short", "HEAD"], { allowFail: true }),
    git(repo, ["remote", "get-url", "origin"], { allowFail: true }),
    statusCounts(repo),
    detectBase(repo),
    recentCommits(repo),
    listBranches(repo),
  ]);
  let ahead: number | null = null;
  let behind: number | null = null;
  if (base.base && headR.code === 0) {
    const r = await git(repo, ["rev-list", "--left-right", "--count", `${base.base}...HEAD`], { allowFail: true });
    const m = /^(\d+)\s+(\d+)/.exec(r.stdout.trim());
    if (r.code === 0 && m) {
      behind = +m[1];
      ahead = +m[2];
    }
  }
  return {
    branch: branchR.stdout.trim() || null,
    headShort: headR.code === 0 ? headR.stdout.trim() : null,
    remoteUrl: remoteR.code === 0 ? remoteR.stdout.trim() : null,
    status,
    base,
    ahead,
    behind,
    commits,
    branches,
  };
}

export interface ScopeInfo {
  patch: string;
  label: string;
  base?: string;
  skipped: { path: string; reason: string }[];
}

/** Resolve a scope to the diff text, plus the revisions used for each side of every file. */
export interface ResolvedScope {
  /** Where to read the "before" content: a commit SHA, "index", or null. */
  before: string | "index";
  /** Where to read the "after" content: a commit SHA, "index", or "worktree". */
  after: string | "index" | "worktree";
  label: string;
  base?: string;
}

export async function resolveScope(repo: string, scope: Scope): Promise<ResolvedScope> {
  switch (scope.type) {
    case "staged":
      return { before: await resolveRev(repo, "HEAD").catch(() => "EMPTY"), after: "index", label: "Staged changes" };
    case "working":
      return { before: "index", after: "worktree", label: "Unstaged changes and new files" };
    case "commit": {
      const sha = await resolveRev(repo, scope.sha);
      const parent = await git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}^`], { allowFail: true });
      const p = parent.stdout.trim();
      return { before: parent.code === 0 && SHA_RE.test(p) ? p : "EMPTY", after: sha, label: `Commit ${sha.slice(0, 7)}` };
    }
    case "range": {
      const from = await resolveRev(repo, scope.from);
      const to = await resolveRev(repo, scope.to);
      return { before: from, after: to, label: `${scope.from} → ${scope.to}` };
    }
    case "branch": {
      const baseName = scope.base ?? (await detectBase(repo)).base;
      if (!baseName) throw new GitError("No base branch found. Choose one");
      const baseSha = await resolveRev(repo, baseName);
      const headSha = await resolveRev(repo, "HEAD");
      const mb = (await git(repo, ["merge-base", baseSha, headSha], { allowFail: true })).stdout.trim();
      if (!SHA_RE.test(mb)) throw new GitError(`No common history between ${baseName} and HEAD`);
      return { before: mb, after: headSha, label: `Current branch vs ${baseName}`, base: baseName };
    }
  }
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/** Build a "new file" patch for an untracked file without running git on it. */
export function syntheticAddPatch(rel: string, text: string): string {
  if (text.length === 0) return `diff --git a/${rel} b/${rel}\nnew file mode 100644\n`;
  const endsWithNewline = text.endsWith("\n");
  const body = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  const out = [
    `diff --git a/${rel} b/${rel}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${rel}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body.map((l) => "+" + l),
  ];
  if (!endsWithNewline) out.push("\\ No newline at end of file");
  return out.join("\n") + "\n";
}

async function untrackedPatches(repo: string): Promise<{ patch: string; skipped: ScopeInfo["skipped"] }> {
  const list = (await git(repo, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  const skipped: ScopeInfo["skipped"] = [];
  const chunks: string[] = [];
  const realRoot = await fs.realpath(repo);
  for (const rel of list.slice(0, MAX_UNTRACKED_FILES)) {
    if (!isSafeRelPath(rel)) {
      skipped.push({ path: rel, reason: "unsafe path" });
      continue;
    }
    const full = path.join(repo, rel);
    try {
      const st = await fs.lstat(full);
      if (st.isSymbolicLink() || !st.isFile()) {
        skipped.push({ path: rel, reason: "not a regular file" });
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: "larger than 1 MB" });
        continue;
      }
      const real = await fs.realpath(full);
      if (!isInside(realRoot, real)) {
        skipped.push({ path: rel, reason: "outside the repository" });
        continue;
      }
      const buf = await fs.readFile(full);
      if (looksBinary(buf)) {
        skipped.push({ path: rel, reason: "binary file" });
        continue;
      }
      chunks.push(syntheticAddPatch(rel, buf.toString("utf8")));
    } catch {
      skipped.push({ path: rel, reason: "unreadable" });
    }
  }
  if (list.length > MAX_UNTRACKED_FILES) {
    skipped.push({ path: `${list.length - MAX_UNTRACKED_FILES} more files`, reason: `only the first ${MAX_UNTRACKED_FILES} untracked files are included` });
  }
  return { patch: chunks.join(""), skipped };
}

export async function getDiff(repo: string, scope: Scope): Promise<ScopeInfo & { resolved: ResolvedScope }> {
  const resolved = await resolveScope(repo, scope);
  let patch = "";
  let skipped: ScopeInfo["skipped"] = [];
  switch (scope.type) {
    case "staged":
      patch = (await git(repo, ["diff", "--cached", ...DIFF_FLAGS, "--"])).stdout;
      break;
    case "working": {
      patch = (await git(repo, ["diff", ...DIFF_FLAGS, "--"])).stdout;
      const u = await untrackedPatches(repo);
      patch += u.patch;
      skipped = u.skipped;
      break;
    }
    case "commit":
      patch = (await git(repo, ["show", "--format=", "--first-parent", ...DIFF_FLAGS, resolved.after, "--"])).stdout;
      break;
    case "range":
    case "branch":
      patch = (await git(repo, ["diff", ...DIFF_FLAGS, resolved.before, resolved.after, "--"])).stdout;
      break;
  }
  return { patch, label: resolved.label, base: resolved.base, skipped, resolved };
}

export interface FileSides {
  original: string | null;
  modified: string | null;
  binary: boolean;
  tooLarge: boolean;
}

async function readBlob(repo: string, spec: string): Promise<{ text: string | null; binary: boolean; tooLarge: boolean }> {
  const size = await git(repo, ["cat-file", "-s", spec], { allowFail: true });
  if (size.code !== 0) return { text: null, binary: false, tooLarge: false };
  if (parseInt(size.stdout.trim(), 10) > MAX_FILE_BYTES) return { text: null, binary: false, tooLarge: true };
  const r = await git(repo, ["cat-file", "-p", spec]);
  if (r.stdout.includes("\0")) return { text: null, binary: true, tooLarge: false };
  return { text: r.stdout, binary: false, tooLarge: false };
}

async function readWorktree(repo: string, rel: string): Promise<{ text: string | null; binary: boolean; tooLarge: boolean }> {
  const full = path.join(repo, rel);
  try {
    const st = await fs.lstat(full);
    if (st.isSymbolicLink() || !st.isFile()) return { text: null, binary: false, tooLarge: false };
    if (st.size > MAX_FILE_BYTES) return { text: null, binary: false, tooLarge: true };
    const real = await fs.realpath(full);
    if (!isInside(await fs.realpath(repo), real)) return { text: null, binary: false, tooLarge: false };
    const buf = await fs.readFile(full);
    return looksBinary(buf) ? { text: null, binary: true, tooLarge: false } : { text: buf.toString("utf8"), binary: false, tooLarge: false };
  } catch {
    return { text: null, binary: false, tooLarge: false };
  }
}

/** Both sides of one file for the diff viewer. `oldPath` is the pre-rename name when there is one. */
export async function getFileSides(repo: string, scope: Scope, filePath: string, oldPath: string | null): Promise<FileSides> {
  if (!isSafeRelPath(filePath) || (oldPath !== null && !isSafeRelPath(oldPath))) throw new GitError("Invalid file path");
  const r = await resolveScope(repo, scope);
  const side = async (where: string, rel: string) => {
    if (where === "EMPTY") return { text: null, binary: false, tooLarge: false };
    if (where === "worktree") return readWorktree(repo, rel);
    if (where === "index") return readBlob(repo, `:${rel}`);
    return readBlob(repo, `${where}:${rel}`);
  };
  const [a, b] = await Promise.all([side(r.before, oldPath ?? filePath), side(r.after, filePath)]);
  return { original: a.text, modified: b.text, binary: a.binary || b.binary, tooLarge: a.tooLarge || b.tooLarge };
}
