"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUSES, countBy, defaultFilters, filterFindings, type FindingView, type Filters, type Severity, type Status } from "@/lib/findings";
import { cn } from "@/lib/utils";
import type { Phase } from "./review-panel";

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];
const SEV_TEXT: Record<Severity, string> = {
  Critical: "text-red-300 border-red-500/60",
  High: "text-orange-300 border-orange-500/60",
  Medium: "text-amber-300 border-amber-500/60",
  Low: "text-sky-300 border-sky-500/60",
  Informational: "text-muted-foreground border-border",
};
const SEV_CHIP: Record<Severity, string> = {
  Critical: "bg-red-500/20 text-red-200 border-red-500/60",
  High: "bg-orange-500/20 text-orange-200 border-orange-500/60",
  Medium: "bg-amber-500/20 text-amber-200 border-amber-500/60",
  Low: "bg-sky-500/20 text-sky-200 border-sky-500/60",
  Informational: "bg-muted text-foreground border-border",
};
const STATUS_LABEL: Record<Status, string> = { open: "Open", resolved: "Resolved", ignored: "Ignored" };

export function FindingsPanel({
  phase,
  activeId,
  onSelect,
  onJump,
  onUpdate,
  filters,
  setFilters,
  visible,
}: {
  phase: Phase;
  activeId: string | null;
  onSelect: (f: FindingView) => void;
  onJump: (f: FindingView) => void;
  onUpdate: (id: string, patch: Partial<Pick<FindingView, "status" | "note">>) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  visible: FindingView[];
}) {
  if (phase.kind === "idle") return <p className="text-sm text-muted-foreground">No review has been run on this diff yet. Use Run review above.</p>;
  if (phase.kind === "starting") return <p className="text-sm text-muted-foreground">Preparing the review…</p>;
  if (phase.kind === "confirm") return <p className="text-sm text-muted-foreground">Waiting for your confirmation to send.</p>;
  if (phase.kind === "running") {
    const p = phase.progress;
    return (
      <div role="status" className="text-sm">
        <p className="font-medium">Reviewing…</p>
        <p className="mt-1 text-muted-foreground">{p && p.total > 0 ? `Part ${Math.min(p.done + 1, p.total)} of ${p.total}${p.failed ? `, ${p.failed} failed` : ""}` : "Working"}</p>
        {p && p.total > 0 ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted" aria-hidden>
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} />
          </div>
        ) : null}
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {phase.message}
      </p>
    );
  }

  const { review, findings } = phase.data;
  const m = review.meta;
  const byStatus = countBy(findings, (f) => f.status);
  const bySev = countBy(findings.filter((f) => filters.status === "all" || f.status === filters.status), (f) => f.severity);
  const categories = [...new Set(findings.map((f) => f.category))].sort();
  const filtersOn = filters.search.trim() !== "" || filters.category !== "all" || filters.severities.size < SEVERITIES.length;

  return (
    <div className="grid gap-3 text-sm">
      {review.status === "partial" ? <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">Partial review. {review.partialReason}</p> : null}
      {m && m.skipped.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {m.skipped.length} file{m.skipped.length === 1 ? "" : "s"} not reviewed
          </summary>
          <ul className="mt-1 space-y-0.5">
            {m.skipped.map((s, i) => (
              <li key={i} className="truncate" title={`${s.path}: ${s.reason}`}>
                {s.path} <span className="opacity-70">({s.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {m && m.dropped.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {m.dropped.length} unverifiable finding{m.dropped.length === 1 ? "" : "s"} dropped
          </summary>
          <ul className="mt-1 space-y-0.5">
            {m.dropped.map((d, i) => (
              <li key={i}>
                {d.title} <span className="opacity-70">({d.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {m && m.errors.length > 0 ? <p className="text-xs text-amber-300">{m.errors.join(" ")}</p> : null}

      {findings.length > 0 ? (
        <div className="grid gap-2 rounded-lg border border-border p-2">
          <div role="group" aria-label="Status" className="flex gap-1">
            {(["all", ...STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filters.status === s}
                onClick={() => setFilters({ ...filters, status: s })}
                className={cn("flex-1 rounded-md border px-2 py-1 text-xs", filters.status === s ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]} {s === "all" ? findings.length : (byStatus[s] ?? 0)}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Severity" className="flex flex-wrap gap-1">
            {SEVERITIES.map((sev) => {
              const on = filters.severities.has(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(filters.severities);
                    if (on) next.delete(sev);
                    else next.add(sev);
                    setFilters({ ...filters, severities: next });
                  }}
                  className={cn("rounded-full border px-2 py-0.5 text-xs", on ? SEV_CHIP[sev] : "border-border text-muted-foreground opacity-60")}
                >
                  {sev} {bySev[sev] ?? 0}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Category"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input aria-label="Search findings" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Search…" className="h-8 text-xs" />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {visible.length} of {findings.length} · ] next, [ previous · r resolve, i ignore, o reopen
            </span>
            {filtersOn || filters.status !== "open" ? (
              <button type="button" className="underline" onClick={() => setFilters(defaultFilters())}>
                Reset
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {findings.length === 0 ? <p className="text-muted-foreground">Nothing worth reporting was found in the parts that were reviewed.</p> : null}
      {findings.length > 0 && visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground">
          <p>No findings match these filters.</p>
          <button type="button" className="mt-1 underline" onClick={() => setFilters({ ...defaultFilters(), status: "all" })}>
            Show all findings
          </button>
        </div>
      ) : null}

      <ul className="grid gap-2">
        {visible.map((f) => (
          <FindingCard key={f.id} f={f} active={f.id === activeId} onSelect={() => onSelect(f)} onJump={() => onJump(f)} onUpdate={onUpdate} />
        ))}
      </ul>
    </div>
  );
}

function FindingCard({ f, active, onSelect, onJump, onUpdate }: { f: FindingView; active: boolean; onSelect: () => void; onJump: () => void; onUpdate: (id: string, p: Partial<Pick<FindingView, "status" | "note">>) => void }) {
  const [note, setNote] = useState(f.note);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(note);
  const ref = useRef<HTMLLIElement>(null);

  // The card is keyed by finding id and is the only thing that edits its note, so the local text stays authoritative while you type.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function patch(p: Partial<Pick<FindingView, "status" | "note">>) {
    setErr(null);
    try {
      const r = await apiFetch(`/api/findings/${encodeURIComponent(f.id)}`, { method: "PATCH", body: JSON.stringify(p) });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn’t save");
      onUpdate(f.id, p);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  }

  function saveNote(value: string) {
    if (value === f.note) return setSaving("idle");
    setSaving("saving");
    void patch({ note: value }).then((ok) => setSaving(ok ? "saved" : "error"));
  }

  return (
    <li
      ref={ref}
      data-finding-id={f.id}
      onClick={onSelect}
      className={cn("rounded-lg border bg-card p-3", SEV_TEXT[f.severity], active && "ring-2 ring-primary", f.status !== "open" && "opacity-70")}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{f.severity}</span>
        <Badge variant="outline">{f.category}</Badge>
        <span className="text-muted-foreground">{Math.round(f.confidence * 100)}% confident</span>
        {f.verification === "downgraded" ? (
          <Badge variant="secondary" title="This finding pointed outside the diff, so it was moved to the nearest changed line and lowered one level.">
            adjusted
          </Badge>
        ) : null}
        {f.status !== "open" ? <Badge variant="secondary">{STATUS_LABEL[f.status]}</Badge> : null}
      </div>
      <p className="mt-1 font-medium text-foreground">{f.title}</p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
          onJump();
        }}
        className="mt-0.5 block max-w-full truncate text-left font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
        title="Show in the diff"
      >
        {f.filePath}:{f.lineStart}
        {f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}
      </button>
      <p className="mt-2 whitespace-pre-wrap text-foreground">{f.description}</p>
      <details className="mt-2 text-muted-foreground" open={active}>
        <summary className="cursor-pointer text-xs">Why it matters, fix and example</summary>
        {f.whyItMatters ? (
          <p className="mt-2 whitespace-pre-wrap">
            <span className="font-medium text-foreground">Why it matters: </span>
            {f.whyItMatters}
          </p>
        ) : null}
        {f.suggestedFix ? (
          <p className="mt-2 whitespace-pre-wrap">
            <span className="font-medium text-foreground">Suggested fix: </span>
            {f.suggestedFix}
          </p>
        ) : null}
        {f.codeExample ? <pre className="mt-2 overflow-auto rounded bg-muted p-2 font-mono text-xs text-foreground">{f.codeExample}</pre> : null}
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {STATUSES.map((s) => (
          <Button
            key={s}
            size="xs"
            variant={f.status === s ? "default" : "outline"}
            aria-pressed={f.status === s}
            onClick={() => void patch({ status: s }).then((ok) => ok && undefined)}
          >
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <label className="sr-only" htmlFor={`note-${f.id}`}>
          Your note
        </label>
        <textarea
          id={`note-${f.id}`}
          value={note}
          rows={note ? 3 : 1}
          maxLength={4000}
          placeholder="Add a note for yourself…"
          onChange={(e) => {
            setNote(e.target.value);
            latest.current = e.target.value;
            setSaving("idle");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => saveNote(latest.current), 700);
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            saveNote(latest.current);
          }}
          className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="h-4 text-[11px] text-muted-foreground" aria-live="polite">
          {err ? <span className="text-red-300">{err}</span> : saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}
        </p>
      </div>
    </li>
  );
}

export function useFindingFilters(findings: FindingView[]) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const visible = useMemo(() => filterFindings(findings, filters), [findings, filters]);
  return { filters, setFilters, visible };
}
