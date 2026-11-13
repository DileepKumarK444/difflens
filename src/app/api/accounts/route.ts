import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { AccountError, addTokenAccount, listAccounts } from "@/lib/gh/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ accounts: await listAccounts(db), defaultAccount: getSetting(db, "defaultAccount") });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const account = await addTokenAccount(getDb(), body);
    return NextResponse.json({ account }, { status: 201 });
  } catch (e) {
    if (e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not add the account" }, { status: 500 });
  }
}
