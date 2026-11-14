import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ProviderId, getSetting, setSetting } from "@/lib/db/settings";
import { KEY_ENV } from "@/lib/ai/providers/anthropic";

export const dynamic = "force-dynamic";

function read() {
  const db = getDb();
  return {
    provider: getSetting(db, "provider"),
    ollamaUrl: getSetting(db, "ollamaUrl"),
    ollamaModel: getSetting(db, "ollamaModel"),
    claudeModel: getSetting(db, "claudeModel"),
    anthropicModel: getSetting(db, "anthropicModel"),
    minSeverity: getSetting(db, "minSeverity"),
    customInstructions: getSetting(db, "customInstructions"),
    confirmSend: getSetting(db, "confirmSend"),
    maxChunks: getSetting(db, "maxChunks"),
    // Only whether the key exists, never its value.
    anthropicKeyPresent: Boolean(process.env[KEY_ENV]?.trim()),
  };
}

export function GET() {
  return NextResponse.json(read());
}

const Body = z.object({
  provider: ProviderId,
  ollamaUrl: z.string().trim().url().max(300).refine((u) => /^https?:\/\//.test(u) && !new URL(u).username, "Use an http:// or https:// URL without a login"),
  ollamaModel: z.string().trim().max(100),
  claudeModel: z.string().trim().max(100).regex(/^[A-Za-z0-9._:/-]*$/, "Model names use letters, numbers and . _ : / -"),
  anthropicModel: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/, "Model names use letters, numbers and . _ : / -"),
  minSeverity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  customInstructions: z.string().max(4000),
  confirmSend: z.enum(["always", "session", "never"]),
});

export async function PUT(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  const db = getDb();
  for (const [k, v] of Object.entries(body.data)) setSetting(db, k as keyof typeof body.data, v as never);
  return NextResponse.json(read());
}
