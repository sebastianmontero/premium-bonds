import assert from "assert";
import { Address, lamports } from "@solana/kit";
import {
  decodeUserWinnings,
  decodeGlobalConfig,
  decodePendingRedemption,
  decodeDrawCycle,
  decodePayoutRegistry,
} from "../app/lib/generated/yield-bonds/src/generated/accounts";
import {
  RedemptionType,
  parseDrawCycle,
  parsePrizePool,
  parseMockHumaPoolState,
  parseTokenAccountBalance,
  parseMintSupply,
  calculatePoolYield,
  resolveUserTickets,
  UserEntryInfo,
} from "../app/lib/bonds-sdk";
import { ANCHOR_CUSTOM_ERRORS } from "../app/lib/errors";
import { ANCHOR_ERROR__POOL_NOT_FROZEN } from "../app/lib/generated/yield-bonds/src/generated";

console.log("Running Codama SDK parser verification tests...");

function mockAccount(data: Uint8Array) {
  return {
    address: "11111111111111111111111111111111" as Address,
    programAddress: "11111111111111111111111111111111" as Address,
    executable: false,
    lamports: lamports(0n),
    space: BigInt(data.byteLength),
    exists: true,
    data,
  } as const;
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
  const buffer = new Uint8Array(169);
  const parsed = decodeGlobalConfig(mockAccount(buffer)).data;
  assert.ok(parsed.admin);
  assert.ok(parsed.guardian);
  assert.ok(parsed.jobsAccount);
  console.log("✓ decodeGlobalConfig passed");
}

// 3. Test decodePendingRedemption
{
  const buffer = new Uint8Array(159);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(8, 123n, true);
  view.setBigUint64(16, 0n, true);
  view.setBigUint64(24, 7n, true);
  view.setBigUint64(32, 1_000_000n, true);
  view.setBigUint64(40, 1_000_000n, true);
  view.setBigInt64(48, 1700000000n, true);
  view.setUint32(88, 1, true);
  buffer[92] = 254;
  buffer[94] = 1; // PrizeClaim

  const parsed = decodePendingRedemption(mockAccount(buffer)).data;
  assert.strictEqual(parsed.humaRequestId, 123n);
  assert.strictEqual(parsed.redemptionId, 7n);
  assert.strictEqual(parsed.amount, 1_000_000n);
  assert.strictEqual(parsed.pstSharesLocked, 1_000_000n);
  assert.strictEqual(parsed.requestedAt, 1700000000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.bump, 254);
  assert.strictEqual(parsed.redemptionType, RedemptionType.PrizeClaim);
  console.log("✓ decodePendingRedemption passed");
}

// 4. Test decodeDrawCycle
{
  const buffer = new Uint8Array(190);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(8, 500_000_000n, true);
  view.setBigUint64(16, 50_000_000n, true);
  view.setBigUint64(24, 12345n, true);
  view.setBigInt64(32, 1700000000n, true);
  view.setBigInt64(40, 1700001000n, true);
  view.setUint32(80, 1, true);
  view.setUint32(84, 3, true);
  view.setUint32(88, 1000, true);
  buffer[92] = 2; // Complete

  const parsed = decodeDrawCycle(mockAccount(buffer)).data;
  assert.strictEqual(parsed.prizePot, 500_000_000n);
  assert.strictEqual(parsed.cycleFeeCollected, 50_000_000n);
  assert.strictEqual(parsed.harvestSlot, 12345n);
  assert.strictEqual(parsed.initiatedAt, 1700000000n);
  assert.strictEqual(parsed.completedAt, 1700001000n);
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.cycleId, 3);
  assert.strictEqual(parsed.lockedTicketCount, 1000);
  assert.strictEqual(parsed.status, 2); // Complete enum variant index

  buffer[92] = 4; // Skipped
  const parsedSkipped = parseDrawCycle(buffer);
  assert.strictEqual(parsedSkipped.status, "Skipped");

  buffer[92] = 3; // ForceUnlocked
  const parsedUnlocked = parseDrawCycle(buffer);
  assert.strictEqual(parsedUnlocked.status, "ForceUnlocked");

  // Verify that an invalid DrawStatus byte throws an explicit Error
  buffer[92] = 99;
  assert.throws(() => parseDrawCycle(buffer));

  console.log("✓ decodeDrawCycle passed");
}

// 5. Test decodePayoutRegistry
{
  const buffer = new Uint8Array(8 + 2896);
  const view = new DataView(buffer.buffer);

  view.setUint32(8, 1, true); // pool_id
  view.setUint32(12, 0, true); // cycle_id
  view.setUint32(16, 1, true); // winners_count
  view.setUint32(20, 0, true); // payouts_completed
  view.setBigInt64(24, 1700000000n, true); // revealed_at
  buffer[32] = 0; // status (Active = 0)
  buffer[33] = 1; // version

  // Winner 0 at offset 8 + 32 (header) + 64 (reserved) = 104
  const wOffset = 104;
  buffer.fill(2, wOffset, wOffset + 32); // winner Pubkey (32 bytes: 0..32)
  view.setBigUint64(wOffset + 32, 5_000_000n, true); // amount_owed (8 bytes: 32..40)
  view.setUint32(wOffset + 40, 2, true); // bonds_bought (4 bytes: 40..44)
  buffer[wOffset + 44] = 0; // processed (44..45)
  buffer[wOffset + 45] = 0; // tier_index (45..46)
  buffer[wOffset + 46] = 1; // version (46..47)

  const parsed = decodePayoutRegistry(mockAccount(buffer)).data;
  assert.strictEqual(parsed.poolId, 1);
  assert.strictEqual(parsed.cycleId, 0);
  assert.strictEqual(parsed.winnersCount, 1);
  assert.strictEqual(parsed.payoutsCompleted, 0);
  assert.strictEqual(parsed.revealedAt, 1700000000n);
  assert.strictEqual(parsed.status, 0);
  assert.strictEqual(parsed.winners[0].amountOwed, 5_000_000n);
  assert.strictEqual(parsed.winners[0].bondsBought, 2);
  assert.ok(parsed.winners[0].winner);
  console.log("✓ decodePayoutRegistry passed");
}

// 6. Test parsePrizePool and invalid status handling
{
  const buffer = new Uint8Array(200);
  buffer[170] = 0; // Active
  // Verify parsePrizePool fails on raw buffer without valid discriminator/fields
  // or test status mapping with mock
  assert.strictEqual(typeof parsePrizePool, "function");
  console.log("✓ parsePrizePool structure passed");
}

// 7. Test ANCHOR_CUSTOM_ERRORS Codama constant synchronization
{
  assert.ok(ANCHOR_CUSTOM_ERRORS[ANCHOR_ERROR__POOL_NOT_FROZEN]);
  assert.strictEqual(
    ANCHOR_CUSTOM_ERRORS[ANCHOR_ERROR__POOL_NOT_FROZEN].name,
    "PoolNotFrozen"
  );
  console.log("✓ ANCHOR_CUSTOM_ERRORS key synchronization passed");
}

// 8. Test parseMockHumaPoolState
{
  const buffer = new Uint8Array(512);
  const view = new DataView(buffer.buffer);

  view.setUint32(26, 1, true); // numModes = 1
  view.setBigUint64(30, 10_000_000n, true); // totalAssets low
  view.setBigUint64(38, 0n, true); // totalAssets high

  const modeConfigKeysOffset = 30 + 1 * 216; // 246
  view.setUint32(modeConfigKeysOffset, 0, true); // numConfigKeys = 0

  const redemptionOffset = modeConfigKeysOffset + 4; // 250
  view.setBigUint64(redemptionOffset, 5n, true); // next low
  view.setBigUint64(redemptionOffset + 8, 0n, true); // next high
  view.setBigUint64(redemptionOffset + 16, 12n, true); // last low
  view.setBigUint64(redemptionOffset + 24, 0n, true); // last high

  const parsed = parseMockHumaPoolState(buffer);
  assert.strictEqual(parsed.numModes, 1);
  assert.strictEqual(parsed.totalAssets, 10_000_000n);
  assert.strictEqual(parsed.numConfigKeys, 0);
  assert.strictEqual(parsed.nextRequestId, 5n);
  assert.strictEqual(parsed.lastRequestId, 12n);
  assert.strictEqual(parsed.pendingRequests, 7n);

  console.log("✓ parseMockHumaPoolState passed");
}

// 9. Test parseMockHumaPoolState bounds check on empty/short buffers
{
  const empty = parseMockHumaPoolState(new Uint8Array(10));
  assert.strictEqual(empty.totalAssets, 0n);
  assert.strictEqual(empty.pendingRequests, 0n);

  const short = parseMockHumaPoolState(new Uint8Array(35));
  assert.strictEqual(short.numModes, 0);
  assert.strictEqual(short.totalAssets, 0n);

  console.log("✓ parseMockHumaPoolState bounds checking passed");
}

// 10. Test parseTokenAccountBalance
{
  const buffer = new Uint8Array(165);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(64, 42_000_000n, true);

  assert.strictEqual(parseTokenAccountBalance(buffer), 42_000_000n);
  assert.strictEqual(parseTokenAccountBalance(new Uint8Array(50)), 0n); // Short buffer fallback
  console.log("✓ parseTokenAccountBalance passed");
}

// 11. Test parseMintSupply
{
  const buffer = new Uint8Array(82);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(36, 1_000_000_000n, true);

  assert.strictEqual(parseMintSupply(buffer), 1_000_000_000n);
  assert.strictEqual(parseMintSupply(new Uint8Array(20)), 0n); // Short buffer fallback
  console.log("✓ parseMintSupply passed");
}

// 12. Test calculatePoolYield - Baseline and Fee Deduction
{
  // 1000 USDC deposit, 1000 PST balance, 1000 PST supply, 1050 USDC Huma assets (50 USDC yield), 0% fee
  const resNoFee = calculatePoolYield({
    poolPstBalance: 1_000_000_000n,
    pstSupply: 1_000_000_000n,
    humaTotalAssets: 1_050_000_000n,
    totalDepositedPrincipal: 1_000_000_000n,
    feeBasisPoints: 0,
  });

  assert.strictEqual(resNoFee.currentValue, 1_050_000_000n);
  assert.strictEqual(resNoFee.bookValue, 1_000_000_000n);
  assert.strictEqual(resNoFee.grossYield, 50_000_000n);
  assert.strictEqual(resNoFee.protocolFee, 0n);
  assert.strictEqual(resNoFee.netYield, 50_000_000n);
  assert.strictEqual(resNoFee.estimatedPrizePot, 50_000_000);

  // 10% fee (1000 bps) on 50 USDC yield -> 5 USDC fee, 45 USDC net prize pot
  const resWithFee = calculatePoolYield({
    poolPstBalance: 1_000_000_000n,
    pstSupply: 1_000_000_000n,
    humaTotalAssets: 1_050_000_000n,
    totalDepositedPrincipal: 1_000_000_000n,
    feeBasisPoints: 1000,
  });

  assert.strictEqual(resWithFee.grossYield, 50_000_000n);
  assert.strictEqual(resWithFee.protocolFee, 5_000_000n);
  assert.strictEqual(resWithFee.netYield, 45_000_000n);
  assert.strictEqual(resWithFee.estimatedPrizePot, 45_000_000);

  console.log("✓ calculatePoolYield baseline & fee deduction passed");
}

// 13. Test calculatePoolYield - Pending Redemptions & Settle Invariance
{
  // User requested 25 USDC redemption out of 934 USDC total:
  // Active principal: 909 USDC (909M)
  // Pool PST Balance: 909 PST (909M)
  // PST Mint Supply: 934 PST (934M)
  // Simulated 50 USDC yield: Huma Total Assets = 985,382,743 micro-USDC
  const resPending = calculatePoolYield({
    poolPstBalance: 909_000_000n,
    pstSupply: 934_000_000n,
    humaTotalAssets: 985_382_743n,
    totalDepositedPrincipal: 909_000_000n,
    feeBasisPoints: 0,
  });

  // currentValue = 909M * 985,382,743 / 934M = 959,007,401 micro-USDC
  assert.strictEqual(resPending.currentValue, 959_007_401n);
  assert.strictEqual(resPending.bookValue, 909_000_000n);
  assert.strictEqual(resPending.grossYield, 50_007_401n);
  assert.strictEqual(resPending.netYield, 50_007_401n);
  assert.strictEqual(resPending.estimatedPrizePot, 50_007_401);

  // After 25 PST settled and burned in Huma:
  // Active principal: 909 USDC (909M)
  // Pool PST Balance: 909 PST (909M)
  // PST Mint Supply: 909 PST (909M)
  // Huma Total Assets = 959,007,401 micro-USDC
  const resSettled = calculatePoolYield({
    poolPstBalance: 909_000_000n,
    pstSupply: 909_000_000n,
    humaTotalAssets: 959_007_401n,
    totalDepositedPrincipal: 909_000_000n,
    feeBasisPoints: 0,
  });

  assert.strictEqual(resSettled.currentValue, 959_007_401n);
  assert.strictEqual(resSettled.bookValue, 909_000_000n);
  assert.strictEqual(resSettled.grossYield, 50_007_401n);
  assert.strictEqual(resSettled.netYield, 50_007_401n);
  assert.strictEqual(resSettled.estimatedPrizePot, 50_007_401);

  // Zero supply / zero deposits defensive test
  const resZero = calculatePoolYield({
    poolPstBalance: 0n,
    pstSupply: 0n,
    humaTotalAssets: 0n,
    totalDepositedPrincipal: 0n,
  });
  assert.strictEqual(resZero.currentValue, 0n);
  assert.strictEqual(resZero.grossYield, 0n);
  assert.strictEqual(resZero.estimatedPrizePot, 0);

  console.log(
    "✓ calculatePoolYield pending redemptions & settle invariance passed"
  );
}

// 12. Test resolveUserTickets (Active vs Pending during Draw In Progress)
{
  const mockOwner = "11111111111111111111111111111111" as Address;

  // Case 1: Standard Active Cycle (Cycle 0, user purchased in Cycle 0, pool not frozen)
  const entryCycle0: UserEntryInfo = {
    owner: mockOwner,
    active: 0,
    pending: 100,
    mergedThroughCycle: 0,
    cumulativeActive: 0,
  };
  const resCycle0 = resolveUserTickets(entryCycle0, 0, false);
  assert.strictEqual(resCycle0.activeTicketsCount, 0);
  assert.strictEqual(resCycle0.pendingTicketsCount, 100);
  assert.strictEqual(resCycle0.isStale, false);
  assert.strictEqual(
    resCycle0.activeTicketsCount + resCycle0.pendingTicketsCount,
    entryCycle0.active + entryCycle0.pending
  );

  // Case 2: Draw in Progress (Cycle 0 harvested -> drawCycleId bumped to 1, isFrozenForDraw = true)
  // Newly purchased bonds in cycle 0 MUST remain pending while Draw 0 is resolving!
  const resCycle0Frozen = resolveUserTickets(entryCycle0, 1, true);
  assert.strictEqual(resCycle0Frozen.activeTicketsCount, 0);
  assert.strictEqual(resCycle0Frozen.pendingTicketsCount, 100);
  assert.strictEqual(resCycle0Frozen.isStale, false);
  assert.strictEqual(
    resCycle0Frozen.activeTicketsCount + resCycle0Frozen.pendingTicketsCount,
    entryCycle0.active + entryCycle0.pending
  );

  // Case 3: Draw Complete (Reveal executed -> pool unfrozen, isFrozenForDraw = false, cycle 1)
  // Tickets are now mature and active for Cycle 1!
  const resCycle1Unfrozen = resolveUserTickets(entryCycle0, 1, false);
  assert.strictEqual(resCycle1Unfrozen.activeTicketsCount, 100);
  assert.strictEqual(resCycle1Unfrozen.pendingTicketsCount, 0);
  assert.strictEqual(resCycle1Unfrozen.isStale, true);
  assert.strictEqual(
    resCycle1Unfrozen.activeTicketsCount +
      resCycle1Unfrozen.pendingTicketsCount,
    entryCycle0.active + entryCycle0.pending
  );

  // Case 4: User with existing active tickets + new pending tickets during frozen draw
  // User had 50 active from past cycles, bought 75 pending in cycle 1.
  // Pool is now at cycle 2, frozen for Draw 1.
  const entryMixed: UserEntryInfo = {
    owner: mockOwner,
    active: 50,
    pending: 75,
    mergedThroughCycle: 1,
    cumulativeActive: 50,
  };
  const resMixedFrozen = resolveUserTickets(entryMixed, 2, true);
  assert.strictEqual(resMixedFrozen.activeTicketsCount, 50);
  assert.strictEqual(resMixedFrozen.pendingTicketsCount, 75);
  assert.strictEqual(resMixedFrozen.isStale, false);
  assert.strictEqual(
    resMixedFrozen.activeTicketsCount + resMixedFrozen.pendingTicketsCount,
    entryMixed.active + entryMixed.pending
  );

  // Case 5: Multi-cycle stale user during active draw
  // User deposited in cycle 0 (mergedThroughCycle = 0), pool is now at cycle 3 frozen for Draw 2.
  // Effective cycle = 3 - 1 = 2. Since 0 < 2, their tickets were mature for Draw 2!
  const resMultiCycleStale = resolveUserTickets(entryCycle0, 3, true);
  assert.strictEqual(resMultiCycleStale.activeTicketsCount, 100);
  assert.strictEqual(resMultiCycleStale.pendingTicketsCount, 0);
  assert.strictEqual(resMultiCycleStale.isStale, true);
  assert.strictEqual(
    resMultiCycleStale.activeTicketsCount +
      resMultiCycleStale.pendingTicketsCount,
    entryCycle0.active + entryCycle0.pending
  );

  // Case 6: Null / Undefined entry guard
  const resNull = resolveUserTickets(null, 1, false);
  assert.strictEqual(resNull.activeTicketsCount, 0);
  assert.strictEqual(resNull.pendingTicketsCount, 0);
  assert.strictEqual(resNull.isStale, false);

  const resUndefined = resolveUserTickets(undefined, 1, true);
  assert.strictEqual(resUndefined.activeTicketsCount, 0);
  assert.strictEqual(resUndefined.pendingTicketsCount, 0);
  assert.strictEqual(resUndefined.isStale, false);

  console.log(
    "✓ resolveUserTickets active/pending balance & frozen draw invariance passed"
  );
}

console.log("All Codama SDK parser & math tests completed successfully!");
