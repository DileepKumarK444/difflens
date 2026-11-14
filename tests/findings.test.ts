import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "@/lib/db";
import { findings, reviews } from "@/lib/db/schema";
import { dashboardStats } from "@/lib/db/queries";
import { updateFinding } from "@/lib/reviews/store";
import { countBy, defaultFilters, filterFindings, markerSeverity, openCountsByFile, stepFinding, type FindingView } from "@/lib/findings";

const mk = (id: string, o: Partial<FindingView> = {}): FindingView => ({
  id, title: `Title ${id}`, category: "bug", severity: "High", filePath: "src/a.ts", lineStart: 1, lineEnd: 1, description: `desc ${id}`,
  whyItMatters: "", suggestedFix: "", codeExample: null, confidence: 0.8, verification: "exact", status: "open", note: "", ...o,
});

const LIST = [
  mk("1", { severity: "Critical", category: "security", title: "SQL injection in login", filePath: "src/db.ts" }),
  mk("2", { severity: "High", category: "bug", title: "Off by one", note: "ask Maya about this" }),
  mk("3", { severity: "Medium", category: "concurrency", status: "resolved", filePath: "src/b.ts" }),
  mk("4", { severity: "Low", category: "test-gap", status: "ignored" }),
  mk("5", { severity: "Informational", category: "other" }),
];

describe("filterFindings", () => {
  it("defaults to open findings of every severity, in the given order", () => {
    expect(filterFindings(LIST, defaultFilters()).map((f) => f.id)).toEqual(["1", "2", "5"]);
  });
  it("filters by severity, category and status", () => {
    const f = defaultFilters();
    f.status = "all";
    expect(filterFindings(LIST, f)).toHaveLength(5);
    f.severities = new Set(["Critical", "High"]);
    expect(filterFindings(LIST, f).map((x) => x.id)).toEqual(["1", "2"]);
    f.category = "security";
    expect(filterFindings(LIST, f).map((x) => x.id)).toEqual(["1"]);
    f.severities = new Set();
    expect(filterFindings(LIST, f)).toEqual([]);
    const g = defaultFilters();
    g.status = "resolved";
    expect(filterFindings(LIST, g).map((x) => x.id)).toEqual(["3"]);
  });
  it("searches title, description, file, category and notes, case-insensitively", () => {
    const f = { ...defaultFilters(), status: "all" as const };
    for (const [q, ids] of [["sql", ["1"]], ["MAYA", ["2"]], ["src/b.ts", ["3"]], ["test-gap", ["4"]], ["desc 5", ["5"]], ["  ", ["1", "2", "3", "4", "5"]], ["nothing matches", []]] as [string, string[]][]) {
      expect(filterFindings(LIST, { ...f, search: q }).map((x) => x.id), q).toEqual(ids);
    }
  });
  it("counts by status and severity", () => {
    expect(countBy(LIST, (f) => f.status)).toEqual({ open: 3, resolved: 1, ignored: 1 });
    expect(countBy(LIST, (f) => f.severity).Critical).toBe(1);
  });
});

describe("stepFinding (] and [ keys)", () => {
  const v = LIST.slice(0, 3);
  it("moves forward and back, wrapping around", () => {
    expect(stepFinding(v, null, 1)?.id).toBe("1");
    expect(stepFinding(v, null, -1)?.id).toBe("3");
    expect(stepFinding(v, "1", 1)?.id).toBe("2");
    expect(stepFinding(v, "3", 1)?.id).toBe("1");
    expect(stepFinding(v, "1", -1)?.id).toBe("3");
  });
  it("copes with an empty list and a current finding that was filtered out", () => {
    expect(stepFinding([], "1", 1)).toBeNull();
    expect(stepFinding(v, "gone", 1)?.id).toBe("1");
  });
});

describe("file badges and marker severities", () => {
  it("counts only open findings per file and tracks the worst severity", () => {
    const m = openCountsByFile(LIST);
    expect(m.get("src/a.ts")).toEqual({ open: 2, worst: "High" }); // 2 and 5 (4 is ignored)
    expect(m.get("src/db.ts")).toEqual({ open: 1, worst: "Critical" });
    expect(m.has("src/b.ts")).toBe(false); // resolved
  });
  it("maps severity to Monaco marker levels", () => {
    expect([markerSeverity("Critical"), markerSeverity("High"), markerSeverity("Medium"), markerSeverity("Low"), markerSeverity("Informational")]).toEqual([8, 8, 4, 2, 1]);
  });
});

describe("persisting triage and notes", () => {
  let dir: string;
  let db: Db;
  let close: () => void;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-triage-"));
    const o = openDb(path.join(dir, "t.sqlite"));
    db = o.db;
    close = () => o.sqlite.close();
    db.insert(reviews).values({ id: "r", kind: "local", source: "{}", title: "T", provider: "ollama" }).run();
    db.insert(findings).values({ id: "r:f1", reviewId: "r", title: "t", category: "bug", severity: "Critical", filePath: "a", lineStart: 1, lineEnd: 1, description: "d", whyItMatters: "w", suggestedFix: "f", confidence: 0.9 }).run();
  });
  afterEach(() => {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("changes status and note independently and survives a reopen", () => {
    expect(updateFinding(db, "r:f1", { status: "resolved" })).toMatchObject({ status: "resolved", note: "" });
    expect(updateFinding(db, "r:f1", { note: "fixed in abc123" })).toMatchObject({ status: "resolved", note: "fixed in abc123" });
    expect(updateFinding(db, "r:f1", { status: "open", note: "reopened" })).toMatchObject({ status: "open", note: "reopened" });
    expect(db.select().from(findings).get()).toMatchObject({ status: "open", note: "reopened" });
  });
  it("stores notes as plain text, whatever they contain", () => {
    const evil = '<img src=x onerror="alert(1)"> [link](javascript:alert(1)) `code`';
    expect(updateFinding(db, "r:f1", { note: evil })?.note).toBe(evil);
  });
  it("rejects empty, invalid and oversized changes and unknown ids", () => {
    expect(() => updateFinding(db, "r:f1", {})).toThrow();
    expect(() => updateFinding(db, "r:f1", { status: "deleted" as never })).toThrow();
    expect(() => updateFinding(db, "r:f1", { note: "x".repeat(4001) })).toThrow();
    expect(updateFinding(db, "r:nope", { status: "ignored" })).toBeNull();
    expect(db.select().from(findings).get()?.status).toBe("open");
  });
  it("only status and note can change: other fields are untouched", () => {
    updateFinding(db, "r:f1", { status: "ignored", title: "HACKED", severity: "Low" } as never);
    expect(db.select().from(findings).get()).toMatchObject({ title: "t", severity: "Critical", status: "ignored" });
  });
  it("triage feeds the dashboard counts", () => {
    expect(dashboardStats(db)).toMatchObject({ openFindings: 1, openCritical: 1 });
    updateFinding(db, "r:f1", { status: "resolved" });
    expect(dashboardStats(db)).toMatchObject({ openFindings: 0, openCritical: 0 });
  });
});
