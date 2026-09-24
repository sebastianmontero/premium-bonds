import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { readEnvFile } from "./env-utils";
import { isLocalMockUrl } from "./devnet-state";

const nodeRequire = createRequire(import.meta.url);

export const REQUIRED_VARS = [
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

export const OPTIONAL_VARS = [
  "NEXT_PUBLIC_PUSHER_KEY",
  "PUSHER_APP_ID",
  "PUSHER_KEY",
  "PUSHER_SECRET",
  "NEXT_PUBLIC_PUSHER_CLUSTER",
  "PUSHER_CLUSTER",
  "INDEXER_WEBHOOK_SECRET",
];

export interface VercelRunnerConfig {
  executable: string;
  baseArgs: string[];
  options?: { shell?: boolean };
}

export interface VercelCliRunner {
  readonly executable: string;
  readonly baseArgs: readonly string[];
  exec(
    args: string[],
    options?: { input?: Buffer | string; stdio?: unknown }
  ): void;
  execCapture(args: string[]): string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export interface SyncItemResult {
  key: string;
  status: "synced" | "dry_run" | "failed";
  error?: string;
}

export interface SyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  failedKeys: string[];
  results: SyncItemResult[];
}

export interface SyncVercelOptions {
  environment: string;
  forceProduction: boolean;
  dryRun: boolean;
  envFile: string;
}

export const VERCEL_CONFIG_FILES = [
  path.join(".vercel", "project.json"),
  path.join(".vercel", "repo.json"),
] as const;

export interface VercelLinkCheckOptions {
  projectDir?: string;
  fileExists?: (filePath: string) => boolean;
  env?: Record<string, string | undefined>;
}

export interface SyncDependencies {
  runner?: VercelCliRunner;
  envReader?: (filePath: string) => Record<string, string>;
  fileExists?: (filePath: string) => boolean;
  env?: Record<string, string | undefined>;
  preflightChecker?: (
    runner: VercelCliRunner,
    options?: string | VercelLinkCheckOptions
  ) => void;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

/**
 * Resolves local vercel entry point via package.json bin lookup,
 * falling back cleanly to npx.
 */
export function resolveVercelBinaryConfig(): VercelRunnerConfig {
  try {
    const pkgPath = nodeRequire.resolve("vercel/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const binRelPath =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin?.vercel || pkg.bin?.vc || "./dist/vc.js";
    const binPath = path.resolve(path.dirname(pkgPath), binRelPath);

    if (fs.existsSync(binPath)) {
      return { executable: process.execPath, baseArgs: [binPath] };
    }
  } catch {
    // Fall back to npx
  }

  const isWin = process.platform === "win32";
  return {
    executable: isWin ? "npx.cmd" : "npx",
    baseArgs: ["--yes", "vercel"],
    options: { shell: isWin },
  };
}

/**
 * Factory creating an executable Vercel CLI runner interface.
 */
export function createVercelCliRunner(
  customConfig?: VercelRunnerConfig
): VercelCliRunner {
  const config = customConfig ?? resolveVercelBinaryConfig();
  return {
    executable: config.executable,
    baseArgs: config.baseArgs,
    exec(args, options = {}) {
      execFileSync(config.executable, [...config.baseArgs, ...args], {
        stdio: (options.stdio as any) ?? "inherit",
        input: options.input,
        ...config.options,
      });
    },
    execCapture(args) {
      return execFileSync(config.executable, [...config.baseArgs, ...args], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        ...config.options,
      }).trim();
    },
  };
}

/**
 * Checks whether the current directory or specified options represent a linked Vercel project.
 * Evaluates VERCEL_PROJECT_ID first, then probes candidate config files (.vercel/project.json, .vercel/repo.json).
 */
export function isProjectLinked(options: VercelLinkCheckOptions = {}): boolean {
  const env = options.env ?? process.env;
  const envProjectId = env.VERCEL_PROJECT_ID?.trim();
  if (Boolean(envProjectId)) {
    return true;
  }

  const fileExists = options.fileExists ?? fs.existsSync;
  const projectDir = options.projectDir ?? process.cwd();

  return VERCEL_CONFIG_FILES.some((relPath) =>
    fileExists(path.resolve(projectDir, relPath))
  );
}

/**
 * Verifies project directory linkage and CLI authentication before proceeding.
 * Accepts either a string path (for projectDir) or a structured VercelLinkCheckOptions object.
 */
export function checkVercelPreflight(
  runner: VercelCliRunner,
  options?: string | VercelLinkCheckOptions
): void {
  const opts: VercelLinkCheckOptions =
    typeof options === "string" ? { projectDir: options } : (options ?? {});

  if (!isProjectLinked(opts)) {
    throw new Error(
      "❌ Project is not linked to Vercel. Run 'npx vercel link' or provide VERCEL_PROJECT_ID before syncing environment variables."
    );
  }

  try {
    runner.execCapture(["whoami"]);
  } catch (err: any) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(
      `❌ Vercel CLI authentication failed (${msg}). Please run 'npx vercel login'.`
    );
  }
}

/**
 * Pure validation for PostgreSQL database connection URLs.
 */
export function validateDatabaseUrl(url: string | undefined): ValidationResult {
  if (!url) return { valid: true };
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    return {
      valid: false,
      error:
        "DATABASE_URL must be a valid PostgreSQL connection string starting with postgres:// or postgresql://",
    };
  }
  if (isLocalMockUrl(url)) {
    return {
      valid: false,
      error:
        "DATABASE_URL points to a local/loopback host. A cloud database (e.g. Neon) is required for Vercel deployments.",
    };
  }
  return { valid: true };
}

export type VercelEnvType = "config" | "secret";

export const SENSITIVE_KEY_PATTERN =
  /(?:SECRET|KEY|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE|WEBHOOK)/i;

export const EXPLICIT_SECRET_KEYS = new Set<string>(["DATABASE_URL"]);

/**
 * Resolves whether an environment variable should be added as public "config" or private "secret" in Vercel CLI.
 */
export function determineVercelEnvType(key: string): VercelEnvType {
  if (key.startsWith("NEXT_PUBLIC_")) {
    return "config";
  }
  if (EXPLICIT_SECRET_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
    return "secret";
  }
  return "config";
}

/**
 * Masks sensitive variable values for log output while retaining diagnostics.
 */
export function maskSecret(key: string, value: string): string {
  if (!value) return "";

  if (value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    try {
      const parsed = new URL(value);
      if (parsed.password) {
        parsed.password = "********";
      }
      return parsed.toString();
    } catch {
      return "postgres://********";
    }
  }

  if (!SENSITIVE_KEY_PATTERN.test(key)) {
    return value;
  }

  if (value.length <= 8) {
    return "********";
  }
  if (value.length <= 16) {
    return `****...${value.slice(-4)}`;
  }
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

/**
 * Parses command-line arguments into structured sync options.
 */
export function parseSyncArgs(
  args: string[] = process.argv.slice(2)
): SyncVercelOptions {
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

  return {
    dryRun: Boolean(values["dry-run"]),
    forceProduction: Boolean(values["force-production"]),
    environment: values.environment || "preview",
    envFile: values.envFile || ".env.local",
  };
}

/**
 * Core synchronization pipeline with optional dependency injection.
 */
export async function executeVercelSync(
  options: SyncVercelOptions,
  deps: SyncDependencies = {}
): Promise<SyncSummary> {
  const runner = deps.runner ?? createVercelCliRunner();
  const fileExists = deps.fileExists ?? fs.existsSync;
  const envReader = deps.envReader ?? readEnvFile;
  const preflightChecker = deps.preflightChecker ?? checkVercelPreflight;
  const logger = deps.logger ?? console;

  const summary: SyncSummary = {
    total: 0,
    succeeded: 0,
    failed: 0,
    failedKeys: [],
    results: [],
  };

  logger.log(`--- Vercel Environment Sync ---`);
  logger.log(`Target Environment: ${options.environment}`);
  logger.log(`Source File:        ${options.envFile}`);
  logger.log(`Dry Run:            ${options.dryRun ? "YES" : "NO"}`);

  if (options.environment === "production" && !options.forceProduction) {
    throw new Error(
      "❌ Targeting 'production' requires the --force-production flag."
    );
  }

  const envFilePath = path.resolve(process.cwd(), options.envFile);
  if (!fileExists(envFilePath)) {
    throw new Error(`❌ Source env file not found at: ${envFilePath}`);
  }

  const parsedEnv = envReader(envFilePath);
  const dbValidation = validateDatabaseUrl(parsedEnv.DATABASE_URL);
  if (!dbValidation.valid) {
    throw new Error(`❌ ${dbValidation.error}`);
  }

  if (!options.dryRun) {
    preflightChecker(runner, {
      fileExists,
      projectDir: process.cwd(),
      env: deps.env,
    });
  }

  const varsToSync: [string, string][] = [];
  for (const varName of REQUIRED_VARS) {
    const val = parsedEnv[varName];
    if (val !== undefined && val !== "") {
      varsToSync.push([varName, val]);
    } else {
      logger.warn(
        `⚠️  Warning: Required variable ${varName} is missing or empty in ${options.envFile}`
      );
    }
  }

  for (const varName of OPTIONAL_VARS) {
    const val = parsedEnv[varName];
    if (val !== undefined && val !== "") {
      varsToSync.push([varName, val]);
    }
  }

  summary.total = varsToSync.length;
  logger.log(`\nFound ${varsToSync.length} variables to sync.`);

  for (const [key, val] of varsToSync) {
    const envType = determineVercelEnvType(key);
    logger.log(`\n[${key}] -> ${maskSecret(key, val)}`);

    if (options.dryRun) {
      logger.log(
        `  [DRY-RUN] Would remove existing ${key} and add for ${options.environment} (type: ${envType})`
      );
      summary.succeeded++;
      summary.results.push({ key, status: "dry_run" });
      continue;
    }

    try {
      // Step 1: Remove existing env variable if present
      try {
        runner.execCapture(["env", "rm", key, options.environment, "-y"]);
      } catch (rmErr: any) {
        const stderr = rmErr.stderr ? rmErr.stderr.toString() : "";
        const isNotFound = /not found|was not found|does not exist/i.test(
          stderr
        );
        if (!isNotFound && /unauthorized|not linked|login/i.test(stderr)) {
          throw new Error(
            `Fatal Vercel CLI error removing ${key}: ${stderr.trim()}`
          );
        }
      }

      // Step 2: Add env variable with sanitized stdin
      const sanitizedVal = val.replace(/\r\n/g, "\n").trim();
      runner.exec(
        ["env", "add", key, options.environment, "--type", envType, "--yes"],
        {
          input: Buffer.from(sanitizedVal),
          stdio: ["pipe", "inherit", "pipe"],
        }
      );

      logger.log(`  ✓ Synced ${key} to ${options.environment}`);
      summary.succeeded++;
      summary.results.push({ key, status: "synced" });
    } catch (err: any) {
      const stderr = err.stderr ? err.stderr.toString().trim() : "";
      const errMsg = stderr || err.message || String(err);
      logger.error(`  ❌ Failed to sync ${key}: ${errMsg}`);
      summary.failed++;
      summary.failedKeys.push(key);
      summary.results.push({ key, status: "failed", error: errMsg });
    }
  }

  logger.log("\n✓ Vercel environment sync routine finished.");
  return summary;
}

/**
 * Top-level CLI entrypoint.
 */
export async function syncVercelEnvs(
  args: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseSyncArgs(args);
  const summary = await executeVercelSync(options);
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
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
