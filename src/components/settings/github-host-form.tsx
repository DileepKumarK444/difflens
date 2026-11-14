"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GithubHostForm() {
  const [host, setHost] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/github-host")
      .then((r) => r.json())
      .then((d: { host: string }) => {
        if (!alive) return;
        const h = d.host === "github.com" ? "" : d.host;
        setHost(h);
        setSaved(h);
      })
      .catch(() => alive && setError("Couldn’t load the host setting"));
    return () => {
      alive = false;
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch("/api/settings/github-host", { method: "PUT", body: JSON.stringify({ host }) });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "Couldn’t save");
      else {
        const h = d.host === "github.com" ? "" : d.host;
        setHost(h);
        setSaved(h);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-10 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">GitHub Enterprise host</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Optional. github.com always works. Add your company’s host (for example github.acme.com) to review its pull requests. Log in with{" "}
        <code className="font-mono">gh auth login --hostname</code> or add a token account for it.
      </p>
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="ghe-host">Host</Label>
          <Input id="ghe-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="github.acme.com" spellCheck={false} className="font-mono text-xs" />
        </div>
        <Button type="submit" disabled={busy || host.trim().toLowerCase() === (saved ?? "")}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </form>
  );
}
