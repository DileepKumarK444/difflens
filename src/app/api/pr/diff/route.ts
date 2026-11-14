import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { getPrDiff } from "@/lib/gh/prs";
import { parsePrParam } from "@/lib/pr-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ref = parsePrParam(new URL(req.url).searchParams.get("pr"));
    const { meta, patch } = await getPrDiff(getDb(), ref);
    const files = parseUnifiedDiff(patch).map((f) => ({
      path: f.path, oldPath: f.oldPath, status: f.status, binary: f.binary, additions: f.additions, deletions: f.deletions,
    }));
    return NextResponse.json({
      label: `${ref.owner}/${ref.repo} #${meta.number}`,
      title: meta.title,
      author: meta.author,
      isDraft: meta.isDraft,
      state: meta.state,
      reviewDecision: meta.reviewDecision,
      url: meta.url,
      branches: { head: meta.headRefName, base: meta.baseRefName },
      base: meta.baseRefName,
      files,
      skipped: [],
      totals: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
