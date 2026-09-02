import "./load-env";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { Pool } from "pg";
import { cleanIndexerDatabase, INDEXER_TABLE_NAMES } from "../app/lib/db/clean";
import { closeDatabase, isDatabaseConfigured } from "../app/lib/db";

export interface CliIo {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  isTTY?: boolean;
  pool?: Pool;
}

/**
 * Safely masks credentials in database connection URLs.
 */
export function maskDatabaseUrl(rawUrl: string): string {
  if (!rawUrl) return "[not configured]";
  try {
    const url = new URL(rawUrl);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    // Fallback regex for non-standard URI strings
    return rawUrl.replace(/(:\/\/)([^:@\s]+):([^@\s]+)@/, "$1$2:***@");
  }
}

/**
 * Cleans up relayer cursor JSON files for localnet states.
 */
export function cleanRelayerCursorFiles(baseDir?: string): number {
  const dbsDir = baseDir || path.resolve(__dirname, "localnet-state", "dbs");
  if (!fs.existsSync(dbsDir)) return 0;

  let cleaned = 0;
  const files = fs.readdirSync(dbsDir);
  for (const file of files) {
    if (file.endsWith(".cursor.json")) {
      const fullPath = path.resolve(dbsDir, file);
      try {
        fs.unlinkSync(fullPath);
        cleaned++;
      } catch {
        // Ignore file removal errors
      }
    }
  }
  return cleaned;
}

function promptConfirmation(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  question: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

/**
 * Pure, testable CLI runner for database truncation.
 */
export async function runDbCleanCli(
  args: string[],
  io: CliIo = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stdin = io.stdin ?? process.stdin;
  const isTTY = io.isTTY ?? Boolean((stdin as NodeJS.ReadStream).isTTY);

  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(`
Usage: npm run db:clean [options]

Safely truncates all indexer tables and restarts identity sequences.

Options:
  --force, -y, --confirm   Bypass interactive confirmation prompt (required in CI/scripts)
  --clean-relayer, -r      Also delete local relayer cursor files (*.cursor.json)
  --help, -h               Show this help message

Tables affected:
${INDEXER_TABLE_NAMES.map((t) => `  - ${t}`).join("\n")}
\n`);
    return 0;
  }

  const isForce =
    args.includes("--force") ||
    args.includes("-y") ||
    args.includes("--confirm");
  const shouldCleanRelayer =
    args.includes("--clean-relayer") || args.includes("-r");

  const connectionString = process.env.DATABASE_URL || "";
  const dbConfigured = io.pool ? true : isDatabaseConfigured;

  if (!dbConfigured && !connectionString.startsWith("postgres")) {
    stdout.write(
      "❌ [Error]: DATABASE_URL is not configured or is invalid in .env.local / .env.\n"
    );
    return 1;
  }

  const maskedUrl = maskDatabaseUrl(connectionString);

  if (!isForce && !isTTY) {
    stdout.write(
      "❌ [Safety Guard]: Non-interactive environment detected.\n" +
        "   Truncating database tables is destructive and requires explicit confirmation.\n" +
        "   Please pass --force or -y to confirm: npm run db:clean -- --force\n"
    );
    return 1;
  }

  if (!isForce) {
    stdout.write(`\n⚠️  Target Database: ${maskedUrl}\n`);
    stdout.write(`⚠️  Tables to truncate:\n`);
    for (const table of INDEXER_TABLE_NAMES) {
      stdout.write(`   - ${table}\n`);
    }
    if (shouldCleanRelayer) {
      stdout.write(`   - Local relayer cursor files (*.cursor.json)\n`);
    }
    stdout.write("\n");

    const confirmed = await promptConfirmation(
      stdin,
      stdout,
      "Are you sure you want to truncate all indexer data? [y/N]: "
    );

    if (!confirmed) {
      stdout.write("Operation cancelled. No tables were modified.\n");
      return 0;
    }
  }

  stdout.write(`🚀 Truncating indexer tables on ${maskedUrl}...\n`);

  try {
    const result = await cleanIndexerDatabase({ pool: io.pool });
    stdout.write(
      `✅ Successfully truncated ${result.truncatedTables.length} table(s) in ${result.durationMs}ms:\n`
    );
    for (const table of result.truncatedTables) {
      stdout.write(`   ✓ ${table}\n`);
    }

    if (shouldCleanRelayer) {
      const cursorCount = cleanRelayerCursorFiles();
      stdout.write(`✅ Cleaned ${cursorCount} local relayer cursor file(s).\n`);
    }

    return 0;
  } catch (err) {
    stdout.write(`❌ [Truncate Failed]: ${(err as Error).message}\n`);
    return 1;
  } finally {
    if (!io.pool) {
      await closeDatabase();
    }
  }
}

// Direct execution entrypoint
if (typeof require !== "undefined" && require.main === module) {
  process.on("SIGINT", async () => {
    await closeDatabase();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await closeDatabase();
    process.exit(143);
  });
  runDbCleanCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
} else if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1] &&
  process.argv[1].endsWith("db-clean.ts")
) {
  process.on("SIGINT", async () => {
    await closeDatabase();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await closeDatabase();
    process.exit(143);
  });
  runDbCleanCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
