import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// Load environment variables relative to project root
const rootDir = path.resolve(__dirname, "..");
const envLocalPath = path.resolve(rootDir, ".env.local");
const envPath = path.resolve(rootDir, ".env");

if (fs.existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

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

  console.log(
    "🚀 Running database migrations against Neon PostgreSQL via HTTP..."
  );
  const sql = neon(connectionString);
  const db = drizzle(sql);

  const migrationsFolder = path.resolve(rootDir, "drizzle");
  try {
    await migrate(db, { migrationsFolder });
    console.log("✅ Database migrations applied successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ [Migration Failed]:", error);
    process.exit(1);
  }
}

runMigration();
