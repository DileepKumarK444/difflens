import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/db/settings";
import { redact, run as realRun, type RunOptions, type RunResult } from "@/lib/exec";
import { createKeychain, type Keychain } from "@/lib/keychain";

export type Runner = (file: string, args: string[], opts?: RunOptions) => Promise<RunResult>;
export interface Deps {
  run: Runner;
  keychain: Keychain;
}
export const defaultDeps = (): Deps => ({ run: realRun, keychain: createKeychain() });

export const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/;
/** Classic (ghp_, gho_, ghu_) and fine-grained (github_pat_) tokens: prefix plus [A-Za-z0-9_]. */
export const TOKEN_RE = /^(ghp_|gho_|ghu_|github_pat_)[A-Za-z0-9_]{20,250}$/;

export const AddTokenAccount = z.object({
  host: z.string().trim().toLowerCase().regex(HOST_RE, "Enter a host like github.com"),
  token: z.string().trim().regex(TOKEN_RE, "That doesn't look like a GitHub token"),
  label: z.string().trim().max(60).optional(),
});

export interface AccountView {
  id: string;
  source: "gh" | "token";
  host: string;
  login: string;
  label: string;
  /** gh only: the account `gh` itself treats as active. */
  ghActive: boolean;
  isDefault: boolean;
}

export class AccountError extends Error {}

/** Environment for a gh child process authenticated as one account. The token never leaves it. */
export function ghEnv(host: string, token: string): Record<string, string> {
  const base: Record<string, string> = {
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
    GH_HOST: host,
  };
  if (host === "github.com") base.GH_TOKEN = token;
  else base.GH_ENTERPRISE_TOKEN = token;
  return base;
}

/** Accounts logged in through `gh auth login`. Tokens are not read here. */
export async function listGhAccounts(run: Runner): Promise<Omit<AccountView, "isDefault">[]> {
  const r = await run("gh", ["auth", "status", "--json", "hosts"], { timeoutMs: 10_000 });
  try {
    const parsed = z
      .object({
        hosts: z.record(
          z.string(),
          z.array(z.object({ login: z.string(), host: z.string().optional(), active: z.boolean().optional(), state: z.string().optional() })),
        ),
      })
      .parse(JSON.parse(r.stdout));
    const out: Omit<AccountView, "isDefault">[] = [];
    for (const [host, list] of Object.entries(parsed.hosts)) {
      for (const a of list) {
        if (a.state && a.state !== "success") continue;
        out.push({ id: `gh:${host}:${a.login}`, source: "gh", host, login: a.login, label: a.login, ghActive: a.active === true });
      }
    }
    return out;
  } catch {
    return []; // gh missing, logged out, or unexpected output
  }
}

export async function listAccounts(db: Db, deps: Deps = defaultDeps()): Promise<AccountView[]> {
  const def = getSetting(db, "defaultAccount");
  const gh = await listGhAccounts(deps.run);
  const tokens = db.select().from(accounts).all();
  const all: Omit<AccountView, "isDefault">[] = [
    ...gh,
    ...tokens.map((t) => ({
      id: `token:${t.id}`,
      source: "token" as const,
      host: t.host,
      login: t.login,
      label: t.label,
      ghActive: false,
    })),
  ];
  return all.map((a) => ({ ...a, isDefault: a.id === def }));
}

/** Resolve the token for an account id. Throws AccountError with a safe message. */
export async function resolveToken(db: Db, id: string, deps: Deps = defaultDeps()): Promise<{ host: string; token: string; login: string }> {
  if (id.startsWith("token:")) {
    const rowId = id.slice(6);
    const row = db.select().from(accounts).where(eq(accounts.id, rowId)).get();
    if (!row) throw new AccountError("That account no longer exists");
    const token = await deps.keychain.get(rowId);
    if (!token) throw new AccountError("The token for this account is missing from the Keychain. Remove and add it again");
    return { host: row.host, token, login: row.login };
  }
  const m = /^gh:([^:]+(?::\d+)?):(.+)$/.exec(id);
  if (!m || !HOST_RE.test(m[1]) || !LOGIN_RE.test(m[2])) throw new AccountError("Unknown account");
  const r = await deps.run("gh", ["auth", "token", "--hostname", m[1], "--user", m[2]], { timeoutMs: 10_000 });
  const token = r.stdout.trim();
  if (r.code !== 0 || !token) throw new AccountError(`gh has no login for ${m[2]} on ${m[1]}. Run gh auth login`);
  return { host: m[1], token, login: m[2] };
}

/** Verify a pasted token with GitHub, then store it in the Keychain and record the account. */
export async function addTokenAccount(db: Db, input: unknown, deps: Deps = defaultDeps()): Promise<AccountView> {
  const parsed = AddTokenAccount.safeParse(input);
  if (!parsed.success) throw new AccountError(parsed.error.issues[0]?.message ?? "Invalid input");
  const { host, token, label } = parsed.data;

  const r = await deps.run("gh", ["api", "user", "--jq", ".login"], { env: ghEnv(host, token), timeoutMs: 15_000 });
  const login = r.stdout.trim();
  if (r.code !== 0 || !LOGIN_RE.test(login)) {
    throw new AccountError(`GitHub did not accept this token for ${host}`);
  }

  const existing = db.select().from(accounts).all().find((a) => a.host === host && a.login === login);
  const rowId = existing?.id ?? crypto.randomUUID();
  try {
    await deps.keychain.set(rowId, token);
  } catch (e) {
    throw new AccountError(redact((e as Error).message, token));
  }
  if (existing) {
    db.update(accounts).set({ label: label || existing.label }).where(eq(accounts.id, rowId)).run();
  } else {
    db.insert(accounts).values({ id: rowId, host, login, label: label || login }).run();
  }
  return { id: `token:${rowId}`, source: "token", host, login, label: label || existing?.label || login, ghActive: false, isDefault: false };
}

export async function removeTokenAccount(db: Db, id: string, deps: Deps = defaultDeps()): Promise<void> {
  if (!id.startsWith("token:")) throw new AccountError("gh accounts are removed with gh auth logout");
  const rowId = id.slice(6);
  const row = db.select().from(accounts).where(eq(accounts.id, rowId)).get();
  if (!row) throw new AccountError("That account no longer exists");
  await deps.keychain.remove(rowId);
  db.delete(accounts).where(eq(accounts.id, rowId)).run();
  if (getSetting(db, "defaultAccount") === id) setSetting(db, "defaultAccount", "");
}

export async function setDefaultAccount(db: Db, id: string | null, deps: Deps = defaultDeps()): Promise<void> {
  if (id) {
    const known = (await listAccounts(db, deps)).some((a) => a.id === id);
    if (!known) throw new AccountError("Unknown account");
  }
  setSetting(db, "defaultAccount", id ?? "");
}
