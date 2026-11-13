"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FolderGit2, GitBranch, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RepoRow {
  id: string;
  path: string;
  name: string;
  remoteUrl: string | null;
  ok: boolean;
  status: { staged: number; unstaged: number; untracked: number } | null;
  base: string | null;
}

export function ReposPanel() {
  const [repos, setRepos] = useState<RepoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/repos");
      const d = (await r.json()) as { repos: RepoRow[] };
      setRepos(d.repos);
    } catch {
      setError("Couldn’t load repositories. Reload the page.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/repos")
      .then((r) => r.json())
      .then((d: { repos: RepoRow[] }) => alive && setRepos(d.repos))
      .catch(() => alive && setError("Couldn’t load repositories. Reload the page."));
    return () => {
      alive = false;
    };
  }, []);

  async function call(fn: () => Promise<Response>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Something went wrong");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call(() => apiFetch("/api/repos", { method: "POST", body: JSON.stringify({ path }) }));
    if (ok) setPath("");
  }

  return (
    <div>
      <form onSubmit={add} className="mb-6 rounded-lg border border-border p-4">
        <Label htmlFor="repo-path" className="text-sm font-medium">
          Add a repository
        </Label>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          Enter the absolute path of a git repository’s top-level folder. DiffLens only reads it and never changes it.
        </p>
        <div className="flex gap-2">
          <Input
            id="repo-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/Developer/my-project"
            spellCheck={false}
            className="font-mono text-xs"
            required
          />
          <Button type="submit" disabled={busy || !path.trim()}>
            {busy ? "Checking…" : "Add"}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {repos === null ? (
        <p className="text-sm text-muted-foreground">Loading repositories…</p>
      ) : repos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">Add your first repository</p>
          <p className="mt-1 text-sm text-muted-foreground">Paste a folder path above to start reviewing your changes before you push.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {repos.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{r.path}</p>
                {r.remoteUrl ? <p className="truncate text-xs text-muted-foreground">{r.remoteUrl}</p> : null}
              </div>
              {r.ok && r.status ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{r.status.staged} staged</Badge>
                  <Badge variant="outline">{r.status.unstaged} changed</Badge>
                  <Badge variant="outline">{r.status.untracked} new</Badge>
                  {r.base ? (
                    <Badge variant="secondary">
                      <GitBranch className="size-3" aria-hidden /> base {r.base}
                    </Badge>
                  ) : null}
                </div>
              ) : (
                <Badge variant="destructive">can’t read</Badge>
              )}
              <Link href={`/reviews/new?repo=${encodeURIComponent(r.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Review changes
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${r.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${r.name} from DiffLens? Nothing on disk is deleted.`)) {
                    void call(() => apiFetch(`/api/repos/${encodeURIComponent(r.id)}`, { method: "DELETE" }));
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
