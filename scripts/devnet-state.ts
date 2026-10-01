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
export const DEVNET_USERS_PATH = path.resolve(DEVNET_STATE_DIR, "users.json");
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

export interface EnvironmentMismatchCheck {
  readonly isLocalnet: boolean;
  readonly reason?: string;
}

/**
 * Checks if the active .env.local file is configured for localnet rather than devnet.
 */
export function checkActiveEnvIsLocalnet(
  envFilePath: string = LOCAL_ENV_PATH
): EnvironmentMismatchCheck {
  if (!fs.existsSync(envFilePath)) {
    return { isLocalnet: false };
  }

  const env = readEnvFile(envFilePath);

  if (env.NEXT_PUBLIC_ENVIRONMENT === "localnet") {
    return {
      isLocalnet: true,
      reason: "NEXT_PUBLIC_ENVIRONMENT is set to 'localnet'",
    };
  }

  if (
    isLocalMockUrl(env.SOLANA_RPC_URL) ||
    isLocalMockUrl(env.NEXT_PUBLIC_SOLANA_RPC_URL)
  ) {
    return {
      isLocalnet: true,
      reason: `RPC URL points to a local emulator (${
        env.SOLANA_RPC_URL || env.NEXT_PUBLIC_SOLANA_RPC_URL
      })`,
    };
  }

  if (env.HELIUS_WEBHOOK_SECRET === LOCALNET_MOCK_WEBHOOK_SECRET) {
    return {
      isLocalnet: true,
      reason: "Local mock webhook secret detected",
    };
  }

  return { isLocalnet: false };
}

/**
 * Category B: On-Chain Protocol Addresses and deployment accounts.
 */
export interface ProtocolAccounts {
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

export type DevnetProtocolAccounts = ProtocolAccounts;

/**
 * Shared formatter mapping ProtocolAccounts to Next.js environment variable key-value pairs.
 */
export function buildProtocolAccountEnvVars(
  accounts: ProtocolAccounts
): Record<string, string> {
  return {
    NEXT_PUBLIC_PROGRAM_ID: accounts.programId,
    NEXT_PUBLIC_HUMA_PROGRAM_ID: accounts.humaProgramId,
    NEXT_PUBLIC_USDC_MINT: accounts.usdcMint,
    NEXT_PUBLIC_PST_MINT: accounts.pstMint,
    NEXT_PUBLIC_TICKET_REGISTRY: accounts.ticketRegistry,
    NEXT_PUBLIC_ADMIN_ADDRESS: accounts.adminAddress,
    NEXT_PUBLIC_FEE_WALLET: accounts.feeWallet,
    NEXT_PUBLIC_HUMA_CONFIG: accounts.humaProgramId,
    NEXT_PUBLIC_HUMA_POOL_CONFIG: accounts.humaProgramId,
    NEXT_PUBLIC_HUMA_POOL_STATE: accounts.humaPoolState,
    NEXT_PUBLIC_HUMA_MODE_CONFIG: accounts.humaProgramId,
    NEXT_PUBLIC_HUMA_LENDER_STATE: accounts.humaLenderState,
    NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN: accounts.humaPoolUnderlying,
    NEXT_PUBLIC_HUMA_MODE_MINT: accounts.pstMint,
    NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN: accounts.humaPoolModeToken,
    NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST: accounts.humaRedemptionRequest,
    NEXT_PUBLIC_RANDOMNESS_ACCOUNT: accounts.randomnessAccount ?? "",
  };
}

export const LOCALNET_DEFAULT_RPC_URL = "http://127.0.0.1:8899";
export const LOCALNET_DEFAULT_WS_URL = "ws://127.0.0.1:8900";
export const DEVNET_DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_DEFAULT_WS_URL = "wss://api.devnet.solana.com";
export const LOCALNET_MOCK_WEBHOOK_SECRET = "pb_webhook_secret_local_dev_123";
export const LOCALNET_DEFAULT_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_default";

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
    isLocalMock: (val) => val === LOCALNET_MOCK_WEBHOOK_SECRET,
  },
  {
    envKey: "NEXT_PUBLIC_SOLANA_RPC_URL",
    defaultValue: DEVNET_DEFAULT_RPC_URL,
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "SOLANA_RPC_URL",
    defaultValue: DEVNET_DEFAULT_RPC_URL,
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "NEXT_PUBLIC_SOLANA_WS_URL",
    defaultValue: DEVNET_DEFAULT_WS_URL,
    isLocalMock: isLocalMockUrl,
  },
  {
    envKey: "SOLANA_WS_URL",
    defaultValue: DEVNET_DEFAULT_WS_URL,
    isLocalMock: isLocalMockUrl,
  },
  ...PUSHER_VARS,
];

/**
 * Reads the public on-chain protocol addresses from scripts/devnet-state/addresses.json.
 */
export function readDevnetAddresses(
  filePath: string = DEVNET_ADDRESSES_PATH
): Partial<ProtocolAccounts> | null {
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
  addresses: ProtocolAccounts,
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
  const humaPoolState =
    addresses.humaPoolState || devnetEnv.NEXT_PUBLIC_HUMA_POOL_STATE || "";
  const humaLenderState =
    addresses.humaLenderState || devnetEnv.NEXT_PUBLIC_HUMA_LENDER_STATE || "";
  const humaPoolUnderlying =
    addresses.humaPoolUnderlying ||
    devnetEnv.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
    "";
  const humaPoolModeToken =
    addresses.humaPoolModeToken ||
    devnetEnv.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    "";
  const humaRedemptionRequest =
    addresses.humaRedemptionRequest ||
    devnetEnv.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
    "";
  const randomnessAccount =
    addresses.randomnessAccount ||
    devnetEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    "";

  if (!ticketRegistry) {
    throw new Error(
      `Cannot resolve Devnet ticket registry address. Please run 'npm run devnet init' or configure NEXT_PUBLIC_TICKET_REGISTRY in ${path.basename(devnetEnvPath)}.`
    );
  }

  const resolvedAccounts: ProtocolAccounts = {
    programId,
    humaProgramId,
    adminAddress,
    usdcMint,
    pstMint,
    ticketRegistry,
    feeWallet,
    humaPoolState,
    humaLenderState,
    humaPoolUnderlying,
    humaPoolModeToken,
    humaRedemptionRequest,
    randomnessAccount,
  };

  const accountVars = buildProtocolAccountEnvVars(resolvedAccounts);

  // Build the complete devnet environment dictionary
  const devnetVars: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: "devnet",
    ...accountVars,
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

export interface SyncLocalnetOptions {
  readonly activeEnvPath?: string;
  readonly localnetEnvPath?: string;
  readonly devnetEnvPath?: string;
  readonly accounts: ProtocolAccounts;
  readonly databaseUrl?: string;
  readonly dbName?: string;
  readonly rpcUrl?: string;
  readonly wsUrl?: string;
}

/**
 * Synchronizes localnet configuration into active target environment file (.env.local).
 * Safeguards any active devnet credentials before overwriting with local endpoints.
 */
export function syncLocalnetToActiveEnv(
  options: SyncLocalnetOptions
): Record<string, string> {
  const activeEnvPath = options.activeEnvPath ?? LOCAL_ENV_PATH;
  const devnetEnvPath = options.devnetEnvPath ?? DEVNET_ENV_PATH;
  const localnetEnvPath = options.localnetEnvPath ?? LOCALNET_ENV_PATH;

  // 1. Safeguard Devnet credentials before mutating active env
  safeguardDevnetEnv({ activeEnvPath, profileEnvPath: devnetEnvPath });

  // 2. Load Localnet profile (Pusher keys)
  const localnetProfile = loadLocalnetProfile(localnetEnvPath);

  // 3. Format on-chain protocol accounts
  const accountVars = buildProtocolAccountEnvVars(options.accounts);

  // 4. Resolve RPC and WebSocket URLs
  const resolvedRpc = options.rpcUrl ?? LOCALNET_DEFAULT_RPC_URL;
  let resolvedWs = options.wsUrl;
  if (!resolvedWs) {
    try {
      const parsed = new URL(resolvedRpc);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      if (parsed.port === "8899") parsed.port = "8900";
      resolvedWs = parsed.toString().replace(/\/$/, "");
    } catch {
      resolvedWs = LOCALNET_DEFAULT_WS_URL;
    }
  }

  // 5. Resolve Database URL deterministically
  const resolvedDbUrl =
    options.databaseUrl ||
    (options.dbName
      ? `postgresql://postgres:postgres@127.0.0.1:5432/pb_local_${options.dbName.replace(/[^a-zA-Z0-9_]/g, "_")}`
      : LOCALNET_DEFAULT_DB_URL);

  // 6. Assemble complete Localnet environment dictionary
  const localnetVars: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: "localnet",
    ...accountVars,
    NEXT_PUBLIC_SOLANA_RPC_URL: resolvedRpc,
    SOLANA_RPC_URL: resolvedRpc,
    NEXT_PUBLIC_SOLANA_WS_URL: resolvedWs,
    SOLANA_WS_URL: resolvedWs,
    HELIUS_WEBHOOK_SECRET: LOCALNET_MOCK_WEBHOOK_SECRET,
    DATABASE_URL: resolvedDbUrl,
    ...localnetProfile,
  };

  // 7. Upsert to active environment non-destructively preserving Category C user keys
  upsertEnvFile(activeEnvPath, localnetVars, {
    headerComment: "# Localnet Environment (Auto-synchronized)",
  });

  return localnetVars;
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
