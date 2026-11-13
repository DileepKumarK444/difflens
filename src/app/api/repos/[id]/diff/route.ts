import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse, notFound } from "@/lib/api-helpers";
import { getRepo } from "@/lib/git/repos-db";
import { getDiff } from "@/lib/git/repo";
import { parseScopeParam } from "@/lib/git/scopes";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { GitError } from "@/lib/git/validate";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const repo = getRepo(getDb(), id);
  if (!repo) return notFound("Repository");
  try {
    let scope;
    try {
      scope = parseScopeParam(new URL(req.url).searchParams.get("scope"));
    } catch (e) {
      throw new GitError((e as Error).message);
    }
    const d = await getDiff(repo.path, scope);
    const files = parseUnifiedDiff(d.patch).map((f) => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      binary: f.binary,
      additions: f.additions,
      deletions: f.deletions,
    }));
    return NextResponse.json({
      label: d.label,
      base: d.base ?? null,
      files,
      skipped: d.skipped,
      totals: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
