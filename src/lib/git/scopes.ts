import { z } from "zod";
import { SHA_RE, isValidRev } from "./validate";

const rev = z.string().min(1).max(200).refine(isValidRev, "Not a valid branch, tag or commit");

/** What to review. Every variant resolves to commit SHAs before reaching git. */
export const Scope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("staged") }),
  z.object({ type: z.literal("working") }),
  z.object({ type: z.literal("commit"), sha: z.string().regex(SHA_RE, "Not a commit id") }),
  z.object({ type: z.literal("range"), from: rev, to: rev }),
  z.object({ type: z.literal("branch"), base: rev.optional() }),
]);
export type Scope = z.infer<typeof Scope>;

export function parseScopeParam(raw: string | null): Scope {
  if (!raw) throw new Error("Missing scope");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Invalid scope");
  }
  const r = Scope.safeParse(json);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid scope");
  return r.data;
}
