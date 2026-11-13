import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { AccountError, setDefaultAccount } from "@/lib/gh/accounts";

const Body = z.object({ id: z.string().max(200).nullable() });

export async function PUT(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    await setDefaultAccount(getDb(), parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not set the default account" }, { status: 500 });
  }
}
