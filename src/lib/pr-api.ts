import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { ParseError, PrRefSchema, allowedHosts, type PrRefInput } from "@/lib/gh/parse";

export function configuredHosts(): Set<string> {
  return allowedHosts(getSetting(getDb(), "githubHost"));
}

/** Read and validate the `pr` JSON query parameter used by the PR diff and file routes. */
export function parsePrParam(raw: string | null): PrRefInput {
  if (!raw) throw new ParseError("Missing pull request");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ParseError("Invalid pull request");
  }
  const r = PrRefSchema.safeParse(json);
  if (!r.success) throw new ParseError("Invalid pull request");
  if (!configuredHosts().has(r.data.host)) throw new ParseError(`${r.data.host} isn’t an allowed GitHub host`);
  return r.data;
}
