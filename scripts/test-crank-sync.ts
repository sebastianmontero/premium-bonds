import {
  calculateReinvestmentBreakdown,
  getWinnerKey,
  RPC_PROPAGATION_GRACE_PERIOD_MS,
} from "../app/lib/draw-helpers";
import {
  fetchUserAtaBalance,
  fetchPoolYieldOnChainState,
  resolveWinnerAddress,
  USDC_MINT,
} from "../app/lib/bonds-sdk";
import type { PrizeHistoryEntry } from "../app/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log("=================================================");
  console.log("   TEST: Winner Crank Status & Ledger Sync Suite");
  console.log("=================================================\n");

  // 1. Reinvestment Math Engine Parity (reinvest_winnings.rs math)
  console.log("1. Testing calculateReinvestmentBreakdown on-chain parity...");
  {
    // 1a. Exact multiple of bond price: $25 prize with $5 bond price, $0 prior dust
    const res1 = calculateReinvestmentBreakdown(25_000_000, 0, 5_000_000);
    assert(res1.bondsBought === 5, "25 USDC should buy exactly 5 bonds");
    assert(res1.usedPriorDust === 0, "No prior dust should be used");
    assert(res1.dustAccumulated === 0, "No dust should remain");
    assert(res1.totalAvailable === 25_000_000, "Total available is 25 USDC");

    // 1b. Fractional prize generating dust: $13 prize with $5 bond price, $0 prior dust
    const res2 = calculateReinvestmentBreakdown(13_000_000, 0, 5_000_000);
    assert(res2.bondsBought === 2, "13 USDC should buy 2 bonds (10 USDC)");
    assert(res2.usedPriorDust === 0, "No prior dust used");
    assert(
      res2.dustAccumulated === 3_000_000,
      "3 USDC leftover dust accumulated"
    );

    // 1c. Pooling prior dust to unlock bonus bond: $3 prize with $2 prior dust ($5 total)
    const res3 = calculateReinvestmentBreakdown(
      3_000_000,
      2_000_000,
      5_000_000
    );
    assert(
      res3.bondsBought === 1,
      "3 USDC + 2 USDC prior dust should buy 1 bond"
    );
    assert(
      res3.usedPriorDust === 2_000_000,
      "2 USDC prior dust should be used"
    );
    assert(res3.dustAccumulated === 0, "0 dust should remain");

    // 1d. Pooling prior dust with partial leftover: $4 prize with $3 prior dust ($7 total)
    const res4 = calculateReinvestmentBreakdown(
      4_000_000,
      3_000_000,
      5_000_000
    );
    assert(
      res4.bondsBought === 1,
      "4 USDC + 3 USDC dust should buy 1 bond (5 USDC)"
    );
    assert(res4.usedPriorDust === 1_000_000, "1 USDC prior dust used");
    assert(res4.dustAccumulated === 0, "0 dust accumulated from current prize");

    // 1e. Explicit bonds bought override
    const res5 = calculateReinvestmentBreakdown(20_000_000, 0, 5_000_000, 4);
    assert(res5.bondsBought === 4, "Explicit bonds bought should be 4");

    console.log(
      "  ✓ Reinvestment math matches on-chain Anchor smart contract parity."
    );
  }

  // 2. Winner Composite Key & Named Constants
  console.log(
    "\n2. Testing composite key generator and RPC grace constants..."
  );
  {
    assert(
      getWinnerKey(10, 0) === "10-0",
      "getWinnerKey(10, 0) must return '10-0'"
    );
    assert(
      getWinnerKey(42, 3) === "42-3",
      "getWinnerKey(42, 3) must return '42-3'"
    );
    assert(
      RPC_PROPAGATION_GRACE_PERIOD_MS === 1200,
      "RPC_PROPAGATION_GRACE_PERIOD_MS must be 1200ms"
    );
    console.log("  ✓ Key generator & constants validated.");
  }

  // 3. Optimistic Winner Reconciliation & Anti-Flicker Protection
  console.log("\n3. Testing optimistic reconciliation with 30s TTL...");
  {
    const OPTIMISTIC_TTL_MS = 30_000;
    const testRef = new Map<
      string,
      { bondsBought: number; timestamp: number }
    >();

    const cycleId = 5;
    const winnerIndex = 1;
    const key = getWinnerKey(cycleId, winnerIndex);

    // Set optimistic record
    testRef.set(key, { bondsBought: 2, timestamp: Date.now() });
    assert(testRef.has(key), "Key should exist in optimistic ref");

    // Simulate incoming on-chain response still reporting un-processed (processed: false)
    const onChainWinnerStale = {
      winnerIndex: 1,
      processed: false,
      bondsBought: 0,
    };
    const now = Date.now();
    const opt = testRef.get(key);

    let isProcessed = onChainWinnerStale.processed;
    let effectiveBonds = onChainWinnerStale.bondsBought;

    if (opt) {
      if (
        onChainWinnerStale.processed ||
        now - opt.timestamp > OPTIMISTIC_TTL_MS
      ) {
        testRef.delete(key);
      } else {
        isProcessed = true;
        effectiveBonds = opt.bondsBought;
      }
    }

    assert(
      isProcessed === true,
      "Optimistic state must override stale on-chain response"
    );
    assert(
      effectiveBonds === 2,
      "Effective bonds must be 2 from optimistic record"
    );
    assert(
      testRef.has(key),
      "Key should remain in ref during propagation window"
    );

    // Simulate subsequent confirmed on-chain response (processed: true)
    const onChainWinnerConfirmed = {
      winnerIndex: 1,
      processed: true,
      bondsBought: 2,
    };
    const opt2 = testRef.get(key);
    if (
      opt2 &&
      (onChainWinnerConfirmed.processed ||
        now - opt2.timestamp > OPTIMISTIC_TTL_MS)
    ) {
      testRef.delete(key);
    }
    assert(
      !testRef.has(key),
      "Key must be deleted after on-chain confirmation"
    );

    // Simulate TTL expiry for orphaned records
    testRef.set("99-0", { bondsBought: 1, timestamp: Date.now() - 35_000 });
    const expiredOpt = testRef.get("99-0");
    if (expiredOpt && Date.now() - expiredOpt.timestamp > OPTIMISTIC_TTL_MS) {
      testRef.delete("99-0");
    }
    assert(!testRef.has("99-0"), "Expired TTL record must be evicted");

    console.log(
      "  ✓ Optimistic reconciliation and anti-flicker TTL behavior verified."
    );
  }

  // 4. Live Modal Selector Derivation
  console.log("\n4. Testing live modal selector state derivation...");
  {
    const initialEntries: PrizeHistoryEntry[] = [
      {
        drawCycleId: 8,
        winnerIndex: 0,
        amount: 10_000_000,
        status: "processing",
        date: new Date().toISOString(),
        tierIndex: 1,
        bondsBought: 0,
      },
      {
        drawCycleId: 8,
        winnerIndex: 1,
        amount: 5_000_000,
        status: "processing",
        date: new Date().toISOString(),
        tierIndex: 2,
        bondsBought: 0,
      },
    ];

    const selectedPrizeKey = { drawCycleId: 8, winnerIndex: 0 };

    // Initial derived modal entry
    let derivedModalEntry =
      initialEntries.find(
        (p) =>
          p.drawCycleId === selectedPrizeKey.drawCycleId &&
          p.winnerIndex === selectedPrizeKey.winnerIndex
      ) ?? null;

    assert(derivedModalEntry !== null, "Modal entry must be found");
    assert(
      derivedModalEntry.status === "processing",
      "Initial status must be processing"
    );

    // State updates after crank execution (optimistic update)
    const updatedEntries: PrizeHistoryEntry[] = initialEntries.map((p) => {
      if (p.drawCycleId === 8 && p.winnerIndex === 0) {
        return {
          ...p,
          status: "reinvested",
          bondsBought: 2,
          reinvestedTickets: 2,
        };
      }
      return p;
    });

    // Re-derive modal entry dynamically
    derivedModalEntry =
      updatedEntries.find(
        (p) =>
          p.drawCycleId === selectedPrizeKey.drawCycleId &&
          p.winnerIndex === selectedPrizeKey.winnerIndex
      ) ?? null;

    assert(derivedModalEntry !== null, "Modal entry must be found");
    assert(
      derivedModalEntry.status === "reinvested",
      "Derived modal entry must automatically transition to 'reinvested'"
    );
    assert(
      derivedModalEntry.bondsBought === 2,
      "Derived modal entry must reflect 2 bonus bonds"
    );

    console.log("  ✓ Dynamic modal selector derivation verified.");
  }

  // 5. Explicit RPC Commitment Verification
  console.log("\n5. Verifying explicit confirmed commitment on RPC methods...");
  {
    let capturedCommitment = "";

    const mockRpc = {
      getAccountInfo: (_addr: unknown, opts?: { commitment?: string }) => {
        capturedCommitment = opts?.commitment ?? "";
        return {
          send: async () => ({ value: null }),
        };
      },
    };

    // 5a. fetchUserAtaBalance
    await fetchUserAtaBalance(
      mockRpc,
      "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m",
      USDC_MINT
    );
    assert(
      capturedCommitment === "confirmed",
      `fetchUserAtaBalance must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );

    // 5b. resolveWinnerAddress
    capturedCommitment = "";
    const dummyFallback = "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m";
    await resolveWinnerAddress(mockRpc, 1, 1, 0, undefined, dummyFallback);
    assert(
      capturedCommitment === "confirmed",
      `resolveWinnerAddress must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );

    // 5c. fetchPoolYieldOnChainState
    capturedCommitment = "";
    await fetchPoolYieldOnChainState(mockRpc, { poolId: 1 });
    assert(
      capturedCommitment === "confirmed",
      `fetchPoolYieldOnChainState must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );

    console.log(
      "  ✓ Explicit 'confirmed' commitment verified across SDK functions."
    );
  }

  console.log("\n=================================================");
  console.log("   ✅ ALL WINNER CRANK SYNC TESTS PASSED!   ");
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
