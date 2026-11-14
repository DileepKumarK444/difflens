/**
 * Defense in depth: DiffLens builds every gh command from validated pieces, and this guard makes sure
 * that nothing else can ever run. Only read-only commands are allowed, plus exactly one write:
 * posting a review (event COMMENT) to a pull request, which the user confirms first.
 */

export class GhNotAllowed extends Error {}

const SHA = "[0-9a-f]{40}";
const SEG = "[A-Za-z0-9._-]+";
const ENDPOINTS: { name: string; re: RegExp; write?: boolean }[] = [
  { name: "user", re: /^user$/ },
  { name: "compare", re: new RegExp(`^repos/${SEG}/${SEG}/compare/${SHA}\\.\\.\\.${SHA}$`) },
  { name: "contents", re: new RegExp(`^repos/${SEG}/${SEG}/contents/[^?\\s]+\\?ref=${SHA}$`) },
  { name: "review", re: new RegExp(`^repos/${SEG}/${SEG}/pulls/[0-9]{1,7}/reviews$`), write: true },
];

const PR_FLAGS_WITH_VALUE = new Set(["-R", "--state", "--limit", "--json", "--search", "--author", "--color"]);
const API_FLAGS_WITH_VALUE = new Set(["--hostname", "--jq", "-H", "-X", "--input"]);
const HEADER_OK = /^Accept: application\/vnd\.github(\.raw)?\+json$/;

export function assertGhAllowed(args: string[]): void {
  const [cmd, sub] = args;
  if (cmd === "auth") {
    if (sub === "token" || sub === "status") return;
    throw new GhNotAllowed(`gh auth ${sub ?? ""} is not allowed`);
  }

  if (cmd === "pr") {
    if (sub !== "list" && sub !== "view" && sub !== "diff") throw new GhNotAllowed(`gh pr ${sub ?? ""} is not allowed`);
    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (PR_FLAGS_WITH_VALUE.has(a)) {
        i++;
        continue;
      }
      if (/^[0-9]{1,7}$/.test(a)) continue;
      throw new GhNotAllowed(`gh pr ${sub}: option ${a} is not allowed`);
    }
    return;
  }

  if (cmd === "api") {
    let endpoint: string | null = null;
    let method = "GET";
    let input: string | null = null;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (API_FLAGS_WITH_VALUE.has(a)) {
        const v = args[++i];
        if (v === undefined) throw new GhNotAllowed("gh api: missing option value");
        if (a === "-X") method = v;
        else if (a === "--input") input = v;
        else if (a === "-H" && !HEADER_OK.test(v)) throw new GhNotAllowed("gh api: header is not allowed");
        continue;
      }
      if (a.startsWith("-")) throw new GhNotAllowed(`gh api: option ${a} is not allowed`);
      if (endpoint !== null) throw new GhNotAllowed("gh api: more than one endpoint");
      endpoint = a;
    }
    const match = endpoint ? ENDPOINTS.find((e) => e.re.test(endpoint!)) : undefined;
    if (!match) throw new GhNotAllowed("gh api: this endpoint is not allowed");
    if (match.write) {
      if (method !== "POST" || input !== "-") throw new GhNotAllowed("gh api: a review can only be posted with POST and --input -");
      return;
    }
    if (method !== "GET" || input !== null) throw new GhNotAllowed("gh api: this endpoint is read-only");
    return;
  }

  throw new GhNotAllowed(`gh ${cmd ?? ""} is not allowed`);
}
