import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { StartBody, startReview } from "@/lib/reviews/service";
import { listReviewSummaries } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/reviews: start a review. If the provider sends code off this machine and the user's
 * policy asks first, this answers 409 with a summary and does nothing until called again with confirmSend: true.
 */
export async function POST(req: Request) {
  const body = StartBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid review request" }, { status: 400 });
  try {
    const r = await startReview(getDb(), body.data);
    if ("needsConfirmation" in r) return NextResponse.json(r, { status: 409 });
    return NextResponse.json(r, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET() {
  const rows = listReviewSummaries(getDb()).map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
  return NextResponse.json({ reviews: rows });
}
