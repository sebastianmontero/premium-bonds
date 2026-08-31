import { defineConfig } from "drizzle-kit";
import fs from "node:fs";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const envLocalPath = path.resolve(configDir, ".env.local");
const envPath = path.resolve(configDir, ".env");

// Load .env.local first so local overrides take precedence in process.env
if (fs.existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}
// Load .env second to populate fallback defaults without overwriting .env.local
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
