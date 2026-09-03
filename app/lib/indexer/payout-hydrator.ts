import { db } from "../db";
import { drawHistory, drawWinners } from "../db/schema";
import { eq, and, sql, type InferInsertModel } from "drizzle-orm";
import {
  findPayoutRegistryPda,
  findDrawCyclePda,
  parsePayoutRegistry,
  parseDrawCycle,
  type PayoutRegistryInfo,
  type DrawCycleInfo,
} from "../bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "../vrf-utils";
import {
  broadcastAggregatedInvalidations,
  type RealtimeBroadcastItem,
} from "../realtime/server";
import { createSolanaRpc, address, isAddress } from "@solana/kit";

export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

export interface HydrationFailure {
  poolId: number;
  cycleId: number;
  error: string;
  details?: unknown;
}

export interface HydrationResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: HydrationFailure[];
}

export type DrawWinnerRow = InferInsertModel<typeof drawWinners>;

export interface DeriveDrawWinnerRowsParams {
  poolId: number;
  cycleId: number;
  payout: PayoutRegistryInfo;
  cycle: Pick<DrawCycleInfo, "randomnessSeed" | "lockedTicketCount">;
  fallbackLockedTickets?: bigint | number | null;
}

/**
 * Pure, deterministic derivation of normalized draw winner rows.
 * Computes winning ticket numbers via client-side VRF derivation when randomness is active.
 */
export async function deriveDrawWinnerRows(
  params: DeriveDrawWinnerRowsParams
): Promise<DrawWinnerRow[]> {
  const { poolId, cycleId, payout, cycle, fallbackLockedTickets } = params;
  const lockedTickets = Number(
    cycle.lockedTicketCount ?? fallbackLockedTickets ?? 0
  );
  const tierWinnerCounts: Record<number, number> = {};
  const validWinners = (payout.winners || []).slice(0, payout.winnersCount);
  const seedBytes =
    cycle.randomnessSeed instanceof Uint8Array
      ? cycle.randomnessSeed
      : new Uint8Array(cycle.randomnessSeed || []);
  const allZero = seedBytes.length === 0 || seedBytes.every((b) => b === 0);

  return Promise.all(
    validWinners.map(async (w, idx: number) => {
      const slotInTier = tierWinnerCounts[w.tierIndex] ?? 0;
      tierWinnerCounts[w.tierIndex] = slotInTier + 1;

      let winningTicketIdx: bigint | null = null;
      if (!allZero && lockedTickets > 0) {
        try {
          const ticketNum = await deriveRandomIndex(
            seedBytes,
            w.tierIndex,
            slotInTier,
            cycleId,
            lockedTickets
          );
          winningTicketIdx = BigInt(ticketNum);
        } catch {
          winningTicketIdx = null;
        }
      }

      return {
        poolId,
        cycleId,
        winnerIndex: idx,
        winnerAddress: w.winner ? w.winner.toString() : "Unknown",
        tierIndex: w.tierIndex,
        amountOwed: BigInt(w.amountOwed),
        winningTicketIdx,
        processed: Boolean(w.processed),
        bondsBought: BigInt(w.bondsBought ?? 0),
        revealedAt: Number(payout.revealedAt),
      };
    })
  );
}

export class PayoutHydratorService {
  private rpc: SolanaRpcClient;
  private retryDelays: number[];

  constructor(
    rpcOrUrl: string | SolanaRpcClient,
    options?: { retryDelays?: number[] }
  ) {
    this.rpc =
      typeof rpcOrUrl === "string" ? createSolanaRpc(rpcOrUrl) : rpcOrUrl;
    this.retryDelays = options?.retryDelays ?? [500, 1500, 3000];
  }

  /**
   * Fetches and retries on-chain PayoutRegistry and DrawCycle accounts.
   * Recovers from both RPC replication lag (null returns) and transient network exceptions.
   */
  async fetchDrawAccounts(
    poolId: number,
    cycleId: number
  ): Promise<{ payoutData: Buffer; cycleData: Buffer } | null> {
    const payoutPda = await findPayoutRegistryPda(poolId, cycleId);
    const cyclePda = await findDrawCyclePda(poolId, cycleId);

    if (!isAddress(payoutPda) || !isAddress(cyclePda)) {
      throw new Error(
        `Invalid PDA derived for draw ${poolId}-${cycleId}: payoutPda='${payoutPda}', cyclePda='${cyclePda}'`
      );
    }

    const addresses = [address(payoutPda), address(cyclePda)];
    const delays = [0, ...this.retryDelays];
    let lastError: unknown = null;

    for (const delay of delays) {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await this.rpc
          .getMultipleAccounts(addresses, { encoding: "base64" })
          .send();

        const acc0 = res?.value?.[0];
        const acc1 = res?.value?.[1];

        if (
          acc0 &&
          acc1 &&
          "data" in acc0 &&
          "data" in acc1 &&
          acc0.data &&
          acc1.data
        ) {
          return {
            payoutData: Buffer.from(acc0.data[0], "base64"),
            cycleData: Buffer.from(acc1.data[0], "base64"),
          };
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  }

  /**
   * Hydrates a single draw cycle's winners and metadata from on-chain accounts.
   */
  async hydrateDraw(
    poolId: number,
    cycleId: number,
    options?: {
      fallbackLockedTickets?: bigint | number | null;
      drawInitiatedAt?: number | null;
      drawCompletedAt?: number | null;
      drawBlockTime?: number | null;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const accounts = await this.fetchDrawAccounts(poolId, cycleId);
      if (!accounts) {
        return {
          success: false,
          error: `Accounts not found after retries for draw ${poolId}-${cycleId}`,
        };
      }

      const payout = parsePayoutRegistry(accounts.payoutData);
      const cycle = parseDrawCycle(accounts.cycleData);

      const winnerRows = await deriveDrawWinnerRows({
        poolId,
        cycleId,
        payout,
        cycle,
        fallbackLockedTickets: options?.fallbackLockedTickets,
      });

      const cycleInitiatedAt = Number(cycle.initiatedAt);
      const cycleCompletedAt = Number(cycle.completedAt);
      const resolvedInitiatedAt =
        options?.drawInitiatedAt && options.drawInitiatedAt > 0
          ? options.drawInitiatedAt
          : cycleInitiatedAt > 0
            ? cycleInitiatedAt
            : (options?.drawBlockTime ?? 0);
      const resolvedCompletedAt =
        options?.drawCompletedAt && options.drawCompletedAt > 0
          ? options.drawCompletedAt
          : cycleCompletedAt > 0
            ? cycleCompletedAt
            : (options?.drawBlockTime ?? 0);

      await db.transaction(async (tx) => {
        if (winnerRows.length > 0) {
          await tx
            .insert(drawWinners)
            .values(winnerRows)
            .onConflictDoUpdate({
              target: [
                drawWinners.poolId,
                drawWinners.cycleId,
                drawWinners.winnerIndex,
              ],
              set: {
                processed: sql`${drawWinners.processed} OR EXCLUDED.processed`,
                winningTicketIdx: sql`COALESCE(EXCLUDED.winning_ticket_idx, ${drawWinners.winningTicketIdx})`,
                bondsBought: sql`GREATEST(${drawWinners.bondsBought}, EXCLUDED.bonds_bought)`,
                claimSignature: sql`COALESCE(${drawWinners.claimSignature}, EXCLUDED.claim_signature)`,
              },
            });
        }
        await tx
          .update(drawHistory)
          .set({
            winnersSynced: true,
            revealedAt: Number(payout.revealedAt),
            vrfSeedHex: formatSeedHex(cycle.randomnessSeed),
            initiatedAt: resolvedInitiatedAt,
            completedAt: resolvedCompletedAt,
          })
          .where(
            and(
              eq(drawHistory.poolId, poolId),
              eq(drawHistory.cycleId, cycleId)
            )
          );
      });

      // Realtime cache invalidations (isolated side-effect)
      try {
        const validWinners = payout.winners.slice(0, payout.winnersCount);
        const distinctWinners = Array.from(
          new Set(
            validWinners
              .map((w) => w.winner?.toString())
              .filter(Boolean) as string[]
          )
        );
        const broadcasts: RealtimeBroadcastItem[] = [
          { scope: "draws", poolId, reason: "payout:hydrated" },
          ...distinctWinners.map((addr) => ({
            scope: "user" as const,
            poolId,
            userAddress: addr,
            reason: "payout:winner_registered",
          })),
        ];
        await broadcastAggregatedInvalidations(broadcasts);
      } catch (broadcastErr) {
        console.warn(
          `[PayoutHydrator] Realtime broadcast warning for draw ${poolId}-${cycleId}:`,
          broadcastErr
        );
      }

      return { success: true };
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown hydration error";
      console.warn(
        `[PayoutHydrator] Failed to hydrate draw ${poolId}-${cycleId}:`,
        err
      );
      return { success: false, error: errorMsg };
    }
  }

  async hydratePendingDraws(batchSize = 20): Promise<HydrationResult> {
    const result: HydrationResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    const unhydrated = await db
      .select()
      .from(drawHistory)
      .where(
        and(
          eq(drawHistory.winnersSynced, false),
          eq(drawHistory.status, "Complete")
        )
      )
      .limit(batchSize);

    if (unhydrated.length === 0) {
      return result;
    }

    result.processed = unhydrated.length;

    for (const draw of unhydrated) {
      const res = await this.hydrateDraw(draw.poolId, draw.cycleId, {
        fallbackLockedTickets: draw.lockedTicketCount,
        drawInitiatedAt: draw.initiatedAt,
        drawCompletedAt: draw.completedAt,
        drawBlockTime: draw.blockTime,
      });

      if (res.success) {
        result.succeeded++;
      } else {
        result.failed++;
        result.errors.push({
          poolId: draw.poolId,
          cycleId: draw.cycleId,
          error: res.error || "Unknown hydration error",
        });
      }
    }

    return result;
  }
}
