import type { Db } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { providerInfo } from "@/lib/provider-info";
import { createAnthropicProvider } from "./anthropic";
import { createClaudeCodeProvider } from "./claude-code";
import { createOllamaProvider } from "./ollama";
import type { ReviewProvider } from "./types";

/** Build only the provider the user selected. The others are never constructed, so never contacted. */
export function createProvider(db: Db): ReviewProvider {
  const id = getSetting(db, "provider");
  switch (id) {
    case "claude-code":
      return createClaudeCodeProvider({ model: getSetting(db, "claudeModel") });
    case "anthropic":
      return createAnthropicProvider({ model: getSetting(db, "anthropicModel") });
    case "ollama": {
      const url = getSetting(db, "ollamaUrl");
      return createOllamaProvider({ url, model: getSetting(db, "ollamaModel"), leavesMachine: providerInfo("ollama", url).leavesMachine });
    }
  }
}
