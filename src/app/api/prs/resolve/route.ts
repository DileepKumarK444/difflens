import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-helpers";
import { parsePrUrl } from "@/lib/gh/parse";
import { configuredHosts } from "@/lib/pr-api";

export const dynamic = "force-dynamic";

/** Turn a pasted PR link into a validated reference. Never contacts GitHub. */
export function GET(req: Request) {
  try {
    const ref = parsePrUrl(new URL(req.url).searchParams.get("url") ?? "", configuredHosts());
    return NextResponse.json({ ref });
  } catch (e) {
    return errorResponse(e);
  }
}
