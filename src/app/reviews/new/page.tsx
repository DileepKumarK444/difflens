import { PageHeader, NotBuilt } from "@/components/layout/page-header";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New review" description="Local changes, team PRs, or a PR link." />
      <NotBuilt phase={2} what="Local change reviews (PR sources follow in Phase 3)" />
    </div>
  );
}
