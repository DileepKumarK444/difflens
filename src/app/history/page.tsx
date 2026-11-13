import { PageHeader, NotBuilt } from "@/components/layout/page-header";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="History" description="Saved reviews." />
      <NotBuilt phase={6} what="Browsing, comparing and exporting reviews" />
    </div>
  );
}
