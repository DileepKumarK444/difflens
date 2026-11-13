import { PageHeader, NotBuilt } from "@/components/layout/page-header";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Repositories" description="Local git repos you have added." />
      <NotBuilt phase={2} what="Adding repositories and viewing git status" />
    </div>
  );
}
