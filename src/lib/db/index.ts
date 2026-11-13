import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { dbPath } from "@/lib/paths";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** Open (and migrate) a database file. Exported for tests. */
export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, sqlite };
}

const g = globalThis as unknown as { __difflensDb?: Db };

/** Process-wide singleton (survives Next dev hot reloads). */
export function getDb(): Db {
  if (!g.__difflensDb) g.__difflensDb = openDb(dbPath()).db;
  return g.__difflensDb;
}

export { schema };
