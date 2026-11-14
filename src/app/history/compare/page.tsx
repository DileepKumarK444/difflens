import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { CompareView } from "@/components/history/compare-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const ok = (v?: string): v is string => Boolean(v && /^[0-9a-f-]{36}$/.test(v));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Compare reviews" description="What changed between two reviews of the same work." />
      {ok(a) && ok(b) && a !== b ? (
        <CompareView a={a} b={b} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Choose two different reviews in{" "}
          <Link href="/history" className="underline">
            History
          </Link>
          .
        </p>
      )}
    </div>
  );
}
