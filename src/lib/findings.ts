import { SEVERITIES } from "@/lib/ai/schema";

export type Severity = (typeof SEVERITIES)[number];
export const STATUSES = ["open", "resolved", "ignored"] as const;
export type Status = (typeof STATUSES)[number];

/** The fields the findings UI needs. Matches the rows the review API returns. */
export interface FindingView {
  id: string;
  title: string;
  category: string;
  severity: Severity;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  whyItMatters: string;
  suggestedFix: string;
  codeExample: string | null;
  confidence: number;
  verification: "exact" | "downgraded";
  status: Status;
  note: string;
}

export interface Filters {
  severities: Set<Severity>;
  category: string; // "all" or a category
  status: Status | "all";
  search: string;
}

export const defaultFilters = (): Filters => ({ severities: new Set(SEVERITIES), category: "all", status: "open", search: "" });

const rank = (s: Severity) => SEVERITIES.indexOf(s);

/** Apply the filter bar. Keeps the order given (already sorted by severity, then file, then line). */
export function filterFindings(list: FindingView[], f: Filters): FindingView[] {
  const q = f.search.trim().toLowerCase();
  return list.filter((x) => {
    if (!f.severities.has(x.severity)) return false;
    if (f.category !== "all" && x.category !== f.category) return false;
    if (f.status !== "all" && x.status !== f.status) return false;
    if (q) {
      const hay = `${x.title}\n${x.description}\n${x.filePath}\n${x.category}\n${x.note}\n${x.whyItMatters}\n${x.suggestedFix}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function countBy<T extends string>(list: FindingView[], pick: (f: FindingView) => T): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const f of list) out[pick(f)] = (out[pick(f)] ?? 0) + 1;
  return out;
}

/** The next (delta 1) or previous (delta -1) finding in the visible list, wrapping around. */
export function stepFinding(visible: FindingView[], currentId: string | null, delta: 1 | -1): FindingView | null {
  if (visible.length === 0) return null;
  const i = currentId ? visible.findIndex((f) => f.id === currentId) : -1;
  if (i === -1) return delta === 1 ? visible[0] : visible[visible.length - 1];
  return visible[(i + delta + visible.length) % visible.length];
}

/** How many findings per file that still need attention (open), for the file list badges. */
export function openCountsByFile(list: FindingView[]): Map<string, { open: number; worst: Severity }> {
  const m = new Map<string, { open: number; worst: Severity }>();
  for (const f of list) {
    if (f.status !== "open") continue;
    const cur = m.get(f.filePath);
    if (!cur) m.set(f.filePath, { open: 1, worst: f.severity });
    else {
      cur.open++;
      if (rank(f.severity) < rank(cur.worst)) cur.worst = f.severity;
    }
  }
  return m;
}

/** Monaco marker severity for a finding: 8 Error, 4 Warning, 2 Info, 1 Hint. */
export function markerSeverity(s: Severity): 8 | 4 | 2 | 1 {
  return s === "Critical" || s === "High" ? 8 : s === "Medium" ? 4 : s === "Low" ? 2 : 1;
}
