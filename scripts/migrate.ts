import fs from "node:fs";
import path from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

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
    "🚀 Running database migrations against Neon PostgreSQL via WebSocket Pool..."
  );
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  const migrationsFolder = path.resolve(rootDir, "drizzle");
  try {
    await migrate(db, { migrationsFolder });
    console.log("✅ Database migrations applied successfully!");
  } catch (error) {
    console.error("❌ [Migration Failed]:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigration();
