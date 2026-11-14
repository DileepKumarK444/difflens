export interface ProviderStatus {
  ok: boolean;
  detail: string;
  models?: string[];
}

export interface CompleteRequest {
  prompt: string;
  /** Repository to run in so the model can read surrounding code. Undefined = no repo access. */
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ReviewProvider {
  id: "claude-code" | "ollama" | "anthropic";
  label: string;
  /** True when diff content is sent to a service outside this machine. */
  leavesMachine: boolean;
  /** Whether the provider can read repository files itself (Claude Code with tools). */
  readsRepo: boolean;
  model: string | null;
  status(): Promise<ProviderStatus>;
  /** Returns the model's text reply. Throws ProviderError with a message that is safe to show. */
  complete(req: CompleteRequest): Promise<string>;
}

export class ProviderError extends Error {}
