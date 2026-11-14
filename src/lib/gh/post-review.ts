import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { findings, reviews } from "@/lib/db/schema";
import { parseUnifiedDiff } from "@/lib/git/diff-parse";
import { redact } from "@/lib/exec";
import { defaultDeps, type Deps } from "./accounts";
import { PrRefSchema } from "./parse";
import { buildCommentBody, buildGeneralBody, buildInlinePayload, mapToDiff, type Mapped, type PostableFinding, type ReviewPayload } from "./post";
import { GhError, friendlyGhError, getPrDiff } from "./prs";
import { runGh } from "./run";

export class PostError extends Error {}

export const PostInput = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1, "Choose at least one finding").max(100),
  /** Findings whose code example should be posted as a one-click GitHub suggestion. */
  suggestionIds: z.array(z.string().max(200)).max(100).default([]),
  /** Edited comment text, by finding id. */
  bodies: z.record(z.string(), z.string().min(1).max(8000)).default({}),
  summary: z.string().max(4000).optional(),
});
export type PostInput = z.infer<typeof PostInput>;

const Source = z.object({ type: z.literal("pr"), pr: PrRefSchema, headOid: z.string().regex(/^[0-9a-f]{40}$/i).optional() }).passthrough();

export interface PreviewItem {
  id: string;
  title: string;
  severity: string;
  path: string;
  line: number;
  side: "RIGHT" | "LEFT" | null;
  mapped: boolean;
  /** Why it can't be placed on the diff, when it can't. */
  reason: string | null;
  suggestion: boolean;
  body: string;
  alreadyPosted: boolean;
}

export interface Preview {
  repo: string;
  host: string;
  number: number;
  title: string;
  headOid: string;
  /** "inline" puts each comment on its line; "general" is one comment holding everything. */
  mode: "inline" | "general";
  summary: string;
  items: PreviewItem[];
  warnings: string[];
}

interface Prepared {
  preview: Preview;
  payloadInline: ReviewPayload | null;
  payloadGeneral: ReviewPayload;
  account: string | undefined;
  host: string;
  owner: string;
  repoName: string;
  number: number;
  selectedIds: string[];
}

async function prepare(db: Db, reviewId: string, rawInput: unknown, deps: Deps): Promise<Prepared> {
  const input = PostInput.safeParse(rawInput);
  if (!input.success) throw new PostError(input.error.issues[0]?.message ?? "Invalid request");
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
  if (!review) throw new PostError("That review doesn’t exist");
  if (review.kind !== "pr") throw new PostError("Only reviews of GitHub pull requests can be posted. Local reviews never are");
  const src = Source.safeParse(JSON.parse(review.source));
  if (!src.success) throw new PostError("This review doesn’t record which pull request it was for");
  const { pr, headOid: reviewedHead } = src.data;

  const ids = [...new Set(input.data.ids)];
  const rows = db.select().from(findings).where(and(eq(findings.reviewId, reviewId), inArray(findings.id, ids))).all();
  if (rows.length !== ids.length) throw new PostError("Some of the chosen findings don’t belong to this review");

  // Always look at the PR as it is right now, not as it was when the review ran.
  const { meta, patch } = await getPrDiff(db, pr, deps, { fresh: true });
  const warnings: string[] = [];
  if (meta.state !== "OPEN") throw new PostError(`This pull request is ${meta.state.toLowerCase()}, so comments can’t be added to it`);
  if (reviewedHead && reviewedHead.toLowerCase() !== meta.headOid.toLowerCase()) {
    throw new PostError("The pull request has new commits since this review, so the line numbers may no longer match. Run the review again first");
  }
  if (!reviewedHead) warnings.push("This review didn’t record the commit it looked at, so DiffLens can’t confirm the PR hasn’t changed since.");

  const files = parseUnifiedDiff(patch);
  const wantSuggestion = new Set(input.data.suggestionIds);
  const order = new Map(ids.map((id, i) => [id, i]));
  const items: PreviewItem[] = [];
  const mapped: { m: Extract<Mapped, { ok: true }>; body: string }[] = [];
  for (const f of rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
    const pf: PostableFinding = f;
    const m = mapToDiff(files, f);
    // A suggestion block replaces exactly the commented lines, so it needs an exact, right-hand-side match.
    const canSuggest = m.ok && !m.trimmed && m.side === "RIGHT" && Boolean(f.codeExample?.trim());
    const suggestion = wantSuggestion.has(f.id) && canSuggest;
    if (wantSuggestion.has(f.id) && !canSuggest) warnings.push(`“${f.title}” can’t be a suggestion block (it needs an exact line match and a code example), so it is plain text.`);
    const body = input.data.bodies[f.id]?.trim() || buildCommentBody(pf, { suggestion });
    items.push({
      id: f.id, title: f.title, severity: f.severity, path: f.filePath, line: m.ok ? (m.startLine ?? m.line) : f.lineStart,
      side: m.ok ? m.side : null, mapped: m.ok, reason: m.ok ? (m.trimmed ? "only the first line could be matched, so the comment is placed there" : null) : m.reason,
      suggestion, body, alreadyPosted: f.postedAt !== null,
    });
    if (m.ok) mapped.push({ m, body });
  }

  const allMapped = items.every((i) => i.mapped);
  const summary = (input.data.summary?.trim() || `Review notes (${items.length} ${items.length === 1 ? "finding" : "findings"}).`).slice(0, 4000);
  if (!allMapped) warnings.push("Not every comment can be placed on a line of the diff, so everything will be posted as one general comment instead.");
  const payloadInline = allMapped ? buildInlinePayload(meta.headOid, summary, mapped) : null;
  const payloadGeneral: ReviewPayload = {
    commit_id: meta.headOid,
    event: "COMMENT",
    body: buildGeneralBody(summary, items.map((i) => ({ path: i.path, line: i.line, body: i.body }))),
  };
  return {
    preview: { repo: `${pr.owner}/${pr.repo}`, host: pr.host, number: pr.number, title: meta.title, headOid: meta.headOid, mode: allMapped ? "inline" : "general", summary, items, warnings },
    payloadInline, payloadGeneral, account: pr.account, host: pr.host, owner: pr.owner, repoName: pr.repo, number: pr.number, selectedIds: ids,
  };
}

/** Show exactly what would be posted. Contacts GitHub only to read, and never writes anything. */
export async function previewPost(db: Db, reviewId: string, input: unknown, deps: Deps = defaultDeps()): Promise<Preview> {
  return (await prepare(db, reviewId, input, deps)).preview;
}

export interface PostResult {
  url: string | null;
  mode: "inline" | "general";
  posted: number;
  /** Set when inline placement was rejected and the review was posted as one general comment instead. */
  fallbackReason: string | null;
}

/**
 * Post the review. Requires the caller to repeat the repository and PR number, so a stale or
 * mistaken request can't post to the wrong place. Always event COMMENT, never approve or request changes.
 */
export async function executePost(db: Db, reviewId: string, input: unknown, confirm: { repo: string; number: number }, deps: Deps = defaultDeps()): Promise<PostResult> {
  const p = await prepare(db, reviewId, input, deps);
  if (confirm.repo.toLowerCase() !== p.preview.repo.toLowerCase() || confirm.number !== p.number) {
    throw new PostError(`The confirmation doesn’t match ${p.preview.repo} #${p.number}. Nothing was posted`);
  }

  const send = async (payload: ReviewPayload) => {
    const r = await runGh(
      db,
      ["api", "--hostname", p.host, "-X", "POST", "-H", "Accept: application/vnd.github+json", `repos/${p.owner}/${p.repoName}/pulls/${p.number}/reviews`, "--input", "-"],
      { accountId: p.account, timeoutMs: 60_000, input: JSON.stringify(payload) },
      deps,
    );
    return r;
  };

  let mode: "inline" | "general" = p.payloadInline ? "inline" : "general";
  let fallbackReason: string | null = p.payloadInline ? null : "Some comments couldn’t be placed on the diff lines.";
  let r = await send(p.payloadInline ?? p.payloadGeneral);
  if (r.code !== 0 && p.payloadInline && /422|unprocessable|pull_request_review_thread|line/i.test(r.stderr + r.stdout)) {
    // GitHub refused the line positions: say so, and post everything as one general comment.
    mode = "general";
    fallbackReason = "GitHub didn’t accept the line positions.";
    r = await send(p.payloadGeneral);
  }
  if (r.code !== 0) throw new GhError(friendlyGhError(redact(r.stderr || r.stdout), `${p.preview.repo} #${p.number}`));

  let url: string | null = null;
  try {
    const u = (JSON.parse(r.stdout) as { html_url?: string }).html_url;
    if (typeof u === "string" && u.startsWith(`https://${p.host}/`)) url = u;
  } catch {
    /* the review was posted; the link is optional */
  }
  db.update(findings).set({ postedAt: new Date() }).where(and(eq(findings.reviewId, reviewId), inArray(findings.id, p.selectedIds))).run();
  return { url, mode, posted: p.selectedIds.length, fallbackReason };
}
