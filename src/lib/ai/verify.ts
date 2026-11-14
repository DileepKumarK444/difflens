import { createHash } from "node:crypto";
import type { FileDiff } from "@/lib/git/diff-parse";
import { SEVERITIES, lowerSeverity, severityRank, type RawFinding, type Severity } from "./schema";

export interface VerifiedFinding extends Omit<RawFinding, "id"> {
  id: string;
  verification: "exact" | "downgraded";
  /** Why it was downgraded or moved, when it was. */
  verificationNote?: string;
}
export interface Dropped {
  title: string;
  filePath: string;
  reason: string;
}

interface FileIndex {
  file: FileDiff;
  /** The line numbers the finding may point at: new side normally, old side for deleted files. */
  lines: Set<number>;
  changed: Set<number>;
  sorted: number[];
}

export function buildIndex(files: FileDiff[]): Map<string, FileIndex> {
  const m = new Map<string, FileIndex>();
  for (const f of files) {
    const lines = new Set<number>();
    const changed = new Set<number>();
    for (const h of f.hunks)
      for (const l of h.lines) {
        const n = f.status === "deleted" ? l.old : l.new;
        if (n === undefined) continue;
        lines.add(n);
        if (l.t !== " ") changed.add(n);
      }
    m.set(f.path, { file: f, lines, changed, sorted: [...lines].sort((a, b) => a - b) });
  }
  return m;
}

function matchFile(index: Map<string, FileIndex>, raw: string): FileIndex | null {
  const p = raw.trim().replace(/^(\.\/|a\/|b\/)/, "");
  const exact = index.get(p);
  if (exact) return exact;
  const hits = [...index.values()].filter((i) => i.file.path.endsWith("/" + p) || p.endsWith("/" + i.file.path));
  return hits.length === 1 ? hits[0] : null;
}

const NEARBY = 20;

/**
 * Check every finding against the diff that was actually reviewed.
 * - file not in the diff: dropped
 * - lines inside the diff's hunks: kept as exact
 * - lines outside but within NEARBY lines of a hunk: moved to the nearest diff line, severity lowered, marked downgraded
 * - anything further away: dropped
 */
export function verifyFindings(raw: RawFinding[], files: FileDiff[]): { kept: VerifiedFinding[]; dropped: Dropped[] } {
  const index = buildIndex(files);
  const kept: VerifiedFinding[] = [];
  const dropped: Dropped[] = [];
  for (const f of raw) {
    const idx = matchFile(index, f.filePath);
    if (!idx) {
      dropped.push({ title: f.title, filePath: f.filePath, reason: "file is not in the reviewed diff" });
      continue;
    }
    let start = Math.min(f.lineStart, f.lineEnd);
    let end = Math.max(f.lineStart, f.lineEnd);
    if (idx.sorted.length === 0) {
      dropped.push({ title: f.title, filePath: f.filePath, reason: "file has no reviewable lines" });
      continue;
    }
    const inside = [...Array(Math.min(end - start + 1, 5000)).keys()].map((i) => start + i).filter((n) => idx.lines.has(n));
    const base = { ...f, filePath: idx.file.path, id: "" };
    if (inside.length > 0) {
      const lo = inside[0];
      const hi = inside[inside.length - 1];
      const note = lo !== start || hi !== end ? `Trimmed to lines ${lo}-${hi}, the part inside the diff.` : undefined;
      kept.push({ ...base, lineStart: lo, lineEnd: hi, verification: "exact", verificationNote: note });
      continue;
    }
    // Outside every hunk: find the nearest diff line.
    let best = idx.sorted[0];
    for (const n of idx.sorted) if (Math.abs(n - start) < Math.abs(best - start)) best = n;
    if (Math.abs(best - start) > NEARBY) {
      dropped.push({ title: f.title, filePath: f.filePath, reason: `lines ${start}-${end} are not near any change in ${idx.file.path}` });
      continue;
    }
    kept.push({
      ...base,
      lineStart: best,
      lineEnd: best,
      severity: lowerSeverity(f.severity),
      confidence: Math.round(f.confidence * 70) / 100,
      verification: "downgraded",
      verificationNote: `Reported at line ${start}, which isn’t in the diff. Moved to line ${best} and lowered one severity level.`,
    });
    start = best;
    end = best;
  }
  return { kept, dropped };
}

export const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Merge findings that describe the same problem (same file, nearby lines, similar title). Keeps the stronger one. */
export function dedupeFindings(list: VerifiedFinding[]): VerifiedFinding[] {
  const sorted = [...list].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence);
  const out: VerifiedFinding[] = [];
  for (const f of sorted) {
    const ft = tokens(f.title + " " + f.description.slice(0, 120));
    const dup = out.find((o) => {
      if (o.filePath !== f.filePath) return false;
      const overlap = f.lineStart <= o.lineEnd + 3 && o.lineStart <= f.lineEnd + 3;
      if (!overlap) return false;
      const sim = jaccard(tokens(o.title + " " + o.description.slice(0, 120)), ft);
      const titleSim = jaccard(tokens(o.title), tokens(f.title));
      return sim >= 0.4 || titleSim >= 0.5;
    });
    if (!dup) out.push(f);
  }
  return out;
}

export function findingId(f: { filePath: string; lineStart: number; lineEnd: number; title: string }): string {
  return createHash("sha1").update(`${f.filePath}:${f.lineStart}:${f.lineEnd}:${f.title.toLowerCase()}`).digest("hex").slice(0, 12);
}

export function atLeast(sev: Severity, min: Severity): boolean {
  return SEVERITIES.indexOf(sev) <= SEVERITIES.indexOf(min);
}

/** The full post-processing pipeline for one review. */
export function finalizeFindings(raw: RawFinding[], files: FileDiff[], minSeverity: Severity) {
  const { kept, dropped } = verifyFindings(raw, files);
  const deduped = dedupeFindings(kept);
  const filtered = deduped.filter((f) => atLeast(f.severity, minSeverity));
  const withIds = filtered.map((f) => ({ ...f, id: findingId(f) }));
  withIds.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart);
  return {
    findings: withIds,
    dropped,
    stats: { reported: raw.length, verified: kept.length, duplicates: kept.length - deduped.length, belowMinSeverity: deduped.length - filtered.length },
  };
}
