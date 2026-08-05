import assert from "assert";
import { Address } from "@solana/kit";
import {
  decodeUserWinnings,
  decodeGlobalConfig,
  decodePendingRedemption,
  decodeDrawCycle,
  decodePayoutRegistry,
} from "../app/lib/generated/yield-bonds/src/generated/accounts";

console.log("Running Codama SDK parser verification tests...");

function mockAccount(data: Uint8Array) {
  return {
    executable: false,
    owner: "" as Address,
    lamports: 0n,
    data,
  };
}

// 1. Test decodeUserWinnings
{
  const buffer = new Uint8Array(138);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(8, 5_000_000n, true); // unclaimed_non_reinvested_winnings
  view.setBigUint64(16, 10_000_000n, true); // total_claimed
  view.setBigUint64(24, 25_000_000n, true); // total_reinvested
  view.setUint32(32, 1, true); // pool_id
  view.setUint32(36, 42, true); // registry_entry_index
  buffer.fill(1, 40, 72); // user Pubkey
  buffer[72] = 255; // bump
  buffer[73] = 1; // version

  const parsed = decodeUserWinnings(mockAccount(buffer)).data;

  assert.strictEqual(parsed.unclaimedNonReinvestedWinnings, 5_000_000n);
  assert.strictEqual(parsed.totalClaimed, 10_000_000n);
  assert.strictEqual(parsed.totalReinvested, 25_000_000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.registryEntryIndex, 42);
  assert.strictEqual(parsed.bump, 255);
  assert.strictEqual(parsed.version, 1);

  console.log("✓ decodeUserWinnings passed");
}

// 2. Test decodeGlobalConfig
{
  const buffer = new Uint8Array(137);
  const parsed = decodeGlobalConfig(mockAccount(buffer)).data;
  assert.ok(parsed.admin);
  assert.ok(parsed.jobsAccount);
  console.log("✓ decodeGlobalConfig passed");
}

// 3. Test decodePendingRedemption
{
  const buffer = new Uint8Array(158);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(8, 123n, true);
  view.setBigUint64(16, 0n, true);
  view.setBigUint64(24, 7n, true);
  view.setBigUint64(32, 1_000_000n, true);
  view.setBigUint64(40, 1_000_000n, true);
  view.setBigInt64(48, 1700000000n, true);
  view.setUint32(88, 1, true);
  buffer[92] = 254;

  const parsed = decodePendingRedemption(mockAccount(buffer)).data;
  assert.strictEqual(parsed.humaRequestId, 123n);
  assert.strictEqual(parsed.redemptionId, 7n);
  assert.strictEqual(parsed.amount, 1_000_000n);
  assert.strictEqual(parsed.pstSharesLocked, 1_000_000n);
  assert.strictEqual(parsed.requestedAt, 1700000000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.bump, 254);
  console.log("✓ decodePendingRedemption passed");
}

// 4. Test decodeDrawCycle
{
  const buffer = new Uint8Array(174);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(8, 500_000_000n, true);
  view.setBigUint64(16, 50_000_000n, true);
  view.setBigUint64(24, 12345n, true);
  view.setUint32(64, 1, true);
  view.setUint32(68, 3, true);
  view.setUint32(72, 1000, true);
  buffer[76] = 2; // Complete

  const parsed = decodeDrawCycle(mockAccount(buffer)).data;
  assert.strictEqual(parsed.prizePot, 500_000_000n);
  assert.strictEqual(parsed.cycleFeeCollected, 50_000_000n);
  assert.strictEqual(parsed.harvestSlot, 12345n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.cycleId, 3);
  assert.strictEqual(parsed.lockedTicketCount, 1000);
  assert.strictEqual(parsed.status, 2); // Complete enum variant index
  console.log("✓ decodeDrawCycle passed");
}

// 5. Test decodePayoutRegistry
{
  const buffer = new Uint8Array(8 + 2888);
  const view = new DataView(buffer.buffer);

  view.setUint32(8, 1, true); // pool_id
  view.setUint32(12, 0, true); // cycle_id
  view.setUint32(16, 1, true); // winners_count
  view.setUint32(20, 0, true); // payouts_completed
  buffer[24] = 1; // version

  // Winner 0 at offset 8 + 88 = 96
  const wOffset = 96;
  view.setBigUint64(wOffset, 5_000_000n, true); // amount_owed
  view.setBigUint64(wOffset + 8, 1_000_000n, true); // amount_reinvested
  buffer.fill(2, wOffset + 16, wOffset + 48); // winner Pubkey
  buffer[wOffset + 48] = 0; // processed
  buffer[wOffset + 49] = 0; // tier_index
  buffer[wOffset + 50] = 1; // version

  const parsed = decodePayoutRegistry(mockAccount(buffer)).data;
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.cycleId, 0);
  assert.strictEqual(parsed.winnersCount, 1);
  assert.strictEqual(parsed.winners[0].amountOwed, 5_000_000n);
  assert.strictEqual(parsed.winners[0].amountReinvested, 1_000_000n);
  assert.ok(parsed.winners[0].winner);
  console.log("✓ decodePayoutRegistry passed");
}

console.log("All Codama SDK parser tests completed successfully!");
