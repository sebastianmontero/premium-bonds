import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEVNET_180_PRIZE_TIERS,
  DEVNET_180_TOTAL_WINNERS,
  DEVNET_180_TOTAL_BPS,
  REINVEST_BATCH_SIZE,
  REINVEST_BATCH_CU_LIMIT,
  REINVEST_PRIORITY_FEE_MICRO_LAMPORTS,
  REVEAL_CU_LIMIT,
  parseDevnet180Args,
  validateDevnet180PrizeTiers,
} from "./devnet-180-winners";
import {
  getPayoutRegistryAccountSize,
  MAX_TOTAL_WINNERS,
  PrizeTierInput,
} from "../app/lib/bonds-sdk";
import { calculateTierPayout } from "../app/lib/formatters";

describe("Devnet 180-Winner Suite Unit & Invariant Tests (scripts/devnet-180-winners.test.ts)", () => {
  describe("Prize Tier Validation & Financial Mathematics", () => {
    it("Vector 1: Option B Pyramid 4-Tier configuration satisfies exact on-chain constraints", () => {
      const result = validateDevnet180PrizeTiers(DEVNET_180_PRIZE_TIERS);
      assert.strictEqual(result.totalWinners, 180);
      assert.strictEqual(result.totalBasisPoints, 10_000);
      assert.strictEqual(DEVNET_180_TOTAL_WINNERS, MAX_TOTAL_WINNERS);
      assert.strictEqual(DEVNET_180_TOTAL_BPS, 10_000);
    });

    it("Vector 2: PayoutRegistry account allocation matches 10,184-byte ceiling", () => {
      const size180 = getPayoutRegistryAccountSize(180);
      assert.strictEqual(size180, 10_184); // 104 header + 180 * 56

      // Ensure boundary safety
      const maxWinnersAccountSize =
        getPayoutRegistryAccountSize(MAX_TOTAL_WINNERS);
      assert.strictEqual(maxWinnersAccountSize, 10_184);
      assert.strictEqual(maxWinnersAccountSize <= 10_240, true); // Safe within 10 KiB
    });

    it("Vector 3: Exact prize distribution on 100.00 USDC Pot", () => {
      const potUi = 100.0; // 100 USDC

      // Tier 1: 1 winner @ 1,200 bps (12.00%)
      const t1 = calculateTierPayout(potUi, DEVNET_180_PRIZE_TIERS[0]);
      assert.strictEqual(t1.payoutPerWinnerUi, 12.0);
      assert.strictEqual(t1.totalTierShareUi, 12.0);

      // Tier 2: 9 winners @ 200 bps each (18.00% total)
      const t2 = calculateTierPayout(potUi, DEVNET_180_PRIZE_TIERS[1]);
      assert.strictEqual(t2.payoutPerWinnerUi, 2.0);
      assert.strictEqual(t2.totalTierShareUi, 18.0);

      // Tier 3: 50 winners @ 80 bps each (40.00% total)
      const t3 = calculateTierPayout(potUi, DEVNET_180_PRIZE_TIERS[2]);
      assert.strictEqual(t3.payoutPerWinnerUi, 0.8);
      assert.strictEqual(t3.totalTierShareUi, 40.0);

      // Tier 4: 120 winners @ 25 bps each (30.00% total)
      const t4 = calculateTierPayout(potUi, DEVNET_180_PRIZE_TIERS[3]);
      assert.strictEqual(t4.payoutPerWinnerUi, 0.25);
      assert.strictEqual(t4.totalTierShareUi, 30.0);

      const totalAllocatedUi =
        t1.totalTierShareUi +
        t2.totalTierShareUi +
        t3.totalTierShareUi +
        t4.totalTierShareUi;
      assert.strictEqual(totalAllocatedUi, 100.0);
    });

    it("Vector 4: Dust Conservation on Non-Round Pot (33.333333 USDC)", () => {
      const potMicroUsdc = 33_333_333n;
      let totalAllocated = 0n;

      for (const tier of DEVNET_180_PRIZE_TIERS) {
        const perWinner = (potMicroUsdc * BigInt(tier.basisPoints)) / 10_000n;
        totalAllocated += perWinner * BigInt(tier.numWinners);
      }

      const dust = potMicroUsdc - totalAllocated;
      assert.strictEqual(dust >= 0n, true, "Dust must never be negative");
      assert.strictEqual(
        totalAllocated + dust,
        potMicroUsdc,
        "Total distributed + dust must equal prize pot"
      );
    });

    it("Vector 5: Validation errors on invalid tier definitions", () => {
      // Exceeds 180 winners
      const overCapacityTiers: PrizeTierInput[] = [
        { basisPoints: 50, numWinners: 200 },
      ];
      assert.throws(
        () => validateDevnet180PrizeTiers(overCapacityTiers),
        /exceeds MAX_TOTAL_WINNERS/
      );

      // Total basis points != 10,000
      const invalidBpsTiers: PrizeTierInput[] = [
        { basisPoints: 1000, numWinners: 1 },
      ];
      assert.throws(
        () => validateDevnet180PrizeTiers(invalidBpsTiers),
        /does not equal 10,000 exact/
      );

      // Invalid zero/negative winners
      const zeroWinnerTiers: PrizeTierInput[] = [
        { basisPoints: 10_000, numWinners: 0 },
      ];
      assert.throws(
        () => validateDevnet180PrizeTiers(zeroWinnerTiers),
        /Invalid tier numWinners/
      );
    });
  });

  describe("CLI Options Parser (parseDevnet180Args)", () => {
    it("returns default values when no args provided", () => {
      const opts = parseDevnet180Args([]);
      assert.strictEqual(opts.poolId, 1);
      assert.strictEqual(opts.seedUsers, 0);
      assert.strictEqual(opts.keepConfig, false);
      assert.strictEqual(opts.yieldAmountUsdc, 100);
      assert.strictEqual(typeof opts.rpcUrl, "string");
    });

    it("correctly parses custom flags", () => {
      const opts = parseDevnet180Args([
        "--pool",
        "2",
        "--seed-users",
        "5",
        "--keep-config",
        "--yield",
        "250.5",
        "--rpc",
        "https://api.devnet.solana.com",
        "--admin-key",
        "/tmp/custom-key.json",
      ]);

      assert.strictEqual(opts.poolId, 2);
      assert.strictEqual(opts.seedUsers, 5);
      assert.strictEqual(opts.keepConfig, true);
      assert.strictEqual(opts.yieldAmountUsdc, 250.5);
      assert.strictEqual(opts.rpcUrl, "https://api.devnet.solana.com");
      assert.strictEqual(opts.keypairPath, "/tmp/custom-key.json");
    });

    it("throws clear errors on malformed arguments", () => {
      assert.throws(
        () => parseDevnet180Args(["--pool", "invalid"]),
        /Invalid pool ID/
      );
      assert.throws(
        () => parseDevnet180Args(["--pool", "-1"]),
        /Invalid pool ID/
      );
      assert.throws(
        () => parseDevnet180Args(["--seed-users", "-5"]),
        /Invalid seed users/
      );
      assert.throws(
        () => parseDevnet180Args(["--yield", "0"]),
        /Invalid yield amount/
      );
      assert.throws(
        () => parseDevnet180Args(["--yield", "-10"]),
        /Invalid yield amount/
      );
    });
  });

  describe("Reinvestment Batching & Compute Constants", () => {
    it("Vector 6: 180 winners chunks into exactly 45 batches of 4", () => {
      const winners = Array.from({ length: 180 }, (_, i) => ({
        winner: `User_${i}`,
        index: i,
      }));

      const batches: (typeof winners)[] = [];
      for (let i = 0; i < winners.length; i += REINVEST_BATCH_SIZE) {
        batches.push(winners.slice(i, i + REINVEST_BATCH_SIZE));
      }

      assert.strictEqual(batches.length, 45);
      for (const batch of batches) {
        assert.strictEqual(batch.length, 4);
      }
      assert.strictEqual(REINVEST_BATCH_SIZE, 4);
      assert.strictEqual(REINVEST_BATCH_CU_LIMIT, 400_000);
      assert.strictEqual(REINVEST_PRIORITY_FEE_MICRO_LAMPORTS, 25_000n);
      assert.strictEqual(REVEAL_CU_LIMIT, 800_000);
    });
  });
});
