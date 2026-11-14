import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { notFound } from "@/lib/api-helpers";
import { TriagePatch, updateFinding } from "@/lib/reviews/store";

/** PATCH /api/findings/:id  { status?, note? }. Triage and personal notes only; nothing else about a finding can change. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = TriagePatch.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  const row = updateFinding(getDb(), decodeURIComponent(id), body.data);
  if (!row) return notFound("Finding");
  return NextResponse.json({ finding: { ...row, createdAt: row.createdAt.getTime() } });
}
