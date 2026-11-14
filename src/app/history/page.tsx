import { PageHeader } from "@/components/layout/page-header";
import { HistoryPanel } from "@/components/history/history-panel";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="History" description="Every review you’ve run. Open one, compare two, export it, or delete it." />
      <HistoryPanel />
    </div>
  );
}
