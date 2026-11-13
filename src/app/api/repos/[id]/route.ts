import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { removeRepo } from "@/lib/git/repos-db";
import { notFound } from "@/lib/api-helpers";

/** Removing a repo only forgets it inside DiffLens. Nothing on disk is touched. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return removeRepo(getDb(), id) ? NextResponse.json({ ok: true }) : notFound("Repository");
}
