import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createProvider } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** Checks the selected provider without sending any code. */
export async function GET() {
  const p = createProvider(getDb());
  return NextResponse.json({ provider: p.id, label: p.label, leavesMachine: p.leavesMachine, status: await p.status() });
}
