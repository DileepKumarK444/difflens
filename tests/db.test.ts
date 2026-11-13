import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db";
import { findings, reviewFiles, reviews, repos } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/db/settings";
import { dashboardStats } from "@/lib/db/queries";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-test-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const finding = (reviewId: string, id: string, severity: "Critical" | "Low" = "Low") => ({
  id,
  reviewId,
  title: "t",
  category: "bug",
  severity,
  filePath: "a.ts",
  lineStart: 1,
  lineEnd: 2,
  description: "d",
  whyItMatters: "w",
  suggestedFix: "f",
  confidence: 0.9,
});

describe("database", () => {
  it("applies migrations to a fresh file", () => {
    const { sqlite } = openDb(path.join(dir, "t.sqlite"));
    const tables = sqlite
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["repos", "reviews", "review_files", "findings", "settings"]) expect(tables).toContain(t);
    sqlite.close();
  });

  it("persists data across reopen", () => {
    const file = path.join(dir, "t.sqlite");
    const a = openDb(file);
    a.db.insert(reviews).values({ id: "r1", kind: "local", source: "{}", title: "Staged", provider: "claude-code" }).run();
    a.db.insert(findings).values(finding("r1", "f1", "Critical")).run();
    a.sqlite.close();

    const b = openDb(file); // reopening re-runs migrations safely
    expect(b.db.select().from(reviews).all()).toHaveLength(1);
    const f = b.db.select().from(findings).get();
    expect(f?.status).toBe("open");
    expect(f?.note).toBe("");
    b.sqlite.close();
  });

  it("cascades deletes from review to files and findings", () => {
    const { db, sqlite } = openDb(path.join(dir, "t.sqlite"));
    db.insert(reviews).values({ id: "r1", kind: "pr", source: "{}", title: "PR", provider: "ollama" }).run();
    db.insert(reviewFiles).values({ id: "x", reviewId: "r1", path: "a.ts", status: "M" }).run();
    db.insert(findings).values(finding("r1", "f1")).run();
    db.delete(reviews).where(eq(reviews.id, "r1")).run();
    expect(db.select().from(findings).all()).toHaveLength(0);
    expect(db.select().from(reviewFiles).all()).toHaveLength(0);
    sqlite.close();
  });

  it("rejects invalid enum-like values only via app validation, but enforces foreign keys", () => {
    const { db, sqlite } = openDb(path.join(dir, "t.sqlite"));
    expect(() => db.insert(findings).values(finding("missing", "f1")).run()).toThrow();
    sqlite.close();
  });

  it("enforces unique repo paths", () => {
    const { db, sqlite } = openDb(path.join(dir, "t.sqlite"));
    db.insert(repos).values({ id: "1", path: "/x", name: "x" }).run();
    expect(() => db.insert(repos).values({ id: "2", path: "/x", name: "x" }).run()).toThrow();
    sqlite.close();
  });
});

describe("settings", () => {
  it("returns defaults, round-trips, and falls back on corrupt values", () => {
    const { db, sqlite } = openDb(path.join(dir, "t.sqlite"));
    expect(getSetting(db, "provider")).toBe("claude-code");
    setSetting(db, "provider", "ollama");
    expect(getSetting(db, "provider")).toBe("ollama");
    sqlite.prepare("update settings set value = ? where key = 'provider'").run('"not-a-provider"');
    expect(getSetting(db, "provider")).toBe("claude-code");
    sqlite.prepare("update settings set value = ? where key = 'provider'").run("{broken");
    expect(getSetting(db, "provider")).toBe("claude-code");
    expect(() => setSetting(db, "ollamaUrl", "not a url")).toThrow();
    sqlite.close();
  });
});

describe("dashboard stats", () => {
  it("counts open and critical findings", () => {
    const { db, sqlite } = openDb(path.join(dir, "t.sqlite"));
    db.insert(reviews).values({ id: "r1", kind: "local", source: "{}", title: "A", provider: "claude-code" }).run();
    db.insert(findings).values([finding("r1", "1", "Critical"), finding("r1", "2", "Low")]).run();
    db.update(findings).set({ status: "resolved" }).where(eq(findings.id, "2")).run();
    const s = dashboardStats(db);
    expect(s).toMatchObject({ reviewCount: 1, openFindings: 1, openCritical: 1, repoCount: 0 });
    expect(s.recent[0]).toMatchObject({ findingCount: 2, openCritical: 1 });
    sqlite.close();
  });
});
