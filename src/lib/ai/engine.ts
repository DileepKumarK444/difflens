import { planChunks, type ChunkPlan } from "./chunk";
import { buildRepairPrompt, buildReviewPrompt } from "./prompt";
import { ProviderError, type ReviewProvider } from "./providers/types";
import { OutputError, parseReviewOutput, type RawFinding, type Severity } from "./schema";
import { finalizeFindings, type Dropped, type VerifiedFinding } from "./verify";

export interface EngineInput {
  patch: string;
  title: string;
  provider: ReviewProvider;
  /** Repository the model may read for context (only used by providers that can read files). */
  cwd?: string;
  minSeverity: Severity;
  customInstructions: string;
  maxChunks: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export interface Progress {
  total: number;
  done: number;
  failed: number;
}

export interface EngineResult {
  findings: VerifiedFinding[];
  dropped: Dropped[];
  skipped: ChunkPlan["skipped"];
  partial: boolean;
  partialReason: string | null;
  errors: string[];
  chunks: Progress;
  stats: { reported: number; verified: number; duplicates: number; belowMinSeverity: number };
  /** True if any reply had to be repaired. */
  repaired: number;
  filesReviewed: number;
}

export class ReviewFailed extends Error {}

/** One model call with a single repair attempt if the reply isn't valid JSON for the schema. */
export async function callWithRepair(provider: ReviewProvider, prompt: string, req: { cwd?: string; timeoutMs: number; signal?: AbortSignal }): Promise<{ findings: RawFinding[]; repaired: boolean }> {
  const first = await provider.complete({ prompt, ...req });
  try {
    return { findings: parseReviewOutput(first).findings, repaired: false };
  } catch (e) {
    if (!(e instanceof OutputError)) throw e;
    const second = await provider.complete({ prompt: buildRepairPrompt(first, e.message), ...req });
    try {
      return { findings: parseReviewOutput(second).findings, repaired: true };
    } catch (e2) {
      if (e2 instanceof OutputError) throw new ReviewFailed(`The model’s reply still wasn’t valid after one repair attempt: ${e2.message}`);
      throw e2;
    }
  }
}

export async function runReview(input: EngineInput): Promise<EngineResult> {
  const plan = planChunks(input.patch, { maxChunks: input.maxChunks });
  const total = plan.chunks.length;
  const progress: Progress = { total, done: 0, failed: 0 };
  input.onProgress?.({ ...progress });

  if (total === 0) {
    return {
      findings: [], dropped: [], skipped: plan.skipped, partial: false, partialReason: null, errors: [], chunks: progress,
      stats: { reported: 0, verified: 0, duplicates: 0, belowMinSeverity: 0 }, repaired: 0, filesReviewed: 0,
    };
  }

  const raw: RawFinding[] = [];
  const errors: string[] = [];
  const failedFiles = new Set<string>();
  let repaired = 0;
  let successes = 0;
  let providerFailuresInARow = 0;
  const cwd = input.provider.readsRepo ? input.cwd : undefined;

  for (const chunk of plan.chunks) {
    if (input.signal?.aborted) throw new ReviewFailed("The review was cancelled");
    const prompt = buildReviewPrompt({
      chunkText: chunk.text, chunkIndex: chunk.index, chunkTotal: total, minSeverity: input.minSeverity,
      customInstructions: input.customInstructions, hasRepoAccess: input.provider.readsRepo && Boolean(cwd), title: input.title,
    });
    try {
      const r = await callWithRepair(input.provider, prompt, { cwd, timeoutMs: input.timeoutMs ?? 600_000, signal: input.signal });
      raw.push(...r.findings);
      if (r.repaired) repaired++;
      successes++;
      providerFailuresInARow = 0;
    } catch (e) {
      progress.failed++;
      for (const f of chunk.files) failedFiles.add(f);
      const msg = e instanceof ProviderError || e instanceof ReviewFailed ? e.message : "The review of one chunk failed";
      errors.push(`Part ${chunk.index + 1} of ${total}: ${msg}`);
      providerFailuresInARow = e instanceof ProviderError ? providerFailuresInARow + 1 : 0;
      progress.done++;
      input.onProgress?.({ ...progress });
      // A provider that can't be used at all (not logged in, unreachable) fails every chunk the same way: stop early.
      if (successes === 0 && providerFailuresInARow >= 2) break;
      continue;
    }
    progress.done++;
    input.onProgress?.({ ...progress });
  }

  if (successes === 0) {
    throw new ReviewFailed(errors[0] ?? "The review failed");
  }

  const fin = finalizeFindings(raw, plan.files, input.minSeverity);
  const partialReasons: string[] = [];
  if (plan.partialReason) partialReasons.push(plan.partialReason);
  if (progress.failed > 0) partialReasons.push(`${progress.failed} of ${total} parts failed, so files in them were not reviewed.`);
  const skipped = [...plan.skipped];
  for (const f of failedFiles) skipped.push({ path: f, reason: "the model call for this part failed" });

  return {
    findings: fin.findings,
    dropped: fin.dropped,
    skipped,
    partial: partialReasons.length > 0,
    partialReason: partialReasons.length ? partialReasons.join(" ") : null,
    errors,
    chunks: progress,
    stats: fin.stats,
    repaired,
    filesReviewed: new Set(plan.chunks.flatMap((c) => c.files)).size - failedFiles.size,
  };
}
