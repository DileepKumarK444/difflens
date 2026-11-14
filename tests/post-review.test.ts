import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/lib/db";
import { findings, reviews } from "@/lib/db/schema";
import type { Deps } from "@/lib/gh/accounts";
import { PostError, executePost, previewPost } from "@/lib/gh/post-review";
import { GhError, clearPrCache } from "@/lib/gh/prs";
import { deleteReview, listReviewSummaries } from "@/lib/reviews/store";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MB = "c".repeat(40);
const TOKEN = "ghp_" + "Q".repeat(30);

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 keep10
-old11
+new11
+new12
 keep13
`;
const metaJson = (o: object = {}) =>
  JSON.stringify({ number: 7, title: "Fix things", body: "", author: { login: "maya" }, state: "OPEN", isDraft: false, baseRefName: "main", headRefName: "f", baseRefOid: BASE, headRefOid: HEAD, additions: 2, deletions: 1, changedFiles: 1, reviewDecision: "", url: "https://github.com/acme/api/pull/7", ...o });

let dir: string;
let db: Db;
let close: () => void;
let calls: { args: string[]; input?: string; env?: Record<string, string> }[];
type Payload = { event?: string; commit_id?: string; body?: string; comments?: Record<string, unknown>[] };
let posts: { args: string[]; payload: Payload }[];
let state: { prState: string; head: string; postReply: (n: number) => { code: number; stdout?: string; stderr?: string } };

const deps = (): Deps => ({
  run: async (_f, args, o) => {
    calls.push({ args, input: o?.input, env: o?.env });
    if (args[0] === "auth" && args[1] === "token") return { stdout: TOKEN + "\n", stderr: "", code: 0 };
    if (args[0] === "pr" && args[1] === "view") return { stdout: metaJson({ state: state.prState, headRefOid: state.head }), stderr: "", code: 0 };
    if (args[0] === "api" && args.some((a) => a.includes("/compare/"))) return { stdout: MB + "\n", stderr: "", code: 0 };
    if (args[0] === "pr" && args[1] === "diff") return { stdout: PATCH, stderr: "", code: 0 };
    if (args[0] === "api" && args.includes("POST")) {
      posts.push({ args, payload: JSON.parse(o?.input ?? "{}") as Payload });
      const r = state.postReply(posts.length);
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code };
    }
    return { stdout: "", stderr: "unexpected " + args.join(" "), code: 1 };
  },
  keychain: { set: async () => {}, get: async () => null, remove: async () => {} },
});

const finding = (id: string, o: Record<string, unknown> = {}) => ({
  id: `r1:${id}`, reviewId: "r1", title: `Finding ${id}`, category: "bug", severity: "High" as const, filePath: "src/a.ts", lineStart: 11, lineEnd: 11,
  description: `Description ${id}`, whyItMatters: "It matters", suggestedFix: "Fix it", codeExample: "return 1;", confidence: 0.8, ...o,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-post-"));
  const o = openDb(path.join(dir, "t.sqlite"));
  db = o.db;
  close = () => o.sqlite.close();
  calls = [];
  posts = [];
  clearPrCache();
  state = { prState: "OPEN", head: HEAD, postReply: () => ({ code: 0, stdout: JSON.stringify({ html_url: "https://github.com/acme/api/pull/7#pullrequestreview-1" }) }) };
  db.insert(reviews).values({
    id: "r1", kind: "pr", source: JSON.stringify({ type: "pr", pr: { host: "github.com", owner: "acme", repo: "api", number: 7, account: "gh:github.com:me" }, headOid: HEAD }),
    title: "acme/api #7", provider: "claude-code", prHost: "github.com", prOwnerRepo: "acme/api", prNumber: 7,
  }).run();
  db.insert(findings).values([finding("a"), finding("b", { lineStart: 11, lineEnd: 13, title: "Range" }), finding("far", { lineStart: 99, lineEnd: 99, title: "Far away" })]).run();
});
afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = (...x: string[]) => x.map((i) => `r1:${i}`);
const confirm = { repo: "acme/api", number: 7 };

describe("previewPost", () => {
  it("shows what would be posted and posts nothing", async () => {
    const p = await previewPost(db, "r1", { ids: ids("a", "b") }, deps());
    expect(p).toMatchObject({ repo: "acme/api", number: 7, title: "Fix things", mode: "inline", headOid: HEAD });
    expect(p.items.map((i) => [i.path, i.line, i.side, i.mapped])).toEqual([["src/a.ts", 11, "RIGHT", true], ["src/a.ts", 11, "RIGHT", true]]);
    expect(p.items[0].body).toContain("**High: Finding a**");
    expect(posts).toHaveLength(0);
    expect(db.select().from(findings).all().every((f) => f.postedAt === null)).toBe(true);
  });
  it("switches to one general comment when a finding can't be placed, and says why", async () => {
    const p = await previewPost(db, "r1", { ids: ids("a", "far") }, deps());
    expect(p.mode).toBe("general");
    expect(p.items.find((i) => i.id === "r1:far")).toMatchObject({ mapped: false, reason: expect.stringContaining("isn’t part of the PR") });
    expect(p.warnings.join(" ")).toMatch(/one general comment/);
  });
  it("only makes suggestion blocks when asked and when the lines match exactly", async () => {
    const p = await previewPost(db, "r1", { ids: ids("a", "b"), suggestionIds: ids("a") }, deps());
    expect(p.items[0]).toMatchObject({ suggestion: true });
    expect(p.items[0].body).toContain("```suggestion\nreturn 1;\n```");
    expect(p.items[1]).toMatchObject({ suggestion: false });
    expect(p.items[1].body).not.toContain("suggestion");
    db.update(findings).set({ codeExample: null }).where(eq(findings.id, "r1:a")).run();
    const q = await previewPost(db, "r1", { ids: ids("a"), suggestionIds: ids("a") }, deps());
    expect(q.items[0].suggestion).toBe(false);
    expect(q.warnings.join(" ")).toMatch(/can’t be a suggestion block/);
  });
  it("respects edited text and a custom summary", async () => {
    const p = await previewPost(db, "r1", { ids: ids("a"), bodies: { "r1:a": "My own wording" }, summary: "Two small things" }, deps());
    expect(p.items[0].body).toBe("My own wording");
    expect(p.summary).toBe("Two small things");
  });
});

describe("executePost", () => {
  it("posts one COMMENT review with inline comments, using the account's token only through the environment", async () => {
    const r = await executePost(db, "r1", { ids: ids("a", "b"), suggestionIds: ids("a") }, confirm, deps());
    expect(r).toMatchObject({ mode: "inline", posted: 2, fallbackReason: null, url: "https://github.com/acme/api/pull/7#pullrequestreview-1" });
    expect(posts).toHaveLength(1);
    const { args, payload } = posts[0];
    expect(args).toEqual(expect.arrayContaining(["api", "--hostname", "github.com", "-X", "POST", "repos/acme/api/pulls/7/reviews", "--input", "-"]));
    expect(payload).toMatchObject({ event: "COMMENT", commit_id: HEAD });
    expect(payload.comments).toHaveLength(2);
    expect(payload.comments![0]).toMatchObject({ path: "src/a.ts", line: 11, side: "RIGHT" });
    expect(payload.comments![1]).toMatchObject({ line: 13, start_line: 11, start_side: "RIGHT" });
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
    expect(posts[0].args.join(" ")).not.toContain(TOKEN);
    const postCall = calls.find((c) => c.args.includes("POST"))!;
    expect(postCall.env?.GH_TOKEN).toBe(TOKEN);
    const rows = db.select().from(findings).all();
    expect(rows.filter((f) => f.postedAt !== null).map((f) => f.id).sort()).toEqual(ids("a", "b"));
  });
  it("never approves or requests changes, whatever is asked", async () => {
    await executePost(db, "r1", { ids: ids("a"), event: "APPROVE" } as never, confirm, deps());
    expect(posts[0].payload.event).toBe("COMMENT");
  });
  it("posts one general comment when some lines can't be placed", async () => {
    const r = await executePost(db, "r1", { ids: ids("a", "far") }, confirm, deps());
    expect(r).toMatchObject({ mode: "general", fallbackReason: expect.stringContaining("couldn’t be placed") });
    expect(posts[0].payload.comments).toBeUndefined();
    expect(posts[0].payload.body).toContain("`src/a.ts:11`");
    expect(posts[0].payload.body).toContain("Far away");
  });
  it("falls back to a general comment if GitHub rejects the line positions", async () => {
    state.postReply = (n) => (n === 1 ? { code: 1, stderr: "HTTP 422: Unprocessable Entity: line must be part of the diff" } : { code: 0, stdout: "{}" });
    const r = await executePost(db, "r1", { ids: ids("a") }, confirm, deps());
    expect(r).toMatchObject({ mode: "general", fallbackReason: expect.stringContaining("didn’t accept") });
    expect(posts).toHaveLength(2);
    expect(posts[1].payload.comments).toBeUndefined();
  });
  it("refuses a confirmation that names the wrong repo or number, and posts nothing", async () => {
    await expect(executePost(db, "r1", { ids: ids("a") }, { repo: "acme/other", number: 7 }, deps())).rejects.toThrow(/doesn’t match/);
    await expect(executePost(db, "r1", { ids: ids("a") }, { repo: "acme/api", number: 8 }, deps())).rejects.toThrow(PostError);
    expect(posts).toHaveLength(0);
  });
  it("maps GitHub permission errors to a clear message and does not mark findings posted", async () => {
    state.postReply = () => ({ code: 1, stderr: `HTTP 403: Resource not accessible by personal access token (${TOKEN})` });
    const err = await executePost(db, "r1", { ids: ids("a") }, confirm, deps()).catch((e) => e);
    expect(err).toBeInstanceOf(GhError);
    expect(err.message).toMatch(/isn’t allowed to comment/);
    expect(err.message).not.toContain(TOKEN);
    expect(db.select().from(findings).all().every((f) => f.postedAt === null)).toBe(true);
  });
});

describe("refusals", () => {
  it("never posts a local review", async () => {
    db.update(reviews).set({ kind: "local" }).where(eq(reviews.id, "r1")).run();
    await expect(previewPost(db, "r1", { ids: ids("a") }, deps())).rejects.toThrow(/Local reviews never are/);
    await expect(executePost(db, "r1", { ids: ids("a") }, confirm, deps())).rejects.toThrow(PostError);
    expect(posts).toHaveLength(0);
  });
  it("refuses when the PR has new commits since the review", async () => {
    state.head = "d".repeat(40);
    await expect(executePost(db, "r1", { ids: ids("a") }, confirm, deps())).rejects.toThrow(/new commits/);
    expect(posts).toHaveLength(0);
  });
  it("refuses a closed PR", async () => {
    state.prState = "MERGED";
    await expect(previewPost(db, "r1", { ids: ids("a") }, deps())).rejects.toThrow(/merged/);
  });
  it("refuses findings from another review, empty selections and unknown reviews", async () => {
    db.insert(reviews).values({ id: "r2", kind: "pr", source: "{}", title: "x", provider: "p" }).run();
    db.insert(findings).values({ ...finding("z"), id: "r2:z", reviewId: "r2" }).run();
    await expect(previewPost(db, "r1", { ids: ["r2:z"] }, deps())).rejects.toThrow(/don’t belong/);
    await expect(previewPost(db, "r1", { ids: [] }, deps())).rejects.toThrow(/at least one/);
    await expect(previewPost(db, "nope", { ids: ids("a") }, deps())).rejects.toThrow(/doesn’t exist/);
    await expect(previewPost(db, "r2", { ids: ["r2:z"] }, deps())).rejects.toThrow(/doesn’t record which pull request/);
  });
  it("warns, rather than blocks, when the review didn't record its commit", async () => {
    db.update(reviews).set({ source: JSON.stringify({ type: "pr", pr: { host: "github.com", owner: "acme", repo: "api", number: 7 } }) }).where(eq(reviews.id, "r1")).run();
    const p = await previewPost(db, "r1", { ids: ids("a") }, deps());
    expect(p.warnings.join(" ")).toMatch(/can’t confirm the PR hasn’t changed/);
  });
});

describe("history store", () => {
  it("summarises counts and deletes with cascade", () => {
    db.update(findings).set({ status: "resolved" }).where(eq(findings.id, "r1:far")).run();
    db.update(findings).set({ severity: "Critical", postedAt: new Date() }).where(eq(findings.id, "r1:a")).run();
    const s = listReviewSummaries(db).find((r) => r.id === "r1")!;
    expect(s).toMatchObject({ total: 3, open: 2, critical: 1, high: 1, posted: 1 });
    expect(deleteReview(db, "r1")).toBe(true);
    expect(deleteReview(db, "r1")).toBe(false);
    expect(db.select().from(findings).all()).toHaveLength(0);
  });
});
