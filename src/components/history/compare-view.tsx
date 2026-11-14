"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { compareFindings } from "@/lib/compare";
import type { FindingView } from "@/lib/findings";

interface Loaded {
  review: { id: string; title: string; createdAt: number; provider: string; status: string };
  findings: FindingView[];
}

function Row({ f, other }: { f: FindingView; other?: FindingView }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
      <Badge variant={f.severity === "Critical" ? "destructive" : "outline"}>{f.severity}</Badge>
      <span className="min-w-0 flex-1 basis-60 truncate" title={f.title}>
        {f.title}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {f.filePath}:{f.lineStart}
        {other && other.lineStart !== f.lineStart ? ` → ${other.lineStart}` : ""}
      </span>
      <span className="text-xs text-muted-foreground">
        {f.status}
        {other && other.status !== f.status ? ` → ${other.status}` : ""}
      </span>
    </li>
  );
}

function Section({ title, hint, count, children }: { title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-baseline gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">
          {title} ({count})
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </header>
      {count === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">None.</p> : <ul className="divide-y divide-border">{children}</ul>}
    </section>
  );
}

export function CompareView({ a, b }: { a: string; b: string }) {
  const [data, setData] = useState<{ older: Loaded; newer: Loaded } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([a, b].map((id) => fetch(`/api/reviews/${encodeURIComponent(id)}`).then(async (r) => {
      if (!r.ok) throw new Error("One of the reviews couldn’t be found");
      return (await r.json()) as Loaded;
    })))
      .then(([x, y]) => {
        if (!alive) return;
        const [older, newer] = x.review.createdAt <= y.review.createdAt ? [x, y] : [y, x];
        setData({ older, newer });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [a, b]);

  const cmp = useMemo(() => (data ? compareFindings(data.older.findings, data.newer.findings) : null), [data]);

  if (error) return <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>;
  if (!data || !cmp) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { older, newer } = data;
  const card = (l: Loaded, label: string) => (
    <div className="rounded-lg border border-border p-3 text-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Link href={`/workspace?saved=${encodeURIComponent(l.review.id)}`} className="font-medium hover:underline">
        {l.review.title}
      </Link>
      <p className="text-xs text-muted-foreground">
        {new Date(l.review.createdAt).toLocaleString()} · {l.review.provider} · {l.findings.length} findings
      </p>
    </div>
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {card(older, "Earlier review")}
        {card(newer, "Later review")}
      </div>
      <p className="text-sm text-muted-foreground">
        {cmp.fixed.length} no longer reported, {cmp.added.length} new, {cmp.unchanged.length} still there. Findings are matched by file and wording because line numbers move between reviews.
      </p>
      <Section title="No longer reported" hint="In the earlier review only: probably fixed" count={cmp.fixed.length}>
        {cmp.fixed.map((f) => (
          <Row key={f.id} f={f} />
        ))}
      </Section>
      <Section title="New" hint="Only in the later review" count={cmp.added.length}>
        {cmp.added.map((f) => (
          <Row key={f.id} f={f} />
        ))}
      </Section>
      <Section title="Still there" hint="Reported in both (status and line shown as earlier → later)" count={cmp.unchanged.length}>
        {cmp.unchanged.map(([x, y]) => (
          <Row key={x.id + y.id} f={x} other={y} />
        ))}
      </Section>
    </div>
  );
}
