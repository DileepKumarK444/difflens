import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, notFound } from "@/lib/api-helpers";
import { getRepo } from "@/lib/git/repos-db";
import { repoInfo } from "@/lib/git/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const repo = getRepo(getDb(), id);
  if (!repo) return notFound("Repository");
  try {
    return NextResponse.json({ repo: { id: repo.id, name: repo.name, path: repo.path }, info: await repoInfo(repo.path) });
  } catch (e) {
    return errorResponse(e);
  }
}
