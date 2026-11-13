import { run } from "@/lib/exec";

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
export function createKeychain(runner: KeychainRunner = run) {
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
