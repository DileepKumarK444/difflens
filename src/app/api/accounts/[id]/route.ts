import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { AccountError, removeTokenAccount } from "@/lib/gh/accounts";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await removeTokenAccount(getDb(), decodeURIComponent(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not remove the account" }, { status: 500 });
  }
}
