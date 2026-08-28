import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "";

export const isDatabaseConfigured = Boolean(
  connectionString && connectionString.startsWith("postgres")
);

// Safe initialization that avoids throwing when DATABASE_URL is unset in dev/test/fallback environments
const sql = isDatabaseConfigured
  ? neon(connectionString)
  : (neon("postgresql://dummy:dummy@localhost/dummy") as ReturnType<
      typeof neon
    >);

export const db = drizzle(sql, { schema });
