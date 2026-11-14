import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "@/lib/db";
import { findings, reviewFiles, reviews } from "@/lib/db/schema";
import { setSetting } from "@/lib/db/settings";
import { addRepo } from "@/lib/git/repos-db";
import { ProviderError, type CompleteRequest, type ReviewProvider } from "@/lib/ai/providers/types";
import { getProgress } from "@/lib/reviews/jobs";
import { startReview, type StartResult } from "@/lib/reviews/service";
import { getReview } from "@/lib/reviews/store";
import { eq } from "drizzle-orm";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env: ENV, encoding: "utf8" });

let root: string;
let repoPath: string;
let db: Db;
let close: () => void;
let repoId: string;

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "difflens-svc-")));
  repoPath = path.join(root, "r");
  fs.mkdirSync(repoPath);
  sh(repoPath, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repoPath, "a.ts"), "export const a = 1;\n");
  sh(repoPath, "add", "-A");
  sh(repoPath, "commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(repoPath, "a.ts"), "export const a = 1;\nexport async function save(x) {\n  fetchIt(x);\n  return 1;\n}\n");
  const o = openDb(path.join(root, "t.sqlite"));
  db = o.db;
  close = () => o.sqlite.close();
  repoId = (await addRepo(db, repoPath)).id;
});
afterEach(() => {
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

const body = (confirmSend?: boolean) => ({ source: { type: "local" as const, repoId, scope: { type: "working" as const } }, confirmSend });
const reply = JSON.stringify({ findings: [{ id: "1", title: "Floating promise", category: "bug", severity: "High", filePath: "a.ts", lineStart: 3, lineEnd: 3, description: "fetchIt() is not awaited", whyItMatters: "errors are lost", suggestedFix: "await it", codeExample: "await fetchIt(x);", confidence: 0.9 }] });

function provider(over: Partial<ReviewProvider> & { replies?: () => string | Error } = {}) {
  const calls: CompleteRequest[] = [];
  const p: ReviewProvider = {
    id: "claude-code", label: "Claude Code (headless)", leavesMachine: true, readsRepo: true, model: null,
    status: async () => ({ ok: true, detail: "ok" }),
    complete: async (req) => {
      calls.push(req);
      const r = over.replies ? over.replies() : reply;
      if (r instanceof Error) throw r;
      return r;
    },
    ...over,
  };
  return { p, calls };
}

async function waitDone(id: string) {
  for (let i = 0; i < 200; i++) {
    const r = getReview(db, id)!;
    if (r.review.status !== "running") return r;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("review did not finish");
}
const asId = (r: StartResult) => {
  if (!("id" in r)) throw new Error("expected a started review");
  return r.id;
};

describe("confirmation before sending code", () => {
  it("asks first (default policy), creates nothing, and never calls the provider", async () => {
    const { p, calls } = provider();
    const r = await startReview(db, body(), { provider: p });
    expect(r).toMatchObject({ needsConfirmation: true, summary: { leavesMachine: true, destination: "Anthropic", repoAccess: true, files: 1, parts: 1 } });
    expect(db.select().from(reviews).all()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
  it("starts once confirmed, and the summary names what will be sent", async () => {
    const { p } = provider();
    const r = await startReview(db, body(true), { provider: p });
    expect(r).toHaveProperty("id");
    if ("summary" in r) expect(r.summary).toMatchObject({ provider: "Claude Code (headless)", additions: 4 });
    await waitDone(asId(r));
  });
  it("'never' skips the question, 'session' asks only until the first confirmation", async () => {
    setSetting(db, "confirmSend", "never");
    const a = provider();
    await waitDone(asId(await startReview(db, body(), { provider: a.p })));
    setSetting(db, "confirmSend", "session");
    const b = provider();
    expect(await startReview(db, body(), { provider: b.p })).toHaveProperty("needsConfirmation");
    await waitDone(asId(await startReview(db, body(true), { provider: b.p })));
    const again = await startReview(db, body(), { provider: b.p });
    expect(again).toHaveProperty("id"); // remembered for this server session
    await waitDone(asId(again));
  });
  it("a provider that stays on this machine never asks", async () => {
    const { p } = provider({ leavesMachine: false, readsRepo: false, id: "ollama" });
    const r = await startReview(db, body(), { provider: p });
    expect(r).toHaveProperty("id");
    expect("summary" in r && r.summary.destination).toBe("this machine only");
    await waitDone(asId(r));
  });
});

describe("running and storing a review", () => {
  it("runs in the background, stores verified findings, files and the diff snapshot", async () => {
    const { p, calls } = provider();
    const id = asId(await startReview(db, body(true), { provider: p }));
    expect(getProgress(id)).not.toBeNull();
    const r = await waitDone(id);
    expect(r.review).toMatchObject({ status: "complete", kind: "local", provider: "claude-code", repoId });
    expect(r.review.diffSnapshot).toContain("fetchIt(x)");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ title: "Floating promise", severity: "High", filePath: "a.ts", lineStart: 3, status: "open", verification: "exact" });
    expect(r.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(JSON.parse(r.review.meta!)).toMatchObject({ chunks: { total: 1 }, stats: { reported: 1, verified: 1 } });
    expect(getProgress(id)).toBeNull(); // cleared once finished
    expect(calls[0].cwd).toBe(repoPath); // the repo is given to a provider that can read it
    expect(calls[0].prompt).toContain("fetchIt(x)");
  });
  it("marks a review failed with a safe message when the provider fails", async () => {
    const { p } = provider({ replies: () => new ProviderError("Claude Code isn’t logged in. Open a terminal, run claude, and log in with /login") });
    const r = await waitDone(asId(await startReview(db, body(true), { provider: p })));
    expect(r.review.status).toBe("failed");
    expect(r.review.errorMessage).toMatch(/isn’t logged in/);
    expect(r.findings).toHaveLength(0);
  });
  it("stores invalid model output as a clear failure after one repair", async () => {
    const { p, calls } = provider({ replies: () => "I found some problems! Here they are in prose." });
    const r = await waitDone(asId(await startReview(db, body(true), { provider: p })));
    expect(r.review.status).toBe("failed");
    expect(r.review.errorMessage).toMatch(/one repair attempt/);
    expect(calls).toHaveLength(2);
  });
  it("drops findings for lines or files that are not in the diff", async () => {
    const bad = JSON.stringify({ findings: [JSON.parse(reply).findings[0], { ...JSON.parse(reply).findings[0], filePath: "invented.ts", title: "Ghost" }, { ...JSON.parse(reply).findings[0], lineStart: 400, lineEnd: 400, title: "Far away" }] });
    const { p } = provider({ replies: () => bad });
    const r = await waitDone(asId(await startReview(db, body(true), { provider: p })));
    expect(r.findings.map((f) => f.title)).toEqual(["Floating promise"]);
    expect(JSON.parse(r.review.meta!).dropped).toHaveLength(2);
  });
  it("cascades: deleting a review removes its findings and files", async () => {
    const { p } = provider();
    const id = asId(await startReview(db, body(true), { provider: p }));
    await waitDone(id);
    db.delete(reviews).where(eq(reviews.id, id)).run();
    expect(db.select().from(findings).all()).toHaveLength(0);
    expect(db.select().from(reviewFiles).all()).toHaveLength(0);
  });
});

describe("refusing bad requests", () => {
  it("nothing to review", async () => {
    sh(repoPath, "checkout", "--", "a.ts");
    const { p } = provider();
    await expect(startReview(db, body(true), { provider: p })).rejects.toThrow(/Nothing to review/);
    expect(db.select().from(reviews).all()).toHaveLength(0);
  });
  it("a repository that isn't added", async () => {
    const { p } = provider();
    await expect(startReview(db, { source: { type: "local", repoId: "nope", scope: { type: "working" } } }, { provider: p })).rejects.toThrow(/isn’t added/);
  });
});
