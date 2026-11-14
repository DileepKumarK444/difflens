import { PageHeader } from "@/components/layout/page-header";
import { NewReviewTabs } from "@/components/review/new-review-tabs";

export default async function Page({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New review" description="Review your own changes, or a pull request from your team." />
      <NewReviewTabs initialRepoId={repo} />
    </div>
  );
}
