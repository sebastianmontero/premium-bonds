import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateEstimatedSolFee,
  SOLANA_BASE_SIGNATURE_FEE_SOL,
  USER_WINNINGS_RENT_EXEMPTION_SOL,
  USER_WINNINGS_SPACE_BYTES,
} from "../solana-fees";

describe("Solana Fee Estimation & Protocol Constants", () => {
  it("should match protocol fee constants", () => {
    assert.strictEqual(
      SOLANA_BASE_SIGNATURE_FEE_SOL,
      0.000005,
      `Expected base signature fee 0.000005, got ${SOLANA_BASE_SIGNATURE_FEE_SOL}`
    );
    assert.strictEqual(
      USER_WINNINGS_SPACE_BYTES,
      138,
      `Expected UserWinnings space 138 bytes, got ${USER_WINNINGS_SPACE_BYTES}`
    );
    assert.strictEqual(
      USER_WINNINGS_RENT_EXEMPTION_SOL,
      0.00185136,
      `Expected UserWinnings rent 0.00185136, got ${USER_WINNINGS_RENT_EXEMPTION_SOL}`
    );
  });

  it("should calculate first-time deposit fee with storage rent exemption", () => {
    const fees = calculateEstimatedSolFee({ isFirstDeposit: true });
    assert.strictEqual(
      fees.networkFeeSol,
      0.000005,
      `Expected networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert.strictEqual(
      fees.storageFeeSol,
      0.00185136,
      `Expected storageFeeSol 0.00185136, got ${fees.storageFeeSol}`
    );
    assert.ok(
      Math.abs(fees.totalSolFee - 0.00185636) < 1e-8,
      `Expected totalSolFee ~0.00185636, got ${fees.totalSolFee}`
    );
  });

  it("should calculate returning deposit fee with zero storage rent", () => {
    const fees = calculateEstimatedSolFee({ isFirstDeposit: false });
    assert.strictEqual(
      fees.networkFeeSol,
      0.000005,
      `Expected networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert.strictEqual(
      fees.storageFeeSol,
      0,
      `Expected storageFeeSol 0, got ${fees.storageFeeSol}`
    );
    assert.strictEqual(
      fees.totalSolFee,
      0.000005,
      `Expected totalSolFee 0.000005, got ${fees.totalSolFee}`
    );
  });

  it("should handle default parameter guard (empty call)", () => {
    const fees = calculateEstimatedSolFee();
    assert.strictEqual(
      fees.networkFeeSol,
      0.000005,
      `Expected default networkFeeSol 0.000005, got ${fees.networkFeeSol}`
    );
    assert.strictEqual(
      fees.storageFeeSol,
      0,
      `Expected default storageFeeSol 0, got ${fees.storageFeeSol}`
    );
    assert.strictEqual(
      fees.totalSolFee,
      0.000005,
      `Expected default totalSolFee 0.000005, got ${fees.totalSolFee}`
    );
  });

  it("should calculate custom network fee override", () => {
    const fees = calculateEstimatedSolFee({
      isFirstDeposit: true,
      customNetworkFeeSol: 0.00001,
    });
    assert.strictEqual(
      fees.networkFeeSol,
      0.00001,
      `Expected custom networkFeeSol 0.00001, got ${fees.networkFeeSol}`
    );
    assert.strictEqual(
      fees.storageFeeSol,
      0.00185136,
      `Expected storageFeeSol 0.00185136, got ${fees.storageFeeSol}`
    );
    assert.ok(
      Math.abs(fees.totalSolFee - 0.00186136) < 1e-8,
      `Expected totalSolFee ~0.00186136, got ${fees.totalSolFee}`
    );
  });
});
