import { count } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reviews } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export function GET() {
  const n = getDb().select({ n: count() }).from(reviews).get()?.n ?? 0;
  return NextResponse.json({ ok: true, reviews: n });
}
