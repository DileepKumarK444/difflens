import type { ProviderId } from "@/lib/db/settings";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** True when diff content leaves this machine. */
  leavesMachine: boolean;
  detail: string;
}

export function providerInfo(id: ProviderId, ollamaUrl: string): ProviderInfo {
  switch (id) {
    case "claude-code":
      return {
        id,
        label: "Claude Code (headless)",
        leavesMachine: true,
        detail: "via your Claude Code login, no API key",
      };
    case "anthropic":
      return { id, label: "Anthropic API", leavesMachine: true, detail: "using ANTHROPIC_API_KEY from the environment" };
    case "ollama": {
      let local = false;
      try {
        const h = new URL(ollamaUrl).hostname;
        local = h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
      } catch {
        /* treat as remote */
      }
      return {
        id,
        label: "Ollama",
        leavesMachine: !local,
        detail: local ? "Local only" : "Code is sent to a remote Ollama server",
      };
    }
  }
}
