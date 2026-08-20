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
  const normalizedEnv = env?.trim().toLowerCase();

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
  const normalizedRpc = rpcUrl?.trim().toLowerCase() ?? "";
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
  return NETWORK_CONFIGS.devnet;
}

/**
 * Runtime helper reading Next.js public environment variables.
 */
export function getNetworkInfo(): NetworkConfig {
  return resolveNetwork(
    process.env.NEXT_PUBLIC_ENVIRONMENT,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL
  );
}
