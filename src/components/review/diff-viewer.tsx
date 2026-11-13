"use client";

import { DiffEditor, loader } from "@monaco-editor/react";

// Serve Monaco from this app (copied to public/monaco by scripts/copy-monaco.mjs): no CDN.
loader.config({ paths: { vs: "/monaco/vs" } });

const LANGS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", html: "html", py: "python", rb: "ruby", go: "go",
  rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cs: "csharp", php: "php",
  sh: "shell", zsh: "shell", yml: "yaml", yaml: "yaml", toml: "ini", sql: "sql", xml: "xml", vue: "html", prisma: "plaintext",
};

export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGS[ext] ?? "plaintext";
}

export default function DiffViewer({
  path,
  original,
  modified,
  sideBySide,
}: {
  path: string;
  original: string;
  modified: string;
  sideBySide: boolean;
}) {
  return (
    <DiffEditor
      height="100%"
      theme="vs-dark"
      language={languageFor(path)}
      original={original}
      modified={modified}
      loading={<p className="p-4 text-sm text-muted-foreground">Loading editor…</p>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        renderOverviewRuler: true,
        diffAlgorithm: "advanced",
      }}
    />
  );
}
