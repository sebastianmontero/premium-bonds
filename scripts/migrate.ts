import "./load-env";
import * as path from "node:path";
import { runMigrations } from "../app/lib/db/migrate";

const rootDir = path.resolve(__dirname, "..");

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !connectionString.startsWith("postgres")) {
    console.error(
      "❌ [Migration Error]: DATABASE_URL is not configured or is invalid in .env.local / .env."
    );
    console.error(
      "   Please set DATABASE_URL=postgresql://user:pass@host/dbname in .env.local"
    );
    process.exit(1);
  }

  console.log("🚀 Running database migrations against PostgreSQL database...");
  const migrationsFolder = path.resolve(rootDir, "drizzle");
  try {
    await runMigrations(connectionString, migrationsFolder);
    console.log("✅ Database migrations applied successfully!");
  } catch (error) {
    console.error("❌ [Migration Failed]:", error);
    process.exitCode = 1;
  }
}

runMigration();
