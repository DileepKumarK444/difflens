"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Repo {
  id: string;
  name: string;
  path: string;
}
interface Commit {
  sha: string;
  short: string;
  subject: string;
  author: string;
}
interface Info {
  branch: string | null;
  status: { staged: number; unstaged: number; untracked: number };
  base: { base: string | null; source: string };
  ahead: number | null;
  behind: number | null;
  commits: Commit[];
  branches: string[];
}

type Kind = "branch" | "working" | "staged" | "commit" | "range";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NewLocalReview({ initialRepoId }: { initialRepoId?: string }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoId, setRepoId] = useState(initialRepoId ?? "");
  const [info, setInfo] = useState<Info | null>(null);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("branch");
  const [base, setBase] = useState("");
  const [commit, setCommit] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("HEAD");

  useEffect(() => {
    let alive = true;
    fetch("/api/repos")
      .then((r) => r.json())
      .then((d: { repos: Repo[] }) => {
        if (!alive) return;
        setRepos(d.repos);
        setRepoId((cur) => (cur && d.repos.some((r) => r.id === cur) ? cur : (d.repos[0]?.id ?? "")));
      })
      .catch(() => alive && setError("Couldn’t load repositories. Reload the page."));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!repoId) return;
    let alive = true;
    fetch(`/api/repos/${encodeURIComponent(repoId)}/info`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn’t read this repository");
        return d.info as Info;
      })
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        setInfoFor(repoId);
        setError(null);
        setBase(i.base.base ?? "");
        setCommit(i.commits[0]?.sha ?? "");
        setFrom(i.commits[1]?.sha ?? i.commits[0]?.sha ?? "");
        setTo("HEAD");
        setKind(i.base.base ? "branch" : "working");
      })
      .catch((e: Error) => alive && (setInfo(null), setInfoFor(repoId), setError(e.message)));
    return () => {
      alive = false;
    };
  }, [repoId]);

  const loadingInfo = Boolean(repoId) && infoFor !== repoId;

  const scope = useMemo(() => {
    switch (kind) {
      case "staged":
        return { type: "staged" };
      case "working":
        return { type: "working" };
      case "commit":
        return commit ? { type: "commit", sha: commit } : null;
      case "range":
        return from && to ? { type: "range", from, to } : null;
      case "branch":
        return base ? { type: "branch", base } : null;
    }
  }, [kind, base, commit, from, to]);

  const href = repoId && scope ? `/workspace?repo=${encodeURIComponent(repoId)}&scope=${encodeURIComponent(JSON.stringify(scope))}` : null;

  if (repos === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (repos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">Add a repository first</p>
        <p className="mt-1 text-sm text-muted-foreground">Local reviews need a repository to read from.</p>
        <Link href="/repositories" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
          Go to repositories
        </Link>
      </div>
    );
  }

  const options: { id: Kind; title: string; hint: string; disabled?: boolean }[] = [
    { id: "branch", title: "Current branch vs base", hint: "Everything on this branch that isn’t in the base yet. Closest to a pull request.", disabled: !info?.base.base && !info?.branches.length },
    { id: "working", title: "Unstaged changes and new files", hint: "Edits you haven’t staged, plus untracked files." },
    { id: "staged", title: "Staged changes", hint: "What the next commit would contain." },
    { id: "commit", title: "A single commit", hint: "The changes made by one commit.", disabled: !info?.commits.length },
    { id: "range", title: "A range between two commits", hint: "Everything that changed from one point to another.", disabled: !info?.commits.length },
  ];

  const refChoices = info ? [...new Set(["HEAD", ...info.branches])] : [];

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="repo">Repository</Label>
        <select id="repo" className={selectCls} value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.path}
            </option>
          ))}
        </select>
        {info ? (
          <p className="text-xs text-muted-foreground">
            On {info.branch ?? "a detached HEAD"} · {info.status.staged} staged · {info.status.unstaged} changed · {info.status.untracked} new
            {info.ahead !== null ? ` · ${info.ahead} ahead, ${info.behind} behind ${info.base.base}` : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loadingInfo ? <p className="text-sm text-muted-foreground">Reading repository…</p> : null}

      {info ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">What do you want to review?</legend>
          {options.map((o) => (
            <label
              key={o.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm",
                kind === o.id && "border-primary bg-accent/40",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input type="radio" name="kind" className="mt-1" checked={kind === o.id} disabled={o.disabled} onChange={() => setKind(o.id)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
                {kind === o.id && o.id === "branch" ? (
                  <span className="mt-2 grid gap-1">
                    <span className="text-xs text-muted-foreground">
                      Base branch {info.base.base ? `(detected from ${info.base.source})` : "(none detected, choose one)"}
                    </span>
                    <select className={selectCls} value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base branch">
                      {!base ? <option value="">Choose a base…</option> : null}
                      {info.branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : null}
                {kind === o.id && o.id === "commit" ? (
                  <select className={cn(selectCls, "mt-2")} value={commit} onChange={(e) => setCommit(e.target.value)} aria-label="Commit">
                    {info.commits.map((c) => (
                      <option key={c.sha} value={c.sha}>
                        {c.short} {c.subject}
                      </option>
                    ))}
                  </select>
                ) : null}
                {kind === o.id && o.id === "range" ? (
                  <span className="mt-2 grid grid-cols-2 gap-2">
                    <span className="grid gap-1">
                      <span className="text-xs text-muted-foreground">From</span>
                      <select className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
                        {refChoices.map((r) => (
                          <option key={`b-${r}`} value={r}>
                            {r}
                          </option>
                        ))}
                        {info.commits.map((c) => (
                          <option key={c.sha} value={c.sha}>
                            {c.short} {c.subject}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="grid gap-1">
                      <span className="text-xs text-muted-foreground">To</span>
                      <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
                        {refChoices.map((r) => (
                          <option key={`b-${r}`} value={r}>
                            {r}
                          </option>
                        ))}
                        {info.commits.map((c) => (
                          <option key={c.sha} value={c.sha}>
                            {c.short} {c.subject}
                          </option>
                        ))}
                      </select>
                    </span>
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        {href ? (
          <Link href={href} className={buttonVariants({ variant: "default" })}>
            Open diff
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Choose what to review to continue.</span>
        )}
        <span className="text-xs text-muted-foreground">Running an AI review on this diff arrives in Phase 4.</span>
      </div>
    </div>
  );
}
