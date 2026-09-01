import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPoolPayoutThresholdUi,
  calculateTierPayout,
  formatTierPayoutAmount,
  getLocalizedTierLabel,
} from "../app/lib/formatters";

function assertAlmostEqual(
  a: number,
  b: number,
  eps: number = 1e-9,
  message: string = ""
) {
  assert.ok(
    Math.abs(a - b) <= eps,
    `Expected ${a} to be approximately equal to ${b} (diff: ${Math.abs(a - b)} > ${eps}). ${message}`
  );
}

describe("Tier Payout & BPS Math Verification Suite", () => {
  it("Vector 1: Exact On-Chain BPS Math Verification", () => {
    const potUi = 100.0; // 100 USDC
    const grandTier = { basisPoints: 5000, numWinners: 1 }; // 50%
    const runnerUpTier = { basisPoints: 1500, numWinners: 2 }; // 15% each, 30% total
    const consolationTier = { basisPoints: 200, numWinners: 10 }; // 2% each, 20% total

    const grand = calculateTierPayout(potUi, grandTier);
    assertAlmostEqual(
      grand.payoutPerWinnerUi,
      50.0,
      1e-9,
      "Grand payout should be 50.0 USDC"
    );
    assertAlmostEqual(
      grand.totalTierShareUi,
      50.0,
      1e-9,
      "Grand total share should be 50.0 USDC"
    );
    assert.strictEqual(
      grand.isAboveThreshold,
      true,
      "Grand should be above 10 USDC threshold"
    );

    const runnerUp = calculateTierPayout(potUi, runnerUpTier);
    assertAlmostEqual(
      runnerUp.payoutPerWinnerUi,
      15.0,
      1e-9,
      "Runner-up payout per winner should be 15.0 USDC"
    );
    assertAlmostEqual(
      runnerUp.totalTierShareUi,
      30.0,
      1e-9,
      "Runner-up total share should be 30.0 USDC"
    );

    const consolation = calculateTierPayout(potUi, consolationTier);
    assertAlmostEqual(
      consolation.payoutPerWinnerUi,
      2.0,
      1e-9,
      "Consolation payout per winner should be 2.0 USDC"
    );
    assertAlmostEqual(
      consolation.totalTierShareUi,
      20.0,
      1e-9,
      "Consolation total share should be 20.0 USDC"
    );
  });

  it("Vector 2: Sum Invariant Verification", () => {
    const potUi = 250.75;
    const tiers = [
      { basisPoints: 5000, numWinners: 1 }, // 50%
      { basisPoints: 1500, numWinners: 2 }, // 30%
      { basisPoints: 500, numWinners: 2 }, // 10%
      { basisPoints: 100, numWinners: 10 }, // 10%
    ];

    let totalAllocated = 0;
    for (const tier of tiers) {
      const payout = calculateTierPayout(potUi, tier);
      totalAllocated += payout.totalTierShareUi;
    }

    assertAlmostEqual(
      totalAllocated,
      potUi,
      1e-9,
      "Total allocated across tiers must equal the pot"
    );
  });

  it("Vector 3: Threshold Boundary Switching", () => {
    const tier = { basisPoints: 10000, numWinners: 1 };
    const threshold = 10.0;

    const belowThreshold = calculateTierPayout(9.999999, tier, threshold);
    assert.strictEqual(
      belowThreshold.isAboveThreshold,
      false,
      "9.999999 USDC must be below threshold"
    );

    const atThreshold = calculateTierPayout(10.0, tier, threshold);
    assert.strictEqual(
      atThreshold.isAboveThreshold,
      true,
      "10.0 USDC must be above/at threshold"
    );

    const aboveThreshold = calculateTierPayout(10.000001, tier, threshold);
    assert.strictEqual(
      aboveThreshold.isAboveThreshold,
      true,
      "10.000001 USDC must be above threshold"
    );
  });

  it("Vector 4: Multi-Token Decimals & Thresholds", () => {
    assert.strictEqual(
      getPoolPayoutThresholdUi("USDC"),
      10.0,
      "USDC threshold should be 10.0"
    );
    assert.strictEqual(
      getPoolPayoutThresholdUi("SOL"),
      0.05,
      "SOL threshold should be 0.05"
    );
    assert.strictEqual(
      getPoolPayoutThresholdUi("WBTC"),
      0.0005,
      "WBTC threshold should be 0.0005"
    );

    const solTier = { basisPoints: 5000, numWinners: 1 };
    const solBreakdown = calculateTierPayout(
      1.5,
      solTier,
      getPoolPayoutThresholdUi("SOL")
    );
    assert.strictEqual(
      solBreakdown.isAboveThreshold,
      true,
      "1.5 SOL must be above 0.05 SOL threshold"
    );
    assertAlmostEqual(
      solBreakdown.payoutPerWinnerUi,
      0.75,
      1e-9,
      "0.75 SOL per winner"
    );

    const formattedUsdc = formatTierPayoutAmount(50.0, "USDC", 6);
    assert.strictEqual(
      formattedUsdc,
      "$50.000000",
      `Formatted USDC expected $50.000000, got ${formattedUsdc}`
    );

    const formattedSol = formatTierPayoutAmount(0.75, "SOL", 6);
    assert.strictEqual(
      formattedSol,
      "0.750000 SOL",
      `Formatted SOL expected '0.750000 SOL', got ${formattedSol}`
    );
  });

  it("Vector 5: Defensive Bounds & Corrupted Inputs", () => {
    const testCases = [
      { pot: -10, tier: { basisPoints: 5000, numWinners: 1 }, expected: 0 },
      { pot: 0, tier: { basisPoints: 5000, numWinners: 1 }, expected: 0 },
      { pot: NaN, tier: { basisPoints: 5000, numWinners: 1 }, expected: 0 },
      {
        pot: Infinity,
        tier: { basisPoints: 5000, numWinners: 1 },
        expected: 0,
      },
      { pot: 100, tier: { basisPoints: -500, numWinners: 1 }, expected: 0 },
      { pot: 100, tier: { basisPoints: NaN, numWinners: 1 }, expected: 0 },
    ];

    for (const { pot, tier, expected } of testCases) {
      const res = calculateTierPayout(pot, tier);
      assert.strictEqual(
        res.payoutPerWinnerUi,
        expected,
        `Defensive guard failed for pot=${pot}, bps=${tier.basisPoints}`
      );
    }

    // Corrupted RPC basisPoints > 10,000 should cap safely to 10,000 (100%)
    const corruptedTier = { basisPoints: 65535, numWinners: 1 };
    const cappedRes = calculateTierPayout(100, corruptedTier);
    assertAlmostEqual(
      cappedRes.payoutPerWinnerUi,
      100.0,
      1e-9,
      "BPS > 10,000 must cap at 100% of pot"
    );
  });

  it("Vector 6: Precision & String Formats", () => {
    const fmt6 = formatTierPayoutAmount(12.3456789, "USDC", 6);
    assert.strictEqual(
      fmt6,
      "$12.345679",
      `Expected 6 decimals rounded ($12.345679), got ${fmt6}`
    );

    const fmt2 = formatTierPayoutAmount(12.3456789, "USDC", 2);
    assert.strictEqual(
      fmt2,
      "$12.35",
      `Expected 2 decimals rounded ($12.35), got ${fmt2}`
    );
  });

  it("Vector 7: Localized Tier Label Resolution", () => {
    const mockTranslations: Record<string, string> = {
      grand: "Grand",
      runnerUp: "Runner-up",
      consolation: "Consolation",
      tierN: "Tier {tier}",
    };
    const t = (key: string, values?: Record<string, any>) => {
      let str = mockTranslations[key] || key;
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    };

    assert.strictEqual(
      getLocalizedTierLabel(0, 3, t),
      "Grand",
      "Tier 0 should be Grand"
    );
    assert.strictEqual(
      getLocalizedTierLabel(1, 3, t),
      "Runner-up",
      "Tier 1 should be Runner-up"
    );
    assert.strictEqual(
      getLocalizedTierLabel(2, 3, t),
      "Consolation",
      "Tier 2 in 3-tier pool should be Consolation"
    );
    assert.strictEqual(
      getLocalizedTierLabel(2, 5, t),
      "Tier 3",
      "Tier 2 in 5-tier pool should be Tier 3"
    );
  });

  it("Vector 8: Sub-Threshold Micro-Cent Live Payouts (Modal Behavior)", () => {
    const microPotUi = 0.000138; // Micro-pot (e.g. initial yield or localnet)
    const grandTier = { basisPoints: 5000, numWinners: 1 }; // 50%
    const runnerUpTier = { basisPoints: 1500, numWinners: 2 }; // 15% each

    // In the modal, threshold = 0 so it always computes live amounts
    const grand = calculateTierPayout(microPotUi, grandTier, 0);
    assertAlmostEqual(
      grand.payoutPerWinnerUi,
      0.000069,
      1e-9,
      "Grand payout should be exactly 0.000069 USDC"
    );
    assert.strictEqual(
      grand.isAboveThreshold,
      true,
      "With threshold=0, isAboveThreshold is true"
    );

    const formattedGrand = formatTierPayoutAmount(
      grand.payoutPerWinnerUi,
      "USDC",
      6
    );
    assert.strictEqual(
      formattedGrand,
      "$0.000069",
      `Expected '$0.000069', got ${formattedGrand}`
    );

    const runnerUp = calculateTierPayout(microPotUi, runnerUpTier, 0);
    assertAlmostEqual(
      runnerUp.payoutPerWinnerUi,
      0.0000207,
      1e-9,
      "Runner-up payout per winner should be 0.0000207 USDC"
    );
  });

  it("Vector 9: Time-Series Accrual & Multi-Cell Modal Sum Invariant", () => {
    const tvlUi = 100_000.0; // 100k USDC TVL
    const apy = 0.08; // 8% APY
    const basePotUi = 50.0;
    const SECONDS_PER_YEAR = 31_557_600;

    const tiers = [
      { basisPoints: 5000, numWinners: 1 },
      { basisPoints: 2500, numWinners: 1 },
      { basisPoints: 1250, numWinners: 2 },
    ];

    const timeOffsets = [0, 1, 10, 60, 3600]; // 0s to 1 hour
    for (const dt of timeOffsets) {
      const yieldAccrued = (tvlUi * apy * dt) / SECONDS_PER_YEAR;
      const currentPotUi = basePotUi + yieldAccrued;

      let totalAllocated = 0;
      for (const tier of tiers) {
        const breakdown = calculateTierPayout(currentPotUi, tier, 0);
        totalAllocated += breakdown.totalTierShareUi;
        assert.ok(
          breakdown.payoutPerWinnerUi > 0,
          "Payout per winner must be positive"
        );
      }

      assertAlmostEqual(
        totalAllocated,
        currentPotUi,
        1e-9,
        `Sum invariant violated at dt=${dt}s`
      );
    }
  });
});
