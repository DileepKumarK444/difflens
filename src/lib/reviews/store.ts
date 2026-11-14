import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { findings, reviewFiles, reviews } from "@/lib/db/schema";
import type { EngineResult } from "@/lib/ai/engine";
import { severityRank, type Severity } from "@/lib/ai/schema";
import type { FileDiff } from "@/lib/git/diff-parse";
import { z } from "zod";

export interface NewReview {
  kind: "local" | "pr";
  source: unknown;
  title: string;
  repoId: string | null;
  pr?: { host: string; ownerRepo: string; number: number };
  provider: string;
  model: string | null;
  minSeverity: Severity;
  patch: string;
  files: FileDiff[];
}

export function createReview(db: Db, n: NewReview): string {
  const id = crypto.randomUUID();
  db.insert(reviews)
    .values({
      id, kind: n.kind, source: JSON.stringify(n.source), title: n.title, repoId: n.repoId,
      prHost: n.pr?.host ?? null, prOwnerRepo: n.pr?.ownerRepo ?? null, prNumber: n.pr?.number ?? null,
      provider: n.provider, model: n.model, status: "running", diffSnapshot: n.patch, minSeverity: n.minSeverity,
    })
    .run();
  if (n.files.length) {
    db.insert(reviewFiles)
      .values(n.files.map((f) => ({ id: crypto.randomUUID(), reviewId: id, path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })))
      .run();
  }
  return id;
}

export function completeReview(db: Db, id: string, r: EngineResult): void {
  db.transaction((tx) => {
    if (r.findings.length) {
      tx.insert(findings)
        .values(
          r.findings.map((f) => ({
            id: `${id}:${f.id}`, reviewId: id, title: f.title, category: f.category, severity: f.severity, filePath: f.filePath,
            lineStart: f.lineStart, lineEnd: f.lineEnd, description: f.description, whyItMatters: f.whyItMatters,
            suggestedFix: f.suggestedFix, codeExample: f.codeExample, confidence: f.confidence, verification: f.verification,
          })),
        )
        .onConflictDoNothing()
        .run();
    }
    tx.update(reviews)
      .set({
        status: r.partial ? "partial" : "complete", partialReason: r.partialReason, completedAt: new Date(),
        meta: JSON.stringify({ chunks: r.chunks, skipped: r.skipped, dropped: r.dropped, errors: r.errors, stats: r.stats, repaired: r.repaired, filesReviewed: r.filesReviewed }),
      })
      .where(eq(reviews.id, id))
      .run();
  });
}

export function failReview(db: Db, id: string, message: string): void {
  db.update(reviews).set({ status: "failed", errorMessage: message.slice(0, 500), completedAt: new Date() }).where(eq(reviews.id, id)).run();
}

export function getReview(db: Db, id: string) {
  const review = db.select().from(reviews).where(eq(reviews.id, id)).get();
  if (!review) return null;
  const fs = db.select().from(reviewFiles).where(eq(reviewFiles.reviewId, id)).orderBy(asc(reviewFiles.path)).all();
  const fd = db.select().from(findings).where(eq(findings.reviewId, id)).all();
  fd.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart);
  return { review, files: fs, findings: fd };
}

export function listReviews(db: Db, limit = 50) {
  return db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(limit).all();
}

export const TriagePatch = z
  .object({
    status: z.enum(["open", "resolved", "ignored"]).optional(),
    note: z.string().max(4000).optional(),
  })
  .refine((v) => v.status !== undefined || v.note !== undefined, "Nothing to change");

/** Update a finding's triage status and/or personal note. Returns the updated row, or null if it doesn't exist. */
export function updateFinding(db: Db, id: string, patch: z.infer<typeof TriagePatch>) {
  const p = TriagePatch.parse(patch);
  const set: Partial<typeof findings.$inferInsert> = {};
  if (p.status !== undefined) set.status = p.status;
  if (p.note !== undefined) set.note = p.note;
  const r = db.update(findings).set(set).where(eq(findings.id, id)).run();
  if (r.changes === 0) return null;
  return db.select().from(findings).where(eq(findings.id, id)).get() ?? null;
}

export function deleteReview(db: Db, id: string): boolean {
  return db.delete(reviews).where(eq(reviews.id, id)).run().changes > 0;
}

/** One row per review with the counts the History page shows. */
export function listReviewSummaries(db: Db, limit = 200) {
  return db
    .select({
      id: reviews.id,
      kind: reviews.kind,
      title: reviews.title,
      provider: reviews.provider,
      model: reviews.model,
      status: reviews.status,
      prOwnerRepo: reviews.prOwnerRepo,
      prNumber: reviews.prNumber,
      createdAt: reviews.createdAt,
      total: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id")`,
      open: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id" and f.status = 'open')`,
      critical: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id" and f.status = 'open' and f.severity = 'Critical')`,
      high: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id" and f.status = 'open' and f.severity = 'High')`,
      posted: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id" and f.posted_at is not null)`,
    })
    .from(reviews)
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .all();
}
