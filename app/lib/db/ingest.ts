import { db, isDatabaseConfigured } from "./index";
import {
  protocolEvents,
  bondsActivity,
  drawHistory,
  drawWinners,
  pendingRedemptions,
  poolSnapshots,
  userPortfolioStats,
  indexerCursor,
} from "./schema";
import { ParsedProgramEvent, resolveEventMetadata } from "../anchor-events";
import { sql, Table, eq, and } from "drizzle-orm";
import {
  ZERO_PRIZE_DRAW_STATUSES,
  TERMINAL_DRAW_STATUSES,
  isUnoverridableDrawStatus,
} from "../draw-helpers";

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

export function buildPendingRedemptionRow(params: {
  poolId: number;
  redemptionId: bigint | number;
  userAddress: string;
  redemptionType: "bond_sale" | "prize_claim" | "fee_withdrawal";
  amountUsdc: bigint | number;
  pstSharesLocked?: bigint | number | null;
  humaRequestId?: bigint | number | string | null;
  signature: string;
  blockTime: number;
}): typeof pendingRedemptions.$inferInsert {
  return {
    poolId: params.poolId,
    redemptionId: BigInt(params.redemptionId),
    userAddress: params.userAddress,
    redemptionType: params.redemptionType,
    amountUsdc: BigInt(params.amountUsdc),
    pstSharesLocked:
      params.pstSharesLocked != null
        ? BigInt(params.pstSharesLocked)
        : null,
    humaRequestId:
      params.humaRequestId != null
        ? params.humaRequestId.toString()
        : null,
    status: "settling",
    requestSignature: params.signature,
    requestedAt: params.blockTime,
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

      if (ZERO_PRIZE_DRAW_STATUSES.includes(existing.status as never)) {
        existing.prizePot = 0n;
        existing.cycleFeeCollected = 0n;
      } else {
        if (r.prizePot > 0n) existing.prizePot = r.prizePot;
        if (r.cycleFeeCollected && r.cycleFeeCollected > 0n)
          existing.cycleFeeCollected = r.cycleFeeCollected;
      }

      if (r.lockedTicketCount !== undefined && r.lockedTicketCount !== null) {
        existing.lockedTicketCount = r.lockedTicketCount;
      }
      if (r.harvestSlot && r.harvestSlot > 0) {
        if (r.harvestSlot >= (existing.harvestSlot || 0)) {
          existing.harvestSlot = r.harvestSlot;
          if (r.randomnessAccount)
            existing.randomnessAccount = r.randomnessAccount;
        }
      } else if (r.randomnessAccount && !existing.randomnessAccount) {
        existing.randomnessAccount = r.randomnessAccount;
      }
      if (r.winnersCount && r.winnersCount > 0)
        existing.winnersCount = r.winnersCount;
      if (r.totalDistributed && r.totalDistributed > 0n)
        existing.totalDistributed = r.totalDistributed;
      if (r.winnersSynced !== undefined) {
        existing.winnersSynced = Boolean(
          existing.winnersSynced || r.winnersSynced
        );
      }

      // Authoritative initiator (YieldHarvested) sets initiation data.
      // Fallback completion events only populate initiatedAt if existing is missing/zero.
      if (r.status === "AwaitingRandomness") {
        existing.initiatedAt = r.initiatedAt;
        if (r.harvestSlot && r.harvestSlot >= (existing.harvestSlot || 0)) {
          existing.harvestSlot = r.harvestSlot;
          existing.randomnessAccount = r.randomnessAccount;
        }
      } else if (!existing.initiatedAt || existing.initiatedAt === 0) {
        if (r.initiatedAt && r.initiatedAt > 0) {
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
      if (r.humaRequestId != null) existing.humaRequestId = r.humaRequestId;
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
      if (r.totalPrizesDistributed)
        existing.totalPrizesDistributed = r.totalPrizesDistributed;
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
            WHEN ${drawHistory.status} IN ('Skipped', 'Voided', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN EXCLUDED.status IN ('Skipped', 'Voided', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            ELSE COALESCE(NULLIF(EXCLUDED.prize_pot, 0), ${drawHistory.prizePot})
          END`,
          cycleFeeCollected: sql`CASE
            WHEN ${drawHistory.status} IN ('Skipped', 'Voided', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            WHEN EXCLUDED.status IN ('Skipped', 'Voided', 'HaltedInsolvent', 'HaltedYieldSpike') THEN 0
            ELSE COALESCE(NULLIF(EXCLUDED.cycle_fee_collected, 0), ${drawHistory.cycleFeeCollected})
          END`,
          lockedTicketCount: sql`COALESCE(EXCLUDED.locked_ticket_count, ${drawHistory.lockedTicketCount})`,
          harvestSlot: sql`GREATEST(COALESCE(${drawHistory.harvestSlot}, 0), COALESCE(EXCLUDED.harvest_slot, 0))`,
          randomnessAccount: sql`CASE
            WHEN NULLIF(EXCLUDED.randomness_account, '') IS NOT NULL AND COALESCE(EXCLUDED.harvest_slot, 0) >= COALESCE(${drawHistory.harvestSlot}, 0) THEN EXCLUDED.randomness_account
            ELSE ${drawHistory.randomnessAccount}
          END`,
          winnersCount: sql`COALESCE(NULLIF(EXCLUDED.winners_count, 0), ${drawHistory.winnersCount})`,
          totalDistributed: sql`COALESCE(NULLIF(EXCLUDED.total_distributed, 0), ${drawHistory.totalDistributed})`,
          winnersSynced: sql`CASE
            WHEN ${drawHistory.winnersSynced} = true THEN true
            WHEN EXCLUDED.winners_synced = true THEN true
            WHEN EXCLUDED.status IN ('Skipped', 'Voided', 'ForceUnlocked', 'HaltedInsolvent', 'HaltedYieldSpike') THEN true
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
          humaRequestId: sql`COALESCE(EXCLUDED.huma_request_id, ${pendingRedemptions.humaRequestId})`,
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
          totalPrizesDistributed: sql`COALESCE(NULLIF(EXCLUDED.total_prizes_distributed, 0), ${poolSnapshots.totalPrizesDistributed})`,
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

export async function ingestTransactionBatch(
  batch: IngestTransactionItem[],
  options: { updateLatestCursor?: boolean } = { updateLatestCursor: true }
): Promise<IngestBatchResult> {
  if (!isDatabaseConfigured || batch.length === 0)
    return { insertedCount: 0, unhydratedDraws: [] };

  const rawEventRows: (typeof protocolEvents.$inferInsert)[] = [];
  const activityRows: (typeof bondsActivity.$inferInsert)[] = [];
  const winnerUpdateRows: WinnerUpdateRow[] = [];
  const drawRows: (typeof drawHistory.$inferInsert)[] = [];
  const redemptionRows: (typeof pendingRedemptions.$inferInsert)[] = [];
  const snapshotRows: (typeof poolSnapshots.$inferInsert)[] = [];
  const userStatDeltas: UserStatDelta[] = [];

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
          userStatDeltas.push({
            poolId: evt.data.poolId,
            userAddress: evt.data.user,
            activeBondsDelta: BigInt(evt.data.bonds),
            depositedUsdcDelta: BigInt(evt.data.amount),
            withdrawnUsdcDelta: 0n,
            wonUsdcDelta: 0n,
            claimedUsdcDelta: 0n,
            reinvestedUsdcDelta: 0n,
            depositCountDelta: 1,
            withdrawCountDelta: 0,
            winCountDelta: 0,
            activityTime: context.blockTime,
          });
          if (evt.data.newTotalDepositedPrincipal != null) {
            snapshotRows.push({
              poolId: evt.data.poolId,
              cycleId: 0,
              snapshotTime: context.blockTime,
              totalDepositedPrincipal: evt.data.newTotalDepositedPrincipal,
              totalFeesAccrued: 0n,
              totalFeesWithdrawn: 0n,
              totalPrizesDistributed: 0n,
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
              pstSharesLocked: evt.data.pstShares,
              humaRequestId: evt.data.humaRequestId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          userStatDeltas.push({
            poolId: evt.data.poolId,
            userAddress: evt.data.user,
            activeBondsDelta: -BigInt(evt.data.bonds),
            depositedUsdcDelta: 0n,
            withdrawnUsdcDelta: BigInt(evt.data.principal),
            wonUsdcDelta: 0n,
            claimedUsdcDelta: 0n,
            reinvestedUsdcDelta: 0n,
            depositCountDelta: 0,
            withdrawCountDelta: 1,
            winCountDelta: 0,
            activityTime: context.blockTime,
          });
          break;

        case "WinningsReinvested":
          winnerUpdateRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            winnerIndex: evt.data.winnerIndex,
            winnerAddress: evt.data.winner,
            bondsBought: BigInt(evt.data.bondsBought),
            amountReinvested: BigInt(evt.data.amountReinvested),
            claimSignature: context.signature,
          });

          if (evt.data.bondsBought > 0) {
            activityRows.push({
              signature: context.signature,
              eventIndex,
              userAddress: evt.data.winner,
              poolId: evt.data.poolId,
              activityType: "auto-reinvest",
              bonds: evt.data.bondsBought,
              amountUsdc: BigInt(evt.data.amountReinvested),
              cycleId: evt.data.cycleId,
              blockTime: context.blockTime,
            });
            userStatDeltas.push({
              poolId: evt.data.poolId,
              userAddress: evt.data.winner,
              activeBondsDelta: BigInt(evt.data.bondsBought),
              depositedUsdcDelta: 0n,
              withdrawnUsdcDelta: 0n,
              wonUsdcDelta: BigInt(evt.data.amountReinvested),
              claimedUsdcDelta: 0n,
              reinvestedUsdcDelta: BigInt(evt.data.amountReinvested),
              depositCountDelta: 0,
              withdrawCountDelta: 0,
              winCountDelta: 1,
              activityTime: context.blockTime,
            });
          }
          break;

        case "WinningsClaimed":
          activityRows.push({
            signature: context.signature,
            eventIndex,
            userAddress: evt.data.user,
            poolId: evt.data.poolId,
            activityType: "win",
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
              redemptionType: "prize_claim",
              amountUsdc: evt.data.amount,
              pstSharesLocked: evt.data.pstShares,
              humaRequestId: evt.data.humaRequestId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          userStatDeltas.push({
            poolId: evt.data.poolId,
            userAddress: evt.data.user,
            activeBondsDelta: 0n,
            depositedUsdcDelta: 0n,
            withdrawnUsdcDelta: 0n,
            wonUsdcDelta: BigInt(evt.data.amount),
            claimedUsdcDelta: 0n,
            reinvestedUsdcDelta: 0n,
            depositCountDelta: 0,
            withdrawCountDelta: 0,
            winCountDelta: 1,
            activityTime: context.blockTime,
          });
          break;

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
          {
            const redemptionTypeMap: Record<number, string> = {
              0: "bond_sale",
              1: "prize_claim",
              2: "fee_withdrawal",
            };
            redemptionRows.push({
              poolId: evt.data.poolId,
              redemptionId: BigInt(evt.data.redemptionId),
              userAddress: evt.data.user,
              redemptionType:
                (evt.data.redemptionType != null &&
                  redemptionTypeMap[evt.data.redemptionType]) ||
                "bond_sale",
              amountUsdc: BigInt(evt.data.amount),
              pstSharesLocked:
                evt.data.pstSharesLocked != null
                  ? BigInt(evt.data.pstSharesLocked)
                  : null,
              humaRequestId:
                evt.data.humaRequestId != null
                  ? evt.data.humaRequestId.toString()
                  : null,
              status: "claimed",
              requestSignature: context.signature,
              claimSignature: context.signature,
              requestedAt: Number(evt.data.requestedAt ?? context.blockTime),
              claimedAt: context.blockTime,
            });
          }
          userStatDeltas.push({
            poolId: evt.data.poolId,
            userAddress: evt.data.user,
            activeBondsDelta: 0n,
            depositedUsdcDelta: 0n,
            withdrawnUsdcDelta: 0n,
            wonUsdcDelta: 0n,
            claimedUsdcDelta: BigInt(evt.data.amount),
            reinvestedUsdcDelta: 0n,
            depositCountDelta: 0,
            withdrawCountDelta: 0,
            winCountDelta: 0,
            activityTime: context.blockTime,
          });
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
            harvestSlot: context.slot,
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
            totalPrizesDistributed: 0n,
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
          snapshotRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            snapshotTime: context.blockTime,
            totalDepositedPrincipal: 0n,
            totalFeesAccrued: 0n,
            totalFeesWithdrawn: 0n,
            totalPrizesDistributed: BigInt(
              evt.data.totalPrizesDistributed ?? evt.data.prizePot
            ),
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
            prizePot: 0n,
            cycleFeeCollected: 0n,
            winnersSynced: true,
            completedAt: voidedTimestamp,
            signature: context.signature,
            blockTime: context.blockTime,
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
            totalPrizesDistributed: 0n,
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
            harvestSlot: Number(evt.data.harvestSlot),
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
              pstSharesLocked: evt.data.pstShares,
              humaRequestId: evt.data.humaRequestId,
              signature: context.signature,
              blockTime: context.blockTime,
            })
          );
          break;
      }
    });
  }

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

    // 4. Upsert Pending Redemptions
    if (redemptionRows.length > 0) {
      await upsertPendingRedemptionsTx(tx, redemptionRows);
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
