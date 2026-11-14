import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createProvider } from "@/lib/ai/providers";
import { ProviderError } from "@/lib/ai/providers/types";
import { OutputError, parseReviewOutput } from "@/lib/ai/schema";

export const dynamic = "force-dynamic";

/** Sends one fixed, harmless message (no code) through the selected provider to prove it works. */
export async function POST() {
  const p = createProvider(getDb());
  const t0 = Date.now();
  try {
    const text = await p.complete({ prompt: 'This is a connection test. Reply with ONLY this JSON and nothing else: {"findings": []}', timeoutMs: 120_000 });
    try {
      parseReviewOutput(text);
      return NextResponse.json({ ok: true, ms: Date.now() - t0, message: `${p.label} replied correctly in ${Math.round((Date.now() - t0) / 100) / 10}s` });
    } catch (e) {
      const why = e instanceof OutputError ? e.message : "unreadable reply";
      return NextResponse.json({ ok: false, ms: Date.now() - t0, message: `${p.label} answered, but not in the expected format (${why}). Reviews may need the repair retry` });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, ms: Date.now() - t0, message: e instanceof ProviderError ? e.message : "The test failed" });
  }
}
