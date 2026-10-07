import * as fs from "fs";
import * as path from "path";
import { createSolanaRpc, Address, address } from "@solana/kit";
import { readEnvFile, upsertEnvFile } from "./env-utils";
import {
  PROGRAM_ID,
  HUMA_PROGRAM_ID,
  ANCHOR_PROGRAM_ADDRESS,
  MOCK_HUMA_PROGRAM_ADDRESS,
} from "../app/lib/bonds-sdk";

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const LOCAL_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.local");
export const DEFAULT_ENV_PATH = path.resolve(PROJECT_ROOT, ".env");
export const DEVNET_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.devnet");
export const LOCALNET_ENV_PATH = path.resolve(PROJECT_ROOT, ".env.localnet");
export const PRODUCTION_ENV_PATH = path.resolve(
  PROJECT_ROOT,
  ".env.production"
);

export type NetworkCluster = "devnet" | "mainnet-beta" | "localnet";

export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS_HASH =
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

export interface ClusterConfig {
  readonly cluster: NetworkCluster;
  readonly genesisHash?: string;
  readonly stateDirName: string;
  readonly envFileName: string;
  readonly defaultRpcUrl: string;
  readonly defaultWsUrl: string;
}

export const CLUSTER_CONFIGS: Readonly<Record<NetworkCluster, ClusterConfig>> =
  {
    "mainnet-beta": {
      cluster: "mainnet-beta",
      genesisHash: MAINNET_GENESIS_HASH,
      stateDirName: "mainnet-state",
      envFileName: ".env.production",
      defaultRpcUrl: "https://api.mainnet-beta.solana.com",
      defaultWsUrl: "wss://api.mainnet-beta.solana.com",
    },
    devnet: {
      cluster: "devnet",
      genesisHash: DEVNET_GENESIS_HASH,
      stateDirName: "devnet-state",
      envFileName: ".env.devnet",
      defaultRpcUrl: "https://api.devnet.solana.com",
      defaultWsUrl: "wss://api.devnet.solana.com",
    },
    localnet: {
      cluster: "localnet",
      genesisHash: undefined,
      stateDirName: "localnet-state",
      envFileName: ".env.localnet",
      defaultRpcUrl: "http://127.0.0.1:8899",
      defaultWsUrl: "ws://127.0.0.1:8900",
    },
  };

export const LOCALNET_DEFAULT_RPC_URL = CLUSTER_CONFIGS.localnet.defaultRpcUrl;
export const LOCALNET_DEFAULT_WS_URL = CLUSTER_CONFIGS.localnet.defaultWsUrl;
export const DEVNET_DEFAULT_RPC_URL = CLUSTER_CONFIGS.devnet.defaultRpcUrl;
export const DEVNET_DEFAULT_WS_URL = CLUSTER_CONFIGS.devnet.defaultWsUrl;
export const MAINNET_DEFAULT_RPC_URL =
  CLUSTER_CONFIGS["mainnet-beta"].defaultRpcUrl;
export const MAINNET_DEFAULT_WS_URL =
  CLUSTER_CONFIGS["mainnet-beta"].defaultWsUrl;
export const LOCALNET_MOCK_WEBHOOK_SECRET = "pb_webhook_secret_local_dev_123";
export const LOCALNET_DEFAULT_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_default";

/**
 * Validates that the connected RPC matches the expected cluster genesis hash.
 */
export async function assertCluster(
  rpc: ReturnType<typeof createSolanaRpc>,
  expectedCluster: NetworkCluster
): Promise<void> {
  const config = CLUSTER_CONFIGS[expectedCluster];
  if (!config.genesisHash) {
    return;
  }

  const actualGenesisHash = await rpc.getGenesisHash().send();
  if (actualGenesisHash !== config.genesisHash) {
    throw new Error(
      `CRITICAL SECURITY ERROR: Connected RPC genesis hash does NOT match ${expectedCluster} (expected: ${config.genesisHash}, received: ${actualGenesisHash}).`
    );
  }
}

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

export class EnvironmentMismatchError extends Error {
  constructor(
    public readonly envFilePath: string = LOCAL_ENV_PATH,
    public readonly reason?: string
  ) {
    const fileName = path.basename(envFilePath);
    const msg =
      `\n❌ [ENVIRONMENT ERROR] ${fileName} is configured for LOCALNET\n` +
      (reason ? `    Reason: ${reason}\n` : "") +
      `    Cannot execute Devnet commands against localnet environment variables.\n\n` +
      `    • To synchronize ${fileName} with Devnet protocol addresses, run:\n` +
      `        npm run devnet sync-env\n` +
      `    • If you intended to run commands against localnet, run:\n` +
      `        npm run localnet --help\n`;
    super(msg);
    this.name = "EnvironmentMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
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
 * Pure assertion function that throws an EnvironmentMismatchError if the active env is configured for localnet.
 */
export function assertActiveEnvIsNotLocalnet(
  envFilePath: string = LOCAL_ENV_PATH
): void {
  const envCheck = checkActiveEnvIsLocalnet(envFilePath);
  if (envCheck.isLocalnet) {
    throw new EnvironmentMismatchError(envFilePath, envCheck.reason);
  }
}

/**
 * On-Chain Protocol Addresses and deployment accounts.
 */
export interface ProtocolAccounts {
  programId: Address | string;
  humaProgramId: Address | string;
  adminAddress: Address | string;
  usdcMint: Address | string;
  pstMint: Address | string;
  ticketRegistry: Address | string;
  feeWallet: Address | string;
  humaPoolState: Address | string;
  humaLenderState: Address | string;
  humaPoolUnderlying: Address | string;
  humaPoolModeToken: Address | string;
  humaRedemptionRequest: Address | string;
  randomnessAccount?: Address | string;
  squadsMultisig?: Address | string;
}

export type DevnetProtocolAccounts = ProtocolAccounts;

/**
 * Shared formatter mapping ProtocolAccounts to Next.js environment variable key-value pairs.
 */
export function buildProtocolAccountEnvVars(
  accounts: ProtocolAccounts
): Record<string, string> {
  return {
    NEXT_PUBLIC_PROGRAM_ID: String(accounts.programId),
    NEXT_PUBLIC_HUMA_PROGRAM_ID: String(accounts.humaProgramId),
    NEXT_PUBLIC_USDC_MINT: String(accounts.usdcMint),
    NEXT_PUBLIC_PST_MINT: String(accounts.pstMint),
    NEXT_PUBLIC_TICKET_REGISTRY: String(accounts.ticketRegistry),
    NEXT_PUBLIC_ADMIN_ADDRESS: String(accounts.adminAddress),
    NEXT_PUBLIC_FEE_WALLET: String(accounts.feeWallet),
    NEXT_PUBLIC_HUMA_CONFIG: String(accounts.humaProgramId),
    NEXT_PUBLIC_HUMA_POOL_CONFIG: String(accounts.humaProgramId),
    NEXT_PUBLIC_HUMA_POOL_STATE: String(accounts.humaPoolState),
    NEXT_PUBLIC_HUMA_MODE_CONFIG: String(accounts.humaProgramId),
    NEXT_PUBLIC_HUMA_LENDER_STATE: String(accounts.humaLenderState),
    NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN: String(accounts.humaPoolUnderlying),
    NEXT_PUBLIC_HUMA_MODE_MINT: String(accounts.pstMint),
    NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN: String(accounts.humaPoolModeToken),
    NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST: String(accounts.humaRedemptionRequest),
    NEXT_PUBLIC_RANDOMNESS_ACCOUNT: accounts.randomnessAccount
      ? String(accounts.randomnessAccount)
      : "",
  };
}

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

export interface ClusterPaths {
  readonly stateDir: string;
  readonly addressesPath: string;
  readonly usersPath: string;
  readonly profileEnvPath: string;
}

export function getClusterPaths(cluster: NetworkCluster): ClusterPaths {
  const config = CLUSTER_CONFIGS[cluster];
  const stateDir = path.resolve(__dirname, config.stateDirName);
  const addressesPath = path.resolve(stateDir, "addresses.json");
  const usersPath = path.resolve(stateDir, "users.json");
  const profileEnvPath = path.resolve(PROJECT_ROOT, config.envFileName);
  return { stateDir, addressesPath, usersPath, profileEnvPath };
}

export const DEVNET_PATHS = getClusterPaths("devnet");
export const DEVNET_STATE_DIR = DEVNET_PATHS.stateDir;
export const DEVNET_ADDRESSES_PATH = DEVNET_PATHS.addressesPath;
export const DEVNET_USERS_PATH = DEVNET_PATHS.usersPath;

export const MAINNET_PATHS = getClusterPaths("mainnet-beta");
export const MAINNET_STATE_DIR = MAINNET_PATHS.stateDir;
export const MAINNET_ADDRESSES_PATH = MAINNET_PATHS.addressesPath;

/**
 * Reads public on-chain protocol addresses for a cluster.
 */
export function readClusterAddresses(
  cluster: NetworkCluster,
  customFilePath?: string
): Partial<ProtocolAccounts> | null {
  const filePath = customFilePath ?? getClusterPaths(cluster).addressesPath;
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Cluster State] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * Writes public on-chain protocol addresses for a cluster.
 */
export function writeClusterAddresses(
  cluster: NetworkCluster,
  addresses: ProtocolAccounts,
  customFilePath?: string
): void {
  const filePath = customFilePath ?? getClusterPaths(cluster).addressesPath;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), "utf-8");
}

export interface SafeguardProfileOptions {
  readonly activeEnvPath?: string;
  readonly profileEnvPath: string;
  readonly expectedEnvironment: "devnet" | "localnet" | "mainnet-beta";
  readonly varsToPreserve: readonly PreservedCloudVarConfig[];
  readonly headerComment?: string;
  readonly logLabel?: string;
}

export interface SafeguardEnvOptions {
  readonly activeEnvPath?: string;
  readonly profileEnvPath?: string;
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
      result[item.envKey] = item.defaultValue ?? "";
    }
  }
  return result;
}

export interface SyncClusterOptions {
  readonly targetFile?: string;
  readonly profileEnvPath?: string;
  readonly addressesPath?: string;
  readonly localnetEnvPath?: string;
}

export interface SyncDevnetOptions {
  readonly targetFile?: string;
  readonly devnetEnvPath?: string;
  readonly addressesPath?: string;
  readonly localnetEnvPath?: string;
}

/**
 * Synchronizes cluster addresses and cloud credentials into the active target env file.
 */
export function syncClusterToActiveEnv(
  cluster: NetworkCluster,
  optionsOrTargetFile?: SyncClusterOptions | string,
  profileEnvPathArg?: string,
  addressesPathArg?: string
): Record<string, string> {
  const clusterPaths = getClusterPaths(cluster);
  const targetFile =
    typeof optionsOrTargetFile === "string"
      ? optionsOrTargetFile
      : (optionsOrTargetFile?.targetFile ?? LOCAL_ENV_PATH);
  const profileEnvPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.profileEnvPath ?? clusterPaths.profileEnvPath)
      : (profileEnvPathArg ?? clusterPaths.profileEnvPath);
  const addressesPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.addressesPath ?? clusterPaths.addressesPath)
      : (addressesPathArg ?? clusterPaths.addressesPath);
  const localnetEnvPath =
    typeof optionsOrTargetFile === "object"
      ? (optionsOrTargetFile.localnetEnvPath ?? LOCALNET_ENV_PATH)
      : LOCALNET_ENV_PATH;

  const addresses = readClusterAddresses(cluster, addressesPath) || {};
  const profileEnv = fs.existsSync(profileEnvPath)
    ? readEnvFile(profileEnvPath)
    : {};
  const currentTargetEnv = fs.existsSync(targetFile)
    ? readEnvFile(targetFile)
    : {};

  const isActiveCluster = currentTargetEnv.NEXT_PUBLIC_ENVIRONMENT === cluster;

  if (
    cluster === "devnet" &&
    !fs.existsSync(localnetEnvPath) &&
    fs.existsSync(targetFile) &&
    !isActiveCluster
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

  const programId =
    addresses.programId ||
    (cluster === "mainnet-beta"
      ? ANCHOR_PROGRAM_ADDRESS
      : ANCHOR_PROGRAM_ADDRESS);
  const humaProgramId =
    addresses.humaProgramId ||
    (cluster === "mainnet-beta"
      ? "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn"
      : MOCK_HUMA_PROGRAM_ADDRESS);
  const usdcMint =
    addresses.usdcMint ||
    profileEnv.NEXT_PUBLIC_USDC_MINT ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const pstMint = addresses.pstMint || profileEnv.NEXT_PUBLIC_PST_MINT || "";
  const ticketRegistry =
    addresses.ticketRegistry || profileEnv.NEXT_PUBLIC_TICKET_REGISTRY || "";
  const adminAddress =
    addresses.adminAddress || profileEnv.NEXT_PUBLIC_ADMIN_ADDRESS || "";
  const feeWallet =
    addresses.feeWallet || profileEnv.NEXT_PUBLIC_FEE_WALLET || "";
  const humaPoolState =
    addresses.humaPoolState || profileEnv.NEXT_PUBLIC_HUMA_POOL_STATE || "";
  const humaLenderState =
    addresses.humaLenderState || profileEnv.NEXT_PUBLIC_HUMA_LENDER_STATE || "";
  const humaPoolUnderlying =
    addresses.humaPoolUnderlying ||
    profileEnv.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
    "";
  const humaPoolModeToken =
    addresses.humaPoolModeToken ||
    profileEnv.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    "";
  const humaRedemptionRequest =
    addresses.humaRedemptionRequest ||
    profileEnv.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
    "";
  const randomnessAccount =
    addresses.randomnessAccount ||
    profileEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    "";

  if (!ticketRegistry && cluster === "devnet") {
    throw new Error(
      `Cannot resolve Devnet ticket registry address. Please run 'npm run devnet init' or configure NEXT_PUBLIC_TICKET_REGISTRY in ${path.basename(profileEnvPath)}.`
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

  const clusterVars: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: cluster,
    ...accountVars,
  };

  const clusterContext: Record<string, string> = {
    NEXT_PUBLIC_ENVIRONMENT: cluster,
    ...profileEnv,
  };

  for (const item of PRESERVED_CLOUD_VARS) {
    const profileVal = profileEnv[item.envKey];
    const activeVal = isActiveCluster
      ? currentTargetEnv[item.envKey]
      : undefined;
    const isNonMockProfile =
      profileVal && !item.isLocalMock(profileVal, clusterContext);
    const isNonMockActive =
      activeVal && !item.isLocalMock(activeVal, currentTargetEnv);
    const resolved =
      (isNonMockProfile ? profileVal : undefined) ||
      (isNonMockActive ? activeVal : undefined) ||
      item.defaultValue;
    if (resolved !== undefined) {
      clusterVars[item.envKey] = resolved;
    }
  }

  if (cluster === "devnet" && !clusterVars.DATABASE_URL) {
    console.warn(
      "⚠️  [Devnet Sync] No remote DATABASE_URL configured in .env.devnet. Local database URL neutralized."
    );
    clusterVars.DATABASE_URL = "";
  }

  for (const item of PUSHER_VARS) {
    if (clusterVars[item.envKey] === undefined) {
      clusterVars[item.envKey] = item.defaultValue ?? "";
    }
  }

  const cloudUpdatesToPersist: Record<string, string> = {};
  if (isActiveCluster) {
    for (const item of PRESERVED_CLOUD_VARS) {
      const val = clusterVars[item.envKey];
      const profileVal = profileEnv[item.envKey];
      const isProfileMockOrMissing =
        !profileVal || item.isLocalMock(profileVal, clusterContext);
      if (
        val &&
        isProfileMockOrMissing &&
        (!item.defaultValue || val !== item.defaultValue)
      ) {
        cloudUpdatesToPersist[item.envKey] = val;
      }
    }
    if (Object.keys(cloudUpdatesToPersist).length > 0) {
      upsertEnvFile(profileEnvPath, cloudUpdatesToPersist, {
        headerComment: `# ${cluster} Environment Profile (Auto-synchronized)`,
      });
    }
  }

  upsertEnvFile(targetFile, clusterVars, {
    headerComment: `# Synchronized from ${path.basename(profileEnvPath)}`,
  });

  return clusterVars;
}

export function syncDevnetToActiveEnv(
  optionsOrTargetFile?: SyncDevnetOptions | string,
  devnetEnvPathArg?: string,
  addressesPathArg?: string
): Record<string, string> {
  const options: SyncClusterOptions | undefined =
    typeof optionsOrTargetFile === "object"
      ? {
          targetFile: optionsOrTargetFile.targetFile,
          profileEnvPath: optionsOrTargetFile.devnetEnvPath,
          addressesPath: optionsOrTargetFile.addressesPath,
          localnetEnvPath: optionsOrTargetFile.localnetEnvPath,
        }
      : undefined;

  return syncClusterToActiveEnv(
    "devnet",
    options || optionsOrTargetFile,
    devnetEnvPathArg,
    addressesPathArg
  );
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

export function syncLocalnetToActiveEnv(
  options: SyncLocalnetOptions
): Record<string, string> {
  const activeEnvPath = options.activeEnvPath ?? LOCAL_ENV_PATH;
  const devnetEnvPath = options.devnetEnvPath ?? DEVNET_ENV_PATH;
  const localnetEnvPath = options.localnetEnvPath ?? LOCALNET_ENV_PATH;

  safeguardDevnetEnv({ activeEnvPath, profileEnvPath: devnetEnvPath });

  const localnetProfile = loadLocalnetProfile(localnetEnvPath);
  const accountVars = buildProtocolAccountEnvVars(options.accounts);

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

  const resolvedDbUrl =
    options.databaseUrl ||
    (options.dbName
      ? `postgresql://postgres:postgres@127.0.0.1:5432/pb_local_${options.dbName.replace(/[^a-zA-Z0-9_]/g, "_")}`
      : LOCALNET_DEFAULT_DB_URL);

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

  upsertEnvFile(activeEnvPath, localnetVars, {
    headerComment: "# Localnet Environment (Auto-synchronized)",
  });

  return localnetVars;
}

export function recordDevnetRandomnessAccount(
  randomnessAddress: string,
  addressesPath: string = DEVNET_ADDRESSES_PATH,
  devnetEnvPath: string = DEVNET_ENV_PATH
): void {
  const existing = readClusterAddresses("devnet", addressesPath) || {};
  const updated = {
    ...existing,
    randomnessAccount: randomnessAddress,
  } as DevnetProtocolAccounts;
  writeClusterAddresses("devnet", updated, addressesPath);
  upsertEnvFile(
    devnetEnvPath,
    { NEXT_PUBLIC_RANDOMNESS_ACCOUNT: randomnessAddress },
    { headerComment: "# Devnet Environment Profile (Auto-synchronized)" }
  );
}
