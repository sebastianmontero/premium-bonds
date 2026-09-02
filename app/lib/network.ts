export type SolanaNetworkCluster =
  | "mainnet-beta"
  | "devnet"
  | "testnet"
  | "localnet";

export type NetworkBadgeVariant = "success" | "info" | "warning" | "secondary";

export interface NetworkConfig {
  cluster: SolanaNetworkCluster;
  displayNameKey: string;
  variant: NetworkBadgeVariant;
  pillClassName: string;
}

export const DEFAULT_SOLANA_RPC_URL = "http://127.0.0.1:8899";
export const DEFAULT_NETWORK_CLUSTER: SolanaNetworkCluster = "devnet";

export const NETWORK_CONFIGS: Record<SolanaNetworkCluster, NetworkConfig> = {
  "mainnet-beta": {
    cluster: "mainnet-beta",
    displayNameKey: "networkMainnet",
    variant: "success",
    pillClassName: "pill pill-success",
  },
  devnet: {
    cluster: "devnet",
    displayNameKey: "networkDevnet",
    variant: "info",
    pillClassName: "pill pill-info",
  },
  localnet: {
    cluster: "localnet",
    displayNameKey: "networkLocalnet",
    variant: "secondary",
    pillClassName:
      "pill pill-info border-primary/30 bg-primary/10 text-primary",
  },
  testnet: {
    cluster: "testnet",
    displayNameKey: "networkTestnet",
    variant: "warning",
    pillClassName: "pill pill-warning",
  },
};

/**
 * Safely sanitizes environment variable strings, handling whitespace and literal "undefined" / "null" values.
 */
export function sanitizeEnvValue(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null")
    return undefined;
  return trimmed;
}

/**
 * Pure function: resolves network cluster and metadata based on explicit env and RPC URL inputs.
 * Precedence: explicit env > RPC URL pattern matching > default devnet fallback.
 *
 * @param env - Optional environment override (e.g. process.env.NEXT_PUBLIC_ENVIRONMENT)
 * @param rpcUrl - Optional Solana RPC URL (e.g. process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
 * @returns NetworkConfig object with cluster, localization key, and badge styling
 */
export function resolveNetwork(
  env?: string | null,
  rpcUrl?: string | null
): NetworkConfig {
  const normalizedEnv = sanitizeEnvValue(env)?.toLowerCase();

  // 1. Explicit Environment Override
  if (
    normalizedEnv === "mainnet" ||
    normalizedEnv === "mainnet-beta" ||
    normalizedEnv === "production"
  ) {
    return NETWORK_CONFIGS["mainnet-beta"];
  }
  if (normalizedEnv === "devnet" || normalizedEnv === "development") {
    return NETWORK_CONFIGS.devnet;
  }
  if (normalizedEnv === "localnet" || normalizedEnv === "local") {
    return NETWORK_CONFIGS.localnet;
  }
  if (normalizedEnv === "testnet") {
    return NETWORK_CONFIGS.testnet;
  }

  // 2. RPC URL Pattern Matching
  const normalizedRpc = sanitizeEnvValue(rpcUrl)?.toLowerCase() ?? "";
  if (
    normalizedRpc.includes("localhost") ||
    normalizedRpc.includes("127.0.0.1") ||
    normalizedRpc.includes("8899")
  ) {
    return NETWORK_CONFIGS.localnet;
  }
  if (normalizedRpc.includes("devnet")) {
    return NETWORK_CONFIGS.devnet;
  }
  if (normalizedRpc.includes("testnet")) {
    return NETWORK_CONFIGS.testnet;
  }
  if (
    normalizedRpc.includes("mainnet") ||
    normalizedRpc.includes("helius") ||
    normalizedRpc.includes("quicknode") ||
    normalizedRpc.includes("alchemy")
  ) {
    return NETWORK_CONFIGS["mainnet-beta"];
  }

  // 3. Default fallback
  return NETWORK_CONFIGS[DEFAULT_NETWORK_CLUSTER];
}

/**
 * Resolves client-safe Solana RPC URL (used in React components, providers, and UI helpers).
 * Never reads server-only private variables (SOLANA_RPC_URL) to guarantee deterministic SSR and prevent hydration mismatches.
 */
export function resolveClientSolanaRpcUrl(customRpc?: string | null): string {
  return (
    sanitizeEnvValue(customRpc) ||
    sanitizeEnvValue(process.env.NEXT_PUBLIC_SOLANA_RPC_URL) ||
    DEFAULT_SOLANA_RPC_URL
  );
}

/**
 * Resolves server-side Solana RPC URL (for webhooks, indexers, crank service, CLI scripts).
 * Hierarchy: explicit argument > SOLANA_RPC_URL (private backend) > NEXT_PUBLIC_SOLANA_RPC_URL (public client) > default localnet.
 */
export function resolveSolanaRpcUrl(customRpc?: string | null): string {
  return (
    sanitizeEnvValue(customRpc) ||
    sanitizeEnvValue(process.env.SOLANA_RPC_URL) ||
    resolveClientSolanaRpcUrl()
  );
}

/**
 * Pure client-safe runtime helper reading Next.js public environment variables for badge rendering and localization.
 */
export function getNetworkInfo(): NetworkConfig {
  const env =
    process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NEXT_PUBLIC_NETWORK;
  const rpcUrl = resolveClientSolanaRpcUrl();
  return resolveNetwork(env, rpcUrl);
}
