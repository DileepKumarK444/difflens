import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GhNotAllowed, assertGhAllowed } from "@/lib/gh/allow";
import { cspHeader } from "@/lib/security";

const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);

describe("gh allowlist: only the commands DiffLens needs", () => {
  const ok: string[][] = [
    ["pr", "list", "-R", "github.com/a/b", "--state", "open", "--limit", "100", "--json", "number,title", "--search", "review-requested:@me"],
    ["pr", "list", "-R", "github.com/a/b", "--author", "@me"],
    ["pr", "view", "12", "-R", "github.com/a/b", "--json", "number"],
    ["pr", "diff", "12", "-R", "github.com/a/b", "--color", "never"],
    ["auth", "token", "--hostname", "github.com", "--user", "me"],
    ["auth", "status", "--json", "hosts"],
    ["api", "user", "--jq", ".login"],
    ["api", "--hostname", "github.com", `repos/a/b/compare/${SHA1}...${SHA2}`, "--jq", ".merge_base_commit.sha"],
    ["api", "--hostname", "github.com", "-H", "Accept: application/vnd.github.raw+json", `repos/a/b/contents/dir/my%20file.ts?ref=${SHA1}`],
    ["api", "--hostname", "github.com", "-X", "POST", "-H", "Accept: application/vnd.github+json", "repos/a/b/pulls/7/reviews", "--input", "-"],
  ];
  it.each(ok)("allows %j", (...args) => {
    expect(() => assertGhAllowed(args)).not.toThrow();
  });

  const bad: [string, string[]][] = [
    ["merging a PR", ["pr", "merge", "12"]],
    ["commenting with the CLI", ["pr", "comment", "12", "--body", "x"]],
    ["closing a PR", ["pr", "close", "12"]],
    ["approving", ["pr", "review", "12", "--approve"]],
    ["opening a browser", ["pr", "view", "12", "--web"]],
    ["creating a repo", ["repo", "create", "x"]],
    ["deleting a repo", ["repo", "delete", "a/b"]],
    ["logging in", ["auth", "login"]],
    ["logging out", ["auth", "logout"]],
    ["refreshing credentials", ["auth", "refresh"]],
    ["running an arbitrary alias", ["alias", "set", "x", "y"]],
    ["nothing", []],
    ["a DELETE", ["api", "-X", "DELETE", `repos/a/b/pulls/7/reviews`, "--input", "-"]],
    ["a POST to another endpoint", ["api", "-X", "POST", "repos/a/b/issues", "--input", "-"]],
    ["a PATCH of a PR", ["api", "--method", "PATCH", "repos/a/b/pulls/7"]],
    ["fields on a read", ["api", "-f", "body=hi", "user"]],
    ["a raw field", ["api", "-F", "x=1", "user"]],
    ["an unknown endpoint", ["api", "repos/a/b/git/refs"]],
    ["a graphql call", ["api", "graphql", "-f", "query={viewer{login}}"]],
    ["two endpoints", ["api", "user", "repos/a/b/compare/" + SHA1 + "..." + SHA2]],
    ["an unpinned contents ref", ["api", "repos/a/b/contents/x?ref=main"]],
    ["a review POST without --input -", ["api", "-X", "POST", "repos/a/b/pulls/7/reviews"]],
    ["a review POST reading a file", ["api", "-X", "POST", "repos/a/b/pulls/7/reviews", "--input", "/etc/passwd"]],
    ["a review fetched with GET and input", ["api", "repos/a/b/pulls/7/reviews", "--input", "-"]],
    ["an odd header", ["api", "-H", "Authorization: token x", "user"]],
    ["input on a read endpoint", ["api", "user", "--input", "-"]],
    ["a stray flag on pr list", ["pr", "list", "--web"]],
  ];
  it.each(bad)("blocks %s", (_what, args) => {
    expect(() => assertGhAllowed(args)).toThrow(GhNotAllowed);
  });
});

describe("Content-Security-Policy", () => {
  it("keeps everything on this origin and blocks framing", () => {
    const p = cspHeader(false);
    expect(p).toContain("default-src 'self'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("form-action 'self'");
    expect(p).not.toMatch(/https?:\/\//);
  });
  it("only allows eval and websockets in development", () => {
    expect(cspHeader(false)).not.toContain("unsafe-eval");
    expect(cspHeader(false)).not.toContain("ws:");
    expect(cspHeader(true)).toContain("'unsafe-eval'");
    expect(cspHeader(true)).toContain("ws://127.0.0.1:*");
  });
});

/** Static checks over the source tree, so a future change can't quietly break a core rule. */
const ROOT = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC = walk(path.join(ROOT, "src"));
const rel = (f: string) => path.relative(ROOT, f);
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("source rules", () => {
  it("only src/lib/exec.ts starts processes", () => {
    const users = SRC.filter((f) => /from "node:child_process"|require\("child_process"\)/.test(read(f))).map(rel);
    expect(users).toEqual(["src/lib/exec.ts"]);
  });
  it("never uses a shell", () => {
    for (const f of SRC) {
      const t = read(f);
      expect(/shell:\s*true/.test(t), rel(f)).toBe(false);
      expect(/\bexecSync\b|\bspawnSync\b/.test(t), rel(f)).toBe(false);
      expect(/child_process\.exec\(|[^.\w]exec\(`/.test(t), rel(f)).toBe(false);
    }
  });
  it("never logs (so no source code, tokens or keys can reach a log)", () => {
    const hits = SRC.filter((f) => /\bconsole\.(log|info|warn|error|debug|trace)\b/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
  it("never renders raw HTML or evaluates strings", () => {
    for (const f of SRC) {
      const t = read(f);
      expect(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(|document\.write\(/.test(t), rel(f)).toBe(false);
    }
  });
  it("only a few modules write to disk, and only inside the data directory or a validated repo path", () => {
    const writers = SRC.filter((f) => /\b(writeFile|writeFileSync|appendFile|mkdirSync|mkdtempSync|rmSync|unlinkSync|cpSync|renameSync)\b/.test(read(f))).map(rel).sort();
    expect(writers).toEqual(["src/lib/ai/providers/claude-code.ts", "src/lib/keychain.ts", "src/lib/paths.ts"]);
  });
  it("the Claude Code temp folder lives under the app data directory", () => {
    const t = read(path.join(ROOT, "src/lib/ai/providers/claude-code.ts"));
    expect(t).toContain('path.join(dataDir(), "tmp")');
    expect(t).not.toContain("os.tmpdir()");
  });
  it("the app binds to loopback only", () => {
    const scripts = JSON.parse(read(path.join(ROOT, "package.json"))).scripts as Record<string, string>;
    expect(scripts.dev).toContain("-H 127.0.0.1");
    expect(scripts.start).toContain("-H 127.0.0.1");
    expect(/0\.0\.0\.0|-H\s+::/.test(JSON.stringify(scripts))).toBe(false);
  });
  it("TypeScript runs in strict mode", () => {
    expect(JSON.parse(read(path.join(ROOT, "tsconfig.json"))).compilerOptions.strict).toBe(true);
  });
  it("the request guard covers every API route", () => {
    const proxy = read(path.join(ROOT, "src/proxy.ts"));
    const matcher = /matcher:\s*\["([^"]+)"\]/.exec(proxy)?.[1] ?? "";
    expect(matcher).toBeTruthy();
    expect(matcher).not.toMatch(/api/); // /api is not excluded from the guard
    const routes = SRC.filter((f) => /src\/app\/api\/.*route\.ts$/.test(f.replace(/\\/g, "/")));
    expect(routes.length).toBeGreaterThan(15);
    // Every mutating handler lives under /api, where the guard demands a same-origin request and a CSRF token.
    for (const f of routes) {
      if (/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(read(f))) expect(rel(f).replace(/\\/g, "/")).toMatch(/^src\/app\/api\//);
    }
  });
  it("no route can post to GitHub without a confirmation object", () => {
    const post = read(path.join(ROOT, "src/app/api/reviews/[id]/post/route.ts"));
    expect(post).toContain("confirm === undefined");
    expect(post).toMatch(/executePost\(getDb\(\), id, input, c\.data\)/);
  });
  it("GitHub review posting is always event COMMENT", () => {
    const t = read(path.join(ROOT, "src/lib/gh/post.ts"));
    expect(t.match(/event: "[A-Z_]+"/g)).toEqual(['event: "COMMENT"', 'event: "COMMENT"']);
    expect(/APPROVE|REQUEST_CHANGES/.test(read(path.join(ROOT, "src/lib/gh/post-review.ts")) + t)).toBe(false);
  });
});
