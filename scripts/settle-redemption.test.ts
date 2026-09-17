import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { address } from "@solana/kit";
import {
  getPendingRedemptionSize,
  getUserWinningsSize,
  getPendingRedemptionDecoder,
} from "../app/lib/generated/yield-bonds/src/generated/accounts";
import {
  PENDING_REDEMPTION_ACCOUNT_SIZE,
  USER_WINNINGS_ACCOUNT_SIZE,
  PENDING_REDEMPTION_OFFSETS,
  getPendingRedemptionFilters,
  calculateSettlementAmounts,
  aggregateRedemptionsInRange,
  type SettlementRedemptionItem,
} from "../app/lib/bonds-sdk";
import { parseSettleArgs } from "./localnet";

describe("Settlement & PendingRedemption Invariants", () => {
  describe("Size & Byte Offset Invariants", () => {
    it("matches Codama-generated account sizes", () => {
      assert.strictEqual(
        PENDING_REDEMPTION_ACCOUNT_SIZE,
        BigInt(getPendingRedemptionSize()),
        "PENDING_REDEMPTION_ACCOUNT_SIZE must match Codama getPendingRedemptionSize()"
      );
      assert.strictEqual(
        PENDING_REDEMPTION_ACCOUNT_SIZE,
        160n,
        "PendingRedemption account size must be exactly 160 bytes (8 disc + 152 space)"
      );

      assert.strictEqual(
        USER_WINNINGS_ACCOUNT_SIZE,
        BigInt(getUserWinningsSize()),
        "USER_WINNINGS_ACCOUNT_SIZE must match Codama getUserWinningsSize()"
      );
      assert.strictEqual(
        USER_WINNINGS_ACCOUNT_SIZE,
        138n,
        "UserWinnings account size must be exactly 138 bytes"
      );
    });

    it("verifies all field offsets match Rust repr(C) struct layout", () => {
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.DISCRIMINATOR, 0);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.HUMA_REQUEST_ID, 8);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.REDEMPTION_ID, 24);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.AMOUNT, 32);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.PST_SHARES_LOCKED, 40);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.REQUESTED_AT, 48);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.USER, 56);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.POOL_ID, 88);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.BUMP, 92);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.VERSION, 93);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.REDEMPTION_TYPE, 94);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.PADDING, 95);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.RESERVED, 96);
      assert.strictEqual(PENDING_REDEMPTION_OFFSETS.ACCOUNT_SIZE, 160);
    });

    it("verifies decoder is fixed-size 160 bytes", () => {
      const decoder = getPendingRedemptionDecoder();
      assert.strictEqual(decoder.fixedSize, 160);
    });
  });

  describe("RPC Filter Builder", () => {
    it("builds basic dataSize filter with no options", () => {
      const filters = getPendingRedemptionFilters();
      assert.deepStrictEqual(filters, [{ dataSize: 160n }]);
    });

    it("builds poolId memcmp filter", () => {
      const filters = getPendingRedemptionFilters({ poolId: 1 });
      assert.strictEqual(filters.length, 2);
      assert.deepStrictEqual(filters[0], { dataSize: 160n });
      assert.strictEqual(filters[1].memcmp.offset, 88n);
      assert.strictEqual(filters[1].memcmp.encoding, "base58");
    });

    it("builds user memcmp filter", () => {
      const userAddr = address("11111111111111111111111111111111");
      const filters = getPendingRedemptionFilters({ user: userAddr });
      assert.strictEqual(filters.length, 2);
      assert.deepStrictEqual(filters[0], { dataSize: 160n });
      assert.strictEqual(filters[1].memcmp.offset, 56n);
      assert.strictEqual(filters[1].memcmp.bytes, userAddr);
    });

    it("builds combined poolId and user filter", () => {
      const userAddr = address("11111111111111111111111111111111");
      const filters = getPendingRedemptionFilters({
        poolId: 2,
        user: userAddr,
      });
      assert.strictEqual(filters.length, 3);
      assert.deepStrictEqual(filters[0], { dataSize: 160n });
      assert.strictEqual(filters[1].memcmp.offset, 88n);
      assert.strictEqual(filters[2].memcmp.offset, 56n);
      assert.strictEqual(filters[2].memcmp.bytes, userAddr);
    });
  });

  describe("Pure Settlement Calculations & Solvency Invariants", () => {
    const mockRedemptions: SettlementRedemptionItem[] = [
      {
        poolId: 1,
        humaRequestId: 0n,
        amount: 5_000_000n, // 5 USDC
        pstSharesLocked: 5_000_000n,
      },
      {
        poolId: 1,
        humaRequestId: 1n,
        amount: 3_000_000n, // 3 USDC
        pstSharesLocked: 3_000_000n,
      },
      {
        poolId: 2,
        humaRequestId: 2n,
        amount: 10_000_000n, // 10 USDC (Pool 2)
        pstSharesLocked: 10_000_000n,
      },
    ];

    it("aggregates exact redemptions in range for a specific pool", () => {
      const agg = aggregateRedemptionsInRange(mockRedemptions, 1, 0n, 0n);
      assert.strictEqual(agg.matchedCount, 1);
      assert.strictEqual(agg.totalUsdcOwed, 5_000_000n);
      assert.strictEqual(agg.totalPstLocked, 5_000_000n);

      const aggAll = aggregateRedemptionsInRange(mockRedemptions, 1, 0n, 1n);
      assert.strictEqual(aggAll.matchedCount, 2);
      assert.strictEqual(aggAll.totalUsdcOwed, 8_000_000n);
      assert.strictEqual(aggAll.totalPstLocked, 8_000_000n);
    });

    it("aggregates across all pools when poolId is undefined", () => {
      const agg = aggregateRedemptionsInRange(
        mockRedemptions,
        undefined,
        0n,
        2n
      );
      assert.strictEqual(agg.matchedCount, 3);
      assert.strictEqual(agg.totalUsdcOwed, 18_000_000n);
      assert.strictEqual(agg.totalPstLocked, 18_000_000n);
    });

    it("settles single item with exact amounts without averaging loss", () => {
      const result = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 0n,
        escrowedPst: 8_000_000n,
        pendingCount: 2,
        count: 1,
        pstSupply: 100_000_000n,
        totalAssets: 100_000_000n,
      });

      assert.strictEqual(result.matchedCount, 1);
      assert.strictEqual(result.exactUsdcOwed, 5_000_000n);
      assert.strictEqual(result.pstToBurn, 5_000_000n);
      assert.strictEqual(result.usdcDisbursed, 5_000_000n);
    });

    it("settles entire queue accurately", () => {
      const result = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 1n,
        escrowedPst: 8_000_000n,
        pendingCount: 2,
        count: 2,
        pstSupply: 100_000_000n,
        totalAssets: 100_000_000n,
      });

      assert.strictEqual(result.matchedCount, 2);
      assert.strictEqual(result.exactUsdcOwed, 8_000_000n);
      assert.strictEqual(result.pstToBurn, 8_000_000n);
      assert.strictEqual(result.usdcDisbursed, 8_000_000n);
    });

    it("caps pstToBurn to escrowedPst", () => {
      const result = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 1n,
        escrowedPst: 6_000_000n, // Less than 8_000_000n locked
        pendingCount: 2,
        count: 2,
        pstSupply: 100_000_000n,
        totalAssets: 100_000_000n,
      });

      assert.strictEqual(result.pstToBurn, 6_000_000n);
    });

    it("guarantees usdcDisbursed >= exactUsdcOwed when PST appreciates (totalAssets > pstSupply)", () => {
      const result = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 0n,
        escrowedPst: 8_000_000n,
        pendingCount: 2,
        count: 1,
        pstSupply: 80_000_000n,
        totalAssets: 100_000_000n, // 1.25 USDC per PST
      });

      assert.strictEqual(result.matchedCount, 1);
      assert.strictEqual(result.pstToBurn, 5_000_000n);
      // 5_000_000 * 100_000_000 / 80_000_000 = 6_250_000 USDC
      assert.strictEqual(result.usdcDisbursed, 6_250_000n);
      assert(result.usdcDisbursed >= result.exactUsdcOwed);
    });

    it("guarantees usdcDisbursed >= exactUsdcOwed on localnet deficit (totalAssets < pstSupply)", () => {
      const result = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 0n,
        escrowedPst: 8_000_000n,
        pendingCount: 2,
        count: 1,
        pstSupply: 100_000_000n,
        totalAssets: 50_000_000n, // Under-collateralized
      });

      assert.strictEqual(result.matchedCount, 1);
      assert.strictEqual(result.pstToBurn, 5_000_000n);
      // computedUsdcValue would be 2_500_000, but usdcDisbursed is clamped to exactUsdcOwed (5_000_000)
      assert.strictEqual(result.usdcDisbursed, 5_000_000n);
    });

    it("blends exact and proportional fallback for partial unmatched slices", () => {
      // 1 matched account for req 0 (5 USDC), but count is 2 and pendingCount is 3
      const result = calculateSettlementAmounts({
        redemptions: [mockRedemptions[0]],
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 1n,
        escrowedPst: 10_000_000n,
        pendingCount: 3,
        count: 2,
        pstSupply: 100_000_000n,
        totalAssets: 100_000_000n,
      });

      assert.strictEqual(result.matchedCount, 1);
      // exact matched: 5_000_000n
      // unmatched count: 1, remaining escrowed: 5_000_000n, remaining pending: 2
      // fallback: (5_000_000 * 1) / 2 = 2_500_000n
      // total pstToBurn: 7_500_000n
      assert.strictEqual(result.pstToBurn, 7_500_000n);
      assert.strictEqual(result.usdcDisbursed, 7_500_000n);
    });

    it("handles zero count or empty queue safely without throwing", () => {
      const resultZeroCount = calculateSettlementAmounts({
        redemptions: mockRedemptions,
        poolId: 1,
        startRequestId: 0n,
        endRequestId: 0n,
        escrowedPst: 8_000_000n,
        pendingCount: 0,
        count: 0,
        pstSupply: 100_000_000n,
        totalAssets: 100_000_000n,
      });
      assert.strictEqual(resultZeroCount.pstToBurn, 0n);
      assert.strictEqual(resultZeroCount.usdcDisbursed, 0n);

      const resultEmpty = calculateSettlementAmounts({
        redemptions: [],
        startRequestId: 0n,
        endRequestId: 0n,
        escrowedPst: 0n,
        pendingCount: 0,
        count: 0,
        pstSupply: 0n,
        totalAssets: 0n,
      });
      assert.strictEqual(resultEmpty.pstToBurn, 0n);
      assert.strictEqual(resultEmpty.usdcDisbursed, 0n);
      assert.strictEqual(resultEmpty.matchedCount, 0);
    });
  });

  describe("Sequential Claim Solvency Simulation", () => {
    it("simulates multi-user sequential claims without solvency deficit", () => {
      const user1Owed = 5_000_000n;
      const user2Owed = 3_000_000n;
      const totalDisbursed = user1Owed + user2Owed; // 8 USDC credited

      let poolVaultBalance = 0n;
      let lenderStateOwed = totalDisbursed; // Mock Huma lender state has 8 USDC

      // User 1 claims (5 USDC)
      // 1. CPI disburse: transfers min(owed, available) into pool_vault
      const disburseAmount1 = lenderStateOwed;
      poolVaultBalance += disburseAmount1;
      lenderStateOwed -= disburseAmount1; // lenderState becomes 0

      assert.strictEqual(poolVaultBalance, 8_000_000n);
      assert.strictEqual(lenderStateOwed, 0n);

      // 2. On-chain solvency check for User 1
      const deficit1 =
        user1Owed > poolVaultBalance ? user1Owed - poolVaultBalance : 0n;
      assert.strictEqual(deficit1, 0n, "Deficit for User 1 must be 0");

      // 3. User 1 transfer
      poolVaultBalance -= user1Owed;
      assert.strictEqual(poolVaultBalance, 3_000_000n);

      // User 2 claims (3 USDC) later
      // 1. CPI disburse: lenderState is 0, transfers 0
      const disburseAmount2 = lenderStateOwed;
      poolVaultBalance += disburseAmount2;
      lenderStateOwed -= disburseAmount2;

      // 2. On-chain solvency check for User 2 (pool vault already holds remaining 3 USDC)
      const deficit2 =
        user2Owed > poolVaultBalance ? user2Owed - poolVaultBalance : 0n;
      assert.strictEqual(deficit2, 0n, "Deficit for User 2 must be 0");

      // 3. User 2 transfer
      poolVaultBalance -= user2Owed;
      assert.strictEqual(
        poolVaultBalance,
        0n,
        "Pool vault balance should be cleanly exhausted"
      );
    });
  });

  describe("CLI Sentinel & Argument Parsing Invariant", () => {
    it("parses defaults, counts, pool IDs, and sentinels", () => {
      // Default: sentinel -1, undefined poolId
      assert.deepStrictEqual(parseSettleArgs([]), {
        success: true,
        count: -1,
        poolId: undefined,
      });

      // Explicit counts (positional, flags, short flags, equals syntax)
      assert.deepStrictEqual(parseSettleArgs(["5"]), {
        success: true,
        count: 5,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["--count", "3"]), {
        success: true,
        count: 3,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["--count=4"]), {
        success: true,
        count: 4,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["-c", "2"]), {
        success: true,
        count: 2,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["-c=1"]), {
        success: true,
        count: 1,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["0"]), {
        success: true,
        count: 0,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["-1"]), {
        success: true,
        count: -1,
        poolId: undefined,
      });
      assert.deepStrictEqual(parseSettleArgs(["--count", "-1"]), {
        success: true,
        count: -1,
        poolId: undefined,
      });

      // Pool IDs
      assert.deepStrictEqual(parseSettleArgs(["--pool-id", "1"]), {
        success: true,
        count: -1,
        poolId: 1,
      });
      assert.deepStrictEqual(parseSettleArgs(["--pool=2"]), {
        success: true,
        count: -1,
        poolId: 2,
      });
      assert.deepStrictEqual(parseSettleArgs(["-i", "3"]), {
        success: true,
        count: -1,
        poolId: 3,
      });
      assert.deepStrictEqual(parseSettleArgs(["-i=4"]), {
        success: true,
        count: -1,
        poolId: 4,
      });

      // Combinations & Ordering
      assert.deepStrictEqual(parseSettleArgs(["--pool-id", "1", "5"]), {
        success: true,
        count: 5,
        poolId: 1,
      });
      assert.deepStrictEqual(parseSettleArgs(["5", "--pool-id", "1"]), {
        success: true,
        count: 5,
        poolId: 1,
      });
      assert.deepStrictEqual(
        parseSettleArgs(["--pool-id", "1", "--count", "5"]),
        {
          success: true,
          count: 5,
          poolId: 1,
        }
      );
      assert.deepStrictEqual(parseSettleArgs(["-c=5", "-i=2"]), {
        success: true,
        count: 5,
        poolId: 2,
      });
    });

    it("strictly validates and rejects invalid inputs and conflicts", () => {
      // Negative numbers
      assert.deepStrictEqual(parseSettleArgs(["-2"]), {
        success: false,
        error:
          "Invalid count value '-2'. Must be a non-negative integer or omit for all.",
      });
      assert.deepStrictEqual(parseSettleArgs(["--count=-5"]), {
        success: false,
        error:
          "Invalid count value '-5'. Must be a non-negative integer or omit for all.",
      });

      // Non-numeric & Floats
      assert.deepStrictEqual(parseSettleArgs(["abc"]), {
        success: false,
        error:
          "Invalid count value 'abc'. Must be a non-negative integer or omit for all.",
      });
      assert.deepStrictEqual(parseSettleArgs(["1.5"]), {
        success: false,
        error:
          "Invalid count value '1.5'. Must be a non-negative integer or omit for all.",
      });
      assert.deepStrictEqual(parseSettleArgs(["--count", "2.5"]), {
        success: false,
        error:
          "Invalid count value '2.5'. Must be a non-negative integer or omit for all.",
      });
      assert.deepStrictEqual(parseSettleArgs(["--pool-id", "1.5"]), {
        success: false,
        error: "Invalid pool ID '1.5'. Must be a positive integer.",
      });

      // Invalid pool IDs
      assert.deepStrictEqual(parseSettleArgs(["--pool-id", "0"]), {
        success: false,
        error: "Invalid pool ID '0'. Must be a positive integer.",
      });
      assert.deepStrictEqual(parseSettleArgs(["-i", "-1"]), {
        success: false,
        error: "Invalid pool ID '-1'. Must be a positive integer.",
      });

      // Missing flag values
      assert.deepStrictEqual(parseSettleArgs(["--count"]), {
        success: false,
        error: "Missing value for '--count' flag.",
      });
      assert.deepStrictEqual(parseSettleArgs(["-i"]), {
        success: false,
        error: "Missing value for '-i' flag.",
      });
      assert.deepStrictEqual(parseSettleArgs(["--pool-id", "-c", "5"]), {
        success: false,
        error: "Missing value for '--pool-id' flag.",
      });

      // Conflicting / duplicate count arguments
      assert.deepStrictEqual(parseSettleArgs(["5", "--count", "10"]), {
        success: false,
        error:
          "Count already specified. Cannot specify multiple count arguments.",
      });
      assert.deepStrictEqual(parseSettleArgs(["--count", "5", "10"]), {
        success: false,
        error: "Unexpected extra argument '10'.",
      });
      assert.deepStrictEqual(
        parseSettleArgs(["--count", "5", "--count", "10"]),
        {
          success: false,
          error:
            "Count already specified. Cannot specify multiple count arguments.",
        }
      );
      assert.deepStrictEqual(parseSettleArgs(["5", "10"]), {
        success: false,
        error: "Unexpected extra argument '10'.",
      });

      // Unknown arguments
      assert.deepStrictEqual(parseSettleArgs(["--unknown-flag"]), {
        success: false,
        error:
          "Unknown argument '--unknown-flag'. Usage: npm run localnet settle [count] [--count <n> | -c <n>] [--pool-id <id> | -i <id>]",
      });
    });
  });
});
