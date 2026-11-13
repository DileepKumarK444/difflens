import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectBase, getDiff, getFileSides, repoInfo, resolveRev, statusCounts, validateRepo } from "@/lib/git/repo";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { addRepo, listRepos, removeRepo } from "@/lib/git/repos-db";
import { openDb } from "@/lib/db";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" });

let root: string;
let repo: string;
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const commit = (msg: string) => {
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", msg);
  return sh(repo, "rev-parse", "HEAD").trim();
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "difflens-git-")));
  repo = path.join(root, "r");
  fs.mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  write("a.txt", "one\ntwo\nthree\n");
  write("keep.txt", "keep\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("scopes against a real repository", () => {
  it("staged vs unstaged vs untracked are separate", async () => {
    const c1 = commit("init");
    write("a.txt", "one\nTWO\nthree\n");
    sh(repo, "add", "a.txt");
    write("keep.txt", "keep\nmore\n");
    write("fresh.txt", "brand new\n");

    const staged = parseUnifiedDiff((await getDiff(repo, { type: "staged" })).patch);
    expect(staged.map((f) => f.path)).toEqual(["a.txt"]);

    const working = await getDiff(repo, { type: "working" });
    const wf = parseUnifiedDiff(working.patch);
    expect(wf.map((f) => [f.path, f.status])).toEqual([["keep.txt", "modified"], ["fresh.txt", "added"]]);
    expect(await statusCounts(repo)).toEqual({ staged: 1, unstaged: 1, untracked: 1 });
    expect(c1).toHaveLength(40);
  });

  it("single commit, root commit, and range", async () => {
    const c1 = commit("init");
    write("a.txt", "one\ntwo\nthree\nfour\n");
    const c2 = commit("add four");
    write("b.txt", "bee\n");
    const c3 = commit("add b");

    expect(parseUnifiedDiff((await getDiff(repo, { type: "commit", sha: c2 })).patch).map((f) => f.path)).toEqual(["a.txt"]);
    const root1 = parseUnifiedDiff((await getDiff(repo, { type: "commit", sha: c1 })).patch).map((f) => f.path).sort();
    expect(root1).toEqual(["a.txt", "keep.txt"]);
    const range = parseUnifiedDiff((await getDiff(repo, { type: "range", from: c1, to: c3 })).patch).map((f) => f.path).sort();
    expect(range).toEqual(["a.txt", "b.txt"]);
    expect(await resolveRev(repo, "HEAD~1")).toBe(c2);
  });

  it("branch vs base uses the merge-base, not the base tip", async () => {
    commit("init");
    sh(repo, "checkout", "-q", "-b", "feature");
    write("f.txt", "feature work\n");
    commit("feature");
    sh(repo, "checkout", "-q", "main");
    write("m.txt", "main moved on\n");
    commit("main moves");
    sh(repo, "checkout", "-q", "feature");
    const d = await getDiff(repo, { type: "branch", base: "main" });
    expect(parseUnifiedDiff(d.patch).map((f) => f.path)).toEqual(["f.txt"]); // not m.txt
    expect(d.base).toBe("main");
    const info = await repoInfo(repo);
    expect(info).toMatchObject({ branch: "feature", ahead: 1, behind: 1 });
  });

  it("an empty repository does not crash", async () => {
    expect((await getDiff(repo, { type: "staged" })).patch).toBe("");
    expect((await repoInfo(repo)).commits).toEqual([]);
  });

  it("rejects unknown revisions", async () => {
    commit("init");
    await expect(getDiff(repo, { type: "range", from: "nope", to: "HEAD" })).rejects.toThrow(/Unknown revision/);
    await expect(getDiff(repo, { type: "commit", sha: "deadbeef" })).rejects.toThrow(/Unknown revision/);
  });
});

describe("base branch detection", () => {
  it("prefers origin/HEAD, then falls back in order", async () => {
    commit("init");
    expect(await detectBase(repo)).toEqual({ base: "main", source: "fallback" });
    sh(repo, "branch", "master");
    expect((await detectBase(repo)).base).toBe("main"); // main beats master
    sh(repo, "branch", "-m", "main", "trunk");
    expect((await detectBase(repo)).base).toBe("master");
    // fake a remote with HEAD -> origin/develop
    sh(repo, "update-ref", "refs/remotes/origin/develop", "HEAD");
    sh(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    sh(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
    expect(await detectBase(repo)).toEqual({ base: "origin/develop", source: "origin/HEAD" });
  });
  it("reports none when nothing matches", async () => {
    commit("init");
    sh(repo, "checkout", "-q", "-b", "weird");
    sh(repo, "branch", "-D", "main");
    expect(await detectBase(repo)).toEqual({ base: null, source: "none" });
  });
});

describe("file sides for the diff viewer", () => {
  it("returns both sides per scope, handles add/delete/rename", async () => {
    const c1 = commit("init");
    write("a.txt", "one\nTWO\nthree\n");
    fs.unlinkSync(path.join(repo, "keep.txt"));
    write("new.txt", "n\n");
    const working = await getFileSides(repo, { type: "working" }, "a.txt", null);
    expect(working).toMatchObject({ original: "one\ntwo\nthree\n", modified: "one\nTWO\nthree\n" });
    expect(await getFileSides(repo, { type: "working" }, "keep.txt", null)).toMatchObject({ original: "keep\n", modified: null });
    expect(await getFileSides(repo, { type: "working" }, "new.txt", null)).toMatchObject({ original: null, modified: "n\n" });
    const c2 = commit("edit");
    const viaCommit = await getFileSides(repo, { type: "commit", sha: c2 }, "a.txt", null);
    expect(viaCommit).toMatchObject({ original: "one\ntwo\nthree\n", modified: "one\nTWO\nthree\n" });
    expect(await getFileSides(repo, { type: "range", from: c1, to: c2 }, "new.txt", null)).toMatchObject({ original: null, modified: "n\n" });
  });
  it("flags binary and oversized files and refuses unsafe paths", async () => {
    commit("init");
    fs.writeFileSync(path.join(repo, "b.bin"), Buffer.from([0, 1, 2, 0]));
    expect((await getFileSides(repo, { type: "working" }, "b.bin", null)).binary).toBe(true);
    fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(1024 * 1024 + 10));
    expect((await getFileSides(repo, { type: "working" }, "big.txt", null)).tooLarge).toBe(true);
    await expect(getFileSides(repo, { type: "working" }, "../etc/passwd", null)).rejects.toThrow(/Invalid file path/);
    await expect(getFileSides(repo, { type: "working" }, "/etc/passwd", null)).rejects.toThrow(/Invalid file path/);
  });
  it("never follows a symlink out of the repository", async () => {
    commit("init");
    fs.writeFileSync(path.join(root, "secret.txt"), "TOP SECRET\n");
    fs.symlinkSync(path.join(root, "secret.txt"), path.join(repo, "link.txt"));
    const w = await getDiff(repo, { type: "working" });
    expect(w.patch).not.toContain("TOP SECRET");
    expect(w.skipped.map((s) => s.path)).toContain("link.txt");
    expect((await getFileSides(repo, { type: "working" }, "link.txt", null)).modified).toBeNull();
  });
  it("skips binary and oversized untracked files with a reason", async () => {
    commit("init");
    fs.writeFileSync(path.join(repo, "b.bin"), Buffer.from([0, 0, 0]));
    fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(1024 * 1024 + 1));
    write("ok.txt", "fine\n");
    const d = await getDiff(repo, { type: "working" });
    expect(parseUnifiedDiff(d.patch).map((f) => f.path)).toEqual(["ok.txt"]);
    expect(d.skipped.map((s) => s.reason).sort()).toEqual(["binary file", "larger than 1 MB"]);
  });
});

describe("a hostile repository config cannot run code", () => {
  const marker = () => path.join(root, "PWNED");

  it("ignores core.fsmonitor, diff.external, textconv, pager and hooks", async () => {
    commit("init");
    const evil = path.join(root, "evil.sh");
    fs.writeFileSync(evil, `#!/bin/sh\necho ran >> "${marker()}"\nexit 0\n`, { mode: 0o755 });
    sh(repo, "config", "core.fsmonitor", evil);
    sh(repo, "config", "diff.external", evil);
    sh(repo, "config", "core.pager", evil);
    sh(repo, "config", "diff.evil.textconv", evil);
    sh(repo, "config", "core.hooksPath", path.join(root, "hooks"));
    fs.mkdirSync(path.join(root, "hooks"));
    fs.copyFileSync(evil, path.join(root, "hooks", "post-checkout"));
    fs.chmodSync(path.join(root, "hooks", "post-checkout"), 0o755);
    write(".gitattributes", "*.txt diff=evil\n");
    write("a.txt", "changed\n");

    await statusCounts(repo);
    await repoInfo(repo);
    await getDiff(repo, { type: "working" });
    await getDiff(repo, { type: "branch", base: "main" });
    await getFileSides(repo, { type: "working" }, "a.txt", null);
    expect(fs.existsSync(marker())).toBe(false);

    // Sanity check that the trap is real: plain git with the same config does run it.
    execFileSync("git", ["-C", repo, "status"], { env: ENV });
    expect(fs.existsSync(marker())).toBe(true);
  });
});

describe("repository registry", () => {
  it("adds, rejects duplicates and non-repos, lists and removes", async () => {
    const dbdir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-reg-"));
    const { db, sqlite } = openDb(path.join(dbdir, "t.sqlite"));
    try {
      const r = await addRepo(db, repo);
      expect(r).toMatchObject({ path: repo, name: "r" });
      await expect(addRepo(db, repo)).rejects.toThrow(/already added/);
      await expect(addRepo(db, root)).rejects.toThrow(/not a git repository/);
      await expect(addRepo(db, path.join(repo, ".git"))).rejects.toThrow();
      fs.mkdirSync(path.join(repo, "sub"));
      await expect(addRepo(db, path.join(repo, "sub"))).rejects.toThrow(/top-level/);
      await expect(addRepo(db, "relative/path")).rejects.toThrow();
      await expect(addRepo(db, `${repo}/../r`)).rejects.toThrow();
      expect(listRepos(db)).toHaveLength(1);
      expect(removeRepo(db, r.id)).toBe(true);
      expect(removeRepo(db, r.id)).toBe(false);
      // symlinked path resolves to the real path
      const link = path.join(root, "link-to-r");
      fs.symlinkSync(repo, link);
      expect((await addRepo(db, link)).path).toBe(repo);
      expect(await validateRepo(repo)).toBe(repo);
    } finally {
      sqlite.close();
      fs.rmSync(dbdir, { recursive: true, force: true });
    }
  });
});
