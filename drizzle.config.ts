import { defineConfig } from "drizzle-kit";

// Used only to generate migrations (`npm run db:generate`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
