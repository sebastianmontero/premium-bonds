import type { Address } from "@solana/kit";
import type { PrizeLedgerFilters } from "@/app/types/indexer-contracts";

export type PoolId = number;

export const bondsKeys = {
  all: ["yield-bonds"] as const,

  // Pool scopes
  pools: () => [...bondsKeys.all, "pools"] as const,
  poolRoot: (poolId: PoolId) => [...bondsKeys.pools(), poolId] as const,
  poolState: (poolId: PoolId) =>
    [...bondsKeys.poolRoot(poolId), "state"] as const,
  poolDetails: (poolId: PoolId) =>
    [...bondsKeys.poolRoot(poolId), "details"] as const,
  poolSnapshots: (poolId: PoolId) =>
    [...bondsKeys.poolRoot(poolId), "snapshots"] as const,

  // Draws & Winners
  draws: (poolId: PoolId) => [...bondsKeys.poolRoot(poolId), "draws"] as const,
  drawsList: (poolId: PoolId, filters?: Record<string, unknown>) =>
    [...bondsKeys.draws(poolId), "list", filters ?? {}] as const,
  drawDetails: (poolId: PoolId, cycleId?: number | null) =>
    [...bondsKeys.draws(poolId), cycleId ?? "latest"] as const,
  prizes: (poolId: PoolId) =>
    [...bondsKeys.poolRoot(poolId), "prizes"] as const,

  // Relational aggregates
  activityFeed: (
    poolId: PoolId,
    address?: Address | string,
    filters?: { type?: string; search?: string }
  ) =>
    [
      ...bondsKeys.poolRoot(poolId),
      "activity",
      {
        address: address ? String(address) : "all",
        type: filters?.type ?? "all",
        search: filters?.search ?? "",
      },
    ] as const,
  leaderboard: (poolId: PoolId) =>
    [...bondsKeys.poolRoot(poolId), "leaderboard"] as const,

  // User-specific states
  users: (poolId: PoolId) => [...bondsKeys.poolRoot(poolId), "users"] as const,
  user: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.users(poolId), String(address)] as const,
  userPosition: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.user(poolId, address), "position"] as const,
  userRedemptions: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.user(poolId, address), "redemptions"] as const,
  userPrizeHistory: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.user(poolId, address), "prizes"] as const,

  // Segmented user prize scopes
  userPrizes: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.user(poolId, address), "prizes"] as const,
  userPrizeSummary: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.userPrizes(poolId, address), "summary"] as const,
  userPrizeLedgerRoot: (poolId: PoolId, address: Address | string) =>
    [...bondsKeys.userPrizes(poolId, address), "ledger"] as const,
  userPrizeLedger: (
    poolId: PoolId,
    address: Address | string,
    filters: Partial<PrizeLedgerFilters>
  ) => [...bondsKeys.userPrizeLedgerRoot(poolId, address), filters] as const,

  // Token Balances
  tokenBalances: () => [...bondsKeys.all, "token-balances"] as const,
  userTokenBalance: (address?: Address | string, mint?: Address | string) =>
    [
      ...bondsKeys.tokenBalances(),
      {
        address: address ? String(address) : null,
        mint: mint ? String(mint) : null,
      },
    ] as const,
} as const;
