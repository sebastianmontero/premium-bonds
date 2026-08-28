import { db, isDatabaseConfigured } from "./index";
import {
  protocolEvents,
  bondsActivity,
  drawHistory,
  indexerCursor,
} from "./schema";
import { ParsedProgramEvent, resolveEventMetadata } from "../anchor-events";
import { sql, Table } from "drizzle-orm";

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
 * Inserts rows in safe chunks (max 100 rows) to prevent hitting PostgreSQL parameter limits.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type ConflictBuilder = (builder: any) => Promise<unknown>;

async function chunkedInsert<T extends Table>(
  table: T,
  values: unknown[],
  chunkSize = 100,
  onConflictBuilder?: ConflictBuilder
) {
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const query = db.insert(table).values(chunk as never);
    if (onConflictBuilder) {
      await onConflictBuilder(query);
    } else {
      await query.onConflictDoNothing();
    }
  }
}

export async function ingestTransactionBatch(
  batch: IngestTransactionItem[],
  options: { updateLatestCursor?: boolean } = { updateLatestCursor: true }
): Promise<number> {
  if (!isDatabaseConfigured || batch.length === 0) return 0;

  const rawEventRows: (typeof protocolEvents.$inferInsert)[] = [];
  const activityRows: (typeof bondsActivity.$inferInsert)[] = [];
  const drawRows: (typeof drawHistory.$inferInsert)[] = [];

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
          break;

        case "WinningsReinvested":
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
          break;

        case "YieldHarvested":
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "AwaitingRandomness",
            prizePot: BigInt(evt.data.prizePot),
            cycleFeeCollected: BigInt(evt.data.fee),
            lockedTicketCount: evt.data.lockedTicketCount,
            randomnessAccount: evt.data.randomnessAccount,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;

        case "DrawCompleted":
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Complete",
            prizePot: BigInt(evt.data.prizePot),
            winnersCount: evt.data.winnersCount,
            totalDistributed: BigInt(evt.data.prizePot),
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;

        case "DrawForceUnlocked":
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "ForceUnlocked",
            prizePot: BigInt(evt.data.prizePot),
            cycleFeeCollected: BigInt(evt.data.cycleFeeCollected),
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;

        case "DrawVoided":
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Voided",
            prizePot: 0n,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;

        case "DrawSkipped":
          drawRows.push({
            poolId: evt.data.poolId,
            cycleId: evt.data.cycleId,
            status: "Skipped",
            prizePot: 0n,
            signature: context.signature,
            blockTime: context.blockTime,
          });
          break;
      }
    });
  }

  // Safe chunked parallel inserts
  await Promise.all([
    rawEventRows.length > 0
      ? chunkedInsert(protocolEvents, rawEventRows)
      : Promise.resolve(),
    activityRows.length > 0
      ? chunkedInsert(bondsActivity, activityRows)
      : Promise.resolve(),
    drawRows.length > 0
      ? chunkedInsert(drawHistory, drawRows, 100, (q) =>
          q.onConflictDoUpdate({
            target: [drawHistory.poolId, drawHistory.cycleId],
            set: {
              status: sql`EXCLUDED.status`,
              prizePot: sql`EXCLUDED.prize_pot`,
              cycleFeeCollected: sql`COALESCE(NULLIF(EXCLUDED.cycle_fee_collected, 0), ${drawHistory.cycleFeeCollected})`,
              lockedTicketCount: sql`COALESCE(NULLIF(EXCLUDED.locked_ticket_count, 0), ${drawHistory.lockedTicketCount})`,
              randomnessAccount: sql`COALESCE(NULLIF(EXCLUDED.randomness_account, ''), ${drawHistory.randomnessAccount})`,
              winnersCount: sql`COALESCE(NULLIF(EXCLUDED.winners_count, 0), ${drawHistory.winnersCount})`,
              totalDistributed: sql`COALESCE(NULLIF(EXCLUDED.total_distributed, 0), ${drawHistory.totalDistributed})`,
              signature: sql`EXCLUDED.signature`,
              blockTime: sql`EXCLUDED.block_time`,
            },
          })
        )
      : Promise.resolve(),
  ]);

  // Monotonically advance latest seen cursor if requested
  if (options.updateLatestCursor && batch.length > 0) {
    const maxTx = batch.reduce(
      (prev, curr) => (curr.context.slot > prev.context.slot ? curr : prev),
      batch[0]
    );

    if (maxTx) {
      await db
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

  return rawEventRows.length;
}
