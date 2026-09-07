import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReinvestmentBreakdown,
  getEffectivePrizeBreakdown,
  getEffectivePrizeDust,
  applyOptimisticReinvestment,
  patchOptimisticPrizeInCache,
} from "../draw-helpers";
import { bondsKeys } from "../query-keys";
import { QueryClient } from "@tanstack/react-query";
import type { PrizeHistoryEntry } from "@/app/types";
import { foldWinnerUpdateRows, type WinnerUpdateRow } from "../db/ingest";
import { EMPTY_USER_BOND_POSITION } from "../../../app/hooks/queries/useUserBondPosition";
import { address } from "@solana/kit";

const userAddr = address("11111111111111111111111111111111");
const otherAddr = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("Reinvestment Accounting & Breakdown Suite", () => {
  describe("calculateReinvestmentBreakdown", () => {
    it("should compute standard reinvestment with fractional dust remainder (e.g. 247.50 USDC prize)", () => {
      // 247.50 USDC prize = 247,500,000 base units, 5 USDC bond price = 5,000,000 base units
      // 49 bonds = 245,000,000 cost, leaving 2,500,000 (0.50 USDC) dust remainder
      const breakdown = calculateReinvestmentBreakdown(
        247_500_000,
        0,
        5_000_000
      );

      assert.strictEqual(breakdown.bondsBought, 49);
      assert.strictEqual(breakdown.dustAccumulated, 2_500_000);
      assert.strictEqual(breakdown.usedPriorDust, 0);
      assert.strictEqual(breakdown.totalAvailable, 247_500_000);
    });

    it("should handle exact multiple prizes with zero dust remainder", () => {
      // 250.00 USDC prize = exactly 50 bonds at 5 USDC each
      const breakdown = calculateReinvestmentBreakdown(
        250_000_000,
        0,
        5_000_000
      );

      assert.strictEqual(breakdown.bondsBought, 50);
      assert.strictEqual(breakdown.dustAccumulated, 0);
      assert.strictEqual(breakdown.usedPriorDust, 0);
      assert.strictEqual(breakdown.totalAvailable, 250_000_000);
    });

    it("should apply prior accumulated dust to purchase an extra bond", () => {
      // 247.50 USDC prize + 2.50 USDC prior dust = 250.00 USDC available = 50 bonds
      const breakdown = calculateReinvestmentBreakdown(
        247_500_000,
        2_500_000,
        5_000_000
      );

      assert.strictEqual(breakdown.bondsBought, 50);
      assert.strictEqual(breakdown.usedPriorDust, 2_500_000);
      assert.strictEqual(breakdown.dustAccumulated, 0);
      assert.strictEqual(breakdown.totalAvailable, 250_000_000);
    });

    it("should handle sub-bond prize amounts smaller than 1 bond price", () => {
      // 2.50 USDC prize with 5 USDC bond price -> 0 bonds bought, 100% dust
      const breakdown = calculateReinvestmentBreakdown(2_500_000, 0, 5_000_000);

      assert.strictEqual(breakdown.bondsBought, 0);
      assert.strictEqual(breakdown.dustAccumulated, 2_500_000);
      assert.strictEqual(breakdown.usedPriorDust, 0);
      assert.strictEqual(breakdown.totalAvailable, 2_500_000);
    });

    it("should support BigInt inputs transparently with full precision", () => {
      const breakdown = calculateReinvestmentBreakdown(
        247_500_000n,
        2_500_000n,
        5_000_000n
      );

      assert.strictEqual(breakdown.bondsBought, 50);
      assert.strictEqual(breakdown.usedPriorDust, 2_500_000);
      assert.strictEqual(breakdown.dustAccumulated, 0);
      assert.strictEqual(breakdown.totalAvailable, 250_000_000);
    });

    it("should respect explicitBondsBought for closed pools and full registries", () => {
      // In sunset/closed pool or full registry, bonds_to_buy is explicitly 0 on-chain
      const breakdown = calculateReinvestmentBreakdown(
        247_500_000,
        0,
        5_000_000,
        0
      );

      assert.strictEqual(breakdown.bondsBought, 0);
      assert.strictEqual(breakdown.dustAccumulated, 247_500_000);
      assert.strictEqual(breakdown.usedPriorDust, 0);
    });

    it("should respect custom bond prices (e.g. 10 USDC)", () => {
      const breakdown = calculateReinvestmentBreakdown(
        25_000_000,
        0,
        10_000_000
      );

      assert.strictEqual(breakdown.bondsBought, 2);
      assert.strictEqual(breakdown.dustAccumulated, 5_000_000);
    });
  });

  describe("getEffectivePrizeBreakdown & getEffectivePrizeDust", () => {
    it("should return zero bonds and un-altered dust for non-reinvested prizes", () => {
      const pendingEntry = {
        amount: 100_000_000,
        status: "processing" as const,
        bondsBought: 0,
        dustAccumulated: undefined,
      };

      const breakdown = getEffectivePrizeBreakdown(pendingEntry);
      assert.strictEqual(breakdown.bondsBought, 0);
      assert.strictEqual(breakdown.usedPriorDust, 0);
      assert.strictEqual(breakdown.dustAccumulated, 0);
      assert.strictEqual(breakdown.totalAvailable, 100_000_000);

      assert.strictEqual(getEffectivePrizeDust(pendingEntry), undefined);
    });

    it("should preserve persisted dustAccumulated for finalized entries", () => {
      const finalizedEntry = {
        amount: 247_500_000,
        status: "reinvested" as const,
        bondsBought: 49,
        dustAccumulated: 2_500_000,
      };

      const breakdown = getEffectivePrizeBreakdown(finalizedEntry);
      assert.strictEqual(breakdown.bondsBought, 49);
      assert.strictEqual(breakdown.dustAccumulated, 2_500_000);
      assert.strictEqual(getEffectivePrizeDust(finalizedEntry), 2_500_000);
    });

    it("should calculate dust on the fly for optimistic entries without dustAccumulated", () => {
      const optimisticEntry = {
        amount: 247_500_000,
        status: "reinvested" as const,
        bondsBought: 49,
        dustAccumulated: undefined,
      };

      const breakdown = getEffectivePrizeBreakdown(optimisticEntry);
      assert.strictEqual(breakdown.bondsBought, 49);
      assert.strictEqual(breakdown.dustAccumulated, 2_500_000);
      assert.strictEqual(getEffectivePrizeDust(optimisticEntry), 2_500_000);
    });

    it("should handle reinvested tickets zero fallback for closed/sunset pools", () => {
      const sunsetEntry = {
        amount: 50_000_000,
        status: "reinvested" as const,
        bondsBought: 0,
        reinvestedTickets: 0,
        dustAccumulated: undefined,
      };

      const breakdown = getEffectivePrizeBreakdown(sunsetEntry);
      assert.strictEqual(breakdown.bondsBought, 0);
      assert.strictEqual(breakdown.dustAccumulated, 50_000_000);
      assert.strictEqual(getEffectivePrizeDust(sunsetEntry), 50_000_000);
    });
  });

  describe("EMPTY_USER_BOND_POSITION schema", () => {
    it("should have totalClaimed and totalReinvested as 0n BigInts and be frozen", () => {
      assert.strictEqual(EMPTY_USER_BOND_POSITION.totalClaimed, 0n);
      assert.strictEqual(EMPTY_USER_BOND_POSITION.totalReinvested, 0n);
      assert.strictEqual(EMPTY_USER_BOND_POSITION.unclaimedWinnings, 0n);
      assert.strictEqual(EMPTY_USER_BOND_POSITION.activeTicketsCount, 0);
      assert.ok(Object.isFrozen(EMPTY_USER_BOND_POSITION));
    });
  });

  describe("foldWinnerUpdateRows with amountReinvested", () => {
    it("should preserve and select greatest amountReinvested across duplicate updates", () => {
      const rows: WinnerUpdateRow[] = [
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 0n,
          amountReinvested: 0n,
          claimSignature: "sig_optimistic",
        },
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 49n,
          amountReinvested: 245_000_000n,
          claimSignature: "sig_final",
        },
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 1,
          winnerAddress: otherAddr,
          bondsBought: 10n,
          amountReinvested: 50_000_000n,
          claimSignature: "sig_other",
        },
      ];

      const folded = foldWinnerUpdateRows(rows);
      assert.strictEqual(folded.length, 2);

      const winner0 = folded.find((w) => w.winnerIndex === 0);
      assert.ok(winner0);
      assert.strictEqual(winner0.bondsBought, 49n);
      assert.strictEqual(winner0.amountReinvested, 245_000_000n);
      assert.strictEqual(winner0.claimSignature, "sig_optimistic");

      const winner1 = folded.find((w) => w.winnerIndex === 1);
      assert.ok(winner1);
      assert.strictEqual(winner1.bondsBought, 10n);
      assert.strictEqual(winner1.amountReinvested, 50_000_000n);
    });

    it("should not overwrite known amountReinvested with undefined", () => {
      const rows: WinnerUpdateRow[] = [
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 49n,
          amountReinvested: 245_000_000n,
          claimSignature: "sig_reinvest",
        },
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 49n,
          amountReinvested: undefined,
          claimSignature: "sig_second",
        },
      ];

      const folded = foldWinnerUpdateRows(rows);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].amountReinvested, 245_000_000n);
    });
  });

  describe("applyOptimisticReinvestment", () => {
    it("should transform a processing entry into reinvested with bonds and remainder dust", () => {
      const entry: PrizeHistoryEntry = {
        drawCycleId: 10,
        winnerIndex: 2,
        date: "2026-09-01T00:00:00Z",
        tierIndex: 1,
        amount: 247_500_000,
        status: "processing",
        winningTicket: "00000042",
      };

      const breakdown = {
        bondsBought: 49,
        usedPriorDust: 0,
        dustAccumulated: 2_500_000,
        totalAvailable: 247_500_000,
      };

      const updated = applyOptimisticReinvestment(
        entry,
        breakdown,
        "5abcSignature"
      );

      assert.strictEqual(updated.status, "reinvested");
      assert.strictEqual(updated.bondsBought, 49);
      assert.strictEqual(updated.reinvestedTickets, 49);
      assert.strictEqual(updated.dustAccumulated, 2_500_000);
      assert.strictEqual(updated.usedPriorDust, undefined);
      assert.strictEqual(updated.txSignature, "5abcSignature");
      assert.strictEqual(updated.drawCycleId, 10);
      assert.strictEqual(updated.winnerIndex, 2);

      // Verify original entry was not mutated (immutability)
      assert.strictEqual(entry.status, "processing");
      assert.strictEqual(entry.bondsBought, undefined);
    });

    it("should include usedPriorDust when > 0", () => {
      const entry: PrizeHistoryEntry = {
        drawCycleId: 10,
        winnerIndex: 0,
        date: "2026-09-01T00:00:00Z",
        tierIndex: 0,
        amount: 247_500_000,
        status: "processing",
      };

      const breakdown = {
        bondsBought: 50,
        usedPriorDust: 2_500_000,
        dustAccumulated: 0,
        totalAvailable: 250_000_000,
      };

      const updated = applyOptimisticReinvestment(entry, breakdown);
      assert.strictEqual(updated.status, "reinvested");
      assert.strictEqual(updated.bondsBought, 50);
      assert.strictEqual(updated.usedPriorDust, 2_500_000);
      assert.strictEqual(updated.dustAccumulated, undefined);
    });
  });

  describe("patchOptimisticPrizeInCache", () => {
    it("should patch both unpaginated userPrizeHistory and paginated userPrizeLedger caches", () => {
      const queryClient = new QueryClient();
      const poolId = 1;
      const testUser = "11111111111111111111111111111111";

      const unpaginatedKey = bondsKeys.userPrizeHistory(poolId, testUser);
      const paginatedKey1 = bondsKeys.userPrizeLedger(poolId, testUser, {
        page: 1,
        pageSize: 10,
      });
      const paginatedKey2 = bondsKeys.userPrizeLedger(poolId, testUser, {
        status: "processing",
      });

      const initialHistory: PrizeHistoryEntry[] = [
        {
          drawCycleId: 5,
          winnerIndex: 0,
          date: "2026-09-01T00:00:00Z",
          tierIndex: 0,
          amount: 50_000_000,
          status: "processing",
        },
        {
          drawCycleId: 4,
          winnerIndex: 1,
          date: "2026-08-01T00:00:00Z",
          tierIndex: 1,
          amount: 10_000_000,
          status: "reinvested",
          bondsBought: 2,
        },
      ];

      queryClient.setQueryData(unpaginatedKey, initialHistory);
      queryClient.setQueryData(paginatedKey1, {
        entries: initialHistory,
        pagination: {
          page: 1,
          pageSize: 10,
          totalCount: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        aggregates: { totalFilteredValue: "60000000" },
      });
      queryClient.setQueryData(paginatedKey2, {
        entries: [initialHistory[0]],
        pagination: {
          page: 1,
          pageSize: 10,
          totalCount: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        aggregates: { totalFilteredValue: "50000000" },
      });

      // Execute cache patch
      patchOptimisticPrizeInCache({
        queryClient,
        poolId,
        userAddress: testUser,
        drawCycleId: 5,
        winnerIndex: 0,
        breakdown: {
          bondsBought: 10,
          usedPriorDust: 0,
          dustAccumulated: 0,
          totalAvailable: 50_000_000,
        },
        txSignature: "txSig12345",
      });

      // Assert unpaginated query updated
      const updatedHistory =
        queryClient.getQueryData<PrizeHistoryEntry[]>(unpaginatedKey);
      assert.ok(updatedHistory);
      assert.strictEqual(updatedHistory[0].status, "reinvested");
      assert.strictEqual(updatedHistory[0].bondsBought, 10);
      assert.strictEqual(updatedHistory[0].txSignature, "txSig12345");
      assert.strictEqual(updatedHistory[1].status, "reinvested");

      // Assert paginated queries updated
      const updatedLedger1 = queryClient.getQueryData<{
        entries: PrizeHistoryEntry[];
      }>(paginatedKey1);
      assert.ok(updatedLedger1);
      assert.strictEqual(updatedLedger1.entries[0].status, "reinvested");
      assert.strictEqual(updatedLedger1.entries[0].bondsBought, 10);

      const updatedLedger2 = queryClient.getQueryData<{
        entries: PrizeHistoryEntry[];
      }>(paginatedKey2);
      assert.ok(updatedLedger2);
      assert.strictEqual(updatedLedger2.entries[0].status, "reinvested");
      assert.strictEqual(updatedLedger2.entries[0].bondsBought, 10);
    });
  });
});
