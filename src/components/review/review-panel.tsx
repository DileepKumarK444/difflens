"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { FindingView } from "@/lib/findings";

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

export interface ReviewData {
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
  findings: FindingView[];
  progress: { total: number; done: number; failed: number } | null;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "confirm"; summary: Summary }
  | { kind: "running"; id: string; progress: { total: number; done: number; failed: number } | null }
  | { kind: "done"; data: ReviewData }
  | { kind: "error"; message: string };

export function useReview(body: unknown, initialReviewId?: string) {
  const [phase, setPhase] = useState<Phase>(initialReviewId ? { kind: "running", id: initialReviewId, progress: null } : { kind: "idle" });

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

  /** Apply a triage change locally after the server accepted it. */
  const updateFinding = useCallback((id: string, patch: Partial<Pick<FindingView, "status" | "note">>) => {
    setPhase((p) => (p.kind === "done" ? { kind: "done", data: { ...p.data, findings: p.data.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) } } : p));
  }, []);

  return { phase, updateFinding, start: () => start(false), confirm: () => start(true), cancelConfirm: () => setPhase({ kind: "idle" }), reset: () => setPhase({ kind: "idle" }) };
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
