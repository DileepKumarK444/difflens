import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, reconstructFromHunks } from "@/lib/git/diff-parse";
import { exportFileName, fence, renderMarkdown } from "@/lib/export-md";
import { compareFindings } from "@/lib/compare";
import { buildFixPrompt } from "@/lib/fix-prompt";
import { buildCommentBody, buildGeneralBody, buildInlinePayload, mapToDiff, MAX_BODY } from "@/lib/gh/post";
import type { FindingView } from "@/lib/findings";

const f = (id: string, o: Partial<FindingView> = {}): FindingView => ({
  id, title: `Title ${id}`, category: "bug", severity: "High", filePath: "src/a.ts", lineStart: 12, lineEnd: 12, description: "Something is wrong here",
  whyItMatters: "It breaks", suggestedFix: "Fix it", codeExample: null, confidence: 0.8, verification: "exact", status: "open", note: "", ...o,
});

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 keep10
-old11
+new11
+new12
 keep13
@@ -40,2 +41,2 @@
 keep41
-old42
+new42
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-g1
-g2
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+n1
+n2
`;
const files = parseUnifiedDiff(PATCH);

describe("reconstructFromHunks", () => {
  it("places each line at its real line number and blanks the rest", () => {
    const r = reconstructFromHunks(files[0]);
    const mod = r.modified.split("\n");
    const orig = r.original.split("\n");
    expect(mod[9]).toBe("keep10");
    expect(mod[10]).toBe("new11");
    expect(mod[11]).toBe("new12");
    expect(mod[12]).toBe("keep13");
    expect(mod[40]).toBe("keep41");
    expect(mod[41]).toBe("new42");
    expect(orig[10]).toBe("old11");
    expect(orig[40]).toBe("old42");
    expect(mod.slice(0, 9).every((l) => l === "")).toBe(true);
  });
  it("handles added and deleted files", () => {
    expect(reconstructFromHunks(files[1]).original.split("\n")).toEqual(["g1", "g2"]);
    expect(reconstructFromHunks(files[2]).modified.split("\n")).toEqual(["n1", "n2"]);
  });
  it("parser now keeps line text", () => {
    expect(files[0].hunks[0].lines.find((l) => l.t === "+")?.text).toBe("new11");
  });
});

describe("Markdown export", () => {
  const base = { title: "acme/api #7: Fix <thing> # heading", kind: "pr" as const, provider: "claude-code", model: null, status: "complete", createdAt: Date.UTC(2026, 10, 14, 9, 30), partialReason: null, prUrl: "https://github.com/acme/api/pull/7" };
  it("lists findings by severity with status, notes and a safe code fence", () => {
    const md = renderMarkdown(base, [
      f("1", { severity: "Critical", title: "SQL `injection` <b>", codeExample: "const q = `select ${x}`;\n```nested```", note: "ask Maya\nsecond line", status: "resolved" }),
      f("2", { severity: "Low", status: "ignored" }),
    ]);
    expect(md).toContain("# Code review: Fix \\<thing\\> \\# heading".replace("Fix", "acme/api \\#7: Fix").replace("\\# heading", "\\# heading"));
    expect(md).toContain("Findings: 2 (0 open, 1 resolved, 1 ignored)");
    expect(md.indexOf("## Critical (1)")).toBeLessThan(md.indexOf("## Low (1)"));
    expect(md).toContain("Status: Resolved");
    expect(md).toContain("> ask Maya\n> second line");
    expect(md).toContain("2026-11-14 09:30 UTC");
    const open = md.match(/(`{4,})\n/)?.[1];
    expect(open).toBeDefined(); // longer than the ``` inside the example
    expect(md).toContain(`${open}\nconst q`);
  });
  it("covers partial reviews, skipped files and the empty case", () => {
    const md = renderMarkdown({ ...base, partialReason: "Reviewed 12 chunks", skipped: [{ path: "a`b.ts", reason: "binary file" }] }, []);
    expect(md).toContain("> **Partial review.** Reviewed 12 chunks");
    expect(md).toContain("`ab.ts` (binary file)");
    expect(md).toContain("No findings.");
  });
  it("fence() always outgrows backticks in the content", () => {
    expect(fence("```x```").startsWith("````")).toBe(true);
    expect(fence("plain").startsWith("```\n")).toBe(true);
  });
  it("builds a safe file name", () => {
    expect(exportFileName("acme/api #7: Fix <thing>!!", Date.UTC(2026, 10, 14))).toBe("difflens-acme-api-7-fix-thing-2026-11-14.md");
    expect(exportFileName("../../etc/passwd", 0)).not.toMatch(/[/\\]/);
    expect(exportFileName("???", 0)).toBe("difflens-review-1970-01-01.md");
  });
});

describe("compareFindings", () => {
  it("separates fixed, new and unchanged, tolerating moved lines", () => {
    const older = [f("a", { title: "SQL injection in login", lineStart: 20, lineEnd: 20 }), f("b", { title: "Missing null check", filePath: "src/b.ts" }), f("c", { title: "Leaked handle", filePath: "src/c.ts" })];
    const newer = [f("a2", { title: "SQL injection in login", lineStart: 31, lineEnd: 31 }), f("d", { title: "Race on shared cache", filePath: "src/d.ts", description: "two writers" }), f("c2", { title: "Leaked file handle", filePath: "src/c.ts" })];
    const r = compareFindings(older, newer);
    expect(r.unchanged.map(([x, y]) => [x.id, y.id]).sort()).toEqual([["a", "a2"], ["c", "c2"]]);
    expect(r.fixed.map((x) => x.id)).toEqual(["b"]);
    expect(r.added.map((x) => x.id)).toEqual(["d"]);
  });
  it("matches one-to-one and never across files", () => {
    const r = compareFindings([f("a"), f("b")], [f("x")]);
    expect(r.unchanged).toHaveLength(1);
    expect(r.fixed).toHaveLength(1);
    expect(compareFindings([f("a", { filePath: "one.ts" })], [f("a", { filePath: "two.ts" })]).unchanged).toHaveLength(0);
    expect(compareFindings([], [])).toEqual({ fixed: [], added: [], unchanged: [] });
  });
});

describe("fix prompt", () => {
  it("describes every finding and never says it will edit files itself", () => {
    const p = buildFixPrompt([f("1", { title: "Bug one", codeExample: "fixed();", note: "urgent" }), f("2", { filePath: "src/b.ts", lineStart: 3, lineEnd: 5 })], { repoName: "api" });
    expect(p).toContain("Please fix the following 2 issues in the api repository.");
    expect(p).toContain("## 1. [High] Bug one");
    expect(p).toContain("Where: src/b.ts:3-5");
    expect(p).toContain("Example (may need adapting):");
    expect(p).toContain("My note: urgent");
    expect(buildFixPrompt([f("1")])).toContain("fix the following issue.");
  });
});

describe("mapping findings onto a PR diff", () => {
  it("maps single lines and ranges inside one hunk", () => {
    expect(mapToDiff(files, { filePath: "src/a.ts", lineStart: 11, lineEnd: 11 })).toEqual({ ok: true, path: "src/a.ts", side: "RIGHT", line: 11 });
    expect(mapToDiff(files, { filePath: "src/a.ts", lineStart: 11, lineEnd: 13 })).toEqual({ ok: true, path: "src/a.ts", side: "RIGHT", line: 13, startLine: 11 });
  });
  it("trims a range that leaves its hunk, and rejects lines outside the diff", () => {
    expect(mapToDiff(files, { filePath: "src/a.ts", lineStart: 12, lineEnd: 30 })).toMatchObject({ ok: true, line: 12, trimmed: true });
    expect(mapToDiff(files, { filePath: "src/a.ts", lineStart: 25, lineEnd: 25 })).toMatchObject({ ok: false });
    expect(mapToDiff(files, { filePath: "nope.ts", lineStart: 1, lineEnd: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining("isn’t in the PR") });
  });
  it("uses the left side and old line numbers for deleted files", () => {
    expect(mapToDiff(files, { filePath: "gone.ts", lineStart: 2, lineEnd: 2 })).toEqual({ ok: true, path: "gone.ts", side: "LEFT", line: 2 });
  });
});

describe("comment bodies and payloads", () => {
  const pf = { ...f("1", { codeExample: "return x ?? 0;" }) };
  it("plain comments carry severity, text, fix and a fenced example", () => {
    const b = buildCommentBody(pf, { suggestion: false });
    expect(b.startsWith("**High: Title 1**")).toBe(true);
    expect(b).toContain("**Why it matters:** It breaks");
    expect(b).toContain("```\nreturn x ?? 0;\n```");
    expect(b).not.toContain("suggestion");
  });
  it("suggestion comments use GitHub's suggestion fence, grown if the code has backticks", () => {
    expect(buildCommentBody(pf, { suggestion: true })).toContain("```suggestion\nreturn x ?? 0;\n```");
    expect(buildCommentBody({ ...pf, codeExample: "a ```b``` c" }, { suggestion: true })).toContain("````suggestion");
  });
  it("builds a COMMENT-only inline payload with start_line for ranges", () => {
    const p = buildInlinePayload("a".repeat(40), "Summary", [
      { m: { ok: true, path: "src/a.ts", side: "RIGHT", line: 13, startLine: 11 }, body: "B1" },
      { m: { ok: true, path: "src/a.ts", side: "RIGHT", line: 5 }, body: "B2" },
    ]);
    expect(p.event).toBe("COMMENT");
    expect(p.comments).toEqual([
      { path: "src/a.ts", body: "B1", line: 13, side: "RIGHT", start_line: 11, start_side: "RIGHT" },
      { path: "src/a.ts", body: "B2", line: 5, side: "RIGHT" },
    ]);
  });
  it("the general body lists every item and is capped", () => {
    const b = buildGeneralBody("Summary", [{ path: "a.ts", line: 3, body: "X" }, { path: "b.ts", line: 9, body: "Y" }]);
    expect(b).toContain("`a.ts:3`");
    expect(b).toContain("`b.ts:9`");
    expect(buildGeneralBody("S", [{ path: "a", line: 1, body: "z".repeat(MAX_BODY * 2) }]).length).toBeLessThanOrEqual(MAX_BODY + 10);
  });
});
