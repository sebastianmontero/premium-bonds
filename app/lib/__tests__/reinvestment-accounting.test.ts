import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReinvestmentBreakdown,
  getEffectivePrizeBreakdown,
  getEffectivePrizeDust,
} from "../draw-helpers";
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
});
