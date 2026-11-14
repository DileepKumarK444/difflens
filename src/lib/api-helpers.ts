import { NextResponse } from "next/server";
import { GitError } from "@/lib/git/validate";
import { GhError } from "@/lib/gh/prs";
import { ParseError } from "@/lib/gh/parse";
import { AccountError } from "@/lib/gh/accounts";

/** Map known, user-safe errors to 4xx; anything else becomes a generic 500 (never leaks details). */
export function errorResponse(e: unknown) {
  if (e instanceof GitError || e instanceof ParseError || e instanceof AccountError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof GhError) return NextResponse.json({ error: e.message }, { status: 502 });
  if (e instanceof Error && e.name === "ApiError") return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export class ApiError extends Error {
  name = "ApiError";
}

export const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });
