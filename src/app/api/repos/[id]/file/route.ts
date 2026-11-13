import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, notFound } from "@/lib/api-helpers";
import { getRepo } from "@/lib/git/repos-db";
import { getFileSides } from "@/lib/git/repo";
import { parseScopeParam } from "@/lib/git/scopes";
import { GitError } from "@/lib/git/validate";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const repo = getRepo(getDb(), id);
  if (!repo) return notFound("Repository");
  const q = new URL(req.url).searchParams;
  try {
    let scope;
    try {
      scope = parseScopeParam(q.get("scope"));
    } catch (e) {
      throw new GitError((e as Error).message);
    }
    const file = q.get("path");
    if (!file) throw new GitError("Missing file path");
    return NextResponse.json(await getFileSides(repo.path, scope, file, q.get("oldPath")));
  } catch (e) {
    return errorResponse(e);
  }
}
