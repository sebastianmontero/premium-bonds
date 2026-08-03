import assert from "assert";
import {
  parseUserWinnings,
  parseGlobalConfig,
  parsePendingRedemption,
  parseDrawCycle,
} from "../app/lib/bonds-sdk";

console.log("Running SDK parser verification tests...");

// 1. Test parseUserWinnings
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

  const parsed = parseUserWinnings(buffer);

  assert.strictEqual(parsed.unclaimedNonReinvestedWinnings, 5_000_000n);
  assert.strictEqual(parsed.totalClaimed, 10_000_000n);
  assert.strictEqual(parsed.totalReinvested, 25_000_000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.registryEntryIndex, 42);
  assert.strictEqual(parsed.bump, 255);
  assert.strictEqual(parsed.version, 1);

  assert.throws(
    () => parseUserWinnings(new Uint8Array(70)),
    /UserWinnings data too short/
  );
  console.log("✓ parseUserWinnings passed");
}

// 2. Test parseGlobalConfig
{
  const buffer = new Uint8Array(137);
  const parsed = parseGlobalConfig(buffer);
  assert.ok(parsed.admin);
  assert.ok(parsed.jobsAccount);
  console.log("✓ parseGlobalConfig passed");
}

// 3. Test parsePendingRedemption
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

  const parsed = parsePendingRedemption(buffer);
  assert.strictEqual(parsed.humaRequestId, 123n);
  assert.strictEqual(parsed.redemptionId, 7n);
  assert.strictEqual(parsed.amount, 1_000_000n);
  assert.strictEqual(parsed.pstSharesLocked, 1_000_000n);
  assert.strictEqual(parsed.requestedAt, 1700000000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.bump, 254);
  console.log("✓ parsePendingRedemption passed");
}

// 4. Test parseDrawCycle
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

  const parsed = parseDrawCycle(buffer);
  assert.strictEqual(parsed.prizePot, 500_000_000n);
  assert.strictEqual(parsed.cycleFeeCollected, 50_000_000n);
  assert.strictEqual(parsed.harvestSlot, 12345n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.cycleId, 3);
  assert.strictEqual(parsed.lockedTicketCount, 1000);
  assert.strictEqual(parsed.status, "Complete");
  console.log("✓ parseDrawCycle passed");
}

console.log("All SDK parser tests completed successfully!");
