import { describe, expect, it } from "vitest";
import { isCleanAbsolutePath, isInside, isSafeRelPath, isValidRefName, isValidRev, resolveRepoPath } from "@/lib/git/validate";
import { buildGitArgs, SAFE_GIT_PREFIX } from "@/lib/git/exec";
import { parseScopeParam } from "@/lib/git/scopes";

describe("ref validation", () => {
  it("accepts normal refs", () => {
    for (const r of ["main", "origin/main", "feature/add-login", "release-1.2.3", "v1.0", "HEAD", "HEAD~3", "HEAD^", "abc1234", "a".repeat(40), "user/topic_x+y"]) {
      expect(isValidRev(r), r).toBe(true);
    }
  });
  it("rejects options, traversal, revision tricks and junk", () => {
    for (const r of ["", "-rf", "--output=/tmp/x", "-c", "main..dev", "a//b", "a/../b", "x@{1}", "feat/.hidden", "name.lock", "trailing/", "trailing.", "a b", "a;b", "a$(id)", "a`id`", "a|b", "a:b", "main:path", ":/x", "@", "a\nb", "a".repeat(201), "HEAD~~", "HEAD~abc"]) {
      expect(isValidRev(r), JSON.stringify(r)).toBe(false);
    }
  });
  it("never allows a leading dash even with valid chars", () => {
    expect(isValidRefName("-main")).toBe(false);
    expect(isValidRefName("--upload-pack=x")).toBe(false);
  });
});

describe("path validation", () => {
  it("accepts clean absolute paths and rejects the rest", () => {
    expect(isCleanAbsolutePath("/Users/me/code/app")).toBe(true);
    for (const p of ["relative/path", "~/code", "/a/../b", "/a/b/..", "", "/x\0y", "./x"]) expect(isCleanAbsolutePath(p), p).toBe(false);
  });
  it("accepts repo-relative file paths and rejects traversal", () => {
    for (const p of ["src/a.ts", "a b/c d.txt", "dir/.hidden", "ünïcode.ts"]) expect(isSafeRelPath(p), p).toBe(true);
    for (const p of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "a\0b", "a\nb", "a/.."]) expect(isSafeRelPath(p), JSON.stringify(p)).toBe(false);
  });
  it("isInside compares resolved paths", () => {
    expect(isInside("/r", "/r")).toBe(true);
    expect(isInside("/r", "/r/a/b")).toBe(true);
    expect(isInside("/r", "/rx/a")).toBe(false);
    expect(isInside("/r", "/etc")).toBe(false);
  });
  it("resolveRepoPath rejects missing, relative, traversal and non-directories", async () => {
    await expect(resolveRepoPath("relative")).rejects.toThrow();
    await expect(resolveRepoPath("/tmp/../etc")).rejects.toThrow();
    await expect(resolveRepoPath("/definitely/not/here")).rejects.toThrow(/doesn't exist/);
    await expect(resolveRepoPath("/etc/hosts")).rejects.toThrow(/not a folder/);
  });
});

describe("git argument handling", () => {
  it("always prepends the safety flags", () => {
    const a = buildGitArgs("/repo", ["status"]);
    expect(a.slice(0, SAFE_GIT_PREFIX.length)).toEqual(SAFE_GIT_PREFIX);
    expect(a).toContain("core.fsmonitor=false");
    expect(a).toContain("core.hooksPath=/dev/null");
    expect(a).toContain("--no-pager");
    expect(a.slice(-3)).toEqual(["-C", "/repo", "status"]);
  });
  it("refuses anything that could write or run programs", () => {
    for (const sub of ["commit", "add", "checkout", "reset", "push", "fetch", "clean", "rm", "merge", "config", "apply", "stash"]) {
      expect(() => buildGitArgs("/r", [sub]), sub).toThrow();
    }
    expect(() => buildGitArgs("/r", ["diff", "--output=/tmp/x"])).toThrow();
    expect(() => buildGitArgs("/r", ["diff", "--ext-diff"])).toThrow();
    expect(() => buildGitArgs("/r", ["diff", "--textconv"])).toThrow();
  });
});

describe("scope parsing", () => {
  it("parses valid scopes", () => {
    expect(parseScopeParam('{"type":"staged"}')).toEqual({ type: "staged" });
    expect(parseScopeParam('{"type":"commit","sha":"abcdef1"}')).toMatchObject({ type: "commit" });
    expect(parseScopeParam('{"type":"branch","base":"origin/main"}')).toMatchObject({ base: "origin/main" });
    expect(parseScopeParam('{"type":"range","from":"main","to":"HEAD~2"}')).toMatchObject({ type: "range" });
  });
  it("rejects malformed and hostile scopes", () => {
    for (const raw of [null, "", "not json", '{"type":"nope"}', '{"type":"commit","sha":"--all"}', '{"type":"range","from":"-x","to":"main"}', '{"type":"branch","base":"a b"}', '{"type":"commit"}']) {
      expect(() => parseScopeParam(raw as string | null), String(raw)).toThrow();
    }
  });
});
