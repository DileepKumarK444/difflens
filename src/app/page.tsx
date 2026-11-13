import { getDb } from "@/lib/db";
import { dashboardStats } from "@/lib/db/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={
            tone === "danger" && value > 0
              ? "text-2xl font-medium text-red-400"
              : tone === "warn" && value > 0
                ? "text-2xl font-medium text-amber-300"
                : "text-2xl font-medium"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const s = dashboardStats(getDb());
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Dashboard" description="Your reviews and findings at a glance." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Reviews" value={s.reviewCount} />
        <Stat label="Open findings" value={s.openFindings} tone="warn" />
        <Stat label="Open critical" value={s.openCritical} tone="danger" />
        <Stat label="Repositories" value={s.repoCount} />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-medium">Recent reviews</h2>
      {s.recent.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No reviews yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews you run will appear here. Running reviews is built in Phases 2 to 4.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {s.recent.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <Badge variant="outline">{r.kind === "pr" ? "PR" : "Local"}</Badge>
              <span className="text-muted-foreground">{r.findingCount} findings</span>
              {r.openCritical > 0 ? <Badge variant="destructive">{r.openCritical} critical</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
