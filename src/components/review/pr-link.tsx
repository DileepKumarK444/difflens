"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountSelect, DEFAULT_ACCOUNT, accountField, useAccounts } from "./account-select";
import { prHref } from "./team-prs";

export function PrLink() {
  const router = useRouter();
  const accounts = useAccounts();
  const [url, setUrl] = useState("");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/prs/resolve?url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "That link didn’t work");
        return;
      }
      router.push(prHref(d.ref, d.ref.number, accountField(account)));
    } catch {
      setError("Couldn’t read that link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={open} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="pr-url">Pull request link</Label>
        <Input id="pr-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/pull/123" spellCheck={false} className="font-mono text-xs" required />
        <p className="text-xs text-muted-foreground">github.com works by default. For GitHub Enterprise, add your host in Settings.</p>
      </div>
      <div className="max-w-sm">
        <AccountSelect id="link-account" value={account} onChange={setAccount} accounts={accounts} />
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? "Checking…" : "Open pull request"}
        </Button>
        <span className="text-xs text-muted-foreground">Running an AI review on a PR arrives in Phase 4.</span>
      </div>
    </form>
  );
}
