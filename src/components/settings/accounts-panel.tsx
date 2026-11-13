"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Terminal, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Account {
  id: string;
  source: "gh" | "token";
  host: string;
  login: string;
  label: string;
  ghActive: boolean;
  isDefault: boolean;
}

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("github.com");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/accounts");
      const data = await r.json();
      setAccounts(data.accounts);
    } catch {
      setError("Couldn't load accounts. Reload the page.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d: { accounts: Account[] }) => alive && setAccounts(d.accounts))
      .catch(() => alive && setError("Couldn’t load accounts. Reload the page."));
    return () => {
      alive = false;
    };
  }, []);

  async function call(fn: () => Promise<Response>) {
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
    const ok = await call(() =>
      apiFetch("/api/accounts", { method: "POST", body: JSON.stringify({ host, token, label: label || undefined }) }),
    );
    if (ok) {
      setToken(""); // never keep the secret in the page after it is sent
      setLabel("");
    }
  }

  const setDefault = (id: string | null) =>
    call(() => apiFetch("/api/accounts/default", { method: "PUT", body: JSON.stringify({ id }) }));

  return (
    <section aria-labelledby="accounts-h" className="mt-10">
      <h2 id="accounts-h" className="mb-1 text-sm font-medium">
        GitHub accounts
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Choose which account DiffLens uses to read pull requests. Accounts from{" "}
        <code className="font-mono text-xs">gh auth login</code> appear automatically.
      </p>

      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {accounts === null ? (
        <p className="text-sm text-muted-foreground">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm">
          <p className="font-medium">No accounts found</p>
          <p className="mt-1 text-muted-foreground">
            Run <code className="font-mono text-xs">gh auth login</code> in a terminal, or add a token below.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
              {a.source === "gh" ? (
                <Terminal className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span className="font-medium">{a.label}</span>
              {a.label !== a.login ? <span className="text-muted-foreground">({a.login})</span> : null}
              <span className="text-muted-foreground">@ {a.host}</span>
              <Badge variant="outline">{a.source === "gh" ? "gh" : "token"}</Badge>
              {a.ghActive ? <Badge variant="secondary">gh active</Badge> : null}
              {a.isDefault ? <Badge>default</Badge> : null}
              <span className="ml-auto flex gap-2">
                {a.isDefault ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDefault(null)}>
                    Clear default
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setDefault(a.id)}>
                    Use as default
                  </Button>
                )}
                {a.source === "token" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${a.label}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${a.label} and delete its token from the Keychain?`)) {
                        void call(() => apiFetch(`/api/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" }));
                      }
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        With no default, DiffLens uses whichever account <code className="font-mono">gh</code> has active. Remove gh
        accounts with <code className="font-mono">gh auth logout</code>.
      </p>

      <form onSubmit={add} className="mt-6 rounded-lg border border-border p-4" autoComplete="off">
        <h3 className="text-sm font-medium">Add an account with a token</h3>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          Optional. GitHub checks the token, then it’s stored only in your macOS Keychain. Use a fine-grained token with
          read access to pull requests and contents. Add pull request write access only if you want to post reviews.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="acc-host">Host</Label>
            <Input id="acc-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="github.com" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-label">Label (optional)</Label>
            <Input id="acc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work" maxLength={60} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="acc-token">Token</Label>
            <Input
              id="acc-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="new-password"
              spellCheck={false}
              required
            />
          </div>
        </div>
        <Button type="submit" className="mt-3" disabled={busy || !token}>
          {busy ? "Checking…" : "Add account"}
        </Button>
      </form>
    </section>
  );
}
