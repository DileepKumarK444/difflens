"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, GitCompare, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  kind: "local" | "pr";
  title: string;
  provider: string;
  model: string | null;
  status: "pending" | "running" | "complete" | "partial" | "failed";
  createdAt: number;
  total: number;
  open: number;
  critical: number;
  high: number;
  posted: number;
}

const STATUS_BADGE: Record<Row["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "pending", variant: "outline" },
  running: { label: "running", variant: "outline" },
  complete: { label: "complete", variant: "secondary" },
  partial: { label: "partial", variant: "outline" },
  failed: { label: "failed", variant: "destructive" },
};

const selectCls = "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function HistoryPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = (await (await fetch("/api/reviews")).json()) as { reviews: Row[] };
      setRows(d.reviews);
    } catch {
      setError("Couldn’t load your reviews. Reload the page.");
    }
  }
  useEffect(() => {
    let alive = true;
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((d: { reviews: Row[] }) => alive && setRows(d.reviews))
      .catch(() => alive && setError("Couldn’t load your reviews. Reload the page."));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (kind === "all" || r.kind === kind) && (status === "all" || r.status === status) && (!needle || r.title.toLowerCase().includes(needle)));
  }, [rows, q, kind, status]);

  async function remove(r: Row) {
    if (!window.confirm(`Delete this review?\n\n${r.title}\n\nIts findings, your notes and the saved diff are deleted. This can’t be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reviews/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      if (!res.ok) setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn’t delete");
      else {
        setPicked((p) => p.filter((x) => x !== r.id));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));

  if (rows === null) return <p className="text-sm text-muted-foreground">{error ?? "Loading reviews…"}</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">No reviews yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Run a review from New review and it will be saved here.</p>
        <Link href="/reviews/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
          New review
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input aria-label="Search reviews" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" className="max-w-xs" />
        <select aria-label="Source" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All sources</option>
          <option value="pr">Pull requests</option>
          <option value="local">Local changes</option>
        </select>
        <select aria-label="Status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Any status</option>
          <option value="complete">Complete</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </select>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{picked.length === 2 ? "Ready to compare" : "Tick two reviews to compare them"}</span>
          {picked.length === 2 ? (
            <Link href={`/history/compare?a=${encodeURIComponent(picked[0])}&b=${encodeURIComponent(picked[1])}`} className={buttonVariants({ size: "sm" })}>
              <GitCompare className="size-4" aria-hidden /> Compare
            </Link>
          ) : null}
        </span>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No reviews match these filters.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {shown.map((r) => {
            const sb = STATUS_BADGE[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-sm">
                <input type="checkbox" aria-label={`Select ${r.title} to compare`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                <div className="min-w-0 flex-1 basis-72">
                  <Link href={`/workspace?saved=${encodeURIComponent(r.id)}`} className="block truncate font-medium hover:underline" title={r.title}>
                    {r.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()} · {r.provider}
                    {r.model ? ` (${r.model})` : ""}
                  </p>
                </div>
                <Badge variant="outline">{r.kind === "pr" ? "PR" : "Local"}</Badge>
                <Badge variant={sb.variant}>{sb.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {r.total} finding{r.total === 1 ? "" : "s"} · {r.open} open
                </span>
                {r.critical > 0 ? <Badge variant="destructive">{r.critical} critical</Badge> : null}
                {r.high > 0 ? <Badge variant="outline">{r.high} high</Badge> : null}
                {r.posted > 0 ? <Badge variant="secondary">{r.posted} posted</Badge> : null}
                <span className="flex items-center gap-1">
                  <Link href={`/workspace?saved=${encodeURIComponent(r.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Open
                  </Link>
                  <a href={`/api/reviews/${encodeURIComponent(r.id)}/export`} download className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Export ${r.title} as Markdown`} title="Export as Markdown">
                    <Download className="size-4" aria-hidden />
                  </a>
                  <Button size="sm" variant="ghost" disabled={busy} aria-label={`Delete ${r.title}`} onClick={() => void remove(r)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
