import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { addRepo, listRepos } from "@/lib/git/repos-db";
import { statusCounts, detectBase } from "@/lib/git/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = listRepos(getDb());
  const repos = await Promise.all(
    rows.map(async (r) => {
      try {
        const [status, base] = await Promise.all([statusCounts(r.path), detectBase(r.path)]);
        return { ...r, createdAt: r.createdAt.getTime(), ok: true as const, status, base: base.base };
      } catch {
        return { ...r, createdAt: r.createdAt.getTime(), ok: false as const, status: null, base: null };
      }
    }),
  );
  return NextResponse.json({ repos });
}

const Body = z.object({ path: z.string().min(1).max(4096) });

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter a folder path" }, { status: 400 });
  try {
    const repo = await addRepo(getDb(), body.data.path.trim());
    return NextResponse.json({ repo: { ...repo, createdAt: repo.createdAt.getTime() } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
