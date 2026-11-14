import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "@/lib/db";
import { setSetting } from "@/lib/db/settings";
import type { Deps } from "@/lib/gh/accounts";
import { GhError, clearPrCache, contentsEndpoint, friendlyGhError, getPrDiff, getPrFileSides, getPrMeta, listPrs, listPrsAcross } from "@/lib/gh/prs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MB = "c".repeat(40);
const ref = { host: "github.com", owner: "acme", repo: "api", number: 12 };

let dir: string;
let db: Db;
let close: () => void;
let calls: { args: string[]; env?: Record<string, string> }[];
let handler: (args: string[]) => { stdout?: string; stderr?: string; code?: number };

const deps = (): Deps => ({
  run: async (_f, args, o) => {
    calls.push({ args, env: o?.env });
    const r = handler(args);
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code ?? 0 };
  },
  keychain: { set: async () => {}, get: async () => null, remove: async () => {} },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-prs-"));
  const o = openDb(path.join(dir, "t.sqlite"));
  db = o.db;
  close = () => o.sqlite.close();
  calls = [];
  clearPrCache();
  handler = () => ({ stdout: "[]" });
});
afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const item = (n: number, extra: object = {}) => ({
  number: n, title: `PR ${n}`, author: { login: "maya" }, isDraft: false, additions: 3, deletions: 1, changedFiles: 2,
  reviewDecision: "", url: `https://github.com/acme/api/pull/${n}`, headRefName: "f", baseRefName: "main", updatedAt: "2026-11-01T00:00:00Z", ...extra,
});

describe("listPrs", () => {
  it("builds the right gh arguments for each filter", async () => {
    handler = () => ({ stdout: JSON.stringify([item(1)]) });
    const r = { host: "github.com", owner: "acme", repo: "api" };
    await listPrs(db, r, "all", undefined, deps());
    await listPrs(db, r, "review", undefined, deps());
    await listPrs(db, r, "mine", undefined, deps());
    const [all, review, mine] = calls.map((c) => c.args);
    expect(all.slice(0, 4)).toEqual(["pr", "list", "-R", "github.com/acme/api"]);
    expect(all).toEqual(expect.arrayContaining(["--state", "open", "--limit", "100"]));
    expect(all).not.toContain("--search");
    expect(review).toEqual(expect.arrayContaining(["--search", "review-requested:@me"]));
    expect(mine).toEqual(expect.arrayContaining(["--author", "@me"]));
  });

  it("returns normalised items (author, draft, lines, decision)", async () => {
    handler = () => ({ stdout: JSON.stringify([item(5, { isDraft: true, reviewDecision: "APPROVED" }), item(6, { author: null })]) });
    const prs = await listPrs(db, { host: "github.com", owner: "acme", repo: "api" }, "all", undefined, deps());
    expect(prs[0]).toMatchObject({ number: 5, author: "maya", isDraft: true, additions: 3, deletions: 1, reviewDecision: "APPROVED" });
    expect(prs[1]).toMatchObject({ author: null, reviewDecision: null });
  });

  it("rejects unexpected output and maps gh failures to friendly errors", async () => {
    const r = { host: "github.com", owner: "acme", repo: "api" };
    handler = () => ({ stdout: "<html>nope</html>" });
    await expect(listPrs(db, r, "all", undefined, deps())).rejects.toThrow(/unexpected/);
    handler = () => ({ code: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/api'." });
    await expect(listPrs(db, r, "all", undefined, deps())).rejects.toThrow(/no access/i);
    handler = () => ({ code: 1, stderr: "HTTP 401: Bad credentials" });
    await expect(listPrs(db, r, "all", undefined, deps())).rejects.toThrow(/gh auth login/);
  });

  it("uses the chosen account token only through the environment", async () => {
    const TOKEN = "ghp_" + "Q".repeat(30);
    const d = deps();
    const base = d.run;
    d.run = async (f, a, o) => (a[0] === "auth" ? { stdout: TOKEN + "\n", stderr: "", code: 0 } : base(f, a, o));
    handler = () => ({ stdout: "[]" });
    await listPrs(db, { host: "github.com", owner: "acme", repo: "api" }, "all", "gh:github.com:maya", d);
    const listCall = calls.find((c) => c.args[0] === "pr")!;
    expect(listCall.env?.GH_TOKEN).toBe(TOKEN);
    expect(listCall.args.join(" ")).not.toContain(TOKEN);
  });

  it("falls back to the default account setting, and plain gh when account is empty", async () => {
    const d = deps();
    const base = d.run;
    d.run = async (f, a, o) => (a[0] === "auth" ? { stdout: "gho_" + "Z".repeat(30), stderr: "", code: 0 } : base(f, a, o));
    setSetting(db, "defaultAccount", "gh:github.com:me");
    await listPrs(db, { host: "github.com", owner: "a", repo: "b" }, "all", undefined, d);
    expect(calls.find((c) => c.args[0] === "pr")!.env?.GH_TOKEN).toMatch(/^gho_/);
    calls = [];
    await listPrs(db, { host: "github.com", owner: "a", repo: "b" }, "all", "", d);
    expect(calls.find((c) => c.args[0] === "pr")!.env?.GH_TOKEN).toBeUndefined();
  });
});

describe("listPrsAcross", () => {
  it("dedupes repos, keeps going when one fails, and reports per-repo errors", async () => {
    handler = (args) => {
      const repo = args[args.indexOf("-R") + 1];
      return repo.endsWith("/bad") ? { code: 1, stderr: "HTTP 404 Not Found" } : { stdout: JSON.stringify([item(1)]) };
    };
    const r = (repo: string) => ({ host: "github.com", owner: "acme", repo });
    const res = await listPrsAcross(db, [r("api"), r("bad"), r("API"), r("api"), r("web")], "all", undefined, deps());
    expect(res.map((x) => x.repo.repo)).toEqual(["api", "bad", "web"]);
    expect(res[1].error).toMatch(/Couldn.t find/);
    expect(res[0].prs).toHaveLength(1);
    expect(res[2].error).toBeNull();
  });
});

describe("PR metadata, diff and file sides", () => {
  const metaJson = JSON.stringify({
    number: 12, title: "T", body: "B", author: { login: "maya" }, state: "OPEN", isDraft: false, baseRefName: "main", headRefName: "f",
    baseRefOid: BASE, headRefOid: HEAD, additions: 4, deletions: 2, changedFiles: 3, reviewDecision: "REVIEW_REQUIRED", url: "https://github.com/acme/api/pull/12",
  });
  const answer = (args: string[]) => {
    if (args[0] === "pr" && args[1] === "view") return { stdout: metaJson };
    if (args[0] === "api" && args.some((a) => a.includes("/compare/"))) return { stdout: MB + "\n" };
    if (args[0] === "pr" && args[1] === "diff") return { stdout: "diff --git a/x b/x\n" };
    if (args[0] === "api") {
      const ep = args[args.length - 1];
      if (ep.includes(`ref=${MB}`)) return { stdout: "old content\n" };
      if (ep.includes(`ref=${HEAD}`)) return ep.includes("gone") ? { code: 1, stderr: "HTTP 404: Not Found" } : { stdout: "new content\n" };
    }
    return { code: 1, stderr: "unexpected" };
  };

  it("gets metadata with the merge base, and caches it", async () => {
    handler = answer;
    const m = await getPrMeta(db, ref, deps());
    expect(m).toMatchObject({ title: "T", mergeBase: MB, headOid: HEAD, author: "maya", reviewDecision: "REVIEW_REQUIRED" });
    const compare = calls.find((c) => c.args.some((a) => a.includes("/compare/")))!;
    expect(compare.args).toContain("--hostname");
    expect(compare.args.join(" ")).toContain(`compare/${BASE}...${HEAD}`);
    const n = calls.length;
    await getPrMeta(db, ref, deps());
    expect(calls.length).toBe(n); // served from cache
  });

  it("fetches the diff", async () => {
    handler = answer;
    const d = await getPrDiff(db, ref, deps());
    expect(d.patch).toContain("diff --git");
    const diffCall = calls.find((c) => c.args[1] === "diff")!;
    expect(diffCall.args).toEqual(expect.arrayContaining(["12", "-R", "github.com/acme/api", "--color", "never"]));
  });

  it("reads each side at the right commit (merge base vs head), treating 404 as absent", async () => {
    handler = answer;
    const s = await getPrFileSides(db, ref, "src/a.ts", null, deps());
    expect(s).toMatchObject({ original: "old content\n", modified: "new content\n", binary: false, tooLarge: false });
    const deleted = await getPrFileSides(db, ref, "gone.ts", null, deps());
    expect(deleted.modified).toBeNull();
    expect(deleted.original).toBe("old content\n");
    const apiCalls = calls.filter((c) => c.args[0] === "api" && c.args.some((a) => a.includes("/contents/")));
    expect(apiCalls[0].args).toEqual(expect.arrayContaining(["-H", "Accept: application/vnd.github.raw+json"]));
  });

  it("flags binary and oversized content", async () => {
    handler = (args) => (args[0] === "pr" ? answer(args) : args.some((a) => a.includes("/compare/")) ? answer(args) : { stdout: args.join(" ").includes("big") ? "x".repeat(1024 * 1024 + 1) : "a\0b" });
    expect((await getPrFileSides(db, ref, "img.bin", null, deps())).binary).toBe(true);
    expect((await getPrFileSides(db, ref, "big.txt", null, deps())).tooLarge).toBe(true);
  });

  it("refuses unsafe paths before calling GitHub", async () => {
    handler = answer;
    for (const p of ["../etc/passwd", "/abs", "a/../b", "", "a\nb"]) {
      await expect(getPrFileSides(db, ref, p, null, deps()), p).rejects.toThrow(/Invalid file path/);
    }
    expect(calls.length).toBe(0);
  });
});

describe("contentsEndpoint and error text", () => {
  it("encodes path segments and validates the sha", () => {
    const r = { host: "github.com", owner: "a", repo: "b" };
    expect(contentsEndpoint(r, "dir/my file#1?.ts", HEAD)).toBe(`repos/a/b/contents/dir/my%20file%231%3F.ts?ref=${HEAD}`);
    expect(() => contentsEndpoint(r, "x", "main")).toThrow();
    expect(() => contentsEndpoint(r, "x", `${HEAD}&per_page=1`)).toThrow();
  });
  it("friendlyGhError never echoes raw stderr", () => {
    expect(friendlyGhError("secret=ghp_abcdefghijklmnopqrstuvwxyz0123 weird", "x")).toBe("GitHub request failed");
    expect(friendlyGhError("Resource protected by organization SAML enforcement", "acme/api")).toMatch(/SSO/);
    expect(friendlyGhError("API rate limit exceeded", "x")).toMatch(/rate limit/);
    expect(friendlyGhError("pull request diff exceeded the maximum number of lines", "x")).toMatch(/too large/);
    expect(new GhError("x")).toBeInstanceOf(Error);
  });
});
