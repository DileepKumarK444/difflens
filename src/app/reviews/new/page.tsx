import { PageHeader } from "@/components/layout/page-header";
import { NewLocalReview } from "@/components/review/new-local-review";

export default async function Page({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New review" description="Review your own changes before you push." />
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-3 text-sm">
        <span className="font-medium">Local changes</span>
        <span className="text-muted-foreground">Team PRs and PR links arrive in Phase 3</span>
      </div>
      <NewLocalReview initialRepoId={repo} />
    </div>
  );
}
