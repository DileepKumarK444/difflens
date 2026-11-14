export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffLine {
  t: "+" | "-" | " ";
  /** 1-based line number on the old side (undefined for added lines). */
  old?: number;
  /** 1-based line number on the new side (undefined for removed lines). */
  new?: number;
  /** The line's text without the leading +, - or space. */
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  /** The file's own slice of the unified diff, used later to build review prompts. */
  patch: string;
}

function unquote(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p
      .slice(1, -1)
      .replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\(["\\])/g, "$1")
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n");
  }
  return p;
}

function stripPrefix(p: string): string {
  return /^[ab]\//.test(p) ? p.slice(2) : p;
}

/** Split "a/X b/X" (identical names) from a `diff --git` header; null when it is ambiguous. */
function pathFromHeader(rest: string): string | null {
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && n > 0 && rest.startsWith("a/") && rest.slice(2 + n, 3 + n) === " " && rest.slice(3 + n, 5 + n) === "b/") {
    const a = rest.slice(2, 2 + n);
    if (a === rest.slice(5 + n)) return a;
  }
  return null;
}

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = text.split("\n");
  let cur: FileDiff | null = null;
  let patchStart = 0;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let headerPath: string | null = null;

  const finish = (end: number) => {
    if (!cur) return;
    cur.patch = lines.slice(patchStart, end).join("\n") + "\n";
    if (renameFrom && renameTo) {
      cur.oldPath = renameFrom;
      cur.path = renameTo;
      cur.status = "renamed";
    }
    files.push(cur);
    cur = null;
    hunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      finish(i);
      patchStart = i;
      renameFrom = renameTo = null;
      headerPath = pathFromHeader(line.slice(11));
      cur = { path: headerPath ?? "", oldPath: null, status: "modified", binary: false, additions: 0, deletions: 0, hunks: [], patch: "" };
      continue;
    }
    if (!cur) continue;
    const c: FileDiff = cur;
    if (hunk === null) {
      if (line.startsWith("new file mode")) c.status = "added";
      else if (line.startsWith("deleted file mode")) c.status = "deleted";
      else if (line.startsWith("rename from ")) renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) renameTo = unquote(line.slice(10));
      else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) c.binary = true;
      else if (line.startsWith("+++ ")) {
        const p = unquote(line.slice(4));
        if (p !== "/dev/null") c.path = stripPrefix(p);
      } else if (line.startsWith("--- ")) {
        const p = unquote(line.slice(4));
        if (p !== "/dev/null" && !c.path) c.path = stripPrefix(p);
      }
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      hunk = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      c.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    const h: Hunk = hunk;
    if (line.startsWith("+")) {
      h.lines.push({ t: "+", new: newNo++, text: line.slice(1) });
      c.additions++;
    } else if (line.startsWith("-")) {
      h.lines.push({ t: "-", old: oldNo++, text: line.slice(1) });
      c.deletions++;
    } else if (line.startsWith(" ")) {
      h.lines.push({ t: " ", old: oldNo++, new: newNo++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and blank trailing lines are ignored.
  }
  finish(lines[lines.length - 1] === "" ? lines.length - 1 : lines.length);

  for (const f of files) {
    if (!f.path) f.path = f.oldPath ?? "(unknown)";
  }
  return files;
}

/**
 * Rebuild the two sides of a file from its diff alone, for reviews opened from history.
 * Lines the diff doesn't show are blank, and every shown line sits at its real line number,
 * so findings (which cite real line numbers) still line up.
 */
export function reconstructFromHunks(f: FileDiff): { original: string; modified: string } {
  const orig: string[] = [];
  const mod: string[] = [];
  for (const h of f.hunks)
    for (const l of h.lines) {
      if (l.old !== undefined) orig[l.old - 1] = l.text;
      if (l.new !== undefined) mod[l.new - 1] = l.text;
    }
  const fill = (a: string[]) => Array.from({ length: a.length }, (_, i) => a[i] ?? "").join("\n");
  return { original: fill(orig), modified: fill(mod) };
}
