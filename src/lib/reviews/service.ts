import { z } from "zod";
import type { Db } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { planChunks } from "@/lib/ai/chunk";
import { ReviewFailed, runReview } from "@/lib/ai/engine";
import { createProvider } from "@/lib/ai/providers";
import { ProviderError, type ReviewProvider } from "@/lib/ai/providers/types";
import { parseUnifiedDiff, type FileDiff } from "@/lib/git/diff-parse";
import { git } from "@/lib/git/exec";
import { getDiff } from "@/lib/git/repo";
import { getRepo, listRepos } from "@/lib/git/repos-db";
import { Scope } from "@/lib/git/scopes";
import { GitError } from "@/lib/git/validate";
import { PrRefSchema, allowedHosts, parseRemoteUrl, ParseError } from "@/lib/gh/parse";
import { getPrDiff } from "@/lib/gh/prs";
import { clearProgress, confirmSession, sessionConfirmed, setProgress } from "./jobs";
import { completeReview, createReview, failReview } from "./store";

export const SourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), repoId: z.string().min(1).max(100), scope: Scope }),
  z.object({ type: z.literal("pr"), pr: PrRefSchema }),
]);
export const StartBody = z.object({ source: SourceSchema, confirmSend: z.boolean().optional() });
export type StartBody = z.infer<typeof StartBody>;

export interface Prepared {
  kind: "local" | "pr";
  title: string;
  patch: string;
  files: FileDiff[];
  repoId: string | null;
  cwd: string | undefined;
  pr?: { host: string; ownerRepo: string; number: number };
  /** The PR's head commit at review time, kept so comments are only posted if it hasn't moved. */
  headOid?: string;
  context: string;
}

export interface Summary {
  title: string;
  files: number;
  additions: number;
  deletions: number;
  bytes: number;
  provider: string;
  model: string | null;
  leavesMachine: boolean;
  destination: string;
  repoAccess: boolean;
  context: string;
  parts: number;
  limitWarning: string | null;
}

export async function prepareSource(db: Db, source: StartBody["source"]): Promise<Prepared> {
  if (source.type === "local") {
    const repo = getRepo(db, source.repoId);
    if (!repo) throw new GitError("That repository isn’t added to DiffLens");
    const d = await getDiff(repo.path, source.scope);
    return {
      kind: "local", title: `${repo.name}: ${d.label}`, patch: d.patch, files: parseUnifiedDiff(d.patch), repoId: repo.id, cwd: repo.path,
      context: "Your local repository, as it is on disk now",
    };
  }
  const hosts = allowedHosts(getSetting(db, "githubHost"));
  if (!hosts.has(source.pr.host)) throw new ParseError(`${source.pr.host} isn’t an allowed GitHub host`);
  const { meta, patch } = await getPrDiff(db, source.pr);
  // Give the model the local clone only when it is exactly at the PR's head commit, so it never reads the wrong code.
  let cwd: string | undefined;
  let repoId: string | null = null;
  for (const r of listRepos(db)) {
    const ref = parseRemoteUrl(r.remoteUrl);
    if (ref && ref.host === source.pr.host && ref.owner.toLowerCase() === source.pr.owner.toLowerCase() && ref.repo.toLowerCase() === source.pr.repo.toLowerCase()) {
      repoId = r.id;
      const head = await git(r.path, ["rev-parse", "HEAD"], { allowFail: true });
      if (head.code === 0 && head.stdout.trim() === meta.headOid) cwd = r.path;
      break;
    }
  }
  return {
    kind: "pr", title: `${source.pr.owner}/${source.pr.repo} #${meta.number}: ${meta.title}`, patch, files: parseUnifiedDiff(patch), repoId, cwd,
    pr: { host: source.pr.host, ownerRepo: `${source.pr.owner}/${source.pr.repo}`, number: meta.number },
    headOid: meta.headOid,
    context: cwd ? "Your local clone, which is at the PR’s head commit" : "Only the PR’s diff (no local clone is at the PR’s head commit)",
  };
}

export function summarize(p: Prepared, provider: ReviewProvider, maxChunks: number): Summary {
  const plan = planChunks(p.patch, { maxChunks });
  return {
    title: p.title,
    files: p.files.length,
    additions: p.files.reduce((n, f) => n + f.additions, 0),
    deletions: p.files.reduce((n, f) => n + f.deletions, 0),
    bytes: Buffer.byteLength(p.patch),
    provider: provider.label,
    model: provider.model,
    leavesMachine: provider.leavesMachine,
    destination: provider.leavesMachine ? (provider.id === "ollama" ? "a remote Ollama server" : "Anthropic") : "this machine only",
    repoAccess: provider.readsRepo && Boolean(p.cwd),
    context: p.context,
    parts: plan.chunks.length,
    limitWarning: plan.partial ? plan.partialReason : null,
  };
}

export type StartResult = { needsConfirmation: true; summary: Summary } | { id: string; summary: Summary };

export async function startReview(db: Db, body: StartBody, opts: { provider?: ReviewProvider } = {}): Promise<StartResult> {
  const provider = opts.provider ?? createProvider(db);
  const maxChunks = getSetting(db, "maxChunks");
  const prepared = await prepareSource(db, body.source);
  if (prepared.files.length === 0 || prepared.patch.trim() === "") throw new GitError("Nothing to review: there are no changes in this scope");
  const summary = summarize(prepared, provider, maxChunks);

  const policy = getSetting(db, "confirmSend");
  const needsAsk = provider.leavesMachine && (policy === "always" || (policy === "session" && !sessionConfirmed()));
  if (needsAsk && body.confirmSend !== true) return { needsConfirmation: true, summary };
  if (provider.leavesMachine && policy === "session") confirmSession();

  const minSeverity = getSetting(db, "minSeverity");
  const id = createReview(db, {
    kind: prepared.kind, source: prepared.headOid ? { ...body.source, headOid: prepared.headOid } : body.source, title: prepared.title, repoId: prepared.repoId, pr: prepared.pr,
    provider: provider.id, model: provider.model, minSeverity, patch: prepared.patch, files: prepared.files,
  });
  setProgress(id, { total: summary.parts, done: 0, failed: 0 });
  void runJob(db, id, prepared, provider, { minSeverity, maxChunks, customInstructions: getSetting(db, "customInstructions") });
  return { id, summary };
}

async function runJob(db: Db, id: string, p: Prepared, provider: ReviewProvider, o: { minSeverity: ReturnType<typeof getSetting<"minSeverity">>; maxChunks: number; customInstructions: string }) {
  try {
    const result = await runReview({
      patch: p.patch, title: p.title, provider, cwd: p.cwd, minSeverity: o.minSeverity, customInstructions: o.customInstructions,
      maxChunks: o.maxChunks, onProgress: (pr) => setProgress(id, pr),
    });
    completeReview(db, id, result);
  } catch (e) {
    failReview(db, id, e instanceof ReviewFailed || e instanceof ProviderError ? e.message : "The review failed unexpectedly");
  } finally {
    clearProgress(id);
  }
}
