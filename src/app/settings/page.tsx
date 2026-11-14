import { dataDir, dbPath } from "@/lib/paths";
import { PageHeader } from "@/components/layout/page-header";
import { AccountsPanel } from "@/components/settings/accounts-panel";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { GithubHostForm } from "@/components/settings/github-host-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const rows: [string, string][] = [
    ["Data directory", dataDir()],
    ["Database file", dbPath()],
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Where your data lives, which AI reviews your code, and your GitHub accounts." />
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-3">
            <dt className="w-44 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <AiSettingsForm />
      <AccountsPanel />
      <GithubHostForm />
    </div>
  );
}
