import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Native module: must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // The on-disk dev cache gets corrupted when the dev server is stopped abruptly (for example by App Hub),
  // which causes an endless reload loop. Rebuilding from scratch is fast enough for this app.
  experimental: { turbopackFileSystemCacheForDev: false },
  turbopack: {
    // Without this, Next picks a parent folder (e.g. $HOME) as the watch root, and the hub's
    // log file for this app changes the watched tree on every request: an endless reload loop.
    root: path.resolve(process.cwd()),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
