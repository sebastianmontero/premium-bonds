import { db } from "../db";
import { drawHistory, drawWinners } from "../db/schema";
import { eq, and, sql, inArray, type InferInsertModel } from "drizzle-orm";
import {
  findPayoutRegistryPda,
  findDrawCyclePda,
  findPrizePoolPda,
  parsePayoutRegistry,
  parseDrawCycle,
  parsePrizePool,
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

export interface HydrateDrawOptions {
  fallbackLockedTickets?: bigint | number | null;
  drawInitiatedAt?: number | null;
  drawCompletedAt?: number | null;
  drawBlockTime?: number | null;
}

export interface PayoutBroadcastSource {
  winners: readonly { winner?: { toString(): string } | string | null }[];
  winnersCount: number;
}

export type DrawHistoryCycleUpdatePayload = {
  winnersSynced: boolean;
  vrfSeedSlot: number;
  vrfSeedHex: string;
  initiatedAt: number;
  completedAt: number;
  lockedTicketCount: bigint;
};

/**
 * Pure derivation of base draw history cycle metadata updates.
 * Unifies timestamp resolution, VRF seed formatting, and locked ticket count logic.
 */
export function buildDrawHistoryCycleUpdate(
  cycle: Pick<
    DrawCycleInfo,
    | "vrfSeedSlot"
    | "randomnessSeed"
    | "initiatedAt"
    | "completedAt"
    | "lockedTicketCount"
  >,
  options?: HydrateDrawOptions
): DrawHistoryCycleUpdatePayload {
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

  return {
    winnersSynced: true,
    vrfSeedSlot: Number(cycle.vrfSeedSlot),
    vrfSeedHex: formatSeedHex(cycle.randomnessSeed),
    initiatedAt: resolvedInitiatedAt,
    completedAt: resolvedCompletedAt,
    lockedTicketCount: BigInt(
      cycle.lockedTicketCount > 0
        ? cycle.lockedTicketCount
        : (options?.fallbackLockedTickets ?? 0)
    ),
  };
}

export const buildClosedRegistryDrawHistoryUpdate = buildDrawHistoryCycleUpdate;

/**
 * Pure derivation of realtime invalidation broadcasts for draw hydration.
 * Suppresses user-level winner notifications for voided draws while preserving pool invalidations.
 */
export function buildPayoutHydrationBroadcasts(
  poolId: number,
  isVoided: boolean,
  payout?: PayoutBroadcastSource | null
): RealtimeBroadcastItem[] {
  const broadcasts: RealtimeBroadcastItem[] = [
    { scope: "draws", poolId, reason: "payout:hydrated" },
  ];

  if (!isVoided && payout) {
    const validWinners = payout.winners.slice(0, payout.winnersCount);
    const distinctWinners = Array.from(
      new Set(
        validWinners
          .map((w) =>
            typeof w.winner === "string" ? w.winner : w.winner?.toString()
          )
          .filter(Boolean) as string[]
      )
    );
    for (const addr of distinctWinners) {
      broadcasts.push({
        scope: "user",
        poolId,
        userAddress: addr,
        reason: "payout:winner_registered",
      });
    }
  }

  return broadcasts;
}

export interface DeriveDrawWinnerRowsParams {
  poolId: number;
  cycleId: number;
  payout: PayoutRegistryInfo;
  cycle: Pick<DrawCycleInfo, "randomnessSeed" | "lockedTicketCount">;
  fallbackLockedTickets?: bigint | number | null;
  bondPrice?: bigint | number;
}

/**
 * Pure, deterministic derivation of normalized draw winner rows.
 * Computes winning ticket numbers via client-side VRF derivation when randomness is active.
 */
export async function deriveDrawWinnerRows(
  params: DeriveDrawWinnerRowsParams
): Promise<DrawWinnerRow[]> {
  const { poolId, cycleId, payout, cycle, fallbackLockedTickets, bondPrice } =
    params;
  const effectiveBondPrice = BigInt(bondPrice ?? 5_000_000);
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

      const amountOwed = BigInt(w.amountOwed);
      const bondsBought = BigInt(w.bondsBought ?? 0);
      const cost = bondsBought * effectiveBondPrice;
      const isProcessed = Boolean(w.processed);
      const dustAccumulated =
        isProcessed && amountOwed > cost ? amountOwed - cost : 0n;

      return {
        poolId,
        cycleId,
        winnerIndex: idx,
        winnerAddress: w.winner ? w.winner.toString() : "Unknown",
        tierIndex: w.tierIndex,
        amountOwed,
        winningTicketIdx,
        processed: isProcessed,
        bondsBought,
        dustAccumulated,
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
   * Immediately recognizes legitimate on-chain closed payout registries for voided or 100% completed draws.
   */
  async fetchDrawAccounts(
    poolId: number,
    cycleId: number
  ): Promise<{
    payoutData: Buffer | null;
    cycleData: Buffer;
    poolData?: Buffer;
  } | null> {
    const payoutPda = await findPayoutRegistryPda(poolId, cycleId);
    const cyclePda = await findDrawCyclePda(poolId, cycleId);
    const poolPda = await findPrizePoolPda(poolId);

    if (!isAddress(payoutPda) || !isAddress(cyclePda) || !isAddress(poolPda)) {
      throw new Error(
        `Invalid PDA derived for draw ${poolId}-${cycleId}: payoutPda='${payoutPda}', cyclePda='${cyclePda}', poolPda='${poolPda}'`
      );
    }

    const addresses = [address(payoutPda), address(cyclePda), address(poolPda)];
    const delays = [0, ...this.retryDelays];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      const delay = delays[attempt];
      const isLastAttempt = attempt === delays.length - 1;

      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await this.rpc
          .getMultipleAccounts(addresses, { encoding: "base64" })
          .send();

        const acc0 = res?.value?.[0];
        const acc1 = res?.value?.[1];
        const acc2 = res?.value?.[2];

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
            poolData:
              acc2 && "data" in acc2 && acc2.data
                ? Buffer.from(acc2.data[0], "base64")
                : undefined,
          };
        }

        // Non-blocking closed account detection:
        // If DrawCycle exists but PayoutRegistry is missing/null, check if this is a legitimate closure.
        // Require at least 1 confirmation retry for Voided to guard against RPC replication lag,
        // and require retry exhaustion (isLastAttempt) for Complete.
        if (
          acc1 &&
          "data" in acc1 &&
          acc1.data &&
          (!acc0 || !("data" in acc0) || !acc0.data)
        ) {
          const cycleData = Buffer.from(acc1.data[0], "base64");
          try {
            const cycle = parseDrawCycle(cycleData);
            const isVoided = cycle.status === "Voided";
            const isConfirmedClosed =
              (isVoided && attempt >= 1) ||
              (cycle.status === "Complete" && isLastAttempt);

            if (isConfirmedClosed) {
              return {
                payoutData: null,
                cycleData,
                poolData:
                  acc2 && "data" in acc2 && acc2.data
                    ? Buffer.from(acc2.data[0], "base64")
                    : undefined,
              };
            }
          } catch {
            // Continue retrying if DrawCycle parsing fails
          }
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
    options?: HydrateDrawOptions
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const accounts = await this.fetchDrawAccounts(poolId, cycleId);
      if (!accounts) {
        return {
          success: false,
          error: `Accounts not found after retries for draw ${poolId}-${cycleId}`,
        };
      }

      const cycle = parseDrawCycle(accounts.cycleData);
      const baseDrawHistoryUpdate = buildDrawHistoryCycleUpdate(cycle, options);

      // Handle legitimate on-chain closed payout registry
      if (accounts.payoutData === null) {
        await db
          .update(drawHistory)
          .set(baseDrawHistoryUpdate)
          .where(
            and(
              eq(drawHistory.poolId, poolId),
              eq(drawHistory.cycleId, cycleId)
            )
          );

        console.log(
          `[PayoutHydrator] PayoutRegistry for draw ${poolId}-${cycleId} was closed on-chain. Marking synced.`
        );
        return { success: true };
      }

      const payout = parsePayoutRegistry(accounts.payoutData);
      let bondPrice: bigint | undefined;
      if (accounts.poolData) {
        try {
          const poolInfo = parsePrizePool(accounts.poolData);
          bondPrice = BigInt(poolInfo.bondPrice);
        } catch {
          bondPrice = undefined;
        }
      }

      const winnerRows = await deriveDrawWinnerRows({
        poolId,
        cycleId,
        payout,
        cycle,
        fallbackLockedTickets: options?.fallbackLockedTickets,
        bondPrice,
      });

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
                dustAccumulated: sql`GREATEST(${drawWinners.dustAccumulated}, EXCLUDED.dust_accumulated)`,
                claimSignature: sql`COALESCE(${drawWinners.claimSignature}, EXCLUDED.claim_signature)`,
              },
            });
        }
        await tx
          .update(drawHistory)
          .set({
            ...baseDrawHistoryUpdate,
            winnersCount: payout.winnersCount,
            revealedAt: Number(payout.revealedAt),
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
        const isVoided = cycle.status === "Voided";
        const broadcasts = buildPayoutHydrationBroadcasts(
          poolId,
          isVoided,
          payout
        );
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
          inArray(drawHistory.status, ["Complete", "Voided"])
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
