"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NewLocalReview } from "./new-local-review";
import { PrLink } from "./pr-link";
import { TeamPrs } from "./team-prs";

const TABS = [
  { id: "local", label: "Local changes" },
  { id: "team", label: "Team PRs" },
  { id: "link", label: "PR link" },
] as const;

export function NewReviewTabs({ initialRepoId }: { initialRepoId?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("local");
  return (
    <div>
      <div role="tablist" aria-label="Review source" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              tab === t.id ? "border-primary text-foreground" : "border-transparent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "local" ? <NewLocalReview initialRepoId={initialRepoId} /> : tab === "team" ? <TeamPrs /> : <PrLink />}
      </div>
    </div>
  );
}
