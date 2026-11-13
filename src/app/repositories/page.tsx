import { PageHeader } from "@/components/layout/page-header";
import { ReposPanel } from "@/components/repos/repos-panel";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Repositories" description="Local git repos you have added. DiffLens only reads them." />
      <ReposPanel />
    </div>
  );
}
