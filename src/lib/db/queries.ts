import { and, count, desc, eq, sql } from "drizzle-orm";
import { findings, repos, reviews } from "./schema";
import type { Db } from "./index";

export function dashboardStats(db: Db) {
  const reviewCount = db.select({ n: count() }).from(reviews).get()?.n ?? 0;
  const repoCount = db.select({ n: count() }).from(repos).get()?.n ?? 0;
  const openFindings =
    db.select({ n: count() }).from(findings).where(eq(findings.status, "open")).get()?.n ?? 0;
  const openCritical =
    db
      .select({ n: count() })
      .from(findings)
      .where(and(eq(findings.status, "open"), eq(findings.severity, "Critical")))
      .get()?.n ?? 0;

  const recent = db
    .select({
      id: reviews.id,
      title: reviews.title,
      kind: reviews.kind,
      status: reviews.status,
      provider: reviews.provider,
      createdAt: reviews.createdAt,
      findingCount: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id")`,
      openCritical: sql<number>`(select count(*) from findings f where f.review_id = "reviews"."id" and f.status = 'open' and f.severity = 'Critical')`,
    })
    .from(reviews)
    .orderBy(desc(reviews.createdAt))
    .limit(8)
    .all();

  return { reviewCount, repoCount, openFindings, openCritical, recent };
}
