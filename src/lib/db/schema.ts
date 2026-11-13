import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"] as const;
export const FINDING_STATUSES = ["open", "resolved", "ignored"] as const;
export const REVIEW_STATUSES = ["pending", "running", "complete", "partial", "failed"] as const;

/** Local git repositories the user has explicitly added. */
export const repos = sqliteTable("repos", {
  id: id(),
  path: text("path").notNull().unique(),
  name: text("name").notNull(),
  remoteUrl: text("remote_url"),
  githubHost: text("github_host"),
  ownerRepo: text("owner_repo"),
  createdAt: createdAt(),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: id(),
    kind: text("kind", { enum: ["local", "pr"] }).notNull(),
    /** JSON describing the scope (staged, commit, range, branch, or PR ref). */
    source: text("source").notNull(),
    title: text("title").notNull(),
    repoId: text("repo_id").references(() => repos.id, { onDelete: "set null" }),
    prHost: text("pr_host"),
    prOwnerRepo: text("pr_owner_repo"),
    prNumber: integer("pr_number"),
    provider: text("provider").notNull(),
    model: text("model"),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("pending"),
    partialReason: text("partial_reason"),
    errorMessage: text("error_message"),
    /** Unified diff snapshot so history opens without git or GitHub. */
    diffSnapshot: text("diff_snapshot"),
    minSeverity: text("min_severity", { enum: SEVERITIES }),
    createdAt: createdAt(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("reviews_created_idx").on(t.createdAt)],
);

export const reviewFiles = sqliteTable(
  "review_files",
  {
    id: id(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    status: text("status").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
  },
  (t) => [index("review_files_review_idx").on(t.reviewId)],
);

export const findings = sqliteTable(
  "findings",
  {
    id: id(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    filePath: text("file_path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    description: text("description").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    suggestedFix: text("suggested_fix").notNull(),
    codeExample: text("code_example"),
    confidence: real("confidence").notNull(),
    /** exact = file and lines matched the diff; downgraded = moved or lowered. */
    verification: text("verification", { enum: ["exact", "downgraded"] }).notNull().default("exact"),
    status: text("status", { enum: FINDING_STATUSES }).notNull().default("open"),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("findings_review_idx").on(t.reviewId),
    index("findings_status_idx").on(t.status, t.severity),
  ],
);

/** Key/value app settings; values are JSON. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * GitHub accounts added with a pasted token. The token itself lives only in the macOS
 * Keychain (service "DiffLens GitHub token", account = this id), never in this table.
 * Accounts that come from `gh auth login` are listed live and are not stored here.
 */
export const accounts = sqliteTable("accounts", {
  id: id(),
  host: text("host").notNull(),
  login: text("login").notNull(),
  label: text("label").notNull(),
  createdAt: createdAt(),
});
