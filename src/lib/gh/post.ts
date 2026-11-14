import { fence } from "@/lib/export-md";
import type { FileDiff } from "@/lib/git/diff-parse";

export interface PostableFinding {
  id: string;
  title: string;
  severity: string;
  category: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  whyItMatters: string;
  suggestedFix: string;
  codeExample: string | null;
}

export type Mapped =
  | { ok: true; path: string; side: "RIGHT" | "LEFT"; line: number; startLine?: number; trimmed?: boolean }
  | { ok: false; reason: string };

/**
 * Work out where a finding can be attached on the PR's diff. GitHub only accepts inline comments on
 * lines that are visible in the diff, and a multi-line comment must stay within one hunk.
 */
export function mapToDiff(files: FileDiff[], f: Pick<PostableFinding, "filePath" | "lineStart" | "lineEnd">): Mapped {
  const file = files.find((x) => x.path === f.filePath);
  if (!file) return { ok: false, reason: "this file isn’t in the PR’s diff" };
  const deleted = file.status === "deleted";
  const side = deleted ? "LEFT" : "RIGHT";
  const lo = Math.min(f.lineStart, f.lineEnd);
  const hi = Math.max(f.lineStart, f.lineEnd);
  const sets = file.hunks.map((h) => new Set(h.lines.map((l) => (deleted ? l.old : l.new)).filter((n): n is number => n !== undefined)));
  const whole = sets.some((s) => {
    for (let n = lo; n <= hi; n++) if (!s.has(n)) return false;
    return true;
  });
  if (whole) return lo === hi ? { ok: true, path: file.path, side, line: lo } : { ok: true, path: file.path, side, line: hi, startLine: lo };
  if (sets.some((s) => s.has(lo))) return { ok: true, path: file.path, side, line: lo, trimmed: true };
  return { ok: false, reason: `line ${lo} isn’t part of the PR’s diff` };
}

/** The text of one inline comment. A suggestion block replaces exactly the commented lines. */
export function buildCommentBody(f: PostableFinding, opts: { suggestion: boolean }): string {
  const parts = [`**${f.severity}: ${f.title.replace(/\s+/g, " ")}**`, "", f.description.trim()];
  if (f.whyItMatters.trim()) parts.push("", `**Why it matters:** ${f.whyItMatters.trim()}`);
  if (f.suggestedFix.trim()) parts.push("", `**Suggested fix:** ${f.suggestedFix.trim()}`);
  if (f.codeExample?.trim()) {
    if (opts.suggestion) parts.push("", fence(f.codeExample.replace(/\n+$/, ""), "suggestion"));
    else parts.push("", fence(f.codeExample.trim()));
  }
  return parts.join("\n");
}

export const MAX_BODY = 60_000;

/** One general comment holding every selected finding, used when inline placement isn't possible. */
export function buildGeneralBody(summary: string, items: { path: string; line: number; body: string }[]): string {
  const out = [summary.trim()];
  for (const it of items) out.push("", "---", "", `\`${it.path.replace(/`/g, "")}:${it.line}\``, "", it.body);
  const text = out.join("\n");
  return text.length > MAX_BODY ? text.slice(0, MAX_BODY - 80) + "\n\n[... cut: too long for one GitHub comment ...]" : text;
}

export interface ReviewPayload {
  commit_id: string;
  body: string;
  event: "COMMENT";
  comments?: { path: string; body: string; line: number; side: "RIGHT" | "LEFT"; start_line?: number; start_side?: "RIGHT" | "LEFT" }[];
}

export function buildInlinePayload(commitId: string, summary: string, items: { m: Extract<Mapped, { ok: true }>; body: string }[]): ReviewPayload {
  return {
    commit_id: commitId,
    body: summary.trim(),
    event: "COMMENT",
    comments: items.map(({ m, body }) => ({
      path: m.path,
      body,
      line: m.line,
      side: m.side,
      ...(m.startLine !== undefined ? { start_line: m.startLine, start_side: m.side } : {}),
    })),
  };
}
