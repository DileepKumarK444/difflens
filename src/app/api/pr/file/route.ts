import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { getPrFileSides } from "@/lib/gh/prs";
import { GitError } from "@/lib/git/validate";
import { parsePrParam } from "@/lib/pr-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const ref = parsePrParam(q.get("pr"));
    const file = q.get("path");
    if (!file) throw new GitError("Missing file path");
    return NextResponse.json(await getPrFileSides(getDb(), ref, file, q.get("oldPath")));
  } catch (e) {
    return errorResponse(e);
  }
}
