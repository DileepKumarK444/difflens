"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AiSettings {
  provider: "claude-code" | "ollama" | "anthropic";
  ollamaUrl: string;
  ollamaModel: string;
  claudeModel: string;
  anthropicModel: string;
  minSeverity: string;
  customInstructions: string;
  confirmSend: "always" | "session" | "never";
  anthropicKeyPresent: boolean;
}

const PROVIDERS = [
  { id: "claude-code", title: "Claude Code (headless)", note: "Uses your existing Claude Code login, no API key. Code is sent to Anthropic. It can read the repository with read-only tools (Read, Grep, Glob)." },
  { id: "ollama", title: "Ollama (local)", note: "Runs on your machine, or the server you name. Code stays local when the URL is this machine." },
  { id: "anthropic", title: "Anthropic API", note: "Optional. The key comes from the ANTHROPIC_API_KEY environment variable only. Code is sent to Anthropic." },
] as const;

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AiSettingsForm() {
  const router = useRouter();
  const [s, setS] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "status" | "test" | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((d: AiSettings) => alive && setS(d))
      .catch(() => alive && setError("Couldn’t load the AI settings"));
    return () => {
      alive = false;
    };
  }, []);

  if (!s) return <p className="mt-10 text-sm text-muted-foreground">{error ?? "Loading AI settings…"}</p>;

  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => {
    setS({ ...s, [k]: v });
    setDirty(true);
    setMsg(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy("save");
    setError(null);
    try {
      const { anthropicKeyPresent: _k, ...body } = s;
      void _k;
      const r = await apiFetch("/api/settings/ai", { method: "PUT", body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "Couldn’t save");
      else {
        setS(d);
        setDirty(false);
        setMsg({ ok: true, text: "Saved" });
        router.refresh(); // updates the privacy banner
      }
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("status");
    setMsg(null);
    try {
      const d = await (await fetch("/api/ai/status")).json();
      setMsg({ ok: d.status.ok, text: d.status.detail });
    } catch {
      setMsg({ ok: false, text: "Couldn’t check the provider" });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const d = await (await apiFetch("/api/ai/test", { method: "POST" })).json();
      setMsg({ ok: d.ok, text: d.message });
    } catch {
      setMsg({ ok: false, text: "The test didn’t finish" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="mt-10 grid gap-5 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-medium">AI review</h2>
        <p className="mt-1 text-xs text-muted-foreground">Choose who reviews your diffs. Only the selected provider is ever contacted.</p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="sr-only">Provider</legend>
        {PROVIDERS.map((p) => (
          <label key={p.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm", s.provider === p.id && "border-primary bg-accent/40")}>
            <input type="radio" name="provider" className="mt-1" checked={s.provider === p.id} onChange={() => set("provider", p.id)} />
            <span>
              <span className="block font-medium">{p.title}</span>
              <span className="block text-xs text-muted-foreground">{p.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {s.provider === "claude-code" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="claude-model">Model (optional)</Label>
          <Input id="claude-model" value={s.claudeModel} onChange={(e) => set("claudeModel", e.target.value)} placeholder="Leave empty to use Claude Code’s default" spellCheck={false} className="font-mono text-xs" />
        </div>
      ) : null}

      {s.provider === "ollama" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ollama-url">Ollama URL</Label>
            <Input id="ollama-url" value={s.ollamaUrl} onChange={(e) => set("ollamaUrl", e.target.value)} spellCheck={false} className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ollama-model">Model</Label>
            <Input id="ollama-model" value={s.ollamaModel} onChange={(e) => set("ollamaModel", e.target.value)} placeholder="qwen2.5-coder" spellCheck={false} className="font-mono text-xs" />
          </div>
        </div>
      ) : null}

      {s.provider === "anthropic" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="anthropic-model">Model</Label>
          <Input id="anthropic-model" value={s.anthropicModel} onChange={(e) => set("anthropicModel", e.target.value)} spellCheck={false} className="font-mono text-xs" />
          <p className={cn("text-xs", s.anthropicKeyPresent ? "text-emerald-400" : "text-amber-300")}>
            {s.anthropicKeyPresent ? "ANTHROPIC_API_KEY is set in this app’s environment." : "ANTHROPIC_API_KEY isn’t set in the environment this app runs in. Set it and restart DiffLens."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="min-sev">Minimum severity to report</Label>
          <select id="min-sev" className={selectCls} value={s.minSeverity} onChange={(e) => set("minSeverity", e.target.value)}>
            {["Critical", "High", "Medium", "Low", "Informational"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-send">Ask before sending code off this machine</Label>
          <select id="confirm-send" className={selectCls} value={s.confirmSend} onChange={(e) => set("confirmSend", e.target.value as AiSettings["confirmSend"])}>
            <option value="always">Every time</option>
            <option value="session">Once per session</option>
            <option value="never">Never ask</option>
          </select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="custom">Custom review instructions</Label>
        <textarea
          id="custom"
          value={s.customInstructions}
          onChange={(e) => set("customInstructions", e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="For example: this is a payments service, be strict about money handling and idempotency."
          className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">Added to every review prompt. They can’t override DiffLens’s safety rules.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {msg ? (
        <p role="status" className={cn("rounded-md border px-3 py-2 text-sm", msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300")}>
          {msg.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy !== null || !dirty}>
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null || dirty} onClick={check}>
          {busy === "status" ? "Checking…" : "Check status"}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null || dirty} onClick={test}>
          {busy === "test" ? "Testing…" : "Send test message"}
        </Button>
        <span className="text-xs text-muted-foreground">{dirty ? "Save first to check or test." : "The test sends one fixed message, no code."}</span>
      </div>
    </form>
  );
}
