import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { openDb, type Db } from "@/lib/db";
import { setSetting } from "@/lib/db/settings";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { DENY_TOOLS, claudeArgs, claudeEnv, createClaudeCodeProvider } from "@/lib/ai/providers/claude-code";
import { createOllamaProvider } from "@/lib/ai/providers/ollama";
import { createProvider } from "@/lib/ai/providers";
import { ProviderError } from "@/lib/ai/providers/types";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "difflens-prov-"));
  process.env.DIFFLENS_DATA_DIR = path.join(dir, "data");
});
afterEach(() => {
  delete process.env.DIFFLENS_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A stand-in for the claude CLI that records exactly how it was invoked. */
function fakeClaude(reply: string, exit = 0) {
  const rec = path.join(dir, "rec");
  fs.mkdirSync(rec, { recursive: true });
  const bin = path.join(dir, "claude");
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.0 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then echo '{"loggedIn": true}'; exit 0; fi
printf '%s\\n' "$@" > "${rec}/argv"
env > "${rec}/env"
pwd > "${rec}/cwd"
cat > "${rec}/stdin"
printf '%s' '${reply.replace(/'/g, "'\\''")}'
exit ${exit}
`,
    { mode: 0o755 },
  );
  const read = (f: string) => fs.readFileSync(path.join(rec, f), "utf8");
  return { bin, read };
}

describe("Claude Code provider", () => {
  it("uses read-only tools, the right flags, stdin for the prompt, and the repo as cwd", async () => {
    const f = fakeClaude(JSON.stringify({ type: "result", is_error: false, result: '{"findings":[]}' }));
    const repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    const p = createClaudeCodeProvider({ bin: f.bin });
    const out = await p.complete({ prompt: "SECRET DIFF CONTENT", cwd: repo, timeoutMs: 20_000 });
    expect(out).toBe('{"findings":[]}');
    const argv = f.read("argv").trim().split("\n");
    expect(argv).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--permission-mode", "dontAsk", "--no-session-persistence"]));
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(argv[argv.indexOf("--disallowedTools") + 1]).toContain("Read(**/.env)");
    for (const bad of ["Bash", "Edit", "Write", "WebFetch", "--bare", "--dangerously-skip-permissions"]) expect(argv.join(" ")).not.toContain(bad);
    expect(argv.join(" ")).not.toContain("SECRET DIFF CONTENT"); // prompt is stdin only
    expect(f.read("stdin")).toBe("SECRET DIFF CONTENT");
    expect(fs.realpathSync(f.read("cwd").trim())).toBe(fs.realpathSync(repo));
  });

  it("passes --model only when one is chosen", () => {
    expect(claudeArgs(null)).not.toContain("--model");
    const a = claudeArgs("opus");
    expect(a[a.indexOf("--model") + 1]).toBe("opus");
    expect(DENY_TOOLS.length).toBeGreaterThan(5);
  });

  it("strips inherited Anthropic/Claude variables so your own login is used", async () => {
    const f = fakeClaude(JSON.stringify({ is_error: false, result: "{}" }));
    process.env.ANTHROPIC_AUTH_TOKEN = "parent-session-token";
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    process.env.CLAUDE_CODE_SESSION_ID = "abc";
    process.env.GH_TOKEN = "ghp_should_not_leak_either";
    try {
      await createClaudeCodeProvider({ bin: f.bin }).complete({ prompt: "x", timeoutMs: 20_000 });
    } finally {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_SESSION_ID;
      delete process.env.GH_TOKEN;
    }
    const env = f.read("env");
    for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_SESSION_ID", "GH_TOKEN", "should-not-leak"]) expect(env).not.toContain(k);
    expect(env).toContain("HOME=");
    expect(env).toContain("PATH=");
    expect(claudeEnv({ PATH: "/x", HOME: "/h", ANTHROPIC_MODEL: "m", CLAUDECODE: "1", HTTPS_PROXY: "http://p" })).toEqual({ PATH: "/x", HOME: "/h", HTTPS_PROXY: "http://p" });
  });

  it("runs with no repo in an empty temp folder that is removed afterwards", async () => {
    const f = fakeClaude(JSON.stringify({ is_error: false, result: "{}" }));
    await createClaudeCodeProvider({ bin: f.bin }).complete({ prompt: "x", timeoutMs: 20_000 });
    const cwd = f.read("cwd").trim();
    expect(path.basename(cwd)).toMatch(/^claude-/);
    expect(fs.realpathSync(path.dirname(cwd))).toBe(fs.realpathSync(path.join(dir, "data", "tmp"))); // inside the app data directory
    expect(fs.existsSync(cwd)).toBe(false);
  });

  it("maps CLI errors to safe messages", async () => {
    const cases: [string, RegExp][] = [
      ["Not logged in · Please run /login", /isn’t logged in/],
      ["API Error: 429 rate limit", /usage or rate limit/],
      ["API Error: Connection refused (ECONNREFUSED)", /couldn’t reach Anthropic/],
      ["boom with sk-ant-api03-SECRET", /returned an error/],
    ];
    for (const [msg, re] of cases) {
      const f = fakeClaude(JSON.stringify({ is_error: true, result: msg }));
      const err = await createClaudeCodeProvider({ bin: f.bin }).complete({ prompt: "x", timeoutMs: 20_000 }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).toMatch(re);
      expect(err.message).not.toContain("SECRET");
    }
    const junk = fakeClaude("not json at all");
    await expect(createClaudeCodeProvider({ bin: junk.bin }).complete({ prompt: "x", timeoutMs: 20_000 })).rejects.toThrow(ProviderError);
    await expect(createClaudeCodeProvider({ bin: path.join(dir, "missing") }).complete({ prompt: "x", timeoutMs: 5000 })).rejects.toThrow(ProviderError);
  });

  it("reports status from --version and auth status", async () => {
    const f = fakeClaude("");
    expect(await createClaudeCodeProvider({ bin: f.bin }).status()).toMatchObject({ ok: true });
    expect((await createClaudeCodeProvider({ bin: path.join(dir, "nope") }).status()).ok).toBe(false);
  });
});

describe("Ollama provider (against a local stub server)", () => {
  let server: http.Server;
  let url: string;
  let seen: { path: string; body: string }[];
  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body });
        res.setHeader("content-type", "application/json");
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3:latest" }] }));
        if (req.url === "/api/chat") {
          const m = JSON.parse(body).model;
          if (m === "missing") return (res.statusCode = 404), res.end("{}");
          return res.end(JSON.stringify({ message: { content: '{"findings":[]}' } }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("checks connection and model, and completes with JSON format requested", async () => {
    const ok = await createOllamaProvider({ url, model: "qwen2.5-coder", leavesMachine: false }).status();
    expect(ok).toMatchObject({ ok: true, models: ["qwen2.5-coder:7b", "llama3:latest"] });
    const miss = await createOllamaProvider({ url, model: "nope", leavesMachine: false }).status();
    expect(miss.ok).toBe(false);
    expect(miss.detail).toMatch(/ollama pull nope/);
    const text = await createOllamaProvider({ url, model: "llama3", leavesMachine: false }).complete({ prompt: "P", timeoutMs: 5000 });
    expect(text).toBe('{"findings":[]}');
    const chat = JSON.parse(seen.find((s) => s.path === "/api/chat")!.body);
    expect(chat).toMatchObject({ model: "llama3", stream: false, format: "json" });
    expect(chat.messages[0].content).toBe("P");
  });
  it("gives clear errors", async () => {
    await expect(createOllamaProvider({ url, model: "missing", leavesMachine: false }).complete({ prompt: "P", timeoutMs: 5000 })).rejects.toThrow(/ollama pull missing/);
    await expect(createOllamaProvider({ url, model: "", leavesMachine: false }).complete({ prompt: "P", timeoutMs: 5000 })).rejects.toThrow(/Choose an Ollama model/);
    await expect(createOllamaProvider({ url: "http://127.0.0.1:1", model: "m", leavesMachine: false }).complete({ prompt: "P", timeoutMs: 2000 })).rejects.toThrow(/Couldn’t reach Ollama/);
    for (const bad of ["file:///etc/passwd", "ftp://x", "not a url", "http://user:pw@127.0.0.1:11434"]) {
      expect((await createOllamaProvider({ url: bad, model: "m", leavesMachine: false }).status()).ok, bad).toBe(false);
    }
  });
});

describe("Anthropic provider", () => {
  it("sends the key from the environment only, to api.anthropic.com only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"findings":[]}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createAnthropicProvider({ model: "claude-sonnet-5-5", env: { ANTHROPIC_API_KEY: "sk-ant-test-key" }, fetch: f });
    expect(await p.complete({ prompt: "P", timeoutMs: 5000 })).toBe('{"findings":[]}');
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-key");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "P" }] });
    expect(p.leavesMachine).toBe(true);
  });
  it("fails clearly without a key, never leaks it, and maps errors", async () => {
    const none = createAnthropicProvider({ model: "m", env: {}, fetch: (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch });
    await expect(none.complete({ prompt: "P", timeoutMs: 1000 })).rejects.toThrow(/ANTHROPIC_API_KEY isn’t set/);
    expect((await none.status()).ok).toBe(false);
    const mk = (status: number) => createAnthropicProvider({ model: "m", env: { ANTHROPIC_API_KEY: "sk-ant-LEAKME" }, fetch: (async () => new Response("sk-ant-LEAKME bad", { status })) as unknown as typeof fetch });
    for (const [s, re] of [[401, /rejected the API key/], [429, /rate limit/], [500, /returned an error \(500\)/]] as [number, RegExp][]) {
      const e = await mk(s).complete({ prompt: "P", timeoutMs: 1000 }).catch((x) => x);
      expect(e.message).toMatch(re);
      expect(e.message).not.toContain("LEAKME");
    }
  });
});

describe("provider selection", () => {
  it("only builds, and so only ever contacts, the selected provider", async () => {
    const o = openDb(path.join(dir, "t.sqlite"));
    const db: Db = o.db;
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be touched"));
    expect(createProvider(db).id).toBe("claude-code"); // the default
    setSetting(db, "provider", "ollama");
    setSetting(db, "ollamaUrl", "http://127.0.0.1:11434");
    const ol = createProvider(db);
    expect(ol).toMatchObject({ id: "ollama", leavesMachine: false });
    setSetting(db, "ollamaUrl", "http://gpu-box.example.com:11434");
    expect(createProvider(db).leavesMachine).toBe(true);
    setSetting(db, "provider", "anthropic");
    expect(createProvider(db)).toMatchObject({ id: "anthropic", model: "claude-sonnet-5-5" });
    expect(spy).not.toHaveBeenCalled();
    o.sqlite.close();
  });
});
