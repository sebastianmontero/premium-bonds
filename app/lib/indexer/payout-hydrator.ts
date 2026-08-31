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

    for (const draw of unhydrated) {
      try {
        const [payoutPda] = await findPayoutRegistryPda(
          draw.poolId,
          draw.cycleId
        );
        const [cyclePda] = await findDrawCyclePda(draw.poolId, draw.cycleId);

        const res = await this.rpc
          .getMultipleAccounts([payoutPda, cyclePda], { encoding: "base64" })
          .send();
        if (!res.value[0] || !res.value[1]) continue;

        const payoutData = Buffer.from(res.value[0].data[0], "base64");
        const cycleData = Buffer.from(res.value[1].data[0], "base64");

        const payout = parsePayoutRegistry(payoutData);
        const cycle = parseDrawCycle(cycleData);

        const tierWinnerCounts: Record<number, number> = {};
        const validWinners = payout.winners.slice(0, payout.winnersCount);

        const winnerRows = await Promise.all(
          validWinners.map(async (w, idx: number) => {
            const slotInTier = tierWinnerCounts[w.tierIndex] ?? 0;
            tierWinnerCounts[w.tierIndex] = slotInTier + 1;

            let winningTicketIdx: bigint | null = null;
            const allZero = cycle.randomnessSeed.every((b: number) => b === 0);
            if (!allZero && Number(draw.lockedTicketCount) > 0) {
              try {
                const ticketNum = await deriveRandomIndex(
                  cycle.randomnessSeed,
                  w.tierIndex,
                  slotInTier,
                  draw.cycleId,
                  Number(draw.lockedTicketCount)
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
      } catch (err) {
        console.warn(
          `[PayoutHydrator] Failed to hydrate draw ${draw.poolId}-${draw.cycleId}:`,
          err
        );
      }
    }
    return unhydrated.length;
  }
}
