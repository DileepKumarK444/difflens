"use client";

import { DiffEditor, loader, type DiffOnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";
import { markerSeverity, type Severity } from "@/lib/findings";

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

export interface LineMarker {
  id: string;
  title: string;
  severity: Severity;
  lineStart: number;
  lineEnd: number;
  /** Which side of the diff the lines belong to: "original" only for deleted files. */
  side: "modified" | "original";
}

export interface FocusRequest {
  nonce: number;
  line: number;
  side: "modified" | "original";
}

const MARKER_OWNER = "difflens";

export default function DiffViewer({
  path,
  original,
  modified,
  sideBySide,
  collapse,
  markers,
  activeId,
  focus,
  onFocused,
  onMarkerClick,
}: {
  path: string;
  original: string;
  modified: string;
  sideBySide: boolean;
  /** Fold the long runs of blank lines used to pad a saved diff. */
  collapse: boolean;
  markers: LineMarker[];
  activeId: string | null;
  focus: FocusRequest | null;
  onFocused: (nonce: number) => void;
  onMarkerClick: (id: string) => void;
}) {
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<DiffOnMount>[1] | null>(null);
  const collections = useRef<{ modified?: { clear(): void }; original?: { clear(): void } }>({});
  const markersRef = useRef(markers);
  const onClickRef = useRef(onMarkerClick);
  const activeIdRef = useRef(activeId);
  // Keep the refs current for the Monaco callbacks, which outlive any single render.
  useEffect(() => {
    markersRef.current = markers;
    onClickRef.current = onMarkerClick;
    activeIdRef.current = activeId;
  });

  const apply = useCallback(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    for (const side of ["modified", "original"] as const) {
      const sub = side === "modified" ? ed.getModifiedEditor() : ed.getOriginalEditor();
      const model = sub.getModel();
      collections.current[side]?.clear();
      if (!model) continue;
      const list = markersRef.current.filter((m) => m.side === side && m.lineStart <= model.getLineCount());
      // Squiggles and hover text are plain text markers, so nothing from the model is rendered as markup.
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        list.map((m) => ({
          startLineNumber: m.lineStart,
          endLineNumber: Math.min(m.lineEnd, model.getLineCount()),
          startColumn: 1,
          endColumn: model.getLineMaxColumn(Math.min(m.lineEnd, model.getLineCount())),
          message: `${m.severity}: ${m.title}`,
          severity: markerSeverity(m.severity),
          source: "DiffLens",
        })),
      );
      collections.current[side] = sub.createDecorationsCollection(
        list.map((m) => ({
          range: new monaco.Range(m.lineStart, 1, Math.min(m.lineEnd, model.getLineCount()), 1),
          options: {
            isWholeLine: true,
            className: m.id === activeIdRef.current ? "dl-line dl-line-active" : "dl-line",
            glyphMarginClassName: `dl-glyph dl-glyph-${m.severity.toLowerCase()}${m.id === activeIdRef.current ? " dl-glyph-active" : ""}`,
            overviewRuler: { color: m.severity === "Critical" || m.severity === "High" ? "#f87171" : m.severity === "Medium" ? "#fbbf24" : "#38bdf8", position: monaco.editor.OverviewRulerLane.Right },
          },
        })),
      );
    }
  }, []);

  const onMount = useCallback<DiffOnMount>((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.getModifiedEditor().updateOptions({ glyphMargin: true });
    editor.getOriginalEditor().updateOptions({ glyphMargin: true });
    for (const sub of [editor.getModifiedEditor(), editor.getOriginalEditor()]) {
      sub.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const line = e.target.position?.lineNumber;
        const side = sub === editor.getModifiedEditor() ? "modified" : "original";
        const hit = markersRef.current.find((m) => m.side === side && line !== undefined && line >= m.lineStart && line <= m.lineEnd);
        if (hit) onClickRef.current(hit.id);
      });
    }
    editor.onDidUpdateDiff(() => apply());
    apply();
  }, [apply]);

  // Redraw whenever the findings, the active one, or the file contents change.
  useEffect(() => {
    const t = setTimeout(apply, 30);
    return () => clearTimeout(t);
  }, [markers, activeId, original, modified, path, apply]);

  // Scroll to a finding once the right file's text is in the editor.
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => {
      const ed = editorRef.current;
      if (!ed) return;
      const sub = focus.side === "modified" ? ed.getModifiedEditor() : ed.getOriginalEditor();
      const model = sub.getModel();
      if (!model) return;
      const line = Math.min(Math.max(1, focus.line), model.getLineCount());
      sub.revealLineInCenter(line);
      sub.setPosition({ lineNumber: line, column: 1 });
      onFocused(focus.nonce);
    }, 120);
    return () => clearTimeout(t);
  }, [focus, original, modified, onFocused]);

  useEffect(
    () => () => {
      collections.current.modified?.clear();
      collections.current.original?.clear();
    },
    [],
  );

  return (
    <DiffEditor
      height="100%"
      theme="vs-dark"
      language={languageFor(path)}
      original={original}
      modified={modified}
      onMount={onMount}
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
        glyphMargin: true,
        hideUnchangedRegions: collapse ? { enabled: true, contextLineCount: 4, minimumLineCount: 3, revealLineCount: 20 } : { enabled: false },
      }}
    />
  );
}
