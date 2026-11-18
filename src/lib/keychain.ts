import fs from "node:fs";
import path from "node:path";
import { run } from "@/lib/exec";
import { dataDir } from "@/lib/paths";

export const KEYCHAIN_SERVICE = "DiffLens GitHub token";
const ACCOUNT_RE = /^[a-z0-9-]{8,64}$/i;

export interface KeychainRunner {
  (file: string, args: string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string; code: number }>;
}

/**
 * macOS Keychain via the `security` CLI. The secret is sent on stdin to `security -i`,
 * never as a command-line argument, so it cannot show up in `ps`.
 * Callers must pass tokens that already passed isValidToken (charset [A-Za-z0-9_]).
 */
export function createKeychain(runner?: KeychainRunner) {
  // Linux/WSL/Windows have no `security` tool: fall back to an owner-only file.
  if (!runner && process.platform !== "darwin") return createFileKeychain();
  return createMacKeychain(runner ?? run);
}

/**
 * Fallback for systems without the macOS Keychain. Tokens live in tokens.json inside the
 * app data dir, created with owner-only permissions (0600), and never in the SQLite DB.
 */
export function createFileKeychain(dir: () => string = dataDir) {
  const file = () => path.join(dir(), "tokens.json");
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file(), "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string>) => {
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file());
  };
  const check = (account: string) => {
    if (!ACCOUNT_RE.test(account)) throw new Error("Invalid keychain account id");
  };
  return {
    async set(account: string, secret: string): Promise<void> {
      check(account);
      if (!/^[A-Za-z0-9_]{20,255}$/.test(secret)) throw new Error("Token has an unexpected format");
      try {
        write({ ...read(), [account]: secret });
      } catch {
        throw new Error("Could not save the token to the local token file");
      }
    },
    async get(account: string): Promise<string | null> {
      check(account);
      return read()[account] ?? null;
    },
    async remove(account: string): Promise<void> {
      check(account);
      const data = read();
      delete data[account];
      write(data);
    },
  };
}

function createMacKeychain(runner: KeychainRunner) {
  const check = (account: string) => {
    if (!ACCOUNT_RE.test(account)) throw new Error("Invalid keychain account id");
  };
  return {
    async set(account: string, secret: string): Promise<void> {
      check(account);
      if (!/^[A-Za-z0-9_]{20,255}$/.test(secret)) throw new Error("Token has an unexpected format");
      const cmd = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${secret}"\n`;
      const r = await runner("/usr/bin/security", ["-i"], { input: cmd });
      // security -i reports errors on stdout/stderr text rather than via exit code.
      if (r.code !== 0 || /\b(error|SecKeychain\w*:|User interaction)/i.test(r.stderr + r.stdout.replace(/security>/g, ""))) {
        throw new Error("Could not save the token to the Keychain");
      }
    },
    async get(account: string): Promise<string | null> {
      check(account);
      const r = await runner("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]);
      return r.code === 0 ? r.stdout.trim() || null : null;
    },
    async remove(account: string): Promise<void> {
      check(account);
      await runner("/usr/bin/security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]);
    },
  };
}

export type Keychain = ReturnType<typeof createKeychain>;
