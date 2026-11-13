import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { syntheticAddPatch } from "@/lib/git/repo";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 line1
-line2
+line2 changed
+extra
 line3
 line4
@@ -20,2 +21,2 @@ function x() {
 keep
-old -- dash
+new
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.txt b/new name.txt
similarity index 90%
rename from old name.txt
rename to new name.txt
--- a/old name.txt
+++ b/new name.txt
@@ -1 +1 @@
-a
+b
diff --git a/img.png b/img.png
index 1..2 100644
Binary files a/img.png and b/img.png differ
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(PATCH);
  it("finds every file with status", () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["src/a.ts", "modified"],
      ["new.txt", "added"],
      ["gone.txt", "deleted"],
      ["new name.txt", "renamed"],
      ["img.png", "modified"],
    ]);
    expect(files[3].oldPath).toBe("old name.txt");
    expect(files[4].binary).toBe(true);
  });
  it("counts additions and deletions, including content that looks like headers", () => {
    expect(files[0]).toMatchObject({ additions: 3, deletions: 2 });
    expect(files[1]).toMatchObject({ additions: 2, deletions: 0 });
    expect(files[2]).toMatchObject({ additions: 0, deletions: 1 });
  });
  it("tracks new-side line numbers per hunk", () => {
    const h = files[0].hunks;
    expect(h).toHaveLength(2);
    expect(h[0].lines.filter((l) => l.t === "+").map((l) => l.new)).toEqual([2, 3]);
    expect(h[0].lines.find((l) => l.t === "-")?.old).toBe(2);
    expect(h[1].newStart).toBe(21);
    expect(h[1].lines.filter((l) => l.t === "+").map((l) => l.new)).toEqual([22]);
  });
  it("keeps each file's own patch slice", () => {
    expect(files[1].patch.startsWith("diff --git a/new.txt")).toBe(true);
    expect(files[1].patch).not.toContain("gone.txt");
  });
  it("handles empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("syntheticAddPatch", () => {
  it("round-trips through the parser", () => {
    const f = parseUnifiedDiff(syntheticAddPatch("dir/x.txt", "a\nb\n"))[0];
    expect(f).toMatchObject({ path: "dir/x.txt", status: "added", additions: 2, deletions: 0 });
    expect(f.hunks[0].lines.map((l) => l.new)).toEqual([1, 2]);
  });
  it("handles no trailing newline and empty files", () => {
    expect(parseUnifiedDiff(syntheticAddPatch("n.txt", "a\nb"))[0].additions).toBe(2);
    expect(syntheticAddPatch("n.txt", "a")).toContain("\\ No newline at end of file");
    const empty = parseUnifiedDiff(syntheticAddPatch("e.txt", ""))[0];
    expect(empty).toMatchObject({ path: "e.txt", status: "added", additions: 0 });
  });
});
