import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * The only directory the app writes to. Override with DIFFLENS_DATA_DIR
 * (used by tests). Created with owner-only permissions.
 */
export function dataDir(): string {
  const dir =
    process.env.DIFFLENS_DATA_DIR ??
    path.join(os.homedir(), "Library", "Application Support", "DiffLens");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), "difflens.sqlite");
}
