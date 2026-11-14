"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AccountSelect, DEFAULT_ACCOUNT, accountField, useAccounts } from "./account-select";

interface RepoRow {
  id: string;
  name: string;
  github: { host: string; owner: string; repo: string } | null;
}
interface Pr {
  number: number;
  title: string;
  author: string | null;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string | null;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
}
interface Group {
  repo: { host: string; owner: string; repo: string };
  prs: Pr[];
  error: string | null;
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const DECISION: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  APPROVED: { label: "approved", variant: "secondary" },
  CHANGES_REQUESTED: { label: "changes requested", variant: "destructive" },
  REVIEW_REQUIRED: { label: "review required", variant: "outline" },
};

export function prHref(repo: Group["repo"], number: number, account: string | undefined): string {
  const ref: Record<string, unknown> = { host: repo.host, owner: repo.owner, repo: repo.repo, number };
  if (account !== undefined) ref.account = account;
  return `/workspace?pr=${encodeURIComponent(JSON.stringify(ref))}`;
}

export function TeamPrs() {
  const [repos, setRepos] = useState<RepoRow[] | null>(null);
  const [source, setSource] = useState("all");
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("all");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const accounts = useAccounts();

  useEffect(() => {
    let alive = true;
    fetch("/api/repos")
      .then((r) => r.json())
      .then((d: { repos: RepoRow[] }) => alive && setRepos(d.repos))
      .catch(() => alive && setRepos([]));
    return () => {
      alive = false;
    };
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ filter });
    const acc = accountField(account);
    if (acc !== undefined) p.set("account", acc);
    if (source === "all") p.set("all", "1");
    else if (source === "manual") {
      if (!manual.trim()) return null;
      p.set("repo", manual.trim());
    } else {
      const r = repos?.find((x) => x.id === source)?.github;
      if (!r) return null;
      p.set("repo", `${r.host}/${r.owner}/${r.repo}`);
    }
    return p.toString();
  }, [source, manual, filter, account, repos]);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/prs?${query}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error ?? "Couldn’t load pull requests");
          return d.results as Group[];
        })
        .then((g) => alive && setGroups(g))
        .catch((e: Error) => alive && (setGroups(null), setError(e.message)))
        .finally(() => alive && setLoading(false));
    }, source === "manual" ? 500 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, source, reloadTick]);

  const ghRepos = (repos ?? []).filter((r) => r.github);
  const total = groups?.reduce((n, g) => n + g.prs.length, 0) ?? 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="pr-source">Repositories</Label>
          <select id="pr-source" className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All my added repositories ({ghRepos.length})</option>
            {ghRepos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.github!.owner}/{r.github!.repo}
              </option>
            ))}
            <option value="manual">Another repository…</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pr-filter">Show</Label>
          <select id="pr-filter" className={selectCls} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All open</option>
            <option value="review">Waiting for my review</option>
            <option value="mine">My PRs</option>
          </select>
        </div>
        <AccountSelect id="pr-account" value={account} onChange={setAccount} accounts={accounts} />
      </div>

      {source === "manual" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="pr-manual">Repository</Label>
          <Input id="pr-manual" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="owner/repo" spellCheck={false} className="font-mono text-xs" />
        </div>
      ) : null}

      {source === "all" && repos !== null && ghRepos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm">
          <p className="font-medium">No added repository has a GitHub remote</p>
          <p className="mt-1 text-muted-foreground">Add one in Repositories, or choose “Another repository” to type owner/repo.</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading pull requests…</p> : null}

      {!loading && groups ? (
        <div className="grid gap-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} open pull request{total === 1 ? "" : "s"}
              {total === 100 ? " (showing the first 100)" : ""}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setReloadTick((n) => n + 1)}>
              Refresh
            </Button>
          </div>
          {groups.map((g) => (
            <section key={`${g.repo.host}/${g.repo.owner}/${g.repo.repo}`} aria-label={`${g.repo.owner}/${g.repo.repo}`}>
              <h3 className="mb-1 text-sm font-medium">
                {g.repo.owner}/{g.repo.repo}
                {g.repo.host !== "github.com" ? <span className="ml-2 text-xs font-normal text-muted-foreground">{g.repo.host}</span> : null}
              </h3>
              {g.error ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{g.error}</p>
              ) : g.prs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No open pull requests match.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {g.prs.map((p) => (
                    <li key={p.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">#{p.number}</span>
                      <span className="min-w-0 flex-1 basis-64 truncate" title={p.title}>
                        {p.title}
                      </span>
                      {p.isDraft ? <Badge variant="secondary">draft</Badge> : null}
                      {p.reviewDecision && DECISION[p.reviewDecision] ? <Badge variant={DECISION[p.reviewDecision].variant}>{DECISION[p.reviewDecision].label}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{p.author ?? "unknown"}</span>
                      <span className="font-mono text-xs">
                        <span className="text-emerald-400">+{p.additions}</span> <span className="text-red-400">−{p.deletions}</span>
                      </span>
                      <Link href={prHref(g.repo, p.number, accountField(account))} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Open diff
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Running an AI review on a PR arrives in Phase 4.</p>
    </div>
  );
}
