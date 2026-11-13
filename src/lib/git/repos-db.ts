import { eq } from "drizzle-orm";
import path from "node:path";
import type { Db } from "@/lib/db";
import { repos } from "@/lib/db/schema";
import { git } from "./exec";
import { validateRepo } from "./repo";
import { GitError } from "./validate";

export type RepoRow = typeof repos.$inferSelect;

/** Add a repo the user chose. Only repos stored here can ever be read by the app. */
export async function addRepo(db: Db, inputPath: string): Promise<RepoRow> {
  const real = await validateRepo(inputPath);
  if (db.select().from(repos).where(eq(repos.path, real)).get()) throw new GitError("That repository is already added");
  const remote = await git(real, ["remote", "get-url", "origin"], { allowFail: true });
  const row = {
    id: crypto.randomUUID(),
    path: real,
    name: path.basename(real),
    remoteUrl: remote.code === 0 ? remote.stdout.trim() || null : null,
  };
  db.insert(repos).values(row).run();
  return db.select().from(repos).where(eq(repos.id, row.id)).get()!;
}

export function listRepos(db: Db): RepoRow[] {
  return db.select().from(repos).orderBy(repos.name).all();
}

export function getRepo(db: Db, id: string): RepoRow | undefined {
  return db.select().from(repos).where(eq(repos.id, id)).get();
}

export function removeRepo(db: Db, id: string): boolean {
  return db.delete(repos).where(eq(repos.id, id)).run().changes > 0;
}
