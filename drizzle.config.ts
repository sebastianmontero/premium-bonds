import { defineConfig } from "drizzle-kit";
import fs from "node:fs";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// Load .env.local first so local overrides take precedence in process.env
if (fs.existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
// Load .env second to populate fallback defaults without overwriting .env.local
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
