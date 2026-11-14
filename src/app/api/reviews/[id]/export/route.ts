import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/api-helpers";
import { exportFileName, renderMarkdown } from "@/lib/export-md";
import type { FindingView } from "@/lib/findings";
import { getReview } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

/** GET /api/reviews/:id/export[?status=open|resolved|ignored]: the review as a Markdown file. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getReview(getDb(), id);
  if (!r) return notFound("Review");
  const status = new URL(req.url).searchParams.get("status");
  const list = r.findings.filter((f) => status === null || f.status === status) as unknown as FindingView[];
  const meta = r.review.meta ? (JSON.parse(r.review.meta) as { skipped?: { path: string; reason: string }[] }) : null;
  const md = renderMarkdown(
    {
      title: r.review.title, kind: r.review.kind, provider: r.review.provider, model: r.review.model, status: r.review.status,
      createdAt: r.review.createdAt.getTime(), partialReason: r.review.partialReason, skipped: meta?.skipped,
      prUrl: r.review.prOwnerRepo && r.review.prNumber ? `https://${r.review.prHost}/${r.review.prOwnerRepo}/pull/${r.review.prNumber}` : null,
    },
    list,
  );
  return new NextResponse(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(r.review.title, r.review.createdAt.getTime())}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
