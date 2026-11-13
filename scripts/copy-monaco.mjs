// Serve Monaco from this app (public/monaco) instead of a CDN, so no editor assets are fetched
// from the internet and the app works offline.
import fs from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/monaco-editor/min/vs");
const dest = path.resolve("public/monaco/vs");
if (!fs.existsSync(src)) {
  console.warn("monaco-editor not installed yet; skipping copy");
  process.exit(0);
}
const marker = path.join(dest, ".copied-from");
const version = JSON.parse(fs.readFileSync("node_modules/monaco-editor/package.json", "utf8")).version;
if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === version) process.exit(0);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
fs.writeFileSync(marker, version);
console.log(`copied monaco-editor ${version} to public/monaco/vs`);
