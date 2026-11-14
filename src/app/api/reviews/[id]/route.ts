import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/api-helpers";
import { getProgress, isRunning } from "@/lib/reviews/jobs";
import { failReview, getReview } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  let r = getReview(db, id);
  if (!r) return notFound("Review");
  // A review marked running with no job in this process was cut off by a restart.
  if (r.review.status === "running" && !isRunning(id)) {
    failReview(db, id, "The app restarted while this review was running. Run it again");
    r = getReview(db, id)!;
  }
  const { diffSnapshot: _omit, ...review } = r.review;
  void _omit;
  return NextResponse.json({
    review: { ...review, meta: review.meta ? JSON.parse(review.meta) : null, createdAt: review.createdAt.getTime(), completedAt: review.completedAt?.getTime() ?? null },
    files: r.files,
    findings: r.findings.map((f) => ({ ...f, createdAt: f.createdAt.getTime() })),
    progress: getProgress(id),
  });
}
