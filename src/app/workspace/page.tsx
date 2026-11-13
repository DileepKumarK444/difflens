import { Workspace } from "@/components/review/workspace";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ repo?: string; scope?: string }> }) {
  const { repo, scope } = await searchParams;
  if (!repo || !scope) {
    return <p className="text-sm text-muted-foreground">Choose a repository and scope in New review first.</p>;
  }
  return <Workspace repoId={repo} scopeJson={scope} />;
}
