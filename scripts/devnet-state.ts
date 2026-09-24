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
export const LOCALNET_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.localnet");
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
 * Checks whether a Pusher environment variable contains an unconfigured placeholder.
 */
export function isPusherPlaceholder(val: string | undefined): boolean {
  if (!val || val.trim() === "") return true;
  const lower = val.trim().toLowerCase();
  return (
    lower.startsWith("your_") ||
    lower.startsWith("placeholder") ||
    lower.includes("dummy") ||
    lower === "todo" ||
    lower === "change_me" ||
    lower === "undefined" ||
    lower === "null"
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

export const PUSHER_VARS: readonly PreservedCloudVarConfig[] = [
  { envKey: "PUSHER_APP_ID", isLocalMock: (val) => isPusherPlaceholder(val) },
  { envKey: "PUSHER_KEY", isLocalMock: (val) => isPusherPlaceholder(val) },
  { envKey: "PUSHER_SECRET", isLocalMock: (val) => isPusherPlaceholder(val) },
  {
    envKey: "PUSHER_CLUSTER",
    defaultValue: "us2",
    isLocalMock: (val) => !val || isPusherPlaceholder(val),
  },
  {
    envKey: "NEXT_PUBLIC_PUSHER_KEY",
    isLocalMock: (val) => isPusherPlaceholder(val),
  },
  {
    envKey: "NEXT_PUBLIC_PUSHER_CLUSTER",
    defaultValue: "us2",
    isLocalMock: (val) => !val || isPusherPlaceholder(val),
  },
];

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
  ...PUSHER_VARS,
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

export interface SafeguardProfileOptions {
  readonly activeEnvPath?: string;
  readonly profileEnvPath: string;
  readonly expectedEnvironment: "devnet" | "localnet";
  readonly varsToPreserve: readonly PreservedCloudVarConfig[];
  readonly headerComment?: string;
  readonly logLabel?: string;
}

export interface SafeguardEnvOptions {
  readonly activeEnvPath?: string;
  readonly profileEnvPath?: string;
}

export interface SyncDevnetOptions {
  readonly targetFile?: string;
  readonly devnetEnvPath?: string;
  readonly addressesPath?: string;
  readonly localnetEnvPath?: string;
}

/**
 * Core parameterizable safeguarding engine for multi-environment profiles.
 */
export function safeguardProfileEnv(
  options: SafeguardProfileOptions
): Record<string, string> {
  const activePath = options.activeEnvPath ?? LOCAL_ENV_PATH;
  if (!fs.existsSync(activePath)) return {};
  const currentEnv = readEnvFile(activePath);

  // Strict environment isolation guard: never extract credentials if active env does not match
  if (currentEnv.NEXT_PUBLIC_ENVIRONMENT !== options.expectedEnvironment) {
    return {};
  }

  const updates: Record<string, string> = {};
  for (const item of options.varsToPreserve) {
    const val = currentEnv[item.envKey];
    if (val && !item.isLocalMock(val, currentEnv)) {
      updates[item.envKey] = val;
    }
  }

  if (Object.keys(updates).length > 0) {
    const label = options.logLabel ?? options.expectedEnvironment;
    console.log(
      `ℹ Safeguarding ${label} profile credentials into ${path.basename(options.profileEnvPath)}...`
    );
    upsertEnvFile(options.profileEnvPath, updates, {
      headerComment: options.headerComment,
    });
  }

  return updates;
}

/**
 * Safeguards Devnet credentials from .env.local into .env.devnet before Localnet mutates .env.local.
 * STRICT GUARD: Only runs if .env.local is actively set to NEXT_PUBLIC_ENVIRONMENT=devnet.
 */
export function safeguardDevnetEnv(
  optionsOrActiveEnvPath?: SafeguardEnvOptions | string,
  devnetEnvPath?: string
): Record<string, string> {
  const activePath =
    typeof optionsOrActiveEnvPath === "string"
      ? optionsOrActiveEnvPath
      : (optionsOrActiveEnvPath?.activeEnvPath ?? LOCAL_ENV_PATH);
  const profilePath =
    typeof optionsOrActiveEnvPath === "object"
      ? (optionsOrActiveEnvPath.profileEnvPath ?? DEVNET_ENV_PATH)
      : (devnetEnvPath ?? DEVNET_ENV_PATH);

  return safeguardProfileEnv({
    activeEnvPath: activePath,
    profileEnvPath: profilePath,
    expectedEnvironment: "devnet",
    varsToPreserve: PRESERVED_CLOUD_VARS,
    headerComment: "# Devnet Environment Profile (Auto-synchronized)",
    logLabel: "Devnet cloud",
  });
}

/**
 * Safeguards Localnet credentials from .env.local into .env.localnet before Devnet mutates .env.local.
 * STRICT GUARD: Only runs if .env.local is actively set to NEXT_PUBLIC_ENVIRONMENT=localnet.
 */
export function safeguardLocalnetEnv(
  optionsOrActiveEnvPath?: SafeguardEnvOptions | string,
  localnetEnvPath?: string
): Record<string, string> {
  const activePath =
    typeof optionsOrActiveEnvPath === "string"
      ? optionsOrActiveEnvPath
      : (optionsOrActiveEnvPath?.activeEnvPath ?? LOCAL_ENV_PATH);
  const profilePath =
    typeof optionsOrActiveEnvPath === "object"
      ? (optionsOrActiveEnvPath.profileEnvPath ?? LOCALNET_ENV_PATH)
      : (localnetEnvPath ?? LOCALNET_ENV_PATH);

  return safeguardProfileEnv({
    activeEnvPath: activePath,
    profileEnvPath: profilePath,
    expectedEnvironment: "localnet",
    varsToPreserve: PUSHER_VARS,
    headerComment: "# Localnet Environment Profile (Auto-synchronized)",
    logLabel: "Localnet profile",
  });
}

/**
 * Loads localnet profile credentials, returning sanitized keys for .env.local.
 * Neutralizes unconfigured Pusher variables to prevent Devnet credential leakage.
 */
export function loadLocalnetProfile(
  localnetEnvPath: string = LOCALNET_ENV_PATH
): Record<string, string> {
  const localProfile = fs.existsSync(localnetEnvPath)
    ? readEnvFile(localnetEnvPath)
    : {};

  const result: Record<string, string> = {};
  for (const item of PUSHER_VARS) {
    const val = localProfile[item.envKey];
    if (val && !item.isLocalMock(val, localProfile)) {
      result[item.envKey] = val;
    } else {
      // Explicitly neutralize to prevent lingering Devnet keys
      result[item.envKey] = item.defaultValue ?? "";
    }
  }
  return result;
}

/**
 * Assembles the full dictionary of Devnet variables by merging on-chain addresses
 * and .env.devnet cloud credentials, then synchronizes it into the active target environment file.
 */
export function syncDevnetToActiveEnv(
  optionsOrTargetFile?: SyncDevnetOptions | string,
  devnetEnvPathArg?: string,
  addressesPathArg?: string
): Record<string, string> {
  const targetFile =
    typeof optionsOrTargetFile === "string"
      ? optionsOrTargetFile
      : (optionsOrTargetFile?.targetFile ?? LOCAL_ENV_PATH);
  const devnetEnvPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.devnetEnvPath ?? DEVNET_ENV_PATH)
      : (devnetEnvPathArg ?? DEVNET_ENV_PATH);
  const addressesPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.addressesPath ?? DEVNET_ADDRESSES_PATH)
      : (addressesPathArg ?? DEVNET_ADDRESSES_PATH);
  const localnetEnvPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.localnetEnvPath ?? LOCALNET_ENV_PATH)
      : LOCALNET_ENV_PATH;

  const addresses = readDevnetAddresses(addressesPath) || {};
  const devnetEnv = fs.existsSync(devnetEnvPath)
    ? readEnvFile(devnetEnvPath)
    : {};
  const currentTargetEnv = fs.existsSync(targetFile)
    ? readEnvFile(targetFile)
    : {};

  const isActiveDevnet = currentTargetEnv.NEXT_PUBLIC_ENVIRONMENT === "devnet";

  // Automatic initial bootstrap seeding:
  // If .env.localnet does not exist on disk, but targetFile contains non-mock local Pusher keys
  // and is not already in devnet mode, seed .env.localnet before applying Devnet variables.
  if (
    !fs.existsSync(localnetEnvPath) &&
    fs.existsSync(targetFile) &&
    !isActiveDevnet
  ) {
    const localPusherKeysToSeed: Record<string, string> = {};
    for (const item of PUSHER_VARS) {
      const val = currentTargetEnv[item.envKey];
      if (val && !item.isLocalMock(val, currentTargetEnv)) {
        localPusherKeysToSeed[item.envKey] = val;
      }
    }
    if (Object.keys(localPusherKeysToSeed).length > 0) {
      console.log(
        `ℹ Bootstrapping initial ${path.basename(localnetEnvPath)} with existing local Pusher configuration...`
      );
      upsertEnvFile(localnetEnvPath, localPusherKeysToSeed, {
        headerComment: "# Localnet Environment Profile (Auto-synchronized)",
      });
    }
  }

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
  // Priority: .env.devnet (non-mock) > non-mock edit in active target (ONLY IF active env is devnet) > canonical default
  for (const item of PRESERVED_CLOUD_VARS) {
    const profileVal = devnetEnv[item.envKey];
    const activeVal = isActiveDevnet
      ? currentTargetEnv[item.envKey]
      : undefined;
    const isNonMockProfile =
      profileVal && !item.isLocalMock(profileVal, devnetContext);
    const isNonMockActive =
      activeVal && !item.isLocalMock(activeVal, currentTargetEnv);
    const resolved =
      (isNonMockProfile ? profileVal : undefined) ||
      (isNonMockActive ? activeVal : undefined) ||
      item.defaultValue;
    if (resolved !== undefined) {
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

  // Prevent cross-network Pusher broadcast pollution:
  // If .env.devnet contains no non-mock Pusher keys, neutralize Pusher keys so localnet credentials
  // never linger in .env.local while executing in Devnet mode.
  for (const item of PUSHER_VARS) {
    if (devnetVars[item.envKey] === undefined) {
      devnetVars[item.envKey] = item.defaultValue ?? "";
    }
  }

  // Profile Isolation: If any non-mock cloud credentials were salvaged from active env that were missing
  // or mock in .env.devnet, persist ONLY those Category A variables into .env.devnet.
  // STRICT GUARD: Only salvage if active env was already in devnet mode!
  const cloudUpdatesToPersist: Record<string, string> = {};
  if (isActiveDevnet) {
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
