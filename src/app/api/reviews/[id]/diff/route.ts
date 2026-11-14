import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/api-helpers";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { getReview } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

/** The diff exactly as it was when the review ran, from the saved snapshot. No repository or GitHub access. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getReview(getDb(), id);
  if (!r) return notFound("Review");
  const files = parseUnifiedDiff(r.review.diffSnapshot ?? "").map((f) => ({
    path: f.path, oldPath: f.oldPath, status: f.status, binary: f.binary, additions: f.additions, deletions: f.deletions,
  }));
  return NextResponse.json({
    label: r.review.title,
    base: null,
    files,
    skipped: [],
    totals: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) },
    saved: { at: r.review.createdAt.getTime(), kind: r.review.kind, source: JSON.parse(r.review.source) },
  });
}
