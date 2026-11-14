import { parseUnifiedDiff, type FileDiff } from "@/lib/git/diff-parse";

export const MAX_CHUNK_CHARS = 48_000;
export const DEFAULT_MAX_CHUNKS = 12;

const GENERATED = [
  /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)Cargo\.lock$/, /(^|\/)poetry\.lock$/, /(^|\/)composer\.lock$/, /(^|\/)go\.sum$/,
  /\.min\.(js|css)$/, /\.map$/, /(^|\/)(dist|build|\.next|node_modules|vendor)\//, /\.snap$/, /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz)$/i,
];
export function skipReason(f: FileDiff): string | null {
  if (f.binary) return "binary file";
  if (GENERATED.some((r) => r.test(f.path))) return "generated or lock file";
  return null;
}

/**
 * Render one file's patch so every line carries its new-side line number ("  42| +code"),
 * which lets the model cite exact lines. Removed lines are marked "   -|".
 */
export function annotatePatch(f: FileDiff): string {
  const out: string[] = [`=== FILE: ${f.path}${f.oldPath ? ` (renamed from ${f.oldPath})` : ""} [${f.status}]`];
  let newNo = 0;
  let inHunk = false;
  for (const raw of f.patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) {
      newNo = parseInt(h[2], 10);
      inHunk = true;
      out.push(`@@ new line ${newNo}${h[3]}`);
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) out.push(`${String(newNo++).padStart(6)}| ${raw}`);
    else if (raw.startsWith("-")) out.push(`     -| ${raw}`);
    else if (raw.startsWith(" ")) out.push(`${String(newNo++).padStart(6)}| ${raw}`);
    else if (raw.startsWith("\\")) out.push(`      | ${raw}`);
  }
  return out.join("\n") + "\n";
}

export interface Chunk {
  index: number;
  files: string[];
  text: string;
}
export interface ChunkPlan {
  chunks: Chunk[];
  skipped: { path: string; reason: string }[];
  partial: boolean;
  partialReason: string | null;
}

/** Split an over-long file into pieces at hunk boundaries (a single huge hunk is truncated). */
function splitLarge(f: FileDiff, budget: number): string[] {
  const full = annotatePatch(f);
  if (full.length <= budget) return [full];
  const header = full.split("\n")[0] + "\n";
  const hunks = full.split(/\n(?=@@ new line )/).slice(1).map((h) => h + "\n");
  const pieces: string[] = [];
  let cur = header;
  for (const h of hunks) {
    if (header.length + h.length > budget) {
      if (cur.length > header.length) pieces.push(cur);
      pieces.push(header + h.slice(0, budget - header.length - 80) + "\n[... hunk truncated: too large ...]\n");
      cur = header;
    } else if (cur.length + h.length > budget) {
      pieces.push(cur);
      cur = header + h;
    } else cur += h;
  }
  if (cur.length > header.length) pieces.push(cur);
  return pieces;
}

export function planChunks(patch: string, opts: { maxChunks?: number; maxChars?: number } = {}): ChunkPlan & { files: FileDiff[] } {
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const budget = opts.maxChars ?? MAX_CHUNK_CHARS;
  const files = parseUnifiedDiff(patch);
  const skipped: ChunkPlan["skipped"] = [];
  const all: { text: string; path: string }[] = [];
  for (const f of files) {
    const why = skipReason(f);
    if (why) {
      skipped.push({ path: f.path, reason: why });
      continue;
    }
    if (f.hunks.length === 0) {
      skipped.push({ path: f.path, reason: "no text changes (mode or rename only)" });
      continue;
    }
    for (const text of splitLarge(f, budget)) all.push({ text, path: f.path });
  }

  const chunks: Chunk[] = [];
  let cur: { files: Set<string>; text: string } | null = null;
  const dropped = new Set<string>();
  for (const piece of all) {
    if (!cur || cur.text.length + piece.text.length > budget) {
      if (chunks.length >= maxChunks) {
        dropped.add(piece.path);
        cur = null;
        continue;
      }
      cur = { files: new Set(), text: "" };
      chunks.push({ index: chunks.length, files: [], text: "" });
    }
    if (!cur) {
      dropped.add(piece.path);
      continue;
    }
    cur.files.add(piece.path);
    cur.text += piece.text + "\n";
    const c = chunks[chunks.length - 1];
    c.files = [...cur.files];
    c.text = cur.text;
  }
  // A file only partly covered (some pieces dropped) is still reported as skipped in part.
  const covered = new Set(chunks.flatMap((c) => c.files));
  for (const p of dropped) skipped.push({ path: p, reason: covered.has(p) ? "only part of this file fit the review limit" : `not reviewed: the ${maxChunks}-chunk limit was reached` });

  const limited = dropped.size > 0;
  return {
    chunks,
    skipped,
    files,
    partial: limited,
    partialReason: limited ? `Reviewed ${chunks.length} chunks (the limit); ${dropped.size} file${dropped.size === 1 ? "" : "s"} not fully covered.` : null,
  };
}
