import { eq } from "drizzle-orm";
import { z } from "zod";
import { settings } from "./schema";
import type { Db } from "./index";

export const ProviderId = z.enum(["claude-code", "ollama", "anthropic"]);
export type ProviderId = z.infer<typeof ProviderId>;

/** Every setting has a schema and a default; unknown or corrupt values fall back. */
export const SETTING_SCHEMAS = {
  provider: ProviderId.default("claude-code"),
  ollamaUrl: z.string().url().default("http://127.0.0.1:11434"),
  ollamaModel: z.string().default(""),
  customInstructions: z.string().max(4000).default(""),
  minSeverity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]).default("Low"),
  githubHost: z.string().min(1).default("github.com"),
  /** Account id used for GitHub calls; empty means the active `gh` account. */
  defaultAccount: z.string().max(200).default(""),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export function getSetting<K extends SettingKey>(db: Db, key: K): SettingValue<K> {
  const schema = SETTING_SCHEMAS[key];
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (row) {
    try {
      const parsed = schema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data as SettingValue<K>;
    } catch {
      /* fall through to default */
    }
  }
  return schema.parse(undefined) as SettingValue<K>;
}

export function setSetting<K extends SettingKey>(db: Db, key: K, value: SettingValue<K>): void {
  const checked = SETTING_SCHEMAS[key].parse(value);
  const json = JSON.stringify(checked);
  db.insert(settings)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: settings.key, set: { value: json } })
    .run();
}
