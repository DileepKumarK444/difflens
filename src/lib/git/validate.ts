import fs from "node:fs/promises";
import path from "node:path";

export class GitError extends Error {}

export const SHA_RE = /^[0-9a-f]{7,40}$/i;
const REF_CHARS = /^[A-Za-z0-9_][A-Za-z0-9._/+@-]*$/;
const REV_SUFFIX = /^(.+?)(?:~\d{1,4}|\^\d{0,2})?$/;

/** A branch/tag name as git accepts it, restricted to a safe subset. Never starts with "-". */
export function isValidRefName(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) return false;
  if (SHA_RE.test(ref)) return true;
  if (!REF_CHARS.test(ref)) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{") || ref.includes("/.")) return false;
  if (ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock") || ref === "@") return false;
  return true;
}

/** A ref name, optionally with ~N or ^N (e.g. HEAD~2). No ":" so "rev:path" can't be smuggled in. */
export function isValidRev(rev: string): boolean {
  if (typeof rev !== "string") return false;
  const m = REV_SUFFIX.exec(rev);
  return m !== null && isValidRefName(m[1]);
}

/** A repo-relative file path that is safe to pass after "--" or to join onto the repo root. */
export function isSafeRelPath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) return false;
  if (p.includes("\0") || p.includes("\n") || p.startsWith("/") || path.isAbsolute(p)) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "");
}

/** Raw input must be absolute, NUL-free and free of ".." segments before it is ever resolved. */
export function isCleanAbsolutePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096) return false;
  if (p.includes("\0") || !path.isAbsolute(p)) return false;
  return !p.split(path.sep).includes("..");
}

/** True when `child` is `root` or inside it, after both have been resolved with realpath. */
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolve a user-supplied folder to its real path. Throws GitError for anything unsuitable. */
export async function resolveRepoPath(input: string): Promise<string> {
  if (!isCleanAbsolutePath(input)) throw new GitError("Enter an absolute path without \"..\"");
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new GitError("That folder doesn't exist");
  }
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new GitError("That path is not a folder");
  return real;
}
