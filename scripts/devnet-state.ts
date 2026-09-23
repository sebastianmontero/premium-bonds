import * as fs from "fs";
import * as path from "path";
import { readEnvFile, upsertEnvFile } from "./env-utils";
import { PROGRAM_ID, HUMA_PROGRAM_ID } from "../app/lib/bonds-sdk";

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DEVNET_STATE_DIR = path.resolve(__dirname, "devnet-state");
export const DEVNET_ADDRESSES_PATH = path.resolve(
  DEVNET_STATE_DIR,
  "addresses.json"
);
export const DEVNET_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.devnet");
export const LOCAL_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.local");
export const DEFAULT_ENV_PATH = path.resolve(PROJECT_ROOT, ".env");

/**
 * Checks whether a given URL points to a local emulator, Docker container, or loopback interface.
 */
export function isLocalMockUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0") ||
    url.includes("::1")
  );
}

/**
 * Category B: On-Chain Protocol Addresses and deployment accounts.
 */
export interface DevnetProtocolAccounts {
  programId: string;
  humaProgramId: string;
  adminAddress: string;
  usdcMint: string;
  pstMint: string;
  ticketRegistry: string;
  feeWallet: string;
  humaPoolState: string;
  humaLenderState: string;
  humaPoolUnderlying: string;
  humaPoolModeToken: string;
  humaRedemptionRequest: string;
  randomnessAccount?: string;
}

/**
 * Declarative configuration for preserved cloud variables.
 * Eliminates Shotgun Surgery and duplication when managing cloud keys.
 */
export interface PreservedCloudVarConfig {
  readonly envKey: string;
  readonly defaultValue?: string;
  readonly isLocalMock: (val: string, env: Record<string, string>) => boolean;
}

export const PRESERVED_CLOUD_VARS: readonly PreservedCloudVarConfig[] = [
  {
    envKey: "DATABASE_URL",
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "HELIUS_WEBHOOK_SECRET",
    isLocalMock: (val) => val === "pb_webhook_secret_local_dev_123",
  },
  {
    envKey: "NEXT_PUBLIC_SOLANA_RPC_URL",
    defaultValue: "https://api.devnet.solana.com",
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "SOLANA_RPC_URL",
    defaultValue: "https://api.devnet.solana.com",
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "NEXT_PUBLIC_SOLANA_WS_URL",
    defaultValue: "wss://api.devnet.solana.com",
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "SOLANA_WS_URL",
    defaultValue: "wss://api.devnet.solana.com",
    isLocalMock: isLocalMockUrl,
  },
];

/**
 * Reads the public on-chain protocol addresses from scripts/devnet-state/addresses.json.
 */
export function readDevnetAddresses(
  filePath: string = DEVNET_ADDRESSES_PATH
): Partial<DevnetProtocolAccounts> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Devnet State] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * Writes the public on-chain protocol addresses to scripts/devnet-state/addresses.json.
 */
export function writeDevnetAddresses(
  addresses: DevnetProtocolAccounts,
  filePath: string = DEVNET_ADDRESSES_PATH
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), "utf-8");
}

/**
 * Safeguards Devnet credentials from .env.local into .env.devnet before Localnet mutates .env.local.
 * STRICT GUARD: Only runs if .env.local is actively set to NEXT_PUBLIC_ENVIRONMENT=devnet.
 */
export function safeguardDevnetEnv(
  activeEnvPath: string = LOCAL_ENV_PATH,
  devnetEnvPath: string = DEVNET_ENV_PATH
): Record<string, string> {
  if (!fs.existsSync(activeEnvPath)) return {};
  const currentEnv = readEnvFile(activeEnvPath);

  // Strict mode guard: Never extract credentials if .env.local is already in localnet mode.
  // This prevents Docker container hostnames or local IPs from clobbering Neon cloud credentials.
  if (currentEnv.NEXT_PUBLIC_ENVIRONMENT !== "devnet") {
    return {};
  }

  const updates: Record<string, string> = {};

  for (const item of PRESERVED_CLOUD_VARS) {
    const val = currentEnv[item.envKey];
    if (val && !item.isLocalMock(val, currentEnv)) {
      updates[item.envKey] = val;
    }
  }

  if (Object.keys(updates).length > 0) {
    console.log(
      `ℹ Safeguarding Devnet cloud credentials into ${path.basename(devnetEnvPath)}...`
    );
    upsertEnvFile(devnetEnvPath, updates, {
      headerComment: "# Devnet Environment Profile (Auto-synchronized)",
    });
  }

  return updates;
}

/**
 * Assembles the full dictionary of Devnet variables by merging on-chain addresses
 * and .env.devnet cloud credentials, then synchronizes it into the active target environment file.
 */
export function syncDevnetToActiveEnv(
  targetFile: string = LOCAL_ENV_PATH,
  devnetEnvPath: string = DEVNET_ENV_PATH,
  addressesPath: string = DEVNET_ADDRESSES_PATH
): Record<string, string> {
  const addresses = readDevnetAddresses(addressesPath) || {};
  const devnetEnv = fs.existsSync(devnetEnvPath)
    ? readEnvFile(devnetEnvPath)
    : {};
  const currentTargetEnv = fs.existsSync(targetFile)
    ? readEnvFile(targetFile)
    : {};

  // Hierarchical address resolution: addresses.json > .env.devnet > canonical SDK constants
  const programId =
    addresses.programId || devnetEnv.NEXT_PUBLIC_PROGRAM_ID || PROGRAM_ID;
  const humaProgramId =
    addresses.humaProgramId ||
    devnetEnv.NEXT_PUBLIC_HUMA_PROGRAM_ID ||
    HUMA_PROGRAM_ID;
  const usdcMint =
    addresses.usdcMint ||
    devnetEnv.NEXT_PUBLIC_USDC_MINT ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const pstMint = addresses.pstMint || devnetEnv.NEXT_PUBLIC_PST_MINT || "";
  const ticketRegistry =
    addresses.ticketRegistry || devnetEnv.NEXT_PUBLIC_TICKET_REGISTRY || "";
  const adminAddress =
    addresses.adminAddress || devnetEnv.NEXT_PUBLIC_ADMIN_ADDRESS || "";
  const feeWallet =
    addresses.feeWallet || devnetEnv.NEXT_PUBLIC_FEE_WALLET || "";

  if (!ticketRegistry) {
    throw new Error(
      `Cannot resolve Devnet ticket registry address. Please run 'npm run devnet init' or configure NEXT_PUBLIC_TICKET_REGISTRY in ${path.basename(devnetEnvPath)}.`
    );
  }

  // Build the complete devnet environment dictionary
  const devnetVars: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: "devnet",
    NEXT_PUBLIC_PROGRAM_ID: programId,
    NEXT_PUBLIC_HUMA_PROGRAM_ID: humaProgramId,
    NEXT_PUBLIC_USDC_MINT: usdcMint,
    NEXT_PUBLIC_PST_MINT: pstMint,
    NEXT_PUBLIC_TICKET_REGISTRY: ticketRegistry,
    NEXT_PUBLIC_ADMIN_ADDRESS: adminAddress,
    NEXT_PUBLIC_FEE_WALLET: feeWallet,
    NEXT_PUBLIC_HUMA_CONFIG: humaProgramId,
    NEXT_PUBLIC_HUMA_POOL_CONFIG: humaProgramId,
    NEXT_PUBLIC_HUMA_POOL_STATE:
      addresses.humaPoolState || devnetEnv.NEXT_PUBLIC_HUMA_POOL_STATE || "",
    NEXT_PUBLIC_HUMA_MODE_CONFIG: humaProgramId,
    NEXT_PUBLIC_HUMA_LENDER_STATE:
      addresses.humaLenderState ||
      devnetEnv.NEXT_PUBLIC_HUMA_LENDER_STATE ||
      "",
    NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN:
      addresses.humaPoolUnderlying ||
      devnetEnv.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
      "",
    NEXT_PUBLIC_HUMA_MODE_MINT: pstMint,
    NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN:
      addresses.humaPoolModeToken ||
      devnetEnv.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
      "",
    NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST:
      addresses.humaRedemptionRequest ||
      devnetEnv.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
      "",
    NEXT_PUBLIC_RANDOMNESS_ACCOUNT:
      addresses.randomnessAccount ||
      devnetEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
      "",
  };

  // Provide implicit devnet context so devnet profile credentials (like Switchboard VRF) are not falsely rejected
  const devnetContext: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: "devnet",
    ...devnetEnv,
  };

  // Declaratively resolve all Category A cloud variables uniformly:
  // Priority: .env.devnet (non-mock) > non-mock edit in active target > canonical default
  for (const item of PRESERVED_CLOUD_VARS) {
    const profileVal = devnetEnv[item.envKey];
    const activeVal = currentTargetEnv[item.envKey];
    const isNonMockProfile =
      profileVal && !item.isLocalMock(profileVal, devnetContext);
    const isNonMockActive =
      activeVal && !item.isLocalMock(activeVal, currentTargetEnv);
    const resolved =
      (isNonMockProfile ? profileVal : undefined) ||
      (isNonMockActive ? activeVal : undefined) ||
      item.defaultValue;
    if (resolved) {
      devnetVars[item.envKey] = resolved;
    }
  }

  // Prevent cross-network database pollution:
  // If no cloud DATABASE_URL is found, neutralize local PostgreSQL setting so dApp/indexer
  // does not silently connect to a local container while executing in Devnet mode.
  if (!devnetVars.DATABASE_URL) {
    console.warn(
      "⚠️  [Devnet Sync] No remote DATABASE_URL configured in .env.devnet. Local database URL neutralized."
    );
    devnetVars.DATABASE_URL = "";
  }

  // Profile Isolation: If any non-mock cloud credentials were salvaged from active env that were missing
  // or mock in .env.devnet, persist ONLY those Category A variables into .env.devnet. Never write on-chain accounts to .env.devnet!
  const cloudUpdatesToPersist: Record<string, string> = {};
  for (const item of PRESERVED_CLOUD_VARS) {
    const val = devnetVars[item.envKey];
    const profileVal = devnetEnv[item.envKey];
    const isProfileMockOrMissing =
      !profileVal || item.isLocalMock(profileVal, devnetContext);
    if (
      val &&
      isProfileMockOrMissing &&
      (!item.defaultValue || val !== item.defaultValue)
    ) {
      cloudUpdatesToPersist[item.envKey] = val;
    }
  }
  if (Object.keys(cloudUpdatesToPersist).length > 0) {
    upsertEnvFile(devnetEnvPath, cloudUpdatesToPersist, {
      headerComment: "# Devnet Environment Profile (Auto-synchronized)",
    });
  }

  // Apply to active target (.env.local) non-destructively preserving Category C keys
  upsertEnvFile(targetFile, devnetVars, {
    headerComment: "# Synchronized from .env.devnet",
  });

  return devnetVars;
}

/**
 * Records a Switchboard randomness account address to addresses.json and .env.devnet.
 */
export function recordDevnetRandomnessAccount(
  randomnessAddress: string,
  addressesPath: string = DEVNET_ADDRESSES_PATH,
  devnetEnvPath: string = DEVNET_ENV_PATH
): void {
  const existing = readDevnetAddresses(addressesPath) || {};
  const updated = {
    ...existing,
    randomnessAccount: randomnessAddress,
  } as DevnetProtocolAccounts;
  writeDevnetAddresses(updated, addressesPath);
  upsertEnvFile(
    devnetEnvPath,
    { NEXT_PUBLIC_RANDOMNESS_ACCOUNT: randomnessAddress },
    { headerComment: "# Devnet Environment Profile (Auto-synchronized)" }
  );
}
