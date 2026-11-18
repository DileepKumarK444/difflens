"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Columns2, Rows2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { openCountsByFile, stepFinding, type FindingView, type Status } from "@/lib/findings";
import type { FocusRequest, LineMarker } from "./diff-viewer";
import { FindingsPanel, useFindingFilters } from "./findings-panel";
import { PostDialog } from "./post-dialog";
import { ConfirmDialog, useReview } from "./review-panel";

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
  title?: string;
  author?: string | null;
  isDraft?: boolean;
  state?: string;
  reviewDecision?: string | null;
  url?: string;
  branches?: { head: string; base: string };
  saved?: { at: number; kind: "local" | "pr"; source: { type: string; repoId?: string; scope?: unknown; pr?: Record<string, unknown> } };
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

export type WorkspaceSource = { kind: "local"; repoId: string; scopeJson: string } | { kind: "pr"; prJson: string; host: string } | { kind: "saved"; reviewId: string };

function urlsFor(source: WorkspaceSource) {
  if (source.kind === "saved") {
    const id = encodeURIComponent(source.reviewId);
    return {
      key: `saved|${source.reviewId}`,
      diff: `/api/reviews/${id}/diff`,
      file: (path: string) => `/api/reviews/${id}/file?${new URLSearchParams({ path })}`,
      info: null,
      back: "/history",
    };
  }
  if (source.kind === "local") {
    const id = encodeURIComponent(source.repoId);
    return {
      key: `local|${source.repoId}|${source.scopeJson}`,
      diff: `/api/repos/${id}/diff?scope=${encodeURIComponent(source.scopeJson)}`,
      file: (path: string, oldPath: string | null) => {
        const qs = new URLSearchParams({ scope: source.scopeJson, path });
        if (oldPath) qs.set("oldPath", oldPath);
        return `/api/repos/${id}/file?${qs}`;
      },
      info: `/api/repos/${id}/info`,
      back: `/reviews/new?repo=${id}`,
    };
  }
  return {
    key: `pr|${source.prJson}`,
    diff: `/api/pr/diff?pr=${encodeURIComponent(source.prJson)}`,
    file: (path: string, oldPath: string | null) => {
      const qs = new URLSearchParams({ pr: source.prJson, path });
      if (oldPath) qs.set("oldPath", oldPath);
      return `/api/pr/file?${qs}`;
    },
    info: null,
    back: "/reviews/new",
  };
}

/** Link back to the live diff a saved review was made from, when it can be rebuilt. */
function liveHref(saved: NonNullable<DiffResponse["saved"]>): string | null {
  const src = saved.source;
  if (src.type === "local" && src.repoId && src.scope) return `/workspace?repo=${encodeURIComponent(src.repoId)}&scope=${encodeURIComponent(JSON.stringify(src.scope))}`;
  if (src.type === "pr" && src.pr) {
    const { host, owner, repo, number, account } = src.pr as Record<string, unknown>;
    return `/workspace?pr=${encodeURIComponent(JSON.stringify({ host, owner, repo, number, ...(account !== undefined ? { account } : {}) }))}`;
  }
  return null;
}

export function Workspace({ source, initialReviewId }: { source: WorkspaceSource; initialReviewId?: string }) {
  const urls = useMemo(() => urlsFor(source), [source]);
  const scopeJson = urls.key;
  const reviewBody = useMemo(
    () =>
      source.kind === "local"
        ? { type: "local", repoId: source.repoId, scope: JSON.parse(source.scopeJson) }
        : source.kind === "pr"
          ? { type: "pr", pr: JSON.parse(source.prJson) }
          : null,
    [source],
  );
  const rv = useReview(reviewBody, source.kind === "saved" ? source.reviewId : initialReviewId);
  const [postIds, setPostIds] = useState<Set<string>>(new Set());
  const [suggestIds, setSuggestIds] = useState<Set<string>>(new Set());
  const [postOpen, setPostOpen] = useState(false);
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const reviewKind = rv.phase.kind === "done" ? rv.phase.data.review.kind : null;
  // Stable arrays: the post dialog fetches its preview when these change, and must not refetch (and lose edits) on every render.
  const postList = useMemo(() => [...postIds], [postIds]);
  const suggestList = useMemo(() => [...suggestIds].filter((i) => postIds.has(i)), [suggestIds, postIds]);
  const findings = useMemo<FindingView[]>(() => (rv.phase.kind === "done" ? rv.phase.data.findings : []), [rv.phase]);
  const { filters, setFilters, visible } = useFindingFilters(findings);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nonce = useRef(0);
  const reviewId = rv.phase.kind === "running" ? rv.phase.id : rv.phase.kind === "done" ? rv.phase.data.review.id : null;

  // Keep the review id in the address bar so a reload brings the findings back.
  useEffect(() => {
    if (!reviewId || source.kind === "saved") return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("review") !== reviewId) {
      u.searchParams.set("review", reviewId);
      window.history.replaceState(null, "", u);
    }
  }, [reviewId, source.kind]);
  const [showFindings, setShowFindings] = useState(false);
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
    Promise.all([
      fetch(urls.diff).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn’t load the diff");
        return d as DiffResponse;
      }),
      urls.info
        ? fetch(urls.info)
            .then((r) => r.json())
            .then((d: { repo?: { name: string } }) => d.repo?.name ?? "")
            .catch(() => "")
        : Promise.resolve(""),
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
  }, [urls]);

  const file = diff?.files[selected] ?? null;
  const fileKey = file ? `${scopeJson}|${file.path}|${file.oldPath ?? ""}` : "";

  useEffect(() => {
    if (!file || file.binary) return;
    let alive = true;
    fetch(urls.file(file.path, file.oldPath))
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
  }, [urls, file, fileKey]);

  const move = useCallback(
    (delta: number) => {
      if (!diff || diff.files.length === 0) return;
      setSelected((s) => Math.min(diff.files.length - 1, Math.max(0, s + delta)));
    },
    [diff],
  );

  const jumpTo = useCallback(
    (f: FindingView) => {
      const i = diff?.files.findIndex((x) => x.path === f.filePath) ?? -1;
      if (i < 0) return;
      setSelected(i);
      setActiveId(f.id);
      setShowFindings(true);
      setFocus({ nonce: ++nonce.current, line: f.lineStart, side: diff!.files[i].status === "deleted" ? "original" : "modified" });
    },
    [diff],
  );

  const setStatus = useCallback(
    async (id: string, status: Status) => {
      try {
        const r = await apiFetch(`/api/findings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
        if (r.ok) rv.updateFinding(id, { status });
      } catch {
        /* the card shows its own error when you use its buttons */
      }
    },
    [rv],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.closest(".monaco-editor"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") move(1);
      else if (e.key === "k") move(-1);
      else if (e.key === "]" || e.key === "[") {
        const next = stepFinding(visible, activeId, e.key === "]" ? 1 : -1);
        if (next) {
          e.preventDefault();
          jumpTo(next);
        }
      } else if ((e.key === "r" || e.key === "i" || e.key === "o") && activeId) {
        e.preventDefault();
        void setStatus(activeId, e.key === "r" ? "resolved" : e.key === "i" ? "ignored" : "open");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, visible, activeId, jumpTo, setStatus]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [selected, diff]);

  const markers = useMemo<LineMarker[]>(
    () =>
      file
        ? findings
            .filter((f) => f.filePath === file.path && f.status === "open")
            .map((f) => ({ id: f.id, title: f.title, severity: f.severity, lineStart: f.lineStart, lineEnd: f.lineEnd, side: file.status === "deleted" ? "original" : "modified" }))
        : [],
    [findings, file],
  );
  const fileBadges = useMemo(() => openCountsByFile(findings), [findings]);
  const onFocused = useCallback((n: number) => setFocus((f) => (f && f.nonce === n ? null : f)), []);
  const onMarkerClick = useCallback(
    (id: string) => {
      setActiveId(id);
      setShowFindings(true);
    },
    [],
  );
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
        <Link href={urls.back} className="mt-3 inline-block text-sm text-muted-foreground underline">
          Back to new review
        </Link>
      </div>
    );
  }
  if (!diff) return <p className="text-sm text-muted-foreground">Loading diff…</p>;

  return (
    <div className="absolute inset-0 flex min-w-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
        <Link href={urls.back} aria-label="Back" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <span className="font-medium">{source.kind === "local" ? repoName || "Repository" : source.kind === "saved" ? "Saved review" : diff.label}</span>
        {source.kind === "pr" ? (
          <>
            <span className="max-w-[28rem] truncate text-muted-foreground" title={diff.title}>
              {diff.title}
            </span>
            {diff.author ? <span className="text-muted-foreground">by {diff.author}</span> : null}
            {diff.isDraft ? <Badge variant="secondary">draft</Badge> : null}
            {diff.reviewDecision ? <Badge variant="outline">{diff.reviewDecision.replaceAll("_", " ").toLowerCase()}</Badge> : null}
            {diff.url && diff.url.startsWith(`https://${source.host}/`) ? (
              <a href={diff.url} target="_blank" rel="noreferrer noopener" className="text-xs text-muted-foreground underline">
                Open on GitHub
              </a>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">{diff.label}</span>
        )}
        {source.kind === "saved" && diff.saved ? (
          <>
            <Badge variant="secondary">saved {new Date(diff.saved.at).toLocaleDateString()}</Badge>
            {liveHref(diff.saved) ? (
              <Link href={liveHref(diff.saved)!} className="text-xs text-muted-foreground underline">
                Open the live diff
              </Link>
            ) : null}
          </>
        ) : null}
        <Badge variant="outline">{diff.totals.files} files</Badge>
        <span className="text-emerald-400">+{diff.totals.additions}</span>
        <span className="text-red-400">−{diff.totals.deletions}</span>
        {source.kind === "saved" ? (
          <span className="ml-auto" />
        ) : (
        <Button
          size="sm"
          className="ml-auto"
          disabled={rv.phase.kind === "starting" || rv.phase.kind === "running" || diff.files.length === 0}
          onClick={() => {
            setShowFindings(true);
            rv.start();
          }}
        >
          {rv.phase.kind === "running" ? "Reviewing…" : rv.phase.kind === "done" ? "Run again" : "Run review"}
        </Button>
        )}
        <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setShowFindings((v) => !v)} aria-pressed={showFindings}>
          Findings{rv.phase.kind === "done" ? ` (${rv.phase.data.findings.length})` : ""}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSideBySide((v) => !v)} aria-label={sideBySide ? "Switch to inline view" : "Switch to side-by-side view"}>
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
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(160px,240px)_minmax(0,1fr)] xl:grid-cols-[minmax(180px,260px)_minmax(0,1fr)_minmax(280px,340px)]">
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
                    {fileBadges.get(f.path) ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 text-[11px] font-medium",
                          fileBadges.get(f.path)!.worst === "Critical" || fileBadges.get(f.path)!.worst === "High" ? "bg-red-500/25 text-red-200" : fileBadges.get(f.path)!.worst === "Medium" ? "bg-amber-500/25 text-amber-200" : "bg-sky-500/25 text-sky-200",
                        )}
                        title={`${fileBadges.get(f.path)!.open} open finding${fileBadges.get(f.path)!.open === 1 ? "" : "s"}`}
                      >
                        {fileBadges.get(f.path)!.open}
                      </span>
                    ) : null}
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
                <DiffViewer path={file.path} original={current.original ?? ""} modified={current.modified ?? ""} sideBySide={sideBySide} collapse={source.kind === "saved"} markers={markers} activeId={activeId} focus={focus} onFocused={onFocused} onMarkerClick={onMarkerClick} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Loading file…</p>
              )}
            </div>
          </section>

          <aside
            aria-label="Findings"
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto overflow-x-hidden break-words border-l border-border bg-background p-4",
              showFindings ? "absolute inset-y-0 right-0 z-10 w-[min(26rem,100%)] xl:static xl:w-auto" : "hidden xl:block",
            )}
          >
            <h2 className="mb-3 text-sm font-medium">Findings{findings.length ? ` (${findings.length})` : ""}</h2>
            <FindingsPanel
              phase={rv.phase}
              activeId={activeId}
              onSelect={(f) => setActiveId(f.id)}
              onJump={jumpTo}
              onUpdate={rv.updateFinding}
              filters={filters}
              setFilters={setFilters}
              visible={visible}
              reviewId={reviewId}
              reviewKind={reviewKind}
              repoName={repoName || undefined}
              postIds={postIds}
              suggestIds={suggestIds}
              onTogglePost={(id) => setPostIds((p) => toggle(p, id))}
              onToggleSuggest={(id) => setSuggestIds((p) => toggle(p, id))}
              onOpenPost={() => setPostOpen(true)}
            />
          </aside>
        </div>
      )}
      {postOpen && reviewId ? (
        <PostDialog
          reviewId={reviewId}
          ids={postList}
          suggestionIds={suggestList}
          onClose={() => setPostOpen(false)}
          onPosted={(ids) => {
            ids.forEach((i) => rv.updateFinding(i, { postedAt: Date.now() }));
            setPostIds(new Set());
            setSuggestIds(new Set());
          }}
        />
      ) : null}
      {rv.phase.kind === "confirm" ? <ConfirmDialog summary={rv.phase.summary} onSend={rv.confirm} onCancel={rv.cancelConfirm} /> : null}
    </div>
  );
}
