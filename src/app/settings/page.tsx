import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";
import { dataDir, dbPath } from "@/lib/paths";
import { PageHeader } from "@/components/layout/page-header";
import { AccountsPanel } from "@/components/settings/accounts-panel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();
  const rows: [string, string][] = [
    ["Active provider", getSetting(db, "provider")],
    ["Minimum severity", getSetting(db, "minSeverity")],
    ["GitHub host", getSetting(db, "githubHost")],
    ["Data directory", dataDir()],
    ["Database file", dbPath()],
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Current configuration (read-only until Phase 4)." />
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-3">
            <dt className="w-44 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">
        Editing providers, custom instructions and severity arrives in Phase 4.
      </p>
      <AccountsPanel />
    </div>
  );
}
