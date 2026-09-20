import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { readEnvFile } from "./env-utils";

const REQUIRED_VARS = [
  "NEXT_PUBLIC_ENVIRONMENT",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "NEXT_PUBLIC_PROGRAM_ID",
  "NEXT_PUBLIC_HUMA_PROGRAM_ID",
  "NEXT_PUBLIC_USDC_MINT",
  "NEXT_PUBLIC_PST_MINT",
  "NEXT_PUBLIC_TICKET_REGISTRY",
  "NEXT_PUBLIC_ADMIN_ADDRESS",
  "NEXT_PUBLIC_FEE_WALLET",
  "NEXT_PUBLIC_RANDOMNESS_ACCOUNT",
  "NEXT_PUBLIC_HUMA_CONFIG",
  "NEXT_PUBLIC_HUMA_POOL_CONFIG",
  "NEXT_PUBLIC_HUMA_POOL_STATE",
  "NEXT_PUBLIC_HUMA_MODE_CONFIG",
  "NEXT_PUBLIC_HUMA_LENDER_STATE",
  "NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN",
  "NEXT_PUBLIC_HUMA_MODE_MINT",
  "NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN",
  "NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST",
  "DATABASE_URL",
];

const OPTIONAL_VARS = [
  "NEXT_PUBLIC_PUSHER_KEY",
  "PUSHER_APP_ID",
  "PUSHER_SECRET",
  "NEXT_PUBLIC_PUSHER_CLUSTER",
  "INDEXER_WEBHOOK_SECRET",
];

export async function syncVercelEnvs(args: string[] = process.argv.slice(2)) {
  const options = {
    "dry-run": { type: "boolean" as const, default: false },
    "force-production": { type: "boolean" as const, default: false },
    environment: { type: "string" as const, default: "preview" },
    envFile: { type: "string" as const, default: ".env.local" },
  };

  const { values } = parseArgs({
    args,
    options,
    strict: true,
    allowPositionals: true,
  });

  const isDryRun = Boolean(values["dry-run"]);
  const forceProd = Boolean(values["force-production"]);
  const envTarget = values.environment || "preview";
  const envFilePath = path.resolve(
    process.cwd(),
    values.envFile || ".env.local"
  );

  console.log(`--- Vercel Environment Sync ---`);
  console.log(`Target Environment: ${envTarget}`);
  console.log(`Source File:        ${envFilePath}`);
  console.log(`Dry Run:            ${isDryRun ? "YES" : "NO"}`);

  if (envTarget === "production" && !forceProd) {
    console.error(
      "❌ Error: Targeting 'production' requires the --force-production flag."
    );
    process.exit(1);
  }

  if (!fs.existsSync(envFilePath)) {
    console.error(`❌ Error: Source env file not found at: ${envFilePath}`);
    process.exit(1);
  }

  const parsedEnv = readEnvFile(envFilePath);

  // Validate DATABASE_URL
  const dbUrl = parsedEnv.DATABASE_URL;
  if (dbUrl) {
    if (
      !dbUrl.startsWith("postgres://") &&
      !dbUrl.startsWith("postgresql://")
    ) {
      console.error(
        "❌ Error: DATABASE_URL must be a valid PostgreSQL connection string starting with postgres:// or postgresql://"
      );
      process.exit(1);
    }
    if (
      dbUrl.includes("localhost") ||
      dbUrl.includes("127.0.0.1") ||
      dbUrl.includes("::1")
    ) {
      console.error(
        "❌ Error: DATABASE_URL points to localhost/127.0.0.1. A cloud database (e.g. Neon) is required for Vercel deployments."
      );
      process.exit(1);
    }
  }

  // Collect variables to sync
  const varsToSync: [string, string][] = [];

  for (const varName of REQUIRED_VARS) {
    const val = parsedEnv[varName];
    if (val !== undefined && val !== "") {
      varsToSync.push([varName, val]);
    } else {
      console.warn(
        `⚠️  Warning: Required variable ${varName} is missing or empty in ${values.envFile}`
      );
    }
  }

  for (const varName of OPTIONAL_VARS) {
    const val = parsedEnv[varName];
    if (val !== undefined && val !== "") {
      varsToSync.push([varName, val]);
    }
  }

  console.log(`\nFound ${varsToSync.length} variables to sync.`);

  for (const [key, val] of varsToSync) {
    const maskedVal =
      key.includes("SECRET") ||
      key.includes("KEY") ||
      key.includes("URL") ||
      key.includes("PASSWORD")
        ? val.length > 8
          ? `${val.slice(0, 4)}...${val.slice(-4)}`
          : "********"
        : val;

    console.log(`\n[${key}] -> ${maskedVal}`);

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would remove existing ${key} and add for ${envTarget}`
      );
      continue;
    }

    // Step 1: Remove existing env if already present in Vercel to avoid duplicates
    try {
      execFileSync("vercel", ["env", "rm", key, envTarget, "-y"], {
        stdio: "ignore",
      });
    } catch {
      // Ignored if variable does not already exist
    }

    // Step 2: Add env variable non-interactively via stdin buffer pipe
    try {
      execFileSync("vercel", ["env", "add", key, envTarget], {
        input: Buffer.from(val),
        stdio: ["pipe", "inherit", "inherit"],
      });
      console.log(`  ✓ Synced ${key} to ${envTarget}`);
    } catch (err) {
      console.error(`  ❌ Failed to sync ${key}:`, err);
    }
  }

  console.log("\n✓ Vercel environment sync routine finished.");
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("sync-vercel-envs.ts") ||
    process.argv[1].endsWith("sync-vercel-envs.js"))
) {
  syncVercelEnvs().catch((err) => {
    console.error("Unhandled error syncing Vercel environments:", err);
    process.exit(1);
  });
}
