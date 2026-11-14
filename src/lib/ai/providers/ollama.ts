import { z } from "zod";
import { ProviderError, type CompleteRequest, type ProviderStatus, type ReviewProvider } from "./types";

type Fetch = typeof fetch;

function baseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderError("The Ollama URL isn’t valid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ProviderError("The Ollama URL must start with http:// or https://");
  if (u.username || u.password) throw new ProviderError("Remove the credentials from the Ollama URL");
  return u.origin;
}

const Tags = z.object({ models: z.array(z.object({ name: z.string() })).default([]) });
const Chat = z.object({ message: z.object({ content: z.string() }) });

export function createOllamaProvider(opts: { url: string; model: string; fetch?: Fetch; leavesMachine: boolean }): ReviewProvider {
  const f = opts.fetch ?? fetch;
  return {
    id: "ollama",
    label: "Ollama",
    leavesMachine: opts.leavesMachine,
    readsRepo: false,
    model: opts.model || null,
    async status(): Promise<ProviderStatus> {
      let origin: string;
      try {
        origin = baseUrl(opts.url);
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
      try {
        const r = await f(`${origin}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return { ok: false, detail: `Ollama answered with an error (${r.status})` };
        const models = Tags.parse(await r.json()).models.map((m) => m.name);
        if (!opts.model) return { ok: true, detail: `Ollama is running with ${models.length} model${models.length === 1 ? "" : "s"}. Choose one`, models };
        const has = models.some((m) => m === opts.model || m.startsWith(opts.model + ":"));
        return has
          ? { ok: true, detail: `Ollama is running and ${opts.model} is available`, models }
          : { ok: false, detail: `Ollama is running but ${opts.model} isn’t installed. Run: ollama pull ${opts.model}`, models };
      } catch {
        return { ok: false, detail: `Couldn’t reach Ollama at ${origin}. Is it running?` };
      }
    },
    async complete(req: CompleteRequest): Promise<string> {
      const origin = baseUrl(opts.url);
      if (!opts.model) throw new ProviderError("Choose an Ollama model in Settings");
      let r: Response;
      try {
        r = await f(`${origin}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: opts.model, stream: false, format: "json", messages: [{ role: "user", content: req.prompt }], options: { temperature: 0.1, num_ctx: 32768 } }),
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs),
        });
      } catch {
        throw new ProviderError(`Couldn’t reach Ollama at ${origin}. Is it running?`);
      }
      if (!r.ok) throw new ProviderError(r.status === 404 ? `Ollama doesn’t have the model ${opts.model}. Run: ollama pull ${opts.model}` : `Ollama answered with an error (${r.status})`);
      try {
        return Chat.parse(await r.json()).message.content;
      } catch {
        throw new ProviderError("Ollama returned a reply DiffLens couldn’t read");
      }
    },
  };
}
