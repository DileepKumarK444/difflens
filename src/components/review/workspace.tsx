"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Columns2, Rows2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DiffViewer = dynamic(() => import("./diff-viewer"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading editor…</p>,
});

interface FileEntry {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  additions: number;
  deletions: number;
}
interface DiffResponse {
  label: string;
  base: string | null;
  files: FileEntry[];
  skipped: { path: string; reason: string }[];
  totals: { files: number; additions: number; deletions: number };
}
interface Sides {
  original: string | null;
  modified: string | null;
  binary: boolean;
  tooLarge: boolean;
}

const STATUS_LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;
const STATUS_COLOR = { added: "text-emerald-400", modified: "text-amber-300", deleted: "text-red-400", renamed: "text-sky-400" } as const;

export function Workspace({ repoId, scopeJson }: { repoId: string; scopeJson: string }) {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [repoName, setRepoName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [sides, setSides] = useState<{ key: string; data: Sides } | null>(null);
  const [sideError, setSideError] = useState<{ key: string; msg: string } | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let alive = true;
    const q = encodeURIComponent(scopeJson);
    Promise.all([
      fetch(`/api/repos/${encodeURIComponent(repoId)}/diff?scope=${q}`).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn’t load the diff");
        return d as DiffResponse;
      }),
      fetch(`/api/repos/${encodeURIComponent(repoId)}/info`)
        .then((r) => r.json())
        .then((d: { repo?: { name: string } }) => d.repo?.name ?? "")
        .catch(() => ""),
    ])
      .then(([d, name]) => {
        if (!alive) return;
        setDiff(d);
        setRepoName(name);
        setSelected(0);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repoId, scopeJson]);

  const file = diff?.files[selected] ?? null;
  const fileKey = file ? `${scopeJson}|${file.path}|${file.oldPath ?? ""}` : "";

  useEffect(() => {
    if (!file || file.binary) return;
    let alive = true;
    const qs = new URLSearchParams({ scope: scopeJson, path: file.path });
    if (file.oldPath) qs.set("oldPath", file.oldPath);
    fetch(`/api/repos/${encodeURIComponent(repoId)}/file?${qs}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn’t load this file");
        return d as Sides;
      })
      .then((d) => alive && setSides({ key: fileKey, data: d }))
      .catch((e: Error) => alive && setSideError({ key: fileKey, msg: e.message }));
    return () => {
      alive = false;
    };
  }, [repoId, scopeJson, file, fileKey]);

  const move = useCallback(
    (delta: number) => {
      if (!diff || diff.files.length === 0) return;
      setSelected((s) => Math.min(diff.files.length - 1, Math.max(0, s + delta)));
    },
    [diff],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.closest(".monaco-editor"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") move(1);
      else if (e.key === "k") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [selected, diff]);

  const current = sides && sides.key === fileKey ? sides.data : null;
  const currentError = sideError && sideError.key === fileKey ? sideError.msg : null;
  const note = useMemo(() => {
    if (!file) return null;
    if (file.binary) return "Binary file, no text preview.";
    if (currentError) return currentError;
    if (current?.binary) return "Binary file, no text preview.";
    if (current?.tooLarge) return "This file is larger than 1 MB, so it isn’t shown.";
    return null;
  }, [file, current, currentError]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl">
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
        <Link href="/reviews/new" className="mt-3 inline-block text-sm text-muted-foreground underline">
          Back to new review
        </Link>
      </div>
    );
  }
  if (!diff) return <p className="text-sm text-muted-foreground">Loading diff…</p>;

  return (
    <div className="-m-6 flex h-[calc(100vh-37px)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
        <Link href="/reviews/new" aria-label="Back" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <span className="font-medium">{repoName || "Repository"}</span>
        <span className="text-muted-foreground">{diff.label}</span>
        <Badge variant="outline">{diff.totals.files} files</Badge>
        <span className="text-emerald-400">+{diff.totals.additions}</span>
        <span className="text-red-400">−{diff.totals.deletions}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSideBySide((v) => !v)} aria-label={sideBySide ? "Switch to inline view" : "Switch to side-by-side view"}>
          {sideBySide ? <Rows2 className="size-4" aria-hidden /> : <Columns2 className="size-4" aria-hidden />}
          {sideBySide ? "Inline" : "Side by side"}
        </Button>
      </header>

      {diff.files.length === 0 ? (
        <div className="m-auto text-center">
          <p className="text-sm font-medium">No changes in this scope</p>
          <p className="mt-1 text-sm text-muted-foreground">There is nothing to review here. Try another scope.</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_280px]">
          <nav aria-label="Changed files" className="flex min-h-0 flex-col border-r border-border">
            <p className="px-3 py-2 text-xs text-muted-foreground">CHANGED FILES · j / k to move</p>
            <ul ref={listRef} className="min-h-0 flex-1 overflow-auto">
              {diff.files.map((f, i) => (
                <li key={f.path + i}>
                  <button
                    type="button"
                    aria-current={i === selected ? "true" : undefined}
                    onClick={() => setSelected(i)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60",
                      i === selected && "border-l-2 border-primary bg-accent",
                    )}
                  >
                    <span className={cn("w-3 font-mono", STATUS_COLOR[f.status])}>{STATUS_LETTER[f.status]}</span>
                    <span className="min-w-0 flex-1 truncate" title={f.path}>
                      {f.path}
                    </span>
                    <span className="shrink-0 font-mono text-[11px]">
                      <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {diff.skipped.length > 0 ? (
              <details className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{diff.skipped.length} untracked skipped</summary>
                <ul className="mt-1 space-y-0.5">
                  {diff.skipped.map((s) => (
                    <li key={s.path} className="truncate" title={`${s.path}: ${s.reason}`}>
                      {s.path} <span className="opacity-70">({s.reason})</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </nav>

          <section aria-label="Diff" className="flex min-h-0 min-w-0 flex-col">
            {file ? (
              <p className="truncate border-b border-border px-3 py-1.5 font-mono text-xs">
                {file.oldPath ? `${file.oldPath} → ` : ""}
                {file.path}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              {note ? (
                <p className="p-4 text-sm text-muted-foreground">{note}</p>
              ) : current && file ? (
                <DiffViewer path={file.path} original={current.original ?? ""} modified={current.modified ?? ""} sideBySide={sideBySide} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Loading file…</p>
              )}
            </div>
          </section>

          <aside aria-label="Findings" className="hidden border-l border-border p-4 xl:block">
            <h2 className="text-sm font-medium">Findings</h2>
            <p className="mt-2 text-sm text-muted-foreground">No review has been run on this diff. Running AI reviews and showing findings here arrive in Phases 4 and 5.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
