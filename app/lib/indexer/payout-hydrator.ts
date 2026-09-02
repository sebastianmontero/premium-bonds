import { db } from "../db";
import { drawHistory, drawWinners } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  findPayoutRegistryPda,
  findDrawCyclePda,
  parsePayoutRegistry,
  parseDrawCycle,
} from "../bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "../vrf-utils";
import {
  broadcastAggregatedInvalidations,
  RealtimeBroadcastItem,
} from "../realtime/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SolanaRpc = any;

export class PayoutHydratorService {
  constructor(private rpc: SolanaRpc) {}

  async hydratePendingDraws(batchSize = 20): Promise<number> {
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

    if (unhydrated.length === 0) return 0;

    let hydratedCount = 0;
    for (const draw of unhydrated) {
      try {
        const [payoutPda] = await findPayoutRegistryPda(
          draw.poolId,
          draw.cycleId
        );
        const [cyclePda] = await findDrawCyclePda(draw.poolId, draw.cycleId);

        let res = await this.rpc
          .getMultipleAccounts([payoutPda, cyclePda], { encoding: "base64" })
          .send();

        if (!res.value[0] || !res.value[1]) {
          // Retry up to 3 times with exponential backoff for RPC replication lag
          for (const delay of [500, 1500, 3000]) {
            await new Promise((r) => setTimeout(r, delay));
            res = await this.rpc
              .getMultipleAccounts([payoutPda, cyclePda], {
                encoding: "base64",
              })
              .send();
            if (res.value[0] && res.value[1]) break;
          }
        }

        if (!res.value[0] || !res.value[1]) {
          console.warn(
            `[PayoutHydrator] Accounts not found after retries for draw ${draw.poolId}-${draw.cycleId}`
          );
          continue;
        }

        const payoutData = Buffer.from(res.value[0].data[0], "base64");
        const cycleData = Buffer.from(res.value[1].data[0], "base64");

        const payout = parsePayoutRegistry(payoutData);
        const cycle = parseDrawCycle(cycleData);

        const lockedTickets = Number(
          cycle.lockedTicketCount ?? draw.lockedTicketCount
        );
        const tierWinnerCounts: Record<number, number> = {};
        const validWinners = payout.winners.slice(0, payout.winnersCount);

        const winnerRows = await Promise.all(
          validWinners.map(async (w, idx: number) => {
            const slotInTier = tierWinnerCounts[w.tierIndex] ?? 0;
            tierWinnerCounts[w.tierIndex] = slotInTier + 1;

            let winningTicketIdx: bigint | null = null;
            const allZero = cycle.randomnessSeed.every((b: number) => b === 0);
            if (!allZero && lockedTickets > 0) {
              try {
                const ticketNum = await deriveRandomIndex(
                  cycle.randomnessSeed,
                  w.tierIndex,
                  slotInTier,
                  draw.cycleId,
                  lockedTickets
                );
                winningTicketIdx = BigInt(ticketNum);
              } catch {
                winningTicketIdx = null;
              }
            }

            return {
              poolId: draw.poolId,
              cycleId: draw.cycleId,
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

        await db.transaction(async (tx) => {
          if (winnerRows.length > 0) {
            for (const row of winnerRows) {
              await tx
                .insert(drawWinners)
                .values(row)
                .onConflictDoUpdate({
                  target: [
                    drawWinners.poolId,
                    drawWinners.cycleId,
                    drawWinners.winnerIndex,
                  ],
                  set: {
                    processed: sql`${drawWinners.processed} OR EXCLUDED.processed`,
                    winningTicketIdx: sql`COALESCE(EXCLUDED.winning_ticket_idx, ${drawWinners.winningTicketIdx})`,
                    claimSignature: sql`COALESCE(EXCLUDED.claim_signature, ${drawWinners.claimSignature})`,
                  },
                });
            }
          }
          await tx
            .update(drawHistory)
            .set({
              winnersSynced: true,
              revealedAt: Number(payout.revealedAt),
              vrfSeedHex: formatSeedHex(cycle.randomnessSeed),
            })
            .where(
              and(
                eq(drawHistory.poolId, draw.poolId),
                eq(drawHistory.cycleId, draw.cycleId)
              )
            );
        });

        // Realtime cache invalidations
        const distinctWinners = Array.from(
          new Set(
            validWinners
              .map((w) => w.winner?.toString())
              .filter(Boolean) as string[]
          )
        );
        const broadcasts: RealtimeBroadcastItem[] = [
          { scope: "draws", poolId: draw.poolId, reason: "payout:hydrated" },
          ...distinctWinners.map((addr) => ({
            scope: "user" as const,
            poolId: draw.poolId,
            userAddress: addr,
            reason: "payout:winner_registered",
          })),
        ];
        await broadcastAggregatedInvalidations(broadcasts);

        hydratedCount++;
      } catch (err) {
        console.warn(
          `[PayoutHydrator] Failed to hydrate draw ${draw.poolId}-${draw.cycleId}:`,
          err
        );
      }
    }
    return hydratedCount;
  }
}
