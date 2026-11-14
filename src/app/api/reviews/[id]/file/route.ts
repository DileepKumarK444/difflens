import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/api-helpers";
import { parseUnifiedDiff, reconstructFromHunks } from "@/lib/git/diff-parse";
import { getReview } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

/** The visible parts of a file from the saved diff, placed at their real line numbers. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getReview(getDb(), id);
  if (!r) return notFound("Review");
  const path = new URL(req.url).searchParams.get("path");
  const file = parseUnifiedDiff(r.review.diffSnapshot ?? "").find((f) => f.path === path);
  if (!file) return notFound("File");
  if (file.binary) return NextResponse.json({ original: null, modified: null, binary: true, tooLarge: false });
  const { original, modified } = reconstructFromHunks(file);
  return NextResponse.json({ original: file.status === "added" ? null : original, modified: file.status === "deleted" ? null : modified, binary: false, tooLarge: false });
}
