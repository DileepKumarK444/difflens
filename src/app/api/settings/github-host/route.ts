import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/db/settings";
import { HOST_RE } from "@/lib/gh/accounts";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ host: getSetting(getDb(), "githubHost") });
}

const Body = z.object({ host: z.string().trim().toLowerCase().max(253).refine((h) => h === "" || HOST_RE.test(h), "Enter a host like github.acme.com") });

/** Optional GitHub Enterprise host. Empty resets to github.com only. */
export async function PUT(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid host" }, { status: 400 });
  setSetting(getDb(), "githubHost", body.data.host || "github.com");
  return NextResponse.json({ host: getSetting(getDb(), "githubHost") });
}
