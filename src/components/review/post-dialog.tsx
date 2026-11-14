"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  severity: string;
  path: string;
  line: number;
  mapped: boolean;
  reason: string | null;
  suggestion: boolean;
  body: string;
  alreadyPosted: boolean;
}
interface Preview {
  repo: string;
  number: number;
  title: string;
  mode: "inline" | "general";
  summary: string;
  items: Item[];
  warnings: string[];
}
interface Result {
  url: string | null;
  mode: "inline" | "general";
  posted: number;
  fallbackReason: string | null;
}

export function PostDialog({ reviewId, ids, suggestionIds, onClose, onPosted }: { reviewId: string; ids: string[]; suggestionIds: string[]; onClose: () => void; onPosted: (ids: string[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  // The preview is read-only: it asks GitHub for the current PR but posts nothing.
  const idsKey = JSON.stringify(ids);
  const suggestKey = JSON.stringify(suggestionIds);
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/post`, { method: "POST", body: JSON.stringify({ ids: JSON.parse(idsKey), suggestionIds: JSON.parse(suggestKey) }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn’t prepare the review");
        return d.preview as Preview;
      })
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setSummary(p.summary);
        setBodies(Object.fromEntries(p.items.map((i) => [i.id, i.body])));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [reviewId, idsKey, suggestKey]);

  async function post() {
    if (!preview) return;
    setPosting(true);
    setError(null);
    try {
      const edited: Record<string, string> = {};
      for (const i of preview.items) if (bodies[i.id]?.trim() && bodies[i.id] !== i.body) edited[i.id] = bodies[i.id];
      const r = await apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/post`, {
        method: "POST",
        body: JSON.stringify({ ids, suggestionIds, bodies: edited, summary, confirm: { repo: preview.repo, number: preview.number } }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn’t post the review");
      setResult(d.result as Result);
      onPosted(ids);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!posting) onClose();
      }}
      aria-labelledby="post-title"
      className="m-auto max-h-[88vh] w-[min(46rem,94vw)] overflow-auto rounded-xl border border-border bg-popover p-5 text-sm text-popover-foreground backdrop:bg-black/60"
    >
      {result ? (
        <div>
          <h2 id="post-title" className="text-base font-medium">
            Posted to GitHub
          </h2>
          <p className="mt-2">
            {result.posted} finding{result.posted === 1 ? "" : "s"} posted as {result.mode === "inline" ? "inline comments on a single review" : "one general comment"}.
          </p>
          {result.fallbackReason ? <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">{result.fallbackReason} They were posted as one general comment instead.</p> : null}
          {result.url ? (
            <p className="mt-2">
              <a href={result.url} target="_blank" rel="noreferrer noopener" className="underline">
                Open the review on GitHub
              </a>
            </p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div>
          <h2 id="post-title" className="text-base font-medium">
            {preview ? `Post review to ${preview.repo} #${preview.number}?` : "Preparing the review…"}
          </h2>
          {preview ? (
            <p className="mt-1 text-muted-foreground" title={preview.title}>
              {preview.title}
            </p>
          ) : null}
          {error ? <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{error}</p> : null}
          {!preview && !error ? <p className="mt-3 text-muted-foreground">Checking the pull request on GitHub. Nothing has been posted.</p> : null}
          {preview ? (
            <>
              <p className="mt-3 rounded-md border border-border px-3 py-2">
                {preview.mode === "inline" ? (
                  <>This will post <strong>one review</strong> to GitHub as a <strong>comment</strong> (not an approval or a request for changes), with <strong>{preview.items.length}</strong> comment{preview.items.length === 1 ? "" : "s"} on the lines they refer to.</>
                ) : (
                  <>This will post <strong>one general comment</strong> to GitHub (not an approval or a request for changes) containing all <strong>{preview.items.length}</strong> finding{preview.items.length === 1 ? "" : "s"}, because some can’t be placed on a line.</>
                )}{" "}
                It is posted from the GitHub account selected for this pull request.
              </p>
              {preview.warnings.map((w, i) => (
                <p key={i} className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                  {w}
                </p>
              ))}
              <label className="mt-3 block text-xs text-muted-foreground" htmlFor="post-summary">
                Summary at the top of the review
              </label>
              <textarea id="post-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={4000} className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
              <ul className="mt-3 grid gap-3">
                {preview.items.map((i) => (
                  <li key={i.id} className={cn("rounded-lg border p-3", i.mapped ? "border-border" : "border-amber-500/40")}>
                    <p className="font-medium">
                      {i.severity}: {i.title}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {i.path}:{i.line} {i.suggestion ? "· as a GitHub suggestion" : ""} {i.alreadyPosted ? "· already posted before" : ""}
                    </p>
                    {i.reason ? <p className="mt-1 text-xs text-amber-300">{i.reason}</p> : null}
                    <label className="sr-only" htmlFor={`pb-${i.id}`}>
                      Comment text
                    </label>
                    <textarea id={`pb-${i.id}`} value={bodies[i.id] ?? ""} onChange={(e) => setBodies({ ...bodies, [i.id]: e.target.value })} rows={6} maxLength={8000} className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">You can edit any comment above. Once posted, other people on the pull request can see it.</p>
            </>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={posting}>
              Cancel
            </Button>
            {preview ? (
              <Button onClick={post} disabled={posting}>
                {posting ? "Posting…" : `Post review to ${preview.repo} #${preview.number}`}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </dialog>
  );
}
