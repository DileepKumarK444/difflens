import type { Db } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { redact, type RunResult } from "@/lib/exec";
import { defaultDeps, ghEnv, resolveToken, type Deps } from "./accounts";

/**
 * Run `gh` as a chosen account (or the default, or plain gh if none is set).
 * Used by the PR features in Phase 3. The token goes only into the child's environment;
 * output is redacted before it is returned.
 */
export async function runGh(db: Db, args: string[], opts: { accountId?: string | null; timeoutMs?: number; input?: string } = {}, deps: Deps = defaultDeps()): Promise<RunResult> {
  const id = opts.accountId ?? getSetting(db, "defaultAccount");
  if (!id) return deps.run("gh", args, { env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" }, timeoutMs: opts.timeoutMs, input: opts.input });
  const { host, token } = await resolveToken(db, id, deps);
  const r = await deps.run("gh", args, { env: ghEnv(host, token), timeoutMs: opts.timeoutMs, input: opts.input });
  return { ...r, stdout: redact(r.stdout, token), stderr: redact(r.stderr, token) };
}
