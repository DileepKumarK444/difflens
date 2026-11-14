import { SEVERITIES } from "@/lib/ai/schema";
import type { FindingView } from "@/lib/findings";

export interface ExportReview {
  title: string;
  kind: "local" | "pr";
  provider: string;
  model: string | null;
  status: string;
  createdAt: number;
  partialReason: string | null;
  prUrl?: string | null;
  skipped?: { path: string; reason: string }[];
}

/** A code fence longer than any run of backticks inside, so content can never close it early. */
export function fence(text: string, lang = ""): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

const STATUS_LABEL = { open: "Open", resolved: "Resolved", ignored: "Ignored" } as const;

/** Make a one-line value safe inside a Markdown heading or list line. */
const inline = (s: string) => s.replace(/\s+/g, " ").replace(/([\\`*_{}[\]<>#|])/g, "\\$1").trim();

export function renderMarkdown(r: ExportReview, findings: FindingView[]): string {
  const out: string[] = [];
  out.push(`# Code review: ${inline(r.title)}`, "");
  out.push(`- Reviewed: ${new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  out.push(`- Source: ${r.kind === "pr" ? "Pull request" : "Local changes"}${r.prUrl ? ` (${r.prUrl})` : ""}`);
  out.push(`- Provider: ${inline(r.provider)}${r.model ? ` (${inline(r.model)})` : ""}`);
  out.push(`- Status: ${inline(r.status)}`);
  const by = (s: string) => findings.filter((f) => f.status === s).length;
  out.push(`- Findings: ${findings.length} (${by("open")} open, ${by("resolved")} resolved, ${by("ignored")} ignored)`, "");
  if (r.partialReason) out.push(`> **Partial review.** ${inline(r.partialReason)}`, "");
  if (r.skipped?.length) {
    out.push("Not reviewed:", ...r.skipped.map((s) => `- \`${s.path.replace(/`/g, "")}\` (${inline(s.reason)})`), "");
  }
  if (findings.length === 0) out.push("No findings.", "");

  for (const sev of SEVERITIES) {
    const group = findings.filter((f) => f.severity === sev);
    if (!group.length) continue;
    out.push(`## ${sev} (${group.length})`, "");
    for (const f of group) {
      out.push(`### ${inline(f.title)}`, "");
      out.push(`- Location: \`${f.filePath.replace(/`/g, "")}:${f.lineStart}${f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}\``);
      out.push(`- Category: ${inline(f.category)} · Confidence: ${Math.round(f.confidence * 100)}% · Status: ${STATUS_LABEL[f.status]}`);
      if (f.verification === "downgraded") out.push("- Note: this finding pointed outside the diff, so it was moved to the nearest changed line and lowered one level.");
      out.push("", f.description.trim(), "");
      if (f.whyItMatters.trim()) out.push(`**Why it matters:** ${f.whyItMatters.trim()}`, "");
      if (f.suggestedFix.trim()) out.push(`**Suggested fix:** ${f.suggestedFix.trim()}`, "");
      if (f.codeExample?.trim()) out.push(fence(f.codeExample.trim()), "");
      if (f.note.trim()) out.push("**My note:**", "", ...f.note.trim().split("\n").map((l) => `> ${l}`), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** A safe download file name from a review title. */
export function exportFileName(title: string, createdAt: number): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "review";
  return `difflens-${slug}-${new Date(createdAt).toISOString().slice(0, 10)}.md`;
}
