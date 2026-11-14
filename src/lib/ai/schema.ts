import { z } from "zod";

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CATEGORIES = ["bug", "security", "data-loss", "concurrency", "resource-handling", "test-gap", "regression", "performance", "maintainability", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const severityRank = (s: Severity): number => SEVERITIES.length - SEVERITIES.indexOf(s); // Critical = 5
export const lowerSeverity = (s: Severity): Severity => SEVERITIES[Math.min(SEVERITIES.length - 1, SEVERITIES.indexOf(s) + 1)];

const SEV_ALIASES: Record<string, Severity> = {
  critical: "Critical", blocker: "Critical", high: "High", major: "High", medium: "Medium", moderate: "Medium",
  low: "Low", minor: "Low", informational: "Informational", info: "Informational", nit: "Informational", note: "Informational",
};
const CAT_ALIASES: Record<string, Category> = {
  bug: "bug", bugs: "bug", correctness: "bug", logic: "bug", security: "security", vulnerability: "security",
  "data-loss": "data-loss", dataloss: "data-loss", "data loss": "data-loss", concurrency: "concurrency", race: "concurrency", "race-condition": "concurrency",
  "resource-handling": "resource-handling", resource: "resource-handling", resources: "resource-handling", leak: "resource-handling",
  "test-gap": "test-gap", tests: "test-gap", test: "test-gap", testing: "test-gap", "missing-tests": "test-gap",
  regression: "regression", performance: "performance", perf: "performance", maintainability: "maintainability", style: "maintainability", other: "other",
};

const severity = z.preprocess((v) => (typeof v === "string" ? (SEV_ALIASES[v.trim().toLowerCase()] ?? v) : v), z.enum(SEVERITIES));
const category = z.preprocess((v) => (typeof v === "string" ? (CAT_ALIASES[v.trim().toLowerCase().replace(/\s+/g, "-")] ?? "other") : "other"), z.enum(CATEGORIES));
// Accept 0-1 or a percentage (0-100).
const confidence = z.preprocess((v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v), z.number().min(0).max(1));
const line = z.preprocess((v) => (typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10) : v), z.number().int().min(1).max(10_000_000));

/** One finding exactly as the model must return it (and as stored). */
export const RawFinding = z.object({
  id: z.string().max(100).optional().default(""),
  title: z.string().min(1).max(300),
  category,
  severity,
  filePath: z.string().min(1).max(1000),
  lineStart: line,
  lineEnd: line,
  description: z.string().min(1).max(6000),
  whyItMatters: z.string().max(4000).default(""),
  suggestedFix: z.string().max(4000).default(""),
  codeExample: z.string().max(6000).nullable().optional().default(null),
  confidence,
});
export type RawFinding = z.infer<typeof RawFinding>;

export const ReviewOutput = z.object({ findings: z.array(RawFinding).max(200) });
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export class OutputError extends Error {}

/** Pull a JSON object out of model text: handles ```json fences and chatter around the object. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a === -1 || b <= a) throw new OutputError("The reply didn’t contain a JSON object");
    t = t.slice(a, b + 1);
  }
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new OutputError(`The reply wasn’t valid JSON (${(e as Error).message.slice(0, 120)})`);
  }
}

/** Parse and validate model output. Throws OutputError with a short, model-readable reason. */
export function parseReviewOutput(text: string): ReviewOutput {
  const json = extractJson(text);
  const r = ReviewOutput.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new OutputError(`Schema mismatch at ${issue.path.join(".") || "root"}: ${issue.message}`.slice(0, 300));
  }
  return r.data;
}
