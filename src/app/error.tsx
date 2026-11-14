"use client";

import { Button } from "@/components/ui/button";

/** Shown when a page throws. The message is generic on purpose: nothing from the error is displayed. */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">This page hit an unexpected error. Your reviews and notes are saved and weren’t affected.</p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
