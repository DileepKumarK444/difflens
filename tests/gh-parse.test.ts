import { describe, expect, it } from "vitest";
import { allowedHosts, parsePrUrl, parseRemoteUrl, parseRepoInput, repoArg, PrRefSchema } from "@/lib/gh/parse";

const hosts = allowedHosts("github.acme.com");

describe("parsePrUrl", () => {
  it("parses github.com and the configured enterprise host", () => {
    expect(parsePrUrl("https://github.com/cli/cli/pull/123", hosts)).toEqual({ host: "github.com", owner: "cli", repo: "cli", number: 123 });
    expect(parsePrUrl("https://github.acme.com/team/svc/pull/7/files#diff-abc", hosts)).toMatchObject({ host: "github.acme.com", number: 7 });
    expect(parsePrUrl("  https://GitHub.com/a/b.c_d/pull/9/commits/abc?x=1  ", hosts)).toMatchObject({ repo: "b.c_d", number: 9 });
  });
  it("rejects other hosts, schemes, credentials and ports", () => {
    for (const u of [
      "https://evil.com/a/b/pull/1",
      "https://github.com.evil.com/a/b/pull/1",
      "https://evilgithub.com/a/b/pull/1",
      "http://github.com/a/b/pull/1",
      "ssh://github.com/a/b/pull/1",
      "https://user:pw@github.com/a/b/pull/1",
      "https://github.com:8443/a/b/pull/1",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(() => parsePrUrl(u, hosts), u).toThrow();
    }
  });
  it("rejects non-PR paths and odd names", () => {
    for (const u of [
      "https://github.com/a/b/issues/1",
      "https://github.com/a/b/pull/0",
      "https://github.com/a/b/pull/abc",
      "https://github.com/a/b/pull/12345678",
      "https://github.com/a/pull/1",
      "https://github.com/-a/b/pull/1",
      "https://github.com/a/../pull/1",
      "https://github.com/a/b%2F..%2Fc/pull/1",
      "https://github.com/a/b c/pull/1",
    ]) {
      expect(() => parsePrUrl(u, hosts), u).toThrow();
    }
  });
  it("enterprise host is off unless configured", () => {
    expect(() => parsePrUrl("https://github.acme.com/a/b/pull/1", allowedHosts("github.com"))).toThrow(/allowed/);
    expect(allowedHosts("not a host!").size).toBe(1);
  });
});

describe("parseRepoInput", () => {
  it("accepts owner/repo, host/owner/repo and pasted https forms", () => {
    expect(parseRepoInput("cli/cli", hosts)).toEqual({ host: "github.com", owner: "cli", repo: "cli" });
    expect(parseRepoInput("github.acme.com/team/svc", hosts)).toMatchObject({ host: "github.acme.com" });
    expect(parseRepoInput("https://github.com/cli/cli.git/", hosts)).toMatchObject({ repo: "cli" });
  });
  it("rejects junk", () => {
    for (const s of ["cli", "a/b/c/d", "evil.com/a/b", "-x/y", "a/--flag", "a/b;rm", "", "a/ b"]) {
      expect(() => parseRepoInput(s, hosts), s).toThrow();
    }
  });
});

describe("parseRemoteUrl", () => {
  it("handles https, ssh and scp-like remotes", () => {
    const want = { host: "github.com", owner: "DileepKumarK444", repo: "difflens" };
    for (const r of [
      "https://github.com/DileepKumarK444/difflens.git",
      "https://github.com/DileepKumarK444/difflens",
      "git@github.com:DileepKumarK444/difflens.git",
      "ssh://git@github.com/DileepKumarK444/difflens.git",
      "https://user@github.com/DileepKumarK444/difflens.git/",
    ]) {
      expect(parseRemoteUrl(r), r).toEqual(want);
    }
    expect(parseRemoteUrl("git@github.acme.com:team/svc.git")).toEqual({ host: "github.acme.com", owner: "team", repo: "svc" });
    expect(parseRemoteUrl("git@github-work:team/svc.git")).toEqual({ host: "github-work", owner: "team", repo: "svc" }); // ssh alias: caller checks the host list
  });
  it("returns null for anything else", () => {
    for (const r of [null, undefined, "", "/local/path", "file:///x/y", "https://github.com/onlyone", "https://github.com/a/b/c", "ftp://github.com/a/b"]) {
      expect(parseRemoteUrl(r as string | null), String(r)).toBeNull();
    }
  });
});

describe("repoArg and PrRefSchema", () => {
  it("builds a safe -R value", () => {
    expect(repoArg({ host: "github.com", owner: "cli", repo: "cli" })).toBe("github.com/cli/cli");
    expect(() => repoArg({ host: "github.com", owner: "-x", repo: "y" })).toThrow();
    expect(() => repoArg({ host: "github.com", owner: "a", repo: ".." })).toThrow();
  });
  it("validates a PR ref from the query string", () => {
    expect(PrRefSchema.safeParse({ host: "github.com", owner: "a", repo: "b", number: 5 }).success).toBe(true);
    for (const bad of [{ host: "github.com", owner: "a", repo: "b", number: 0 }, { host: "x y", owner: "a", repo: "b", number: 1 }, { host: "github.com", owner: "a", repo: "b", number: 1.5 }, { host: "github.com", owner: "--x", repo: "b", number: 1 }]) {
      expect(PrRefSchema.safeParse(bad).success).toBe(false);
    }
  });
});
