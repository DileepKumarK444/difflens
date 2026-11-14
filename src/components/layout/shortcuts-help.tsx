"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";

const KEYS: [string, string][] = [
  ["j / k", "Next / previous changed file"],
  ["]  /  [", "Next / previous finding (in the current filter)"],
  ["r", "Resolve the selected finding"],
  ["i", "Ignore the selected finding"],
  ["o", "Reopen the selected finding"],
  ["?", "Show this list"],
  ["Esc", "Close a dialog"],
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.closest(".monaco-editor"))) return;
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Keyboard shortcuts">
        <Keyboard className="size-3.5" aria-hidden /> Shortcuts (?)
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-labelledby="keys-title" className="m-auto w-[min(26rem,92vw)] rounded-xl border border-border bg-popover p-5 text-sm text-popover-foreground backdrop:bg-black/60">
        <h2 id="keys-title" className="text-base font-medium">
          Keyboard shortcuts
        </h2>
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2">
          {KEYS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Keys on the review page work when you aren’t typing in a box or the editor.</p>
        <form method="dialog" className="mt-4 flex justify-end">
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">Close</button>
        </form>
      </dialog>
    </>
  );
}
