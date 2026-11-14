import { Workspace, type WorkspaceSource } from "@/components/review/workspace";
import { PrRefSchema } from "@/lib/gh/parse";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ repo?: string; scope?: string; pr?: string }> }) {
  const { repo, scope, pr } = await searchParams;
  let source: WorkspaceSource | null = null;
  if (pr) {
    try {
      const parsed = PrRefSchema.parse(JSON.parse(pr));
      source = { kind: "pr", prJson: pr, host: parsed.host };
    } catch {
      return <p className="text-sm text-muted-foreground">That pull request link isn’t valid. Start again from New review.</p>;
    }
  } else if (repo && scope) {
    source = { kind: "local", repoId: repo, scopeJson: scope };
  }
  if (!source) return <p className="text-sm text-muted-foreground">Choose something to review in New review first.</p>;
  return <Workspace source={source} />;
}
