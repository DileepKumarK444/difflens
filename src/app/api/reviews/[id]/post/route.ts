import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { executePost, previewPost } from "@/lib/gh/post-review";

export const dynamic = "force-dynamic";

const Confirm = z.object({ repo: z.string().min(3).max(200), number: z.number().int().min(1).max(9_999_999) });

/**
 * POST /api/reviews/:id/post
 * Without `confirm`: returns a preview and posts NOTHING.
 * With `confirm: { repo, number }` matching the pull request: posts one review (event COMMENT) to GitHub.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { confirm, ...input } = body;
  try {
    if (confirm === undefined) return NextResponse.json({ preview: await previewPost(getDb(), id, input) });
    const c = Confirm.safeParse(confirm);
    if (!c.success) return NextResponse.json({ error: "Invalid confirmation" }, { status: 400 });
    return NextResponse.json({ result: await executePost(getDb(), id, input, c.data) });
  } catch (e) {
    return errorResponse(e);
  }
}
