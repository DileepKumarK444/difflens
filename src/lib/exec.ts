import { execFile, spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOptions {
  env?: Record<string, string>;
  /** When set, the child gets exactly this environment and nothing from process.env. */
  replaceEnv?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  input?: string;
}

/**
 * The only way this app starts a program: execFile/spawn with an argument array, no shell.
 * Never logs arguments, environment or output. Resolves (does not reject) on non-zero exit.
 */
export function run(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = (opts.replaceEnv ? { ...opts.replaceEnv } : { ...process.env, ...opts.env }) as NodeJS.ProcessEnv;
    if (opts.input !== undefined) {
      const child = spawn(file, args, { env, cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 20_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: e.message, code: 127 });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(opts.input);
      return;
    }
    execFile(
      file,
      args,
      { env, cwd: opts.cwd, timeout: opts.timeoutMs ?? 20_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      },
    );
  });
}

/** Remove a secret from any text before it is returned, thrown or logged. */
export function redact(text: string, ...secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out.replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, "[redacted]");
}
