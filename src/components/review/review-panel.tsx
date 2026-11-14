"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Summary {
  title: string;
  files: number;
  additions: number;
  deletions: number;
  bytes: number;
  provider: string;
  model: string | null;
  leavesMachine: boolean;
  destination: string;
  repoAccess: boolean;
  context: string;
  parts: number;
  limitWarning: string | null;
}

export interface FindingRow {
  id: string;
  title: string;
  category: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  filePath: string;
  lineStart: number;
  lineEnd: number;
  description: string;
  whyItMatters: string;
  suggestedFix: string;
  codeExample: string | null;
  confidence: number;
  verification: "exact" | "downgraded";
}

interface ReviewData {
  review: {
    id: string;
    status: "pending" | "running" | "complete" | "partial" | "failed";
    partialReason: string | null;
    errorMessage: string | null;
    provider: string;
    model: string | null;
    meta: {
      chunks: { total: number; done: number; failed: number };
      skipped: { path: string; reason: string }[];
      dropped: { title: string; filePath: string; reason: string }[];
      errors: string[];
      stats: { reported: number; verified: number; duplicates: number; belowMinSeverity: number };
      repaired: number;
      filesReviewed: number;
    } | null;
  };
  findings: FindingRow[];
  progress: { total: number; done: number; failed: number } | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "confirm"; summary: Summary }
  | { kind: "running"; id: string; progress: { total: number; done: number; failed: number } | null }
  | { kind: "done"; data: ReviewData }
  | { kind: "error"; message: string };

export function useReview(body: unknown) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const start = useCallback(
    async (confirmSend: boolean) => {
      setPhase({ kind: "starting" });
      try {
        const r = await apiFetch("/api/reviews", { method: "POST", body: JSON.stringify({ source: body, confirmSend }) });
        const d = await r.json();
        if (r.status === 409 && d.needsConfirmation) return setPhase({ kind: "confirm", summary: d.summary });
        if (!r.ok) return setPhase({ kind: "error", message: d.error ?? "Couldn’t start the review" });
        setPhase({ kind: "running", id: d.id, progress: { total: d.summary.parts, done: 0, failed: 0 } });
      } catch {
        setPhase({ kind: "error", message: "Couldn’t start the review" });
      }
    },
    [body],
  );

  const runningId = phase.kind === "running" ? phase.id : null;
  useEffect(() => {
    if (!runningId) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = (await (await fetch(`/api/reviews/${runningId}`)).json()) as ReviewData;
        if (!alive) return;
        if (d.review.status === "running") setPhase({ kind: "running", id: runningId, progress: d.progress });
        else if (d.review.status === "failed") setPhase({ kind: "error", message: d.review.errorMessage ?? "The review failed" });
        else setPhase({ kind: "done", data: d });
      } catch {
        /* keep polling */
      }
    };
    const t = setInterval(tick, 1500);
    void tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runningId]);

  return { phase, start: () => start(false), confirm: () => start(true), cancelConfirm: () => setPhase({ kind: "idle" }), reset: () => setPhase({ kind: "idle" }) };
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

export function ConfirmDialog({ summary, onSend, onCancel }: { summary: Summary; onSend: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="send-title"
      className="m-auto w-[min(32rem,92vw)] rounded-xl border border-border bg-popover p-5 text-sm text-popover-foreground backdrop:bg-black/60"
    >
      <h2 id="send-title" className="text-base font-medium">
        Send this code to {summary.destination}?
      </h2>
      <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Review of</dt>
        <dd className="break-words">{summary.title}</dd>
        <dt className="text-muted-foreground">Contents</dt>
        <dd>
          {summary.files} file{summary.files === 1 ? "" : "s"}, +{summary.additions} −{summary.deletions}, {kb(summary.bytes)} of diff, in {summary.parts} part{summary.parts === 1 ? "" : "s"}
        </dd>
        <dt className="text-muted-foreground">Provider</dt>
        <dd>
          {summary.provider}
          {summary.model ? ` (${summary.model})` : ""}
        </dd>
        <dt className="text-muted-foreground">Repo access</dt>
        <dd>{summary.repoAccess ? `Yes: it can read other files in the repository with read-only tools. ${summary.context}.` : `No. ${summary.context}.`}</dd>
      </dl>
      {summary.limitWarning ? <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">Partial review: {summary.limitWarning}</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">Once sent, it is handled under the provider’s terms. You can change when DiffLens asks in Settings.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSend}>Send and review</Button>
      </div>
    </dialog>
  );
}

const SEV: Record<FindingRow["severity"], string> = {
  Critical: "border-red-500/60 text-red-300",
  High: "border-orange-500/60 text-orange-300",
  Medium: "border-amber-500/60 text-amber-300",
  Low: "border-sky-500/60 text-sky-300",
  Informational: "border-border text-muted-foreground",
};

export function FindingsList({ phase, onJump }: { phase: Phase; onJump: (file: string, line: number) => void }) {
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
  return (
    <div className="grid gap-3 text-sm">
      <p className="font-medium">
        {findings.length} finding{findings.length === 1 ? "" : "s"}
      </p>
      {review.status === "partial" ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
          Partial review. {review.partialReason}
        </p>
      ) : null}
      {m && m.skipped.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{m.skipped.length} file{m.skipped.length === 1 ? "" : "s"} not reviewed</summary>
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
          <summary className="cursor-pointer">{m.dropped.length} unverifiable finding{m.dropped.length === 1 ? "" : "s"} dropped</summary>
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
      {findings.length === 0 ? <p className="text-muted-foreground">Nothing worth reporting was found in the parts that were reviewed.</p> : null}
      <ul className="grid gap-2">
        {findings.map((f) => (
          <li key={f.id} className={cn("rounded-lg border bg-card p-3", SEV[f.severity])}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{f.severity}</span>
              <Badge variant="outline">{f.category}</Badge>
              <span className="text-muted-foreground">{Math.round(f.confidence * 100)}% confident</span>
              {f.verification === "downgraded" ? <Badge variant="secondary">adjusted</Badge> : null}
            </div>
            <p className="mt-1 font-medium text-foreground">{f.title}</p>
            <button type="button" onClick={() => onJump(f.filePath, f.lineStart)} className="mt-0.5 block max-w-full truncate text-left font-mono text-xs text-muted-foreground underline-offset-2 hover:underline">
              {f.filePath}:{f.lineStart}
              {f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ""}
            </button>
            <p className="mt-2 whitespace-pre-wrap text-foreground">{f.description}</p>
            {f.whyItMatters ? (
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                <span className="font-medium text-foreground">Why it matters: </span>
                {f.whyItMatters}
              </p>
            ) : null}
            {f.suggestedFix ? (
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                <span className="font-medium text-foreground">Suggested fix: </span>
                {f.suggestedFix}
              </p>
            ) : null}
            {f.codeExample ? <pre className="mt-2 overflow-auto rounded bg-muted p-2 font-mono text-xs text-foreground">{f.codeExample}</pre> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
