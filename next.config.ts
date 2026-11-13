import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Native module: must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
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
