import { z } from "zod";
import { HOST_RE } from "./accounts";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^(?!\.{1,2}$)(?!-)[A-Za-z0-9._-]{1,100}$/;

export interface PrRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export const PrRefSchema = z.object({
  host: z.string().toLowerCase().regex(HOST_RE),
  owner: z.string().regex(OWNER_RE),
  repo: z.string().regex(REPO_RE),
  number: z.number().int().min(1).max(9_999_999),
  /** Optional account id for this request; empty means the default account. */
  account: z.string().max(200).optional(),
});
export type PrRefInput = z.infer<typeof PrRefSchema>;

export interface RepoRef {
  host: string;
  owner: string;
  repo: string;
}

export class ParseError extends Error {}

/** Hosts DiffLens will talk to: github.com plus the optional configured Enterprise host. */
export function allowedHosts(configured: string): Set<string> {
  const set = new Set(["github.com"]);
  const c = configured.trim().toLowerCase();
  if (c && HOST_RE.test(c)) set.add(c);
  return set;
}

/**
 * Parse a GitHub PR link. Only https URLs on an allowed host are accepted, with no credentials,
 * so a pasted link can never point DiffLens at some other server.
 */
export function parsePrUrl(input: string, hosts: Set<string>): PrRef {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ParseError("That doesn’t look like a link");
  }
  if (u.protocol !== "https:") throw new ParseError("Use an https:// link");
  if (u.username || u.password) throw new ParseError("Remove the credentials from the link");
  if (u.port) throw new ParseError("Links with a port aren’t supported");
  const host = u.hostname.toLowerCase();
  if (!hosts.has(host)) {
    throw new ParseError(`${host} isn’t an allowed GitHub host. Add it in Settings first`);
  }
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d{1,7})(?:\/.*)?$/.exec(u.pathname);
  if (!m) throw new ParseError("That isn’t a pull request link (expected /owner/repo/pull/123)");
  const [, owner, repo, num] = m;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) throw new ParseError("Unexpected owner or repository name");
  const number = parseInt(num, 10);
  if (number < 1) throw new ParseError("Invalid pull request number");
  return { host, owner, repo, number };
}

/** Parse `owner/repo` (optionally `host/owner/repo`) typed by the user. */
export function parseRepoInput(input: string, hosts: Set<string>, defaultHost = "github.com"): RepoRef {
  const parts = input.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  let host = defaultHost;
  if (parts.length === 3) host = parts.shift()!.toLowerCase();
  if (parts.length !== 2) throw new ParseError("Enter the repository as owner/repo");
  const [owner, repo] = parts;
  if (!hosts.has(host)) throw new ParseError(`${host} isn’t an allowed GitHub host`);
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) throw new ParseError("Unexpected owner or repository name");
  return { host, owner, repo };
}

/**
 * Work out the GitHub repo behind a git remote URL (https, ssh://, or scp-like git@host:o/r).
 * Returns null for non-GitHub-shaped remotes. Does not check the host against the allowlist.
 */
export function parseRemoteUrl(remote: string | null | undefined): RepoRef | null {
  if (!remote) return null;
  const s = remote.trim();
  let host: string | undefined;
  let p: string | undefined;
  const scp = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(?!\/\/)([^/].*)$/.exec(s);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    host = scp[1];
    p = scp[2];
  } else {
    try {
      const u = new URL(s);
      if (!["https:", "http:", "ssh:", "git:"].includes(u.protocol)) return null;
      host = u.hostname;
      p = u.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  if (!host || !p) return null;
  const segs = p.replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (segs.length !== 2) return null;
  const [owner, repo] = segs;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || !HOST_RE.test(host.toLowerCase())) return null;
  return { host: host.toLowerCase(), owner, repo };
}

/** The `-R` value for gh: HOST/OWNER/REPO. Components are validated, so it can't start with "-". */
export function repoArg(r: RepoRef): string {
  if (!OWNER_RE.test(r.owner) || !REPO_RE.test(r.repo) || !HOST_RE.test(r.host)) throw new ParseError("Invalid repository");
  return `${r.host}/${r.owner}/${r.repo}`;
}
