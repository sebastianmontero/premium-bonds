import { db, isDatabaseConfigured } from "./index";
import {
  protocolEvents,
  bondsActivity,
  drawHistory,
  drawWinners,
  pendingRedemptions,
  redemptionBatches,
  poolSnapshots,
  userPortfolioStats,
  indexerCursor,
} from "./schema";
import { ParsedProgramEvent, resolveEventMetadata } from "../anchor-events";
import { sql, Table, eq, and } from "drizzle-orm";
import {
  isZeroYieldDrawStatus,
  isRolledBackDrawStatus,
  TERMINAL_DRAW_STATUSES,
  isUnoverridableDrawStatus,
} from "../draw-helpers";
import { RedemptionType } from "../bonds-sdk";

export const REDEMPTION_TYPE_TO_DB: Record<
  RedemptionType,
  "bond_sale" | "prize_claim" | "fee_withdrawal"
> = {
  [RedemptionType.BondSale]: "bond_sale",
  [RedemptionType.PrizeClaim]: "prize_claim",
  [RedemptionType.FeeWithdrawal]: "fee_withdrawal",
};

export { TERMINAL_DRAW_STATUSES };

export interface WinnerUpdateRow {
  poolId: number;
  cycleId: number;
  winnerIndex: number;
  winnerAddress: string;
  bondsBought: bigint;
  amountReinvested?: bigint;
  claimSignature: string;
}

export interface IngestBatchResult {
  insertedCount: number;
  unhydratedDraws: { poolId: number; cycleId: number }[];
}

export interface TransactionIngestContext {
  signature: string;
  slot: number;
  blockTime: number;
  network: string;
}

export interface IngestTransactionItem {
  context: TransactionIngestContext;
  events: ParsedProgramEvent[];
}

export interface UserStatDelta {
  poolId: number;
  userAddress: string;
  activeBondsDelta: bigint;
  depositedUsdcDelta: bigint;
  withdrawnUsdcDelta: bigint;
  wonUsdcDelta: bigint;
  claimedUsdcDelta: bigint;
  reinvestedUsdcDelta: bigint;
  depositCountDelta: number;
  withdrawCountDelta: number;
  winCountDelta: number;
  activityTime: number;
}

export function createUserStatDelta(
  base: Pick<UserStatDelta, "poolId" | "userAddress" | "activityTime">,
  overrides: Partial<
    Omit<UserStatDelta, "poolId" | "userAddress" | "activityTime">
  > = {}
): UserStatDelta {
  return {
    poolId: base.poolId,
    userAddress: base.userAddress,
    activityTime: base.activityTime,
    activeBondsDelta: 0n,
    depositedUsdcDelta: 0n,
    withdrawnUsdcDelta: 0n,
    wonUsdcDelta: 0n,
    claimedUsdcDelta: 0n,
    reinvestedUsdcDelta: 0n,
    depositCountDelta: 0,
    withdrawCountDelta: 0,
    winCountDelta: 0,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PgTx = any;

/**
 * Sanitizes object by converting BigInt values to string to prevent JSON.stringify errors in jsonb columns.
 */
export function sanitizeForJsonb(obj: unknown): unknown {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(sanitizeForJsonb);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitizeForJsonb(v)])
    );
  }
  return obj;
}

/**
 * In-memory aggregation of user portfolio deltas to avoid PostgreSQL 21000 batch conflict errors.
 */
export function aggregateUserStatDeltas(
  deltas: UserStatDelta[]
): UserStatDelta[] {
  const aggregated = new Map<string, UserStatDelta>();

  for (const d of deltas) {
    const key = `${d.poolId}:${d.userAddress}`;
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { ...d });
    } else {
      existing.activeBondsDelta += d.activeBondsDelta;
      existing.depositedUsdcDelta += d.depositedUsdcDelta;
      existing.withdrawnUsdcDelta += d.withdrawnUsdcDelta;
      existing.wonUsdcDelta += d.wonUsdcDelta;
      existing.claimedUsdcDelta += d.claimedUsdcDelta;
      existing.reinvestedUsdcDelta += d.reinvestedUsdcDelta;
      existing.depositCountDelta += d.depositCountDelta;
      existing.withdrawCountDelta += d.withdrawCountDelta;
      existing.winCountDelta += d.winCountDelta;
      existing.activityTime = Math.max(existing.activityTime, d.activityTime);
    }
  }

  return Array.from(aggregated.values());
}

/**
 * Safely converts an on-chain timestamp to unix seconds, falling back to blockTime if absent or invalid.
 */
export function toUnixTimestampSeconds(
  onChainTimestamp: bigint | number | undefined | null,
  fallbackBlockTime: number
): number {
  if (onChainTimestamp != null) {
    const sec = Number(onChainTimestamp);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.floor(sec);
    }
  }
  if (Number.isFinite(fallbackBlockTime) && fallbackBlockTime > 0) {
    return Math.floor(fallbackBlockTime);
  }
  return 0;
}

export interface BuildHaltedDrawRowParams {
  poolId: number;
  cycleId: number;
  status: "HaltedInsolvent" | "HaltedYieldSpike";
  lockedTicketCount: bigint | number;
  timestamp?: bigint | number | null;
  signature: string;
  blockTime: number;
}

export function buildHaltedDrawRow(
  params: BuildHaltedDrawRowParams
): typeof drawHistory.$inferInsert {
  const completedTimestamp = toUnixTimestampSeconds(
    params.timestamp,
    params.blockTime
  );
  return {
    poolId: params.poolId,
    cycleId: params.cycleId,
    status: params.status,
    prizePot: 0n,
    cycleFeeCollected: 0n,
    lockedTicketCount: BigInt(params.lockedTicketCount),
    winnersSynced: true,
    initiatedAt: completedTimestamp,
    completedAt: completedTimestamp,
    signature: params.signature,
    blockTime: params.blockTime,
  };
}

export interface BuildPendingRedemptionRowParams {
  poolId: number;
  redemptionId: bigint | number;
  userAddress: string;
  redemptionType: "bond_sale" | "prize_claim" | "fee_withdrawal";
  amountUsdc: bigint | number;
  batchId?: bigint | number | null;
  pstSharesLocked?: bigint | number | null;
  humaRequestId?: bigint | number | string | null;
  signature: string;
  blockTime: number;
  status?: "settling" | "ready" | "claimed";
  claimSignature?: string | null;
  requestedAt?: number | null;
  claimedAt?: number | null;
}

export function buildPendingRedemptionRow(
  params: BuildPendingRedemptionRowParams
): typeof pendingRedemptions.$inferInsert {
  const status = params.status ?? "settling";
  return {
    poolId: params.poolId,
    redemptionId: BigInt(params.redemptionId),
    userAddress: params.userAddress,
    redemptionType: params.redemptionType,
    amountUsdc: BigInt(params.amountUsdc),
    batchId: BigInt(params.batchId ?? 0),
    pstSharesLocked:
      params.pstSharesLocked != null ? BigInt(params.pstSharesLocked) : null,
    status,
    requestSignature: params.signature,
    claimSignature:
      params.claimSignature !== undefined
        ? params.claimSignature
        : status === "claimed"
          ? params.signature
          : null,
    requestedAt: params.requestedAt ?? params.blockTime,
    claimedAt:
      params.claimedAt !== undefined
        ? params.claimedAt
        : status === "claimed"
          ? params.blockTime
          : null,
  };
}

/**
 * Folds multiple draw history rows targeting the same (poolId, cycleId) in memory.
 */
export function foldDrawHistoryRows(
  rows: (typeof drawHistory.$inferInsert)[]
): (typeof drawHistory.$inferInsert)[] {
  const map = new Map<string, typeof drawHistory.$inferInsert>();
  for (const r of rows) {
    const key = `${r.poolId}:${r.cycleId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
    } else {
      // Status state machine (mirrors PostgreSQL CASE expression)
      if (
        r.status === "Voided" &&
        (existing.status === "Complete" ||
          existing.status === "AwaitingRandomness")
      ) {
        existing.status = "Voided";
      } else if (
        !isUnoverridableDrawStatus(existing.status) &&
        existing.status !== "Complete"
      ) {
        existing.status = r.status;
      }

      if (isZeroYieldDrawStatus(existing.status)) {
        existing.prizePot = 0n;
        existing.cycleFeeCollected = 0n;
        existing.totalDistributed = 0n;
      } else if (isRolledBackDrawStatus(existing.status)) {
        // Protect authoritative harvest pot from dust truncation in DrawVoided
        if (r.prizePot && r.prizePot > (existing.prizePot ?? 0n))
          existing.prizePot = r.prizePot;
        if (
          r.cycleFeeCollected &&
          r.cycleFeeCollected > (existing.cycleFeeCollected ?? 0n)
        )
          existing.cycleFeeCollected = r.cycleFeeCollected;
        existing.totalDistributed = 0n;
      } else {
        if (r.prizePot > 0n) existing.prizePot = r.prizePot;
        if (r.cycleFeeCollected && r.cycleFeeCollected > 0n)
          existing.cycleFeeCollected = r.cycleFeeCollected;
      }

      if (
        r.status === "Skipped" ||
        r.status === "HaltedInsolvent" ||
        r.status === "HaltedYieldSpike"
      ) {
        if (r.lockedTicketCount !== undefined && r.lockedTicketCount !== null) {
          existing.lockedTicketCount = r.lockedTicketCount;
        }
      } else if (
        r.lockedTicketCount !== undefined &&
        r.lockedTicketCount !== null &&
        r.lockedTicketCount > 0n
      ) {
        existing.lockedTicketCount = r.lockedTicketCount;
      } else if (
        existing.lockedTicketCount === undefined &&
        r.lockedTicketCount !== undefined
      ) {
        existing.lockedTicketCount = r.lockedTicketCount;
      }
      if (r.vrfSeedSlot && r.vrfSeedSlot > 0) {
        if (r.vrfSeedSlot >= (existing.vrfSeedSlot || 0)) {
          existing.vrfSeedSlot = r.vrfSeedSlot;
          if (r.randomnessAccount)
            existing.randomnessAccount = r.randomnessAccount;
        }
      } else if (r.randomnessAccount && !existing.randomnessAccount) {
        existing.randomnessAccount = r.randomnessAccount;
      }
      if (r.winnersCount && r.winnersCount > 0)
        existing.winnersCount = r.winnersCount;
      if (
        isRolledBackDrawStatus(existing.status) ||
        isZeroYieldDrawStatus(existing.status)
      ) {
        existing.totalDistributed = 0n;
      } else if (r.totalDistributed && r.totalDistributed > 0n) {
        existing.totalDistributed = r.totalDistributed;
      }
      if (r.winnersSynced !== undefined) {
        existing.winnersSynced = Boolean(
          existing.winnersSynced || r.winnersSynced
        );
      }

      // YieldHarvested (status === "AwaitingRandomness") is the authoritative source for initiatedAt
      // and always sets valid timestamps. Other events (e.g. DrawCompleted, DrawSkipped) only backfill
      // if existing is missing/zero. RandomnessRebound carries undefined initiatedAt and must not overwrite.
      if (r.initiatedAt && r.initiatedAt > 0) {
        if (
          r.status === "AwaitingRandomness" ||
          !existing.initiatedAt ||
          existing.initiatedAt === 0
        ) {
          existing.initiatedAt = r.initiatedAt;
        }
      }

      if (r.completedAt && r.completedAt > 0)
        existing.completedAt = r.completedAt;
      if (r.revealedAt && r.revealedAt > 0) existing.revealedAt = r.revealedAt;
      if (r.vrfSeedHex && r.vrfSeedHex.length > 0)
        existing.vrfSeedHex = r.vrfSeedHex;
      existing.blockTime = Math.max(existing.blockTime, r.blockTime);
    }
  }
  return Array.from(map.values());
}

/**
 * Folds pending redemptions targeting the same (poolId, redemptionId) in memory.
 */
export function foldPendingRedemptionRows(
  rows: (typeof pendingRedemptions.$inferInsert)[]
): (typeof pendingRedemptions.$inferInsert)[] {
  const map = new Map<string, typeof pendingRedemptions.$inferInsert>();
  for (const r of rows) {
    const key = `${r.poolId}:${r.redemptionId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
    } else {
      if (r.status === "claimed") {
        existing.status = "claimed";
        existing.claimSignature = r.claimSignature || existing.claimSignature;
        existing.claimedAt = r.claimedAt || existing.claimedAt;
      } else if (r.status === "ready" && existing.status !== "claimed") {
        existing.status = "ready";
      }
      if (r.amountUsdc != null) existing.amountUsdc = r.amountUsdc;
      if (r.pstSharesLocked != null)
        existing.pstSharesLocked = r.pstSharesLocked;
      if (r.batchId != null) existing.batchId = r.batchId;
    }
  }
  return Array.from(map.values());
}

/**
 * Folds redemption batches targeting the same (poolId, batchId) in memory.
 */
export function foldRedemptionBatchRows(
  rows: (typeof redemptionBatches.$inferInsert)[]
): (typeof redemptionBatches.$inferInsert)[] {
  const map = new Map<string, typeof redemptionBatches.$inferInsert>();
  for (const r of rows) {
    const key = `${r.poolId}:${r.batchId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
    } else {
      if (r.status === "Closed") {
        existing.status = "Closed";
      } else if (r.status === "Settled" && existing.status !== "Closed") {
        existing.status = "Settled";
      } else if (
        r.status === "Submitted" &&
        existing.status !== "Closed" &&
        existing.status !== "Settled"
      ) {
        existing.status = "Submitted";
      }
      if (r.totalPrincipalRequested)
        existing.totalPrincipalRequested = r.totalPrincipalRequested;
      if (r.totalPstSharesLocked)
        existing.totalPstSharesLocked = r.totalPstSharesLocked;
      if (r.settledUsdcReceived)
        existing.settledUsdcReceived = r.settledUsdcReceived;
      if (r.claimedPrincipal) existing.claimedPrincipal = r.claimedPrincipal;
      if (r.humaRequestId != null) existing.humaRequestId = r.humaRequestId;
      if (r.submittedAt) existing.submittedAt = r.submittedAt;
      if (r.settledAt) existing.settledAt = r.settledAt;
      if (r.closedAt) existing.closedAt = r.closedAt;
      if (r.submitSignature) existing.submitSignature = r.submitSignature;
      if (r.settleSignature) existing.settleSignature = r.settleSignature;
      if (r.closeSignature) existing.closeSignature = r.closeSignature;
    }
  }
  return Array.from(map.values());
}

/**
 * Folds pool snapshot rows targeting the same (poolId, cycleId) in memory.
 */
export function foldPoolSnapshotRows(
  rows: (typeof poolSnapshots.$inferInsert)[]
): (typeof poolSnapshots.$inferInsert)[] {
  const map = new Map<string, typeof poolSnapshots.$inferInsert>();
  for (const r of rows) {
    const key = `${r.poolId}:${r.cycleId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
    } else {
      if (r.totalDepositedPrincipal)
        existing.totalDepositedPrincipal = r.totalDepositedPrincipal;
      if (r.totalFeesAccrued) existing.totalFeesAccrued = r.totalFeesAccrued;
      if (r.totalFeesWithdrawn)
        existing.totalFeesWithdrawn = r.totalFeesWithdrawn;
      if (r.rawYield) existing.rawYield = r.rawYield;
      if (r.prizePot) existing.prizePot = r.prizePot;
      if (r.feeCollected) existing.feeCollected = r.feeCollected;
      if (r.lockedTicketCount) existing.lockedTicketCount = r.lockedTicketCount;
      existing.snapshotTime = Math.max(
        Number(existing.snapshotTime),
        Number(r.snapshotTime)
      );
    }
  }
  return Array.from(map.values());
}

/**
 * Folds winner update rows targeting the same (poolId, cycleId, winnerIndex) in memory.
 */
export function foldWinnerUpdateRows(
  rows: WinnerUpdateRow[]
): WinnerUpdateRow[] {
  const map = new Map<string, WinnerUpdateRow>();
  for (const r of rows) {
    const key = `${r.poolId}:${r.cycleId}:${r.winnerIndex}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
    } else {
      existing.bondsBought =
        r.bondsBought > existing.bondsBought
          ? r.bondsBought
          : existing.bondsBought;
      if (r.amountReinvested !== undefined) {
        existing.amountReinvested =
          existing.amountReinvested !== undefined
            ? r.amountReinvested > existing.amountReinvested
              ? r.amountReinvested
              : existing.amountReinvested
            : r.amountReinvested;
      }
      existing.claimSignature = existing.claimSignature || r.claimSignature;
    }
  }
  return Array.from(map.values());
}

/**
 * Updates drawWinners rows for reinvested prizes and detects unhydrated cycles.
 */
export async function updateDrawWinnersTx(
  tx: PgTx,
  updates: WinnerUpdateRow[]
): Promise<{ unhydratedDraws: { poolId: number; cycleId: number }[] }> {
  if (updates.length === 0) return { unhydratedDraws: [] };
  const missingDraws = new Map<string, { poolId: number; cycleId: number }>();

  for (const up of updates) {
    const hasReinvestedAmount = up.amountReinvested !== undefined;
    const amountReinvested = up.amountReinvested ?? 0n;

    const updated = await tx
      .update(drawWinners)
      .set({
        processed: true,
        bondsBought: sql`GREATEST(${drawWinners.bondsBought}, ${up.bondsBought})`,
        dustAccumulated: hasReinvestedAmount
          ? sql`CASE WHEN ${drawWinners.amountOwed} > ${amountReinvested} THEN ${drawWinners.amountOwed} - ${amountReinvested} ELSE ${drawWinners.dustAccumulated} END`
          : sql`${drawWinners.dustAccumulated}`,
        claimSignature: sql`COALESCE(${drawWinners.claimSignature}, ${up.claimSignature})`,
      })
      .where(
        and(
          eq(drawWinners.poolId, up.poolId),
          eq(drawWinners.cycleId, up.cycleId),
          eq(drawWinners.winnerIndex, up.winnerIndex),
          eq(drawWinners.winnerAddress, up.winnerAddress)
        )
      )
      .returning({ winnerIndex: drawWinners.winnerIndex });

    if (!updated || updated.length === 0) {
      missingDraws.set(`${up.poolId}:${up.cycleId}`, {
        poolId: up.poolId,
        cycleId: up.cycleId,
      });
    }
  }

  return { unhydratedDraws: Array.from(missingDraws.values()) };
}

/**
 * Inserts rows in safe chunks (max 100 rows) within a transaction client.
 */
export async function chunkedInsertTx<T extends Table>(
  tx: PgTx,
  table: T,
  values: unknown[],
  chunkSize = 100
) {
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await tx
      .insert(table)
      .values(chunk as never)
      .onConflictDoNothing();
  }
}

export async function upsertDrawHistoryTx(
  tx: PgTx,
  rows: (typeof drawHistory.$inferInsert)[]
) {
  if (rows.length === 0) return;
  const folded = foldDrawHistoryRows(rows);

  for (const row of folded) {
    await tx
      .insert(drawHistory)
      .values(row)
      .onConflictDoUpdate({
        target: [drawHistory.poolId, drawHistory.cycleId],
        set: {
          status: sql`CASE
            WHEN ${drawHistory.status} IN ('ForceUnlocked', 'Skipped', 'Voided', 'HaltedInsolvent', 'HaltedYieldSpike') THEN ${drawHistory.status}
            WHEN ${drawHistory.status} = 'Complete' AND EXCLUDED.status = 'Voided' THEN 'Voided'
            WHEN ${drawHistory.status} = 'Complete' THEN 'Complete'
            ELSE EXCLUDED.status
          END`,
          prizePot: sql`CASE
            WHEN ${drawHistory.status} IN ('Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN EXCLUDED.status IN ('Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN ${drawHistory.status} = 'Voided' AND ${drawHistory.prizePot} > 0 THEN GREATEST(${drawHistory.prizePot}, COALESCE(EXCLUDED.prize_pot, 0))
            WHEN EXCLUDED.status = 'Voided' AND ${drawHistory.prizePot} > 0 THEN ${drawHistory.prizePot}
            ELSE COALESCE(NULLIF(EXCLUDED.prize_pot, 0), ${drawHistory.prizePot})
          END`,
          cycleFeeCollected: sql`CASE
            WHEN ${drawHistory.status} IN ('Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN EXCLUDED.status IN ('Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            ELSE COALESCE(NULLIF(EXCLUDED.cycle_fee_collected, 0), ${drawHistory.cycleFeeCollected})
          END`,
          lockedTicketCount: sql`CASE
            WHEN EXCLUDED.status IN ('Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN EXCLUDED.locked_ticket_count
            WHEN EXCLUDED.locked_ticket_count IS NOT NULL AND EXCLUDED.locked_ticket_count > 0 THEN EXCLUDED.locked_ticket_count
            ELSE ${drawHistory.lockedTicketCount}
          END`,
          vrfSeedSlot: sql`GREATEST(COALESCE(${drawHistory.vrfSeedSlot}, 0), COALESCE(EXCLUDED.vrf_seed_slot, 0))`,
          randomnessAccount: sql`CASE
            WHEN NULLIF(EXCLUDED.randomness_account, '') IS NOT NULL AND COALESCE(EXCLUDED.vrf_seed_slot, 0) >= COALESCE(${drawHistory.vrfSeedSlot}, 0) THEN EXCLUDED.randomness_account
            ELSE ${drawHistory.randomnessAccount}
          END`,
          winnersCount: sql`COALESCE(NULLIF(EXCLUDED.winners_count, 0), ${drawHistory.winnersCount})`,
          totalDistributed: sql`CASE
            WHEN ${drawHistory.status} IN ('Voided', 'ForceUnlocked', 'Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN EXCLUDED.status IN ('Voided', 'ForceUnlocked', 'Skipped', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            ELSE COALESCE(NULLIF(EXCLUDED.total_distributed, 0), ${drawHistory.totalDistributed})
          END`,
          winnersSynced: sql`CASE
            WHEN ${drawHistory.winnersSynced} = true THEN true
            WHEN EXCLUDED.winners_synced = true THEN true
            WHEN EXCLUDED.status IN ('Skipped', 'ForceUnlocked', 'HaltedInsolvent', 'HaltedYieldSpike') THEN true
            ELSE false
          END`,
          initiatedAt: sql`CASE
            WHEN ${drawHistory.initiatedAt} IS NOT NULL AND ${drawHistory.initiatedAt} > 0 THEN ${drawHistory.initiatedAt}
            WHEN EXCLUDED.initiated_at IS NOT NULL AND EXCLUDED.initiated_at > 0 THEN EXCLUDED.initiated_at
            ELSE ${drawHistory.initiatedAt}
          END`,
          completedAt: sql`COALESCE(EXCLUDED.completed_at, ${drawHistory.completedAt})`,
          revealedAt: sql`COALESCE(NULLIF(EXCLUDED.revealed_at, 0), ${drawHistory.revealedAt})`,
          vrfSeedHex: sql`COALESCE(NULLIF(EXCLUDED.vrf_seed_hex, ''), ${drawHistory.vrfSeedHex})`,
          signature: sql`EXCLUDED.signature`,
          blockTime: sql`GREATEST(${drawHistory.blockTime}, EXCLUDED.block_time)`,
        },
      });
  }
}

export async function upsertPendingRedemptionsTx(
  tx: PgTx,
  rows: (typeof pendingRedemptions.$inferInsert)[]
) {
  if (rows.length === 0) return;
  const folded = foldPendingRedemptionRows(rows);

  for (const row of folded) {
    await tx
      .insert(pendingRedemptions)
      .values(row)
      .onConflictDoUpdate({
        target: [pendingRedemptions.poolId, pendingRedemptions.redemptionId],
        set: {
          status: sql`CASE
            WHEN ${pendingRedemptions.status} = 'claimed' THEN 'claimed'
            WHEN EXCLUDED.status = 'claimed' THEN 'claimed'
            WHEN ${pendingRedemptions.status} = 'ready' THEN 'ready'
            ELSE EXCLUDED.status
          END`,
          claimSignature: sql`COALESCE(EXCLUDED.claim_signature, ${pendingRedemptions.claimSignature})`,
          claimedAt: sql`COALESCE(EXCLUDED.claimed_at, ${pendingRedemptions.claimedAt})`,
          amountUsdc: sql`COALESCE(NULLIF(EXCLUDED.amount_usdc, 0), ${pendingRedemptions.amountUsdc})`,
          pstSharesLocked: sql`COALESCE(EXCLUDED.pst_shares_locked, ${pendingRedemptions.pstSharesLocked})`,
          batchId: sql`COALESCE(EXCLUDED.batch_id, ${pendingRedemptions.batchId})`,
        },
      });
  }
}

export async function upsertRedemptionBatchesTx(
  tx: PgTx,
  rows: (typeof redemptionBatches.$inferInsert)[]
) {
  if (rows.length === 0) return;
  const folded = foldRedemptionBatchRows(rows);

  for (const row of folded) {
    await tx
      .insert(redemptionBatches)
      .values(row)
      .onConflictDoUpdate({
        target: [redemptionBatches.poolId, redemptionBatches.batchId],
        set: {
          status: sql`CASE
            WHEN ${redemptionBatches.status} = 'Closed' THEN 'Closed'
            WHEN EXCLUDED.status = 'Closed' THEN 'Closed'
            WHEN ${redemptionBatches.status} = 'Settled' THEN 'Settled'
            WHEN EXCLUDED.status = 'Settled' THEN 'Settled'
            WHEN ${redemptionBatches.status} = 'Submitted' THEN 'Submitted'
            ELSE EXCLUDED.status
          END`,
          totalPrincipalRequested: sql`COALESCE(NULLIF(EXCLUDED.total_principal_requested, 0), ${redemptionBatches.totalPrincipalRequested})`,
          totalPstSharesLocked: sql`COALESCE(NULLIF(EXCLUDED.total_pst_shares_locked, 0), ${redemptionBatches.totalPstSharesLocked})`,
          settledUsdcReceived: sql`COALESCE(NULLIF(EXCLUDED.settled_usdc_received, 0), ${redemptionBatches.settledUsdcReceived})`,
          claimedPrincipal: sql`COALESCE(NULLIF(EXCLUDED.claimed_principal, 0), ${redemptionBatches.claimedPrincipal})`,
          humaRequestId: sql`COALESCE(EXCLUDED.huma_request_id, ${redemptionBatches.humaRequestId})`,
          submittedAt: sql`COALESCE(EXCLUDED.submitted_at, ${redemptionBatches.submittedAt})`,
          settledAt: sql`COALESCE(EXCLUDED.settled_at, ${redemptionBatches.settledAt})`,
          closedAt: sql`COALESCE(EXCLUDED.closed_at, ${redemptionBatches.closedAt})`,
          submitSignature: sql`COALESCE(EXCLUDED.submit_signature, ${redemptionBatches.submitSignature})`,
          settleSignature: sql`COALESCE(EXCLUDED.settle_signature, ${redemptionBatches.settleSignature})`,
          closeSignature: sql`COALESCE(EXCLUDED.close_signature, ${redemptionBatches.closeSignature})`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function upsertPoolSnapshotsTx(
  tx: PgTx,
  rows: (typeof poolSnapshots.$inferInsert)[]
) {
  if (rows.length === 0) return;
  const folded = foldPoolSnapshotRows(rows);

  for (const row of folded) {
    await tx
      .insert(poolSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [poolSnapshots.poolId, poolSnapshots.cycleId],
        set: {
          totalDepositedPrincipal: sql`COALESCE(NULLIF(EXCLUDED.total_deposited_principal, 0), ${poolSnapshots.totalDepositedPrincipal})`,
          totalFeesAccrued: sql`COALESCE(NULLIF(EXCLUDED.total_fees_accrued, 0), ${poolSnapshots.totalFeesAccrued})`,
          totalFeesWithdrawn: sql`COALESCE(NULLIF(EXCLUDED.total_fees_withdrawn, 0), ${poolSnapshots.totalFeesWithdrawn})`,
          rawYield: sql`COALESCE(NULLIF(EXCLUDED.raw_yield, 0), ${poolSnapshots.rawYield})`,
          prizePot: sql`COALESCE(NULLIF(EXCLUDED.prize_pot, 0), ${poolSnapshots.prizePot})`,
          feeCollected: sql`COALESCE(NULLIF(EXCLUDED.fee_collected, 0), ${poolSnapshots.feeCollected})`,
          lockedTicketCount: sql`COALESCE(NULLIF(EXCLUDED.locked_ticket_count, 0), ${poolSnapshots.lockedTicketCount})`,
          snapshotTime: sql`GREATEST(${poolSnapshots.snapshotTime}, EXCLUDED.snapshot_time)`,
        },
      });
  }
}

export async function applyUserPortfolioStatsTx(
  tx: PgTx,
  deltas: UserStatDelta[]
) {
  if (deltas.length === 0) return;
  const aggregated = aggregateUserStatDeltas(deltas);

  for (const d of aggregated) {
    await tx
      .insert(userPortfolioStats)
      .values({
        poolId: d.poolId,
        userAddress: d.userAddress,
        activeBonds: d.activeBondsDelta < 0n ? 0n : d.activeBondsDelta,
        totalDepositedUsdc: d.depositedUsdcDelta,
        totalWithdrawnUsdc: d.withdrawnUsdcDelta,
        totalWonUsdc: d.wonUsdcDelta,
        totalClaimedUsdc: d.claimedUsdcDelta,
        totalReinvestedUsdc: d.reinvestedUsdcDelta,
        winCount: d.winCountDelta,
        depositCount: d.depositCountDelta,
        withdrawCount: d.withdrawCountDelta,
        firstActivityAt: d.activityTime,
        lastActivityAt: d.activityTime,
      })
      .onConflictDoUpdate({
        target: [userPortfolioStats.poolId, userPortfolioStats.userAddress],
        set: {
          activeBonds: sql`GREATEST(0, ${userPortfolioStats.activeBonds} + ${d.activeBondsDelta})`,
          totalDepositedUsdc: sql`${userPortfolioStats.totalDepositedUsdc} + ${d.depositedUsdcDelta}`,
          totalWithdrawnUsdc: sql`${userPortfolioStats.totalWithdrawnUsdc} + ${d.withdrawnUsdcDelta}`,
          totalWonUsdc: sql`${userPortfolioStats.totalWonUsdc} + ${d.wonUsdcDelta}`,
          totalClaimedUsdc: sql`${userPortfolioStats.totalClaimedUsdc} + ${d.claimedUsdcDelta}`,
          totalReinvestedUsdc: sql`${userPortfolioStats.totalReinvestedUsdc} + ${d.reinvestedUsdcDelta}`,
          winCount: sql`${userPortfolioStats.winCount} + ${d.winCountDelta}`,
          depositCount: sql`${userPortfolioStats.depositCount} + ${d.depositCountDelta}`,
          withdrawCount: sql`${userPortfolioStats.withdrawCount} + ${d.withdrawCountDelta}`,
          firstActivityAt: sql`LEAST(${userPortfolioStats.firstActivityAt}, ${d.activityTime})`,
          lastActivityAt: sql`GREATEST(${userPortfolioStats.lastActivityAt}, ${d.activityTime})`,
          updatedAt: new Date(),
        },
      });
  }
}

export interface ReducedBatchEvents {
  rawEventRows: (typeof protocolEvents.$inferInsert)[];
  activityRows: (typeof bondsActivity.$inferInsert)[];
  winnerUpdateRows: WinnerUpdateRow[];
  drawRows: (typeof drawHistory.$inferInsert)[];
  redemptionRows: (typeof pendingRedemptions.$inferInsert)[];
  batchRows: (typeof redemptionBatches.$inferInsert)[];
  settledBatchUpdates: { poolId: number; batchId: bigint }[];
  snapshotRows: (typeof poolSnapshots.$inferInsert)[];
  userStatDeltas: UserStatDelta[];
  payoutRegistryClosedUpdates: { poolId: number; cycleId: number }[];
}

export function reduceBatchEvents(
  batch: IngestTransactionItem[]
): ReducedBatchEvents {
  const rawEventRows: (typeof protocolEvents.$inferInsert)[] = [];
  const activityRows: (typeof bondsActivity.$inferInsert)[] = [];
  const winnerUpdateRows: WinnerUpdateRow[] = [];
  const drawRows: (typeof drawHistory.$inferInsert)[] = [];
  const redemptionRows: (typeof pendingRedemptions.$inferInsert)[] = [];
  const batchRows: (typeof redemptionBatches.$inferInsert)[] = [];
  const settledBatchUpdates: { poolId: number; batchId: bigint }[] = [];
  const snapshotRows: (typeof poolSnapshots.$inferInsert)[] = [];
  const userStatDeltas: UserStatDelta[] = [];
  const payoutRegistryClosedUpdates: { poolId: number; cycleId: number }[] = [];

  for (const { context, events } of batch) {
    events.forEach((evt, eventIndex) => {
      const meta = resolveEventMetadata(evt);

      rawEventRows.push({
        signature: context.signature,
        eventIndex,
        slot: context.slot,
        blockTime: context.blockTime,
        eventType: evt.type,
        poolId: meta.poolId,
        userAddress: meta.userAddress || null,
        data: sanitizeForJsonb(evt.data) as Record<string, unknown>,
      });

      switch (evt.type) {
        case "BondsPurchased":
          activityRows.push({
            signature: context.signature,
            eventIndex,
            userAddress: evt.data.user,
            poolId: evt.data.poolId,
            activityType: "deposit",
            bonds: evt.data.bonds,
            amountUsdc: BigInt(evt.data.amount),
            blockTime: context.blockTime,
          });
          userStatDeltas.push(
            createUserStatDelta(
              {
                poolId: evt.data.poolId,
                userAddress: evt.data.user,
                activityTime: context.blockTime,
              },
              {
                activeBondsDelta: BigInt(evt.data.bonds),
                depositedUsdcDelta: BigInt(evt.data.amount),
                depositCountDelta: 1,
              }
            )
          );
          if (evt.data.newTotalDepositedPrincipal != null) {
            snapshotRows.push({
              poolId: evt.data.poolId,
              cycleId: 0,
              snapshotTime: context.blockTime,
              totalDepositedPrincipal: evt.data.newTotalDepositedPrincipal,
              totalFeesAccrued: 0n,
              totalFeesWithdrawn: 0n,
            });
          }
          break;

        case "BondsSold":
          activityRows.push({
            signature: context.signature,
            eventIndex,
            userAddress: evt.data.user,
            poolId: evt.data.poolId,
            activityType: "withdraw",
            bonds: evt.data.bonds,
            amountUsdc: BigInt(evt.data.principal),
            redemptionId:
              evt.data.redemptionId != null
                ? BigInt(evt.data.redemptionId)
                : null,
            blockTime: context.blockTime,
          });
          redemptionRows.push(
            buildPendingRedemptionRow({
              poolId: evt.data.poolId,
              redemptionId: evt.data.redemptionId,
              userAddress: evt.data.user,
              redemptionType: "bond_sale",
              amountUsdc: evt.data.principal,
              batchId: evt.data.batchId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Accumulating",
            createdAt: context.blockTime,
          });
          userStatDeltas.push(
            createUserStatDelta(
              {
                poolId: evt.data.poolId,
                userAddress: evt.data.user,
                activityTime: context.blockTime,
              },
              {
                activeBondsDelta: -BigInt(evt.data.bonds),
                withdrawnUsdcDelta: BigInt(evt.data.principal),
                withdrawCountDelta: 1,
              }
            )
          );
          break;

        case "WinningsReinvested": {
          winnerUpdateRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            winnerIndex: evt.data.winnerIndex,
            winnerAddress: evt.data.winner,
            bondsBought: BigInt(evt.data.bondsBought),
            amountReinvested: BigInt(evt.data.amountReinvested),
            claimSignature: context.signature,
          });

          if (evt.data.newTotalDepositedPrincipal != null) {
            snapshotRows.push({
              poolId: evt.data.poolId,
              cycleId: 0,
              snapshotTime: context.blockTime,
              totalDepositedPrincipal: evt.data.newTotalDepositedPrincipal,
              totalFeesAccrued: 0n,
              totalFeesWithdrawn: 0n,
            });
          }

          const prizeAmount = BigInt(evt.data.prizeAmount ?? 0);
          const amountReinvested = BigInt(evt.data.amountReinvested ?? 0);
          const remainingClaimable = BigInt(
            evt.data.remainingUnclaimedWinnings ?? 0
          );
          // If cost of bonds exceeds the draw prize, the difference was funded by prior claimable dust
          const usedPriorDust =
            amountReinvested > prizeAmount
              ? amountReinvested - prizeAmount
              : 0n;
          const isActualWin = prizeAmount > 0n;

          // Unified Reducer: Handles tickets purchased, mixed wins, dust compounding, and sub-ticket dust
          if (evt.data.bondsBought > 0 || isActualWin) {
            activityRows.push({
              signature: context.signature,
              eventIndex,
              userAddress: evt.data.winner,
              poolId: evt.data.poolId,
              activityType: "auto-reinvest",
              bonds: evt.data.bondsBought,
              // Record prize won in this draw cycle (0n for pure prior dust compounding)
              amountUsdc: prizeAmount,
              claimableUsdc: remainingClaimable,
              usedPriorDustUsdc: usedPriorDust,
              cycleId: evt.data.cycleId,
              blockTime: context.blockTime,
            });
            userStatDeltas.push(
              createUserStatDelta(
                {
                  poolId: evt.data.poolId,
                  userAddress: evt.data.winner,
                  activityTime: context.blockTime,
                },
                {
                  activeBondsDelta: BigInt(evt.data.bondsBought),
                  // wonUsdcDelta: Prize amount won THIS draw (excludes compounded prior dust)
                  wonUsdcDelta: prizeAmount,
                  // reinvestedUsdcDelta: Actual cost of bonds purchased (may include prior dust)
                  reinvestedUsdcDelta: amountReinvested,
                  winCountDelta: isActualWin ? 1 : 0,
                }
              )
            );
          }
          break;
        }

        case "WinningsClaimed": {
          activityRows.push({
            signature: context.signature,
            eventIndex,
            userAddress: evt.data.user,
            poolId: evt.data.poolId,
            activityType: "win",
            amountUsdc: BigInt(evt.data.amount),
            claimableUsdc: 0n,
            usedPriorDustUsdc: 0n,
            redemptionId:
              evt.data.redemptionId != null
                ? BigInt(evt.data.redemptionId)
                : null,
            blockTime: context.blockTime,
          });
          redemptionRows.push(
            buildPendingRedemptionRow({
              poolId: evt.data.poolId,
              redemptionId: evt.data.redemptionId,
              userAddress: evt.data.user,
              redemptionType: "prize_claim",
              amountUsdc: evt.data.amount,
              batchId: evt.data.batchId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Accumulating",
            createdAt: context.blockTime,
          });
          // Dead Code Elimination: WinningsClaimed is an async redemption request.
          // The win was already recorded in WinningsReinvested, and the claimed USDC delta will be
          // recorded in RedemptionClaimed upon settlement. Pushing a 0-delta object to userStatDeltas
          // is omitted entirely to prevent redundant no-op database UPDATE statements.
          break;
        }

        case "RedemptionClaimed":
          activityRows.push({
            signature: context.signature,
            eventIndex,
            userAddress: evt.data.user,
            poolId: evt.data.poolId,
            activityType: "claim-redemption",
            amountUsdc: BigInt(evt.data.amount),
            redemptionId:
              evt.data.redemptionId != null
                ? BigInt(evt.data.redemptionId)
                : null,
            blockTime: context.blockTime,
          });
          redemptionRows.push(
            buildPendingRedemptionRow({
              poolId: evt.data.poolId,
              redemptionId: evt.data.redemptionId,
              userAddress: evt.data.user,
              redemptionType:
                evt.data.redemptionType !== undefined &&
                REDEMPTION_TYPE_TO_DB[evt.data.redemptionType as RedemptionType]
                  ? REDEMPTION_TYPE_TO_DB[
                      evt.data.redemptionType as RedemptionType
                    ]
                  : "bond_sale",
              amountUsdc: evt.data.amount,
              batchId: evt.data.batchId,
              signature: context.signature,
              blockTime: context.blockTime,
              status: "claimed",
              claimSignature: context.signature,
              requestedAt: Number(evt.data.requestedAt ?? context.blockTime),
              claimedAt: context.blockTime,
            })
          );
          userStatDeltas.push(
            createUserStatDelta(
              {
                poolId: evt.data.poolId,
                userAddress: evt.data.user,
                activityTime: context.blockTime,
              },
              {
                claimedUsdcDelta: BigInt(evt.data.amount),
              }
            )
          );
          break;

        case "YieldHarvested": {
          const harvestTimestamp = toUnixTimestampSeconds(
            evt.data.timestamp,
            context.blockTime
          );
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "AwaitingRandomness",
            initiatedAt: harvestTimestamp,
            prizePot: BigInt(evt.data.prizePot),
            cycleFeeCollected: BigInt(evt.data.fee),
            lockedTicketCount: BigInt(evt.data.lockedTicketCount),
            randomnessAccount: evt.data.randomnessAccount,
            vrfSeedSlot: Number(evt.data.vrfSeedSlot),
            signature: context.signature,
            blockTime: context.blockTime,
          });
          snapshotRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            snapshotTime: context.blockTime,
            totalDepositedPrincipal: 0n,
            totalFeesAccrued: BigInt(evt.data.fee),
            totalFeesWithdrawn: 0n,
            rawYield: BigInt(evt.data.rawYield),
            prizePot: BigInt(evt.data.prizePot),
            feeCollected: BigInt(evt.data.fee),
            lockedTicketCount: BigInt(evt.data.lockedTicketCount),
          });
          break;
        }

        case "DrawCompleted": {
          const completedTimestamp = toUnixTimestampSeconds(
            evt.data.timestamp,
            context.blockTime
          );
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Complete",
            prizePot: BigInt(evt.data.prizePot),
            winnersCount: evt.data.winnersCount,
            totalDistributed: BigInt(
              evt.data.totalDistributed ?? evt.data.prizePot
            ),
            winnersSynced: false,
            completedAt: completedTimestamp,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;
        }

        case "DrawForceUnlocked": {
          const unlockedTimestamp = toUnixTimestampSeconds(
            evt.data.timestamp,
            context.blockTime
          );
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "ForceUnlocked",
            prizePot: BigInt(evt.data.prizePot),
            cycleFeeCollected: BigInt(evt.data.cycleFeeCollected),
            totalDistributed: 0n,
            winnersSynced: true,
            completedAt: unlockedTimestamp,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;
        }

        case "DrawVoided": {
          const voidedTimestamp = toUnixTimestampSeconds(
            evt.data.timestamp,
            context.blockTime
          );
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Voided",
            prizePot: BigInt(evt.data.prizesReversed || 0),
            cycleFeeCollected: BigInt(evt.data.feesReversed || 0),
            totalDistributed: 0n,
            winnersSynced: false,
            completedAt: voidedTimestamp,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;
        }

        case "PayoutRegistryClosed": {
          payoutRegistryClosedUpdates.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
          });
          break;
        }

        case "DrawSkipped": {
          const skippedTimestamp = toUnixTimestampSeconds(
            evt.data.timestamp,
            context.blockTime
          );
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Skipped",
            prizePot: 0n,
            cycleFeeCollected: 0n,
            lockedTicketCount: BigInt(evt.data.lockedTicketCount),
            winnersSynced: true,
            initiatedAt: skippedTimestamp,
            completedAt: skippedTimestamp,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          snapshotRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            snapshotTime: context.blockTime,
            totalDepositedPrincipal: 0n,
            totalFeesAccrued: 0n,
            totalFeesWithdrawn: 0n,
            rawYield: BigInt(evt.data.rawYield),
            prizePot: 0n,
            feeCollected: 0n,
            lockedTicketCount: BigInt(evt.data.lockedTicketCount),
          });
          break;
        }

        case "YieldVelocityBreached": {
          drawRows.push(
            buildHaltedDrawRow({
              poolId: evt.data.poolId,
              cycleId: evt.data.cycleId,
              status: "HaltedYieldSpike",
              lockedTicketCount: evt.data.lockedTicketCount,
              timestamp: evt.data.timestamp,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          break;
        }

        case "EmergencyInsolvencyDetected": {
          drawRows.push(
            buildHaltedDrawRow({
              poolId: evt.data.poolId,
              cycleId: evt.data.cycleId,
              status: "HaltedInsolvent",
              lockedTicketCount: evt.data.lockedTicketCount,
              timestamp: evt.data.timestamp,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          break;
        }

        case "RandomnessRebound": {
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "AwaitingRandomness",
            prizePot: 0n,
            vrfSeedSlot: Number(evt.data.vrfSeedSlot),
            randomnessAccount: evt.data.newRandomnessAccount,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;
        }

        case "FeesWithdrawn":
          redemptionRows.push(
            buildPendingRedemptionRow({
              poolId: evt.data.poolId,
              redemptionId: evt.data.redemptionId,
              userAddress: evt.data.feeWallet,
              redemptionType: "fee_withdrawal",
              amountUsdc: evt.data.amount,
              batchId: evt.data.batchId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Accumulating",
            createdAt: context.blockTime,
          });
          break;

        case "RedemptionBatchSubmitted":
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Submitted",
            humaRequestId: evt.data.humaRequestId.toString(),
            totalPrincipalRequested: evt.data.totalPrincipalRequested,
            totalPstSharesLocked: evt.data.pstSharesLocked,
            createdAt: context.blockTime,
            submittedAt: context.blockTime,
            submitSignature: context.signature,
          });
          break;

        case "RedemptionBatchSettled":
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Settled",
            humaRequestId: evt.data.humaRequestId.toString(),
            totalPrincipalRequested: evt.data.totalPrincipalRequested,
            settledUsdcReceived: evt.data.settledUsdcReceived,
            createdAt: context.blockTime,
            settledAt: context.blockTime,
            settleSignature: context.signature,
          });
          settledBatchUpdates.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
          });
          break;

        case "RedemptionBatchClosed":
          batchRows.push({
            poolId: evt.data.poolId,
            batchId: evt.data.batchId,
            status: "Closed",
            createdAt: context.blockTime,
            closedAt: context.blockTime,
            closeSignature: context.signature,
          });
          break;

        case "PoolImpairedModeEnabled":
          snapshotRows.push({
            poolId: evt.data.poolId,
            cycleId: 0,
            snapshotTime: context.blockTime,
            totalDepositedPrincipal: evt.data.totalDepositedPrincipal,
            totalFeesAccrued: 0n,
            totalFeesWithdrawn: 0n,
          });
          break;

        case "PoolRecapitalized":
          snapshotRows.push({
            poolId: evt.data.poolId,
            cycleId: 0,
            snapshotTime: context.blockTime,
            totalDepositedPrincipal: 0n,
            totalFeesAccrued: 0n,
            totalFeesWithdrawn: 0n,
          });
          break;
      }
    });
  }

  return {
    rawEventRows,
    activityRows,
    winnerUpdateRows,
    drawRows,
    redemptionRows,
    batchRows,
    settledBatchUpdates,
    snapshotRows,
    userStatDeltas,
    payoutRegistryClosedUpdates,
  };
}

export async function ingestTransactionBatch(
  batch: IngestTransactionItem[],
  options: { updateLatestCursor?: boolean } = { updateLatestCursor: true }
): Promise<IngestBatchResult> {
  if (!isDatabaseConfigured || batch.length === 0)
    return { insertedCount: 0, unhydratedDraws: [] };

  const {
    rawEventRows,
    activityRows,
    winnerUpdateRows,
    drawRows,
    redemptionRows,
    batchRows,
    settledBatchUpdates,
    snapshotRows,
    userStatDeltas,
    payoutRegistryClosedUpdates,
  } = reduceBatchEvents(batch);

  // Atomically execute all reducers within a single SQL transaction
  const result = await db.transaction(async (tx) => {
    // 1. Insert raw events and get set of newly inserted events for idempotent delta accumulation
    if (rawEventRows.length > 0) {
      await tx
        .insert(protocolEvents)
        .values(rawEventRows)
        .onConflictDoNothing();
    }

    // 2. Insert bonds activity log
    if (activityRows.length > 0) {
      await chunkedInsertTx(tx, bondsActivity, activityRows);
    }

    // 2b. Update Draw Winners on Reinvest
    let unhydratedDraws: { poolId: number; cycleId: number }[] = [];
    if (winnerUpdateRows.length > 0) {
      const updateRes = await updateDrawWinnersTx(
        tx,
        foldWinnerUpdateRows(winnerUpdateRows)
      );
      unhydratedDraws = updateRes.unhydratedDraws;
    }

    // 3. Upsert Draw History
    if (drawRows.length > 0) {
      await upsertDrawHistoryTx(tx, drawRows);
    }

    // 3b. Mark Payout Registry closed for draws where PayoutRegistryClosed event occurred
    if (payoutRegistryClosedUpdates.length > 0) {
      for (const update of payoutRegistryClosedUpdates) {
        await tx
          .update(drawHistory)
          .set({ winnersSynced: true })
          .where(
            and(
              eq(drawHistory.poolId, update.poolId),
              eq(drawHistory.cycleId, update.cycleId)
            )
          );
      }
    }

    // 4a. Upsert Redemption Batches
    if (batchRows.length > 0) {
      await upsertRedemptionBatchesTx(tx, batchRows);
    }

    // 4b. Upsert Pending Redemptions
    if (redemptionRows.length > 0) {
      await upsertPendingRedemptionsTx(tx, redemptionRows);
    }

    // 4c. Cascade Settled Redemption Batches to 'ready' on pending redemptions
    if (settledBatchUpdates.length > 0) {
      for (const s of settledBatchUpdates) {
        await tx
          .update(pendingRedemptions)
          .set({ status: "ready" })
          .where(
            and(
              eq(pendingRedemptions.poolId, s.poolId),
              eq(pendingRedemptions.batchId, s.batchId),
              eq(pendingRedemptions.status, "settling")
            )
          );
      }
    }

    // 5. Upsert Pool Snapshots
    if (snapshotRows.length > 0) {
      await upsertPoolSnapshotsTx(tx, snapshotRows);
    }

    // 6. Apply User Portfolio Stats (only for newly inserted events if we have existing records)
    if (userStatDeltas.length > 0) {
      await applyUserPortfolioStatsTx(tx, userStatDeltas);
    }

    // 7. Monotonically advance latest seen cursor if requested
    if (options.updateLatestCursor && batch.length > 0) {
      const maxTx = batch.reduce(
        (prev, curr) => (curr.context.slot > prev.context.slot ? curr : prev),
        batch[0]
      );

      if (maxTx) {
        await tx
          .insert(indexerCursor)
          .values({
            network: maxTx.context.network,
            latestSeenSignature: maxTx.context.signature,
            latestSeenSlot: maxTx.context.slot,
            lastBlockTime: maxTx.context.blockTime,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: indexerCursor.network,
            set: {
              latestSeenSignature: maxTx.context.signature,
              latestSeenSlot: maxTx.context.slot,
              lastBlockTime: maxTx.context.blockTime,
              updatedAt: new Date(),
            },
            where: sql`${indexerCursor.latestSeenSlot} <= ${maxTx.context.slot}`,
          });
      }
    }

    return {
      insertedCount: rawEventRows.length,
      unhydratedDraws,
    };
  });

  return result;
}
