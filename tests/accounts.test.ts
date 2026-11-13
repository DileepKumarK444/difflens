import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getSetting } from "@/lib/db/settings";
import {
  AddTokenAccount,
  TOKEN_RE,
  addTokenAccount,
  ghEnv,
  listAccounts,
  removeTokenAccount,
  resolveToken,
  setDefaultAccount,
  type Deps,
} from "@/lib/gh/accounts";
import { runGh } from "@/lib/gh/run";
import { createKeychain, KEYCHAIN_SERVICE } from "@/lib/keychain";
import { redact, run } from "@/lib/exec";

const TOKEN = "github_pat_" + "A1b2C3d4E5".repeat(4);
const OTHER = "ghp_" + "Z9y8X7w6V5".repeat(3);

let dir: string;
let db: Db;
let close: () => void;
let calls: { file: string; args: string[]; env?: Record<string, string> }[];
let store: Map<string, string>;

function fakeDeps(opts: { loginFor?: Record<string, string>; ghStatus?: object } = {}): Deps {
  const loginFor = opts.loginFor ?? { [TOKEN]: "work-me" };
  return {
    run: async (file, args, o) => {
      calls.push({ file, args, env: o?.env });
      if (args[0] === "auth" && args[1] === "status") {
        return { stdout: JSON.stringify(opts.ghStatus ?? { hosts: { "github.com": [{ login: "me", active: true, state: "success", host: "github.com" }] } }), stderr: "", code: 0 };
      }
      if (args[0] === "auth" && args[1] === "token") return { stdout: "gho_" + "Q".repeat(30) + "\n", stderr: "", code: 0 };
      if (args[0] === "api" && args[1] === "user") {
        const t = o?.env?.GH_TOKEN ?? o?.env?.GH_ENTERPRISE_TOKEN ?? "";
        const login = loginFor[t];
        return login ? { stdout: login + "\n", stderr: "", code: 0 } : { stdout: "", stderr: `bad credentials ${t}`, code: 1 };
      }
      return { stdout: `echo ${o?.env?.GH_TOKEN ?? ""}`, stderr: "", code: 0 };
    },
    keychain: {
      set: async (a, s) => void store.set(a, s),
      get: async (a) => store.get(a) ?? null,
      remove: async (a) => void store.delete(a),
    },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-acc-"));
  const o = openDb(path.join(dir, "t.sqlite"));
  db = o.db;
  close = () => o.sqlite.close();
  calls = [];
  store = new Map();
});
afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("token validation", () => {
  it("accepts GitHub token formats and rejects junk and injection attempts", () => {
    expect(TOKEN_RE.test(TOKEN)).toBe(true);
    expect(TOKEN_RE.test(OTHER)).toBe(true);
    for (const bad of ["", "ghp_short", 'ghp_' + "a".repeat(30) + '"; rm -rf /', "x".repeat(40), TOKEN + "\n-w x", "ghp_" + "a b".repeat(10)]) {
      expect(TOKEN_RE.test(bad)).toBe(false);
    }
  });
  it("validates host", () => {
    expect(AddTokenAccount.safeParse({ host: "GitHub.com", token: TOKEN }).data?.host).toBe("github.com");
    expect(AddTokenAccount.safeParse({ host: "evil.com/x", token: TOKEN }).success).toBe(false);
    expect(AddTokenAccount.safeParse({ host: "a b", token: TOKEN }).success).toBe(false);
  });
});

describe("adding and listing accounts", () => {
  it("verifies with GitHub, stores the token only in the keychain, never in the DB", async () => {
    const acc = await addTokenAccount(db, { host: "github.com", token: TOKEN, label: "Work" }, fakeDeps());
    expect(acc).toMatchObject({ source: "token", login: "work-me", label: "Work", host: "github.com" });
    const rowId = acc.id.slice(6);
    expect(store.get(rowId)).toBe(TOKEN);
    const raw = JSON.stringify(db.select().from(accounts).all());
    expect(raw).not.toContain(TOKEN);
    expect(JSON.stringify(acc)).not.toContain(TOKEN);
    const verify = calls.find((c) => c.args[0] === "api");
    expect(verify?.env?.GH_TOKEN).toBe(TOKEN); // token only in the child env, not argv
    expect(calls.every((c) => !c.args.join(" ").includes(TOKEN))).toBe(true);
  });

  it("rejects a token GitHub does not accept, without storing it, and does not echo it", async () => {
    await expect(addTokenAccount(db, { host: "github.com", token: OTHER }, fakeDeps())).rejects.toThrow(/did not accept/);
    expect(store.size).toBe(0);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    try {
      await addTokenAccount(db, { host: "github.com", token: OTHER }, fakeDeps());
    } catch (e) {
      expect((e as Error).message).not.toContain(OTHER);
    }
  });

  it("uses the enterprise token variable for non-github.com hosts", () => {
    expect(ghEnv("github.com", TOKEN)).toMatchObject({ GH_TOKEN: TOKEN });
    const ent = ghEnv("github.acme.com", TOKEN);
    expect(ent).toMatchObject({ GH_ENTERPRISE_TOKEN: TOKEN, GH_HOST: "github.acme.com" });
    expect(ent.GH_TOKEN).toBeUndefined();
  });

  it("re-adding the same login rotates the token instead of duplicating", async () => {
    const deps = fakeDeps({ loginFor: { [TOKEN]: "work-me", [OTHER]: "work-me" } });
    await addTokenAccount(db, { host: "github.com", token: TOKEN }, deps);
    await addTokenAccount(db, { host: "github.com", token: OTHER }, deps);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect([...store.values()]).toEqual([OTHER]);
  });

  it("lists gh accounts and token accounts together, with no secrets", async () => {
    const deps = fakeDeps();
    await addTokenAccount(db, { host: "github.com", token: TOKEN }, deps);
    const list = await listAccounts(db, deps);
    expect(list.map((a) => a.source).sort()).toEqual(["gh", "token"]);
    expect(list.find((a) => a.source === "gh")).toMatchObject({ login: "me", ghActive: true });
    expect(JSON.stringify(list)).not.toContain(TOKEN);
  });

  it("returns no gh accounts when gh output is unusable", async () => {
    const deps = fakeDeps();
    deps.run = async () => ({ stdout: "not json", stderr: "", code: 1 });
    expect(await listAccounts(db, deps)).toEqual([]);
  });
});

describe("default account, resolving, removing", () => {
  it("sets and clears the default, rejecting unknown ids", async () => {
    const deps = fakeDeps();
    await setDefaultAccount(db, "gh:github.com:me", deps);
    expect(getSetting(db, "defaultAccount")).toBe("gh:github.com:me");
    await expect(setDefaultAccount(db, "gh:github.com:nobody", deps)).rejects.toThrow(/Unknown/);
    await setDefaultAccount(db, null, deps);
    expect(getSetting(db, "defaultAccount")).toBe("");
  });

  it("resolves tokens for both account kinds and rejects malformed ids", async () => {
    const deps = fakeDeps();
    const acc = await addTokenAccount(db, { host: "github.com", token: TOKEN }, deps);
    expect((await resolveToken(db, acc.id, deps)).token).toBe(TOKEN);
    expect((await resolveToken(db, "gh:github.com:me", deps)).token.startsWith("gho_")).toBe(true);
    await expect(resolveToken(db, "gh:github.com:me; rm -rf /", deps)).rejects.toThrow(/Unknown account/);
    await expect(resolveToken(db, "gh:evil host:me", deps)).rejects.toThrow();
    await expect(resolveToken(db, "token:nope", deps)).rejects.toThrow(/no longer exists/);
  });

  it("removes a token account, its keychain item, and clears it as default", async () => {
    const deps = fakeDeps();
    const acc = await addTokenAccount(db, { host: "github.com", token: TOKEN }, deps);
    await setDefaultAccount(db, acc.id, deps);
    await removeTokenAccount(db, acc.id, deps);
    expect(store.size).toBe(0);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(getSetting(db, "defaultAccount")).toBe("");
    await expect(removeTokenAccount(db, "gh:github.com:me", deps)).rejects.toThrow(/gh auth logout/);
  });

  it("runGh passes the token via env only and redacts it from output", async () => {
    const deps = fakeDeps();
    const acc = await addTokenAccount(db, { host: "github.com", token: TOKEN }, deps);
    calls = [];
    const r = await runGh(db, ["pr", "list"], { accountId: acc.id }, deps);
    expect(calls[0].env?.GH_TOKEN).toBe(TOKEN);
    expect(calls[0].args.join(" ")).not.toContain(TOKEN);
    expect(r.stdout).not.toContain(TOKEN);
    expect(r.stdout).toContain("[redacted]");
  });
});

describe("redaction", () => {
  it("removes explicit secrets and token-shaped strings", () => {
    expect(redact(`oops ${TOKEN} and ${OTHER}`, TOKEN)).toBe("oops [redacted] and [redacted]");
  });
});

describe("keychain wrapper", () => {
  it("sends the secret on stdin, not in argv, and rejects unsafe values", async () => {
    const seen: { args: string[]; input?: string }[] = [];
    const kc = createKeychain(async (_f, args, o) => {
      seen.push({ args, input: o?.input });
      return { stdout: "", stderr: "", code: 0 };
    });
    await kc.set("abcd1234-ef", TOKEN);
    expect(seen[0].args).toEqual(["-i"]);
    expect(seen[0].args.join(" ")).not.toContain(TOKEN);
    expect(seen[0].input).toContain(TOKEN);
    expect(seen[0].input).toContain(KEYCHAIN_SERVICE);
    await expect(kc.set("bad id;", TOKEN)).rejects.toThrow();
    await expect(kc.set("abcd1234-ef", 'x"; evil')).rejects.toThrow();
  });
  it("reports a failed save", async () => {
    const kc = createKeychain(async () => ({ stdout: "", stderr: "security: SecKeychainItemCreate failed", code: 1 }));
    await expect(kc.set("abcd1234-ef", TOKEN)).rejects.toThrow(/Keychain/);
  });
});

describe.runIf(process.platform === "darwin")("real macOS Keychain round trip", () => {
  it("stores, reads and deletes a dummy secret", async () => {
    const kc = createKeychain();
    const id = "test-" + crypto.randomUUID().slice(0, 12);
    const dummy = "ghp_" + "T".repeat(30);
    try {
      await kc.set(id, dummy);
      expect(await kc.get(id)).toBe(dummy);
      // must not be visible as a process argument at any point: verified by design (stdin)
    } finally {
      await kc.remove(id);
    }
    expect(await kc.get(id)).toBeNull();
  });
});

describe("exec helper", () => {
  it("runs without a shell and resolves on failure", async () => {
    const ok = await run("/bin/echo", ["a; echo b"]);
    expect(ok.stdout.trim()).toBe("a; echo b");
    expect((await run("/usr/bin/false", [])).code).not.toBe(0);
    expect((await run("/definitely/missing", [])).code).not.toBe(0);
  });
});
