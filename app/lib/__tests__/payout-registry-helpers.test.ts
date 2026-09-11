import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePayoutRegistry,
  serializePayoutRegistry,
  payoutRegistrySpace,
  getPayoutRegistryAccountSize,
  PayoutRegistryStatus,
  isPayoutRegistryVoided,
  canClosePayoutRegistry,
  PAYOUT_REGISTRY_MAGIC,
  PAYOUT_REGISTRY_VERSION,
  type ParsedWinner,
} from "../payout-registry-helpers";
import { address } from "@solana/kit";

describe("PayoutRegistry Dynamic Serialization & Parsing Helpers", () => {
  it("calculates exact required account space and validates bounds", () => {
    assert.throws(() => payoutRegistrySpace(0), /Invalid winnersCount/);
    assert.throws(() => payoutRegistrySpace(-1), /Invalid winnersCount/);
    assert.throws(() => payoutRegistrySpace(181), /Invalid winnersCount/);

    assert.strictEqual(payoutRegistrySpace(1), 160);
    assert.strictEqual(payoutRegistrySpace(50), 104 + 50 * 56); // 2904
    assert.strictEqual(payoutRegistrySpace(180), 104 + 180 * 56); // 10184

    // Ensure getPayoutRegistryAccountSize is an exact alias
    assert.strictEqual(getPayoutRegistryAccountSize(1), payoutRegistrySpace(1));
    assert.strictEqual(
      getPayoutRegistryAccountSize(180),
      payoutRegistrySpace(180)
    );
    assert.throws(
      () => getPayoutRegistryAccountSize(0),
      /Invalid winnersCount/
    );
  });

  it("checks PayoutRegistryStatus and closure eligibility helpers", () => {
    // Voided status checks
    assert.strictEqual(
      isPayoutRegistryVoided({ status: PayoutRegistryStatus.Voided }),
      true
    );
    assert.strictEqual(
      isPayoutRegistryVoided({ status: PayoutRegistryStatus.Active }),
      false
    );

    // Can close if voided (even with 0 or uncompleted payouts)
    assert.strictEqual(
      canClosePayoutRegistry({
        status: PayoutRegistryStatus.Voided,
        winnersCount: 10,
        payoutsCompleted: 0,
      }),
      true
    );

    // Cannot close if active and payouts not completed
    assert.strictEqual(
      canClosePayoutRegistry({
        status: PayoutRegistryStatus.Active,
        winnersCount: 10,
        payoutsCompleted: 9,
      }),
      false
    );

    // Cannot close if active and 0 winners
    assert.strictEqual(
      canClosePayoutRegistry({
        status: PayoutRegistryStatus.Active,
        winnersCount: 0,
        payoutsCompleted: 0,
      }),
      false
    );

    // Can close if active and all payouts completed
    assert.strictEqual(
      canClosePayoutRegistry({
        status: PayoutRegistryStatus.Active,
        winnersCount: 10,
        payoutsCompleted: 10,
      }),
      true
    );
  });

  it("serializes and parses roundtrip with 1 winner", () => {
    const winnerAddr = address("11111111111111111111111111111111");
    const winners: ParsedWinner[] = [
      {
        winner: winnerAddr,
        amountOwed: 5_000_000n,
        bondsBought: 1,
        processed: 0,
        tierIndex: 0,
        version: 1,
      },
    ];

    const registry = {
      poolId: 1,
      cycleId: 42,
      winnersCount: 1,
      payoutsCompleted: 0,
      revealedAt: 1_700_000_000n,
      status: 0,
      version: PAYOUT_REGISTRY_VERSION,
      winners,
    };

    const buffer = serializePayoutRegistry(registry);
    assert.strictEqual(buffer.byteLength, 104 + 56);

    const parsed = parsePayoutRegistry(buffer);
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.cycleId, 42);
    assert.strictEqual(parsed.winnersCount, 1);
    assert.strictEqual(parsed.payoutsCompleted, 0);
    assert.strictEqual(parsed.revealedAt, 1_700_000_000n);
    assert.strictEqual(parsed.status, 0);
    assert.strictEqual(parsed.version, PAYOUT_REGISTRY_VERSION);
    assert.strictEqual(parsed.winners.length, 1);

    const w0 = parsed.winners[0];
    assert.strictEqual(w0.winner, winnerAddr);
    assert.strictEqual(w0.amountOwed, 5_000_000n);
    assert.strictEqual(w0.bondsBought, 1);
    assert.strictEqual(w0.processed, 0);
    assert.strictEqual(w0.tierIndex, 0);
    assert.strictEqual(w0.version, 1);
  });

  it("serializes and parses roundtrip with 180 winners (max capacity)", () => {
    const winners: ParsedWinner[] = [];
    for (let i = 0; i < 180; i++) {
      winners.push({
        winner: address("11111111111111111111111111111111"),
        amountOwed: BigInt(i * 1_000_000),
        bondsBought: i,
        processed: i % 2,
        tierIndex: i % 5,
        version: 1,
      });
    }

    const registry = {
      poolId: 5,
      cycleId: 10,
      winnersCount: 180,
      payoutsCompleted: 90,
      revealedAt: 1_800_000_000n,
      status: 0,
      version: PAYOUT_REGISTRY_VERSION,
      winners,
    };

    const buffer = serializePayoutRegistry(registry);
    assert.strictEqual(buffer.byteLength, 104 + 180 * 56);

    const parsed = parsePayoutRegistry(buffer);
    assert.strictEqual(parsed.winnersCount, 180);
    assert.strictEqual(parsed.winners.length, 180);
    assert.strictEqual(parsed.payoutsCompleted, 90);

    for (let i = 0; i < 180; i++) {
      assert.strictEqual(parsed.winners[i].amountOwed, BigInt(i * 1_000_000));
      assert.strictEqual(parsed.winners[i].bondsBought, i);
      assert.strictEqual(parsed.winners[i].processed, i % 2);
      assert.strictEqual(parsed.winners[i].tierIndex, i % 5);
    }
  });

  it("throws descriptive error on truncated header (< 104 bytes)", () => {
    const shortBuffer = new Uint8Array(50);
    assert.throws(() => parsePayoutRegistry(shortBuffer), /too small/i);
  });

  it("throws error on discriminator mismatch", () => {
    const buffer = new Uint8Array(104);
    assert.throws(
      () => parsePayoutRegistry(buffer),
      /invalid account discriminator/i
    );
  });

  it("throws error when account buffer is shorter than header + winners_count * 56", () => {
    // Serialize only 2 winners worth of space but specify winners_count = 10
    const truncatedBuffer = new Uint8Array(104 + 2 * 56);
    const view = new DataView(truncatedBuffer.buffer);
    truncatedBuffer.set(PAYOUT_REGISTRY_MAGIC, 0);
    view.setUint32(8, 1, true); // pool_id
    view.setUint32(12, 1, true); // cycle_id
    view.setUint32(16, 10, true); // winners_count = 10

    assert.throws(
      () => parsePayoutRegistry(truncatedBuffer),
      /buffer truncated/i
    );
  });
});
