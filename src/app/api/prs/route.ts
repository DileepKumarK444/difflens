import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-helpers";
import { ParseError, parseRemoteUrl, parseRepoInput, type RepoRef } from "@/lib/gh/parse";
import { PR_FILTERS, listPrs, listPrsAcross, type PrFilter } from "@/lib/gh/prs";
import { listRepos } from "@/lib/git/repos-db";
import { configuredHosts } from "@/lib/pr-api";

export const dynamic = "force-dynamic";

const Filter = z.enum(PR_FILTERS as [PrFilter, ...PrFilter[]]);

/** GET /api/prs?repo=owner/repo[&filter=][&account=]  or  ?all=1 for every added repo with a GitHub remote. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const filter = Filter.safeParse(q.get("filter") ?? "all");
    if (!filter.success) throw new ParseError("Unknown filter");
    const account = q.get("account") ?? undefined; // absent = default account, "" = plain gh
    if (account !== undefined && account.length > 200) throw new ParseError("Invalid account");
    const db = getDb();
    const hosts = configuredHosts();

    if (q.get("all") === "1") {
      const refs: RepoRef[] = [];
      for (const r of listRepos(db)) {
        const ref = parseRemoteUrl(r.remoteUrl);
        if (ref && hosts.has(ref.host)) refs.push(ref);
      }
      return NextResponse.json({ results: await listPrsAcross(db, refs, filter.data, account) });
    }

    const repoParam = q.get("repo");
    if (!repoParam) throw new ParseError("Enter the repository as owner/repo");
    const ref = parseRepoInput(repoParam, hosts);
    return NextResponse.json({ results: [{ repo: ref, prs: await listPrs(db, ref, filter.data, account), error: null }] });
  } catch (e) {
    return errorResponse(e);
  }
}
