import { z } from "zod";
import type { Db } from "@/lib/db";
import { GitError, isSafeRelPath } from "@/lib/git/validate";
import { MAX_FILE_BYTES } from "@/lib/git/repo";
import { defaultDeps, type Deps } from "./accounts";
import { repoArg, type PrRefInput, type RepoRef } from "./parse";
import { runGh } from "./run";

export type PrFilter = "all" | "review" | "mine";
export const PR_FILTERS: PrFilter[] = ["all", "review", "mine"];
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

/** A failure with a message that is safe to show. */
export class GhError extends Error {}

const SHA40 = /^[0-9a-f]{40}$/i;

/** Turn raw gh stderr into a short, actionable message. Never returns tokens or raw dumps. */
export function friendlyGhError(stderr: string, target: string): string {
  const s = stderr.toLowerCase();
  if (/saml|sso/.test(s)) return `${target} needs SSO authorization for this account. Authorize the token for the organization on GitHub`;
  if (/rate limit/.test(s)) return "GitHub’s rate limit was reached. Try again in a few minutes";
  if (/(406|too_large|diff exceeded|too large|maximum number of)/.test(s)) return "GitHub says this diff is too large to return";
  if (/(bad credentials|http 401|authentication|auth login|not logged in|gh_token)/.test(s)) {
    return "GitHub didn’t accept this account’s login. Run gh auth login or choose another account in Settings";
  }
  if (/(could not resolve to a|http 404|not found|no pull requests)/.test(s)) {
    return `Couldn’t find ${target}, or this account has no access to it. Try a different account`;
  }
  if (/(enoent|spawn gh|command not found)/.test(s)) return "Couldn’t run gh. Install the GitHub CLI and run gh auth login";
  if (/(timed out|timeout|etimedout|network|could not resolve host)/.test(s)) return "Couldn’t reach GitHub. Check your connection";
  return "GitHub request failed";
}

async function gh(db: Db, args: string[], accountId: string | undefined, target: string, deps: Deps, timeoutMs = 60_000) {
  let r;
  try {
    r = await runGh(db, args, { accountId, timeoutMs }, deps);
  } catch (e) {
    throw new GhError((e as Error).message || "Couldn’t use that account");
  }
  if (r.code !== 0) throw new GhError(friendlyGhError(r.stderr || r.stdout, target));
  return r.stdout;
}

const Author = z.object({ login: z.string() }).nullable().optional();
const ListItem = z.object({
  number: z.number().int(),
  title: z.string(),
  author: Author,
  isDraft: z.boolean(),
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  changedFiles: z.number().int().default(0),
  reviewDecision: z.string().nullable().optional(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
});
export type PrListItem = Omit<z.infer<typeof ListItem>, "author" | "reviewDecision"> & { author: string | null; reviewDecision: string | null };

const LIST_FIELDS = "number,title,author,isDraft,additions,deletions,changedFiles,reviewDecision,url,headRefName,baseRefName,updatedAt";

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new GhError("GitHub returned something unexpected");
  }
}

/** Open PRs (up to 100) for one repo, with the requested filter. `@me` is the account in use. */
export async function listPrs(db: Db, repo: RepoRef, filter: PrFilter, accountId: string | undefined, deps: Deps = defaultDeps()): Promise<PrListItem[]> {
  const args = ["pr", "list", "-R", repoArg(repo), "--state", "open", "--limit", "100", "--json", LIST_FIELDS];
  if (filter === "review") args.push("--search", "review-requested:@me");
  else if (filter === "mine") args.push("--author", "@me");
  const out = await gh(db, args, accountId, `${repo.owner}/${repo.repo}`, deps);
  return parseJson(out, z.array(ListItem)).map((p) => ({ ...p, author: p.author?.login ?? null, reviewDecision: p.reviewDecision || null }));
}

export interface RepoPrs {
  repo: RepoRef;
  prs: PrListItem[];
  error: string | null;
}

/** List PRs across several repos, a few at a time. One failing repo never hides the others. */
export async function listPrsAcross(db: Db, repos: RepoRef[], filter: PrFilter, accountId: string | undefined, deps: Deps = defaultDeps()): Promise<RepoPrs[]> {
  const seen = new Set<string>();
  const unique = repos.filter((r) => {
    const k = `${r.host}/${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const results: RepoPrs[] = new Array(unique.length);
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const i = next++;
      try {
        results[i] = { repo: unique[i], prs: await listPrs(db, unique[i], filter, accountId, deps), error: null };
      } catch (e) {
        results[i] = { repo: unique[i], prs: [], error: e instanceof GhError ? e.message : "GitHub request failed" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  return results;
}

const MetaSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable().optional(),
  author: Author,
  state: z.string(),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
  baseRefOid: z.string().regex(SHA40),
  headRefOid: z.string().regex(SHA40),
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  changedFiles: z.number().int().default(0),
  reviewDecision: z.string().nullable().optional(),
  url: z.string(),
});

export interface PrMeta {
  number: number;
  title: string;
  body: string;
  author: string | null;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headOid: string;
  mergeBase: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  url: string;
}

const META_TTL_MS = 60_000;
const metaCache = new Map<string, { at: number; meta: PrMeta }>();

export function clearPrCache(): void {
  metaCache.clear();
}

export async function getPrMeta(db: Db, ref: PrRefInput, deps: Deps = defaultDeps()): Promise<PrMeta> {
  const key = `${ref.host}/${ref.owner}/${ref.repo}#${ref.number}|${ref.account ?? "default"}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;

  const target = `${ref.owner}/${ref.repo}#${ref.number}`;
  const raw = await gh(
    db,
    ["pr", "view", String(ref.number), "-R", repoArg(ref), "--json", "number,title,body,author,state,isDraft,baseRefName,headRefName,baseRefOid,headRefOid,additions,deletions,changedFiles,reviewDecision,url"],
    ref.account,
    target,
    deps,
  );
  const m = parseJson(raw, MetaSchema);
  const mb = (
    await gh(
      db,
      ["api", "--hostname", ref.host, `repos/${ref.owner}/${ref.repo}/compare/${m.baseRefOid}...${m.headRefOid}`, "--jq", ".merge_base_commit.sha"],
      ref.account,
      target,
      deps,
    )
  ).trim();
  if (!SHA40.test(mb)) throw new GhError("Couldn’t work out where this PR branched from");
  const meta: PrMeta = {
    number: m.number,
    title: m.title,
    body: m.body ?? "",
    author: m.author?.login ?? null,
    state: m.state,
    isDraft: m.isDraft,
    baseRefName: m.baseRefName,
    headRefName: m.headRefName,
    headOid: m.headRefOid,
    mergeBase: mb,
    additions: m.additions,
    deletions: m.deletions,
    changedFiles: m.changedFiles,
    reviewDecision: m.reviewDecision || null,
    url: m.url,
  };
  if (metaCache.size > 50) metaCache.clear();
  metaCache.set(key, { at: Date.now(), meta });
  return meta;
}

export async function getPrDiff(db: Db, ref: PrRefInput, deps: Deps = defaultDeps()): Promise<{ meta: PrMeta; patch: string }> {
  const meta = await getPrMeta(db, ref, deps);
  const patch = await gh(db, ["pr", "diff", String(ref.number), "-R", repoArg(ref), "--color", "never"], ref.account, `${ref.owner}/${ref.repo}#${ref.number}`, deps, 120_000);
  if (patch.length > MAX_DIFF_BYTES) throw new GhError("This diff is larger than 20 MB, which DiffLens won’t load");
  return { meta, patch };
}

export interface PrFileSides {
  original: string | null;
  modified: string | null;
  binary: boolean;
  tooLarge: boolean;
}

/** Encode each path segment for a GitHub contents URL. The path must already be repo-relative and safe. */
export function contentsEndpoint(ref: RepoRef, filePath: string, sha: string): string {
  if (!isSafeRelPath(filePath)) throw new GitError("Invalid file path");
  if (!SHA40.test(sha)) throw new GitError("Invalid revision");
  const enc = filePath.split("/").map(encodeURIComponent).join("/");
  return `repos/${ref.owner}/${ref.repo}/contents/${enc}?ref=${sha}`;
}

async function readRemote(db: Db, ref: PrRefInput, filePath: string, sha: string, deps: Deps) {
  const endpoint = contentsEndpoint(ref, filePath, sha);
  let r;
  try {
    r = await runGh(db, ["api", "--hostname", ref.host, "-H", "Accept: application/vnd.github.raw+json", endpoint], { accountId: ref.account, timeoutMs: 60_000 }, deps);
  } catch (e) {
    throw new GhError((e as Error).message || "Couldn’t use that account");
  }
  if (r.code !== 0) {
    if (/404|not found/i.test(r.stderr + r.stdout)) return { text: null, binary: false, tooLarge: false }; // file absent on this side
    throw new GhError(friendlyGhError(r.stderr || r.stdout, `${ref.owner}/${ref.repo}`));
  }
  if (r.stdout.length > MAX_FILE_BYTES) return { text: null, binary: false, tooLarge: true };
  if (r.stdout.includes("\0")) return { text: null, binary: true, tooLarge: false };
  return { text: r.stdout, binary: false, tooLarge: false };
}

export async function getPrFileSides(db: Db, ref: PrRefInput, filePath: string, oldPath: string | null, deps: Deps = defaultDeps()): Promise<PrFileSides> {
  if (!isSafeRelPath(filePath) || (oldPath !== null && !isSafeRelPath(oldPath))) throw new GitError("Invalid file path");
  const meta = await getPrMeta(db, ref, deps);
  const [a, b] = await Promise.all([
    readRemote(db, ref, oldPath ?? filePath, meta.mergeBase, deps),
    readRemote(db, ref, filePath, meta.headOid, deps),
  ]);
  return { original: a.text, modified: b.text, binary: a.binary || b.binary, tooLarge: a.tooLarge || b.tooLarge };
}
