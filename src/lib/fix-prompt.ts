import { fence } from "@/lib/export-md";
import type { FindingView } from "@/lib/findings";

/**
 * A prompt you can paste into Claude Code, Copilot Chat or any editor assistant to fix findings.
 * It only describes the problems; DiffLens never edits your files.
 */
export function buildFixPrompt(findings: FindingView[], opts: { repoName?: string } = {}): string {
  const where = opts.repoName ? ` in the ${opts.repoName} repository` : "";
  const out: string[] = [
    `Please fix the following ${findings.length === 1 ? "issue" : `${findings.length} issues`}${where}.`,
    "Make the smallest change that fixes each one, keep all other behaviour the same, and add or update a test when the logic is risky. Look at the code first to confirm each issue is real; if one is a false alarm, say so instead of changing anything.",
    "",
  ];
  findings.forEach((f, i) => {
    out.push(`## ${i + 1}. [${f.severity}] ${f.title.replace(/\s+/g, " ")}`);
    out.push(`Where: ${f.filePath}:${f.lineStart}${f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}`);
    out.push(`Problem: ${f.description.trim()}`);
    if (f.whyItMatters.trim()) out.push(`Why it matters: ${f.whyItMatters.trim()}`);
    if (f.suggestedFix.trim()) out.push(`Suggested fix: ${f.suggestedFix.trim()}`);
    if (f.codeExample?.trim()) out.push("Example (may need adapting):", fence(f.codeExample.trim()));
    if (f.note.trim()) out.push(`My note: ${f.note.trim()}`);
    out.push("");
  });
  return out.join("\n").trimEnd() + "\n";
}
