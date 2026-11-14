import { z } from "zod";
import { ProviderError, type CompleteRequest, type ProviderStatus, type ReviewProvider } from "./types";

type Fetch = typeof fetch;
export const KEY_ENV = "ANTHROPIC_API_KEY";
const Reply = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) });

/**
 * Anthropic Messages API. The key comes only from the server's environment variable.
 * This object is created only when the user has selected the provider, and the key is
 * never returned, logged, or sent anywhere except api.anthropic.com.
 */
export function createAnthropicProvider(opts: { model: string; env?: Record<string, string | undefined>; fetch?: Fetch }): ReviewProvider {
  const f = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  return {
    id: "anthropic",
    label: "Anthropic API",
    leavesMachine: true,
    readsRepo: false,
    model: opts.model,
    async status(): Promise<ProviderStatus> {
      return env[KEY_ENV]?.trim()
        ? { ok: true, detail: `${KEY_ENV} is set. Model ${opts.model}. Nothing is sent until you run a review` }
        : { ok: false, detail: `${KEY_ENV} isn’t set in the environment DiffLens runs in` };
    },
    async complete(req: CompleteRequest): Promise<string> {
      const key = env[KEY_ENV]?.trim();
      if (!key) throw new ProviderError(`${KEY_ENV} isn’t set in the environment DiffLens runs in`);
      let r: Response;
      try {
        r = await f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: opts.model, max_tokens: 8000, messages: [{ role: "user", content: req.prompt }] }),
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs),
        });
      } catch {
        throw new ProviderError("Couldn’t reach the Anthropic API. Check your connection");
      }
      if (r.status === 401 || r.status === 403) throw new ProviderError("Anthropic rejected the API key");
      if (r.status === 429) throw new ProviderError("The Anthropic API rate limit was reached. Try again later");
      if (!r.ok) throw new ProviderError(`The Anthropic API returned an error (${r.status})`);
      try {
        const text = Reply.parse(await r.json()).content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        if (!text.trim()) throw new Error("empty");
        return text;
      } catch {
        throw new ProviderError("The Anthropic API returned a reply DiffLens couldn’t read");
      }
    },
  };
}
