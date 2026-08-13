import {
  calculateEstimatedSolFee,
  SOLANA_BASE_SIGNATURE_FEE_SOL,
  USER_WINNINGS_RENT_EXEMPTION_SOL,
  USER_WINNINGS_SPACE_BYTES,
} from "../solana-fees";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runFeeTests() {
  console.log("Running app/lib/__tests__/solana-fees.test.ts unit tests...\n");

  // Test 1: Verify protocol constants
  {
    console.log("Test 1: Protocol fee constants");
    assert(
      SOLANA_BASE_SIGNATURE_FEE_SOL === 0.000005,
      `Expected base signature fee 0.000005, got ${SOLANA_BASE_SIGNATURE_FEE_SOL}`
    );
    assert(
      USER_WINNINGS_SPACE_BYTES === 138,
      `Expected UserWinnings space 138 bytes, got ${USER_WINNINGS_SPACE_BYTES}`
    );
    assert(
      USER_WINNINGS_RENT_EXEMPTION_SOL === 0.00185136,
      `Expected UserWinnings rent 0.00185136, got ${USER_WINNINGS_RENT_EXEMPTION_SOL}`
    );
    console.log("✓ Passed Test 1\n");
  }

  // Test 2: First-time deposit fee calculation
  {
    console.log("Test 2: First-time deposit fee calculation");
    const fees = calculateEstimatedSolFee({ isFirstDeposit: true });
    assert(
      fees.networkFeeSol === 0.000005,
      `Expected networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert(
      fees.storageFeeSol === 0.00185136,
      `Expected storageFeeSol 0.00185136, got ${fees.storageFeeSol}`
    );
    assert(
      Math.abs(fees.totalSolFee - 0.00185636) < 1e-8,
      `Expected totalSolFee ~0.00185636, got ${fees.totalSolFee}`
    );
    console.log("✓ Passed Test 2\n");
  }

  // Test 3: Returning deposit fee calculation
  {
    console.log("Test 3: Returning deposit fee calculation");
    const fees = calculateEstimatedSolFee({ isFirstDeposit: false });
    assert(
      fees.networkFeeSol === 0.000005,
      `Expected networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert(
      fees.storageFeeSol === 0,
      `Expected storageFeeSol 0, got ${fees.storageFeeSol}`
    );
    assert(
      fees.totalSolFee === 0.000005,
      `Expected totalSolFee 0.000005, got ${fees.totalSolFee}`
    );
    console.log("✓ Passed Test 3\n");
  }

  // Test 4: Default parameter guard (empty call)
  {
    console.log("Test 4: Default parameter guard (no arguments)");
    const fees = calculateEstimatedSolFee();
    assert(
      fees.networkFeeSol === 0.000005,
      `Expected default networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert(
      fees.storageFeeSol === 0,
      `Expected default storageFeeSol 0, got ${fees.storageFeeSol}`
    );
    assert(
      fees.totalSolFee === 0.000005,
      `Expected default totalSolFee 0.000005, got ${fees.totalSolFee}`
    );
    console.log("✓ Passed Test 4\n");
  }

  // Test 5: Custom network fee override
  {
    console.log("Test 5: Custom network fee override");
    const fees = calculateEstimatedSolFee({
      isFirstDeposit: true,
      customNetworkFeeSol: 0.00001,
    });
    assert(
      fees.networkFeeSol === 0.00001,
      `Expected custom networkFeeSol 0.00001, got ${fees.networkFeeSol}`
    );
    assert(
      fees.storageFeeSol === 0.00185136,
      `Expected storageFeeSol 0.00185136, got ${fees.storageFeeSol}`
    );
    assert(
      Math.abs(fees.totalSolFee - 0.00186136) < 1e-8,
      `Expected totalSolFee ~0.00186136, got ${fees.totalSolFee}`
    );
    console.log("✓ Passed Test 5\n");
  }

  console.log("All solana-fees unit tests passed successfully!");
}

// Execute if run directly via tsx
if (require.main === module) {
  runFeeTests();
}
