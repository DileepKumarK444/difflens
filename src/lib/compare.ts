import { jaccard, tokens } from "@/lib/ai/verify";
import type { FindingView } from "@/lib/findings";

export interface Comparison {
  /** In the older review but not the newer one: probably fixed. */
  fixed: FindingView[];
  /** In the newer review only. */
  added: FindingView[];
  /** Matched pairs: [older, newer]. */
  unchanged: [FindingView, FindingView][];
}

function score(a: FindingView, b: FindingView): number {
  if (a.filePath !== b.filePath) return 0;
  const title = jaccard(tokens(a.title), tokens(b.title));
  const body = jaccard(tokens(a.title + " " + a.description.slice(0, 150)), tokens(b.title + " " + b.description.slice(0, 150)));
  const near = Math.abs(a.lineStart - b.lineStart) <= 15;
  // Line numbers drift between reviews, so wording counts for more than position.
  if (title >= 0.6) return 0.6 + title * 0.4;
  if (near && body >= 0.4) return 0.4 + body * 0.4;
  if (a.lineStart === b.lineStart && a.category === b.category && body >= 0.25) return 0.3 + body * 0.3;
  return 0;
}

/** Match findings between two reviews one-to-one, best matches first. */
export function compareFindings(older: FindingView[], newer: FindingView[]): Comparison {
  const pairs: { i: number; j: number; s: number }[] = [];
  older.forEach((a, i) => newer.forEach((b, j) => {
    const s = score(a, b);
    if (s > 0) pairs.push({ i, j, s });
  }));
  pairs.sort((x, y) => y.s - x.s);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const unchanged: Comparison["unchanged"] = [];
  for (const p of pairs) {
    if (usedA.has(p.i) || usedB.has(p.j)) continue;
    usedA.add(p.i);
    usedB.add(p.j);
    unchanged.push([older[p.i], newer[p.j]]);
  }
  return {
    fixed: older.filter((_, i) => !usedA.has(i)),
    added: newer.filter((_, j) => !usedB.has(j)),
    unchanged,
  };
}
