import { createSolanaRpc } from "@solana/kit";
import {
  fetchBatchedBondsState,
  calculatePoolYield,
  parsePrizePool,
  parseMockHumaPoolState,
  parseMintSupply,
  parseTokenAccountBalance,
  parseModeConfig,
  fetchTicketRegistryHeader,
} from "@/app/lib/bonds-sdk";
import type { PoolInfo } from "@/app/types";
import type { PoolFetchOptions } from "@/app/lib/services/pool-stats-aggregator";

interface CacheEntry {
  data: PoolInfo | null;
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();
const inflight = new Map<number, Promise<PoolInfo | null>>();

const rpc = createSolanaRpc(
  process.env.SOLANA_RPC_SERVER_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "http://127.0.0.1:8899"
);

export async function getPoolInfo(
  poolId: number = 1,
  options?: PoolFetchOptions
): Promise<PoolInfo | null> {
  const now = Date.now();
  const bypassCache = options?.bypassCache ?? false;

  if (!bypassCache) {
    const hit = cache.get(poolId);
    if (hit && hit.expiresAt > now) {
      return hit.data;
    }

    const existingPromise = inflight.get(poolId);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const fetchPromise = (async () => {
    try {
      const batched = await fetchBatchedBondsState({ rpc, poolId });
      if (!batched.poolAccountData) {
        cache.set(poolId, { data: null, expiresAt: now + 5000 });
        return null;
      }

      const parsedPool = parsePrizePool(batched.poolAccountData);

      const registryPromise = parsedPool.ticketRegistry
        ? fetchTicketRegistryHeader(rpc, parsedPool.ticketRegistry)
        : Promise.resolve(null);

      const humaTotalAssets = batched.humaPoolStateData
        ? parseMockHumaPoolState(batched.humaPoolStateData).totalAssets
        : 0n;
      const pstSupply = batched.pstMintData
        ? parseMintSupply(batched.pstMintData)
        : 0n;
      const poolPstBalance = batched.poolPstVaultData
        ? parseTokenAccountBalance(batched.poolPstVaultData)
        : 0n;
      const humaModeApy = batched.humaModeConfigData
        ? parseModeConfig(batched.humaModeConfigData).apy
        : undefined;

      const yieldCalc = calculatePoolYield({
        poolPstBalance,
        pstSupply,
        humaTotalAssets,
        totalDepositedPrincipal: parsedPool.totalDepositedPrincipal,
        totalFeesAccrued: parsedPool.totalFeesAccrued,
        totalFeesWithdrawn: parsedPool.totalFeesWithdrawn,
        totalPrizesAllocated: parsedPool.totalPrizesAllocated,
        feeBasisPoints: parsedPool.feeBasisPoints,
      });

      const registryHeader = await registryPromise;
      const totalUsers = registryHeader?.userCount ?? 0;

      // Assemble PoolInfo DTO explicitly without leaky object spreads
      const poolInfo: PoolInfo = {
        poolId: parsedPool.poolId,
        tokenMint: parsedPool.tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        bondPrice: parsedPool.bondPrice,
        stakeCycleDurationHrs: parsedPool.stakeCycleDurationHrs,
        feeBasisPoints: parsedPool.feeBasisPoints,
        status: parsedPool.status,
        totalDepositedPrincipal: parsedPool.totalDepositedPrincipal,
        currentCycleEndAt: parsedPool.currentCycleEndAt,
        isFrozenForDraw: parsedPool.isFrozenForDraw,
        currentDrawCycleId: parsedPool.currentDrawCycleId,
        prizeTiers: parsedPool.prizeTiers,
        estimatedPrizePot: yieldCalc.estimatedPrizePot,
        grossYield: Number(yieldCalc.grossYield),
        protocolFeeAmount: Number(yieldCalc.protocolFee),
        minYieldThreshold: parsedPool.minYieldThreshold,
        underlyingApy: humaModeApy ?? 0.085,
        lastSyncedAt: Math.floor(now / 1000),
        totalUsers,
        totalPrizesDistributed: undefined,
        payoutTimelockSeconds: parsedPool.payoutTimelockSeconds,
        ticketRegistry: parsedPool.ticketRegistry,
        nextRedemptionId: parsedPool.nextRedemptionId,
      };

      cache.set(poolId, { data: poolInfo, expiresAt: now + 5000 });
      return poolInfo;
    } finally {
      inflight.delete(poolId);
    }
  })();

  if (!bypassCache) {
    inflight.set(poolId, fetchPromise);
  }
  return fetchPromise;
}

export function invalidatePoolInfoCache(poolId?: number): void {
  if (poolId !== undefined) {
    cache.delete(poolId);
    inflight.delete(poolId);
  } else {
    cache.clear();
    inflight.clear();
  }
}
