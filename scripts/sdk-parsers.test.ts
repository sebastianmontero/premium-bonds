import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Address,
  lamports,
  address,
  AccountRole,
  createNoopSigner,
} from "@solana/kit";
import {
  decodeUserWinnings,
  decodeGlobalConfig,
  decodePendingRedemption,
  decodeDrawCycle,
  decodePayoutRegistry,
  PAYOUT_REGISTRY_DISCRIMINATOR,
} from "../app/lib/generated/yield-bonds/src/generated/accounts";
import {
  ANCHOR_PROGRAM_ADDRESS,
  PoolStatus,
} from "../app/lib/generated/yield-bonds/src/generated";
import { buildMockPrizePoolEncoded } from "../app/lib/test-harness/account-builders";
import {
  RedemptionType,
  parseDrawCycle,
  parsePrizePool,
  parsePayoutRegistry,
  PayoutRegistryStatus,
  formatPayoutRegistryStatus,
  isPayoutRegistryVoided,
  canClosePayoutRegistry,
  payoutRegistrySpace,
  getPayoutRegistryAccountSize,
  WINNER_SIZE,
  PAYOUT_REGISTRY_HEADER_SIZE,
  parseMockHumaPoolState,
  parseTokenAccountBalance,
  parseMintSupply,
  calculatePoolYield,
  calculateAvailableFees,
  calculateBookValue,
  calculateDeficitTotalAssets,
  MIN_SOLVENCY_TOLERANCE,
  MAX_SOLVENCY_TOLERANCE,
  SOLVENCY_TOLERANCE_BPS,
  DEFAULT_DEFICIT_USDC,
  resolveUserTickets,
  parseUserEntryFromSlice,
  parseRegistryHeaderFromSlice,
  decodeAccountBase64Data,
  parseModeConfig,
  UNASSIGNED_REGISTRY_INDEX,
  REGISTRY_HEADER_SIZE,
  USER_ENTRY_SIZE,
  REGISTRY_REALLOC_STEP,
  REGISTRY_MAX_SIZE,
  REGISTRY_INITIAL_SIZE,
  REGISTRY_INITIAL_CAPACITY,
  REGISTRY_MAX_CAPACITY,
  ticketRegistrySpace,
  ticketRegistryCapacity,
  canExpandTicketRegistry,
  isRegistryAtMaxCapacity,
  REGISTRY_EXPANSION_CHUNK_USERS,
  getRemainingRegistrySlots,
  isRegistryHeadroomDeficit,
  UserEntryInfo,
  buildNominateAdminInstruction,
  buildCancelAdminNominationInstruction,
  buildAcceptAdminInstruction,
} from "../app/lib/bonds-sdk";
import {
  serializeTicketRegistry,
  parseTicketRegistry,
  parseRegistryEntry,
  TICKET_REGISTRY_DISCRIMINATOR,
} from "../app/lib/ticket-registry-helpers";
import { ANCHOR_CUSTOM_ERRORS } from "../app/lib/errors";
import { ANCHOR_ERROR__POOL_NOT_FROZEN } from "../app/lib/generated/yield-bonds/src/generated";
import {
  calculateNetApy,
  resolvePoolYieldBreakdown,
  calculateYieldThresholdProgress,
  resolvePoolThresholdBreakdown,
  formatBasisPoints,
  formatApy,
} from "../app/lib/formatters";

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

describe("Codama SDK Parsers & Account Deserialization", () => {
  it("should decode UserWinnings account correctly", () => {
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
  });

  it("should decode GlobalConfig account correctly", () => {
    const buffer = new Uint8Array(201);
    const parsed = decodeGlobalConfig(mockAccount(buffer)).data;
    assert.ok(parsed.admin, "GlobalConfig must contain admin address");
    assert.ok(parsed.guardian, "GlobalConfig must contain guardian address");
    assert.ok(
      parsed.jobsAccount,
      "GlobalConfig must contain jobsAccount address"
    );
  });

  it("should decode PendingRedemption account correctly", () => {
    const buffer = new Uint8Array(144);
    const view = new DataView(buffer.buffer);

    buffer.fill(1, 8, 40); // user address
    view.setBigUint64(40, 123n, true); // batchId
    view.setBigUint64(48, 7n, true); // redemptionId
    view.setBigUint64(56, 1_000_000n, true); // amount
    view.setBigInt64(64, 1700000000n, true); // requestedAt
    view.setUint32(72, 1, true); // poolId
    buffer[76] = 254; // bump
    buffer[77] = 1; // version
    buffer[78] = 1; // redemptionType: PrizeClaim

    const parsed = decodePendingRedemption(mockAccount(buffer)).data;
    assert.strictEqual(parsed.batchId, 123n);
    assert.strictEqual(parsed.redemptionId, 7n);
    assert.strictEqual(parsed.amount, 1_000_000n);
    assert.strictEqual(parsed.requestedAt, 1700000000n);
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.bump, 254);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.redemptionType, RedemptionType.PrizeClaim);
  });

  it("should decode DrawCycle account and handle status variants correctly", () => {
    const buffer = new Uint8Array(191);
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
    buffer[93] = 1; // version
    buffer[94] = 0; // rebindCount

    const parsed = decodeDrawCycle(mockAccount(buffer)).data;
    assert.strictEqual(parsed.prizePot, 500_000_000n);
    assert.strictEqual(parsed.cycleFeeCollected, 50_000_000n);
    assert.strictEqual(parsed.vrfSeedSlot, 12345n);
    assert.strictEqual(parsed.initiatedAt, 1700000000n);
    assert.strictEqual(parsed.completedAt, 1700001000n);
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.cycleId, 3);
    assert.strictEqual(parsed.lockedTicketCount, 1000);
    assert.strictEqual(parsed.status, 2); // Complete enum variant index
    assert.strictEqual(parsed.rebindCount, 0);

    buffer[92] = 4; // Skipped
    const parsedSkipped = parseDrawCycle(buffer);
    assert.strictEqual(parsedSkipped.status, "Skipped");

    buffer[92] = 3; // ForceUnlocked
    const parsedUnlocked = parseDrawCycle(buffer);
    assert.strictEqual(parsedUnlocked.status, "ForceUnlocked");

    // Verify that an invalid DrawStatus byte throws an explicit Error
    buffer[92] = 99;
    assert.throws(() => parseDrawCycle(buffer));
  });

  it("should decode and parse PayoutRegistry account correctly", () => {
    const buffer = new Uint8Array(104 + 56);
    buffer.set(PAYOUT_REGISTRY_DISCRIMINATOR, 0);
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

    const decodedHeader = decodePayoutRegistry(
      mockAccount(buffer.slice(0, 104))
    ).data;
    assert.strictEqual(decodedHeader.poolId, 1);
    assert.strictEqual(decodedHeader.cycleId, 0);
    assert.strictEqual(decodedHeader.winnersCount, 1);
    assert.strictEqual(decodedHeader.payoutsCompleted, 0);
    assert.strictEqual(decodedHeader.revealedAt, 1700000000n);
    assert.strictEqual(decodedHeader.status, 0);

    const parsed = parsePayoutRegistry(mockAccount(buffer));
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.cycleId, 0);
    assert.strictEqual(parsed.winnersCount, 1);
    assert.strictEqual(parsed.payoutsCompleted, 0);
    assert.strictEqual(parsed.revealedAt, 1700000000n);
    assert.strictEqual(parsed.status, PayoutRegistryStatus.Active);
    assert.strictEqual(formatPayoutRegistryStatus(parsed.status), "Active");
    assert.strictEqual(isPayoutRegistryVoided(parsed), false);
    assert.strictEqual(WINNER_SIZE, 56);
    assert.strictEqual(PAYOUT_REGISTRY_HEADER_SIZE, 104);
    assert.strictEqual(payoutRegistrySpace(1), 160);
    assert.strictEqual(getPayoutRegistryAccountSize(1), 160);
    assert.strictEqual(canClosePayoutRegistry(parsed), false);
    assert.strictEqual(parsed.winners.length, 1);
    assert.strictEqual(parsed.winners[0].amountOwed, 5_000_000n);
    assert.strictEqual(parsed.winners[0].bondsBought, 2);
    assert.ok(parsed.winners[0].winner, "Winner address must be present");
  });

  it("should parse PrizePool account correctly", () => {
    const buffer = buildMockPrizePoolEncoded({
      bondPrice: 1_000_000n,
      stakeCycleDurationHrs: 24n,
      minYieldThreshold: 0n,
      totalDepositedPrincipal: 50_000_000n,
      currentCycleEndAt: 1700000000n,
      nextRedemptionId: 10n,
      totalFeesAccrued: 100_000n,
      totalFeesWithdrawn: 0n,
      totalPrizesAllocated: 500_000n,
      totalPendingRedemptions: 0n,
      poolId: 1,
      currentDrawCycleId: 3,
      feeBasisPoints: 250,
      maxYieldBasisPoints: 500,
      payoutTimelockSeconds: 300,
      vaultAuthorityBump: 254,
      status: PoolStatus.Active,
      isFrozenForDraw: 0,
      version: 1,
      prizeTiersCount: 1,
      prizeTiers: [
        { basisPoints: 10000, numWinners: 1, padding: new Uint8Array(2) },
        ...Array.from({ length: 9 }, () => ({
          basisPoints: 0,
          numWinners: 0,
          padding: new Uint8Array(2),
        })),
      ],
    });

    const parsed = parsePrizePool(buffer);
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.status, "Active");
    assert.strictEqual(parsed.bondPrice, 1_000_000);
    assert.strictEqual(parsed.totalDepositedPrincipal, 50_000_000);
    assert.ok(parsed.humaPoolState, "humaPoolState must be present");
    assert.strictEqual(parsed.prizeTiers.length, 1);
    assert.strictEqual(parsed.prizeTiers[0].basisPoints, 10000);

    // Verify JSON serialization safeguard: parsePrizePool output must be strictly JSON-serializable
    assert.doesNotThrow(
      () => JSON.stringify(parsed),
      "parsePrizePool output must be strictly JSON serializable"
    );
    assert.strictEqual(typeof parsed.totalFeesAccrued, "number");
    assert.strictEqual(typeof parsed.totalFeesWithdrawn, "number");
    assert.strictEqual(typeof parsed.totalPrizesAllocated, "number");
    assert.strictEqual(typeof parsed.totalPendingRedemptions, "number");
  });

  it("should synchronize ANCHOR_CUSTOM_ERRORS Codama constants", () => {
    assert.ok(
      ANCHOR_CUSTOM_ERRORS[ANCHOR_ERROR__POOL_NOT_FROZEN],
      "ANCHOR_CUSTOM_ERRORS must contain entry for PoolNotFrozen"
    );
    assert.strictEqual(
      ANCHOR_CUSTOM_ERRORS[ANCHOR_ERROR__POOL_NOT_FROZEN].name,
      "PoolNotFrozen"
    );
  });

  it("should parse MockHumaPoolState correctly", () => {
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
  });

  it("should safely handle short and empty buffers in parseMockHumaPoolState", () => {
    const empty = parseMockHumaPoolState(new Uint8Array(10));
    assert.strictEqual(empty.totalAssets, 0n);
    assert.strictEqual(empty.pendingRequests, 0n);

    const short = parseMockHumaPoolState(new Uint8Array(35));
    assert.strictEqual(short.numModes, 0);
    assert.strictEqual(short.totalAssets, 0n);
  });

  it("should parse token account balance with fallback", () => {
    const buffer = new Uint8Array(165);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(64, 42_000_000n, true);

    assert.strictEqual(parseTokenAccountBalance(buffer), 42_000_000n);
    assert.strictEqual(parseTokenAccountBalance(new Uint8Array(50)), 0n);
  });

  it("should parse mint supply with fallback", () => {
    const buffer = new Uint8Array(82);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(36, 1_000_000_000n, true);

    assert.strictEqual(parseMintSupply(buffer), 1_000_000_000n);
    assert.strictEqual(parseMintSupply(new Uint8Array(20)), 0n);
  });

  it("should calculate available fees with saturating non-negative subtraction", () => {
    // Normal case: accrued > withdrawn (bigint inputs)
    assert.strictEqual(
      calculateAvailableFees({
        totalFeesAccrued: 50_000_000n,
        totalFeesWithdrawn: 20_000_000n,
      }),
      30_000_000n
    );

    // Number inputs (as returned by parsePrizePool)
    assert.strictEqual(
      calculateAvailableFees({
        totalFeesAccrued: 50_000_000,
        totalFeesWithdrawn: 20_000_000,
      }),
      30_000_000n
    );

    // Saturating guard: withdrawn >= accrued clamps cleanly to 0n without negative values
    assert.strictEqual(
      calculateAvailableFees({
        totalFeesAccrued: 10_000_000n,
        totalFeesWithdrawn: 20_000_000n,
      }),
      0n
    );
    assert.strictEqual(
      calculateAvailableFees({
        totalFeesAccrued: 10_000_000,
        totalFeesWithdrawn: 10_000_000,
      }),
      0n
    );

    // Undefined / empty fields default to 0n
    assert.strictEqual(calculateAvailableFees({}), 0n);
  });

  it("should calculate pool book value across mixed bigint, number, and PrizePoolInfo objects", () => {
    // 1. Mixed bigint and number inputs
    const bvMixed = calculateBookValue({
      totalDepositedPrincipal: 100_000_000, // number
      totalFeesAccrued: 15_000_000n, // bigint
      totalFeesWithdrawn: 5_000_000, // number
      totalPrizesAllocated: 2_000_000n, // bigint
    });
    // principal (100M) + fees_in_vault (15M - 5M = 10M) + prizes (2M) = 112M
    assert.strictEqual(bvMixed, 112_000_000n);

    // 2. Structural compatibility with PrizePoolInfo (all numbers from parsePrizePool)
    const mockParsedPool = {
      poolId: 1,
      totalDepositedPrincipal: 50_000_000,
      totalFeesAccrued: 4_000_000,
      totalFeesWithdrawn: 1_000_000,
      totalPrizesAllocated: 500_000,
    };
    const bvFromParsed = calculateBookValue(mockParsedPool);
    // 50M + (4M - 1M) + 0.5M = 53.5M = 53_500_000n
    assert.strictEqual(bvFromParsed, 53_500_000n);

    // 3. Explicit feesInVault override
    const bvOverride = calculateBookValue({
      totalDepositedPrincipal: 10_000_000n,
      feesInVault: 3_000_000n,
      totalPrizesAllocated: 0n,
    });
    assert.strictEqual(bvOverride, 13_000_000n);

    // 4. Zero liabilities edge case
    assert.strictEqual(
      calculateBookValue({
        totalDepositedPrincipal: 0n,
      }),
      0n
    );
  });

  it("should calculate pool yield baseline and fee deduction", () => {
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
  });

  it("should calculate pool yield with pending redemptions and settle invariance", () => {
    const resPending = calculatePoolYield({
      poolPstBalance: 909_000_000n,
      pstSupply: 934_000_000n,
      humaTotalAssets: 985_382_743n,
      totalDepositedPrincipal: 909_000_000n,
      feeBasisPoints: 0,
    });

    assert.strictEqual(resPending.currentValue, 959_007_401n);
    assert.strictEqual(resPending.bookValue, 909_000_000n);
    assert.strictEqual(resPending.grossYield, 50_007_401n);
    assert.strictEqual(resPending.netYield, 50_007_401n);
    assert.strictEqual(resPending.estimatedPrizePot, 50_007_401);

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

    const resZero = calculatePoolYield({
      poolPstBalance: 0n,
      pstSupply: 0n,
      humaTotalAssets: 0n,
      totalDepositedPrincipal: 0n,
    });
    assert.strictEqual(resZero.currentValue, 0n);
    assert.strictEqual(resZero.grossYield, 0n);
    assert.strictEqual(resZero.estimatedPrizePot, 0);
  });

  it("should resolve user tickets during active and frozen draw stages", () => {
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
    const resCycle0Frozen = resolveUserTickets(entryCycle0, 1, true);
    assert.strictEqual(resCycle0Frozen.activeTicketsCount, 0);
    assert.strictEqual(resCycle0Frozen.pendingTicketsCount, 100);
    assert.strictEqual(resCycle0Frozen.isStale, false);
    assert.strictEqual(
      resCycle0Frozen.activeTicketsCount + resCycle0Frozen.pendingTicketsCount,
      entryCycle0.active + entryCycle0.pending
    );

    // Case 3: Draw Complete (Reveal executed -> pool unfrozen, isFrozenForDraw = false, cycle 1)
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
  });

  it("should serialize and parse TicketRegistry roundtrips accurately", () => {
    const mockUser1 = "11111111111111111111111111111111" as Address;
    const mockUser2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

    const entries: UserEntryInfo[] = [
      {
        owner: mockUser1,
        active: 651,
        pending: 0,
        mergedThroughCycle: 3,
        cumulativeActive: 651,
      },
      {
        owner: mockUser2,
        active: 276,
        pending: 0,
        mergedThroughCycle: 3,
        cumulativeActive: 927,
      },
    ];

    const buffer = serializeTicketRegistry({
      poolId: 1,
      totalActiveTickets: 927,
      totalPendingTickets: 0,
      drawCycleId: 3,
      drawPreparedUpTo: 2,
      entries,
    });

    assert.strictEqual(buffer.byteLength, REGISTRY_INITIAL_SIZE);
    assert.deepStrictEqual(
      Array.from(buffer.subarray(0, 8)),
      Array.from(TICKET_REGISTRY_DISCRIMINATOR)
    );

    const parsed = parseTicketRegistry(buffer);
    assert.strictEqual(parsed.poolId, 1);
    assert.strictEqual(parsed.capacity, REGISTRY_INITIAL_CAPACITY);
    assert.strictEqual(parsed.userCount, 2);
    assert.strictEqual(parsed.totalActiveTickets, 927);
    assert.strictEqual(parsed.drawCycleId, 3);
    assert.strictEqual(parsed.drawPreparedUpTo, 2);
    assert.strictEqual(parsed.entries.length, 2);

    assert.strictEqual(parsed.entries[0].owner, mockUser1);
    assert.strictEqual(parsed.entries[0].active, 651);
    assert.strictEqual(parsed.entries[0].cumulativeActive, 651);

    assert.strictEqual(parsed.entries[1].owner, mockUser2);
    assert.strictEqual(parsed.entries[1].active, 276);
    assert.strictEqual(parsed.entries[1].cumulativeActive, 927);
  });

  it("should parse ModeConfig with dynamic Borsh string length decoding", () => {
    const nameStr = "USDC Prime";
    const nameBytes = new TextEncoder().encode(nameStr);
    const totalLen = 42 + 4 + nameBytes.length + 2 + 8 + 160;
    const buffer = new Uint8Array(totalLen);
    const view = new DataView(buffer.buffer);

    view.setUint32(42, nameBytes.length, true);
    buffer.set(nameBytes, 46);
    const targetApyOffset = 46 + nameBytes.length;
    view.setUint16(targetApyOffset, 850, true);

    const result = parseModeConfig(buffer);
    assert.strictEqual(result.targetApyBps, 850);
    assert.strictEqual(result.apy, 0.085);

    // Fallback on short buffer
    const shortResult = parseModeConfig(new Uint8Array(20));
    assert.strictEqual(shortResult.targetApyBps, 850);
    assert.strictEqual(shortResult.apy, 0.085);
  });

  it("should parse PrizePool feeBasisPoints and minYieldThreshold safely", () => {
    const buffer = new Uint8Array(500);
    const view = new DataView(buffer.buffer);
    // bond_price (offset 8)
    view.setBigUint64(8, 5_000_000n, true);
    // fee_basis_points (offset 40)
    view.setUint16(40, 250, true);
    // min_yield_threshold (offset 48)
    view.setBigUint64(48, 10_000_000n, true);
    buffer[42] = 0; // PoolStatus::Active

    assert.doesNotThrow(() => {
      const parsed = parsePrizePool(buffer);
      assert.strictEqual(typeof parsed.feeBasisPoints, "number");
      assert.strictEqual(typeof parsed.minYieldThreshold, "number");
    });
  });

  it("should calculate APY, yield threshold progress, and breakdown accurately", () => {
    // calculateNetApy
    assert.strictEqual(calculateNetApy(0.085, 250), 0.085 * (1 - 0.025));
    assert.strictEqual(calculateNetApy(0.1, 0), 0.1);

    // formatBasisPoints & formatApy
    assert.strictEqual(formatBasisPoints(250), "2.50%");
    assert.strictEqual(formatApy(0.085), "8.50% APY");

    // calculateYieldThresholdProgress
    const met = calculateYieldThresholdProgress(15_000_000, 10_000_000, 6);
    assert.strictEqual(met.isMet, true);
    assert.strictEqual(met.isConfigured, true);
    assert.strictEqual(met.progressPercent, 100);

    const accumulating = calculateYieldThresholdProgress(
      5_000_000,
      10_000_000,
      6
    );
    assert.strictEqual(accumulating.isMet, false);
    assert.strictEqual(accumulating.progressPercent, 50);

    const zeroThreshold = calculateYieldThresholdProgress(0, 0, 6);
    assert.strictEqual(zeroThreshold.isMet, true);
    assert.strictEqual(zeroThreshold.isConfigured, false);
    assert.strictEqual(zeroThreshold.progressPercent, 100);

    // resolvePoolThresholdBreakdown
    const samplePool = {
      poolId: 1,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      bondPrice: 5_000_000,
      stakeCycleDurationHrs: 168,
      feeBasisPoints: 250,
      status: "Active" as const,
      totalDepositedPrincipal: 100_000_000_000,
      currentCycleEndAt: 1800000000,
      isFrozenForDraw: false,
      currentDrawCycleId: 1,
      prizeTiers: [],
      estimatedPrizePot: 4_875_000,
      grossYield: 5_000_000,
      protocolFeeAmount: 125_000,
      minYieldThreshold: 10_000_000,
      underlyingApy: 0.085,
    };
    const breakdown = resolvePoolThresholdBreakdown(samplePool);
    assert.strictEqual(breakdown.isConfigured, true);
    assert.strictEqual(breakdown.isMet, false);
    assert.strictEqual(breakdown.progressPercent, 50);
    assert.strictEqual(breakdown.gross.targetUi, 10);
    assert.strictEqual(breakdown.net.targetUi, 9.75);
    assert.strictEqual(breakdown.net.currentUi, 4.875);
  });

  it("should parse TicketRegistry slices and handle boundary conditions safely", () => {
    const registryData = serializeTicketRegistry({
      poolId: 1,
      userCount: 3,
      totalActiveTickets: 500,
      totalPendingTickets: 50,
      drawCycleId: 4,
      bump: 254,
      version: 1,
      reserved: new Uint8Array(64),
      entries: [
        {
          owner: "11111111111111111111111111111111" as Address,
          active: 100,
          pending: 10,
          mergedThroughCycle: 4,
          cumulativeActive: 100,
        },
        {
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
          active: 200,
          pending: 20,
          mergedThroughCycle: 4,
          cumulativeActive: 300,
        },
        {
          owner: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
          active: 200,
          pending: 20,
          mergedThroughCycle: 3,
          cumulativeActive: 500,
        },
      ],
    });

    // A. Header slicing (104 bytes)
    const headerSlice = registryData.subarray(0, REGISTRY_HEADER_SIZE);
    assert.strictEqual(headerSlice.byteLength, REGISTRY_HEADER_SIZE);

    const parsedHeader = parseRegistryHeaderFromSlice(headerSlice);
    assert.notStrictEqual(parsedHeader, null);
    assert.strictEqual(parsedHeader?.poolId, 1);
    assert.strictEqual(parsedHeader?.userCount, 3);
    assert.strictEqual(parsedHeader?.totalActiveTickets, 500);
    assert.strictEqual(parsedHeader?.totalPendingTickets, 50);
    assert.strictEqual(parsedHeader?.drawCycleId, 4);

    // Truncated header -> null
    assert.strictEqual(
      parseRegistryHeaderFromSlice(headerSlice.subarray(0, 50)),
      null
    );

    // Corrupted discriminator -> null
    const corruptHeader = new Uint8Array(headerSlice);
    corruptHeader[0] = 0;
    assert.strictEqual(parseRegistryHeaderFromSlice(corruptHeader), null);

    // B. User entry slicing (64 bytes)
    const entry0Offset = REGISTRY_HEADER_SIZE;
    const entry0Slice = registryData.subarray(
      entry0Offset,
      entry0Offset + USER_ENTRY_SIZE
    );
    assert.strictEqual(entry0Slice.byteLength, USER_ENTRY_SIZE);

    const parsedEntry0 = parseUserEntryFromSlice(entry0Slice);
    assert.notStrictEqual(parsedEntry0, null);
    assert.strictEqual(parsedEntry0?.owner, "11111111111111111111111111111111");
    assert.strictEqual(parsedEntry0?.active, 100);
    assert.strictEqual(parsedEntry0?.pending, 10);
    assert.strictEqual(parsedEntry0?.mergedThroughCycle, 4);

    const entry1Offset = REGISTRY_HEADER_SIZE + USER_ENTRY_SIZE;
    const entry1Slice = registryData.subarray(
      entry1Offset,
      entry1Offset + USER_ENTRY_SIZE
    );
    const parsedEntry1 = parseUserEntryFromSlice(entry1Slice);
    assert.notStrictEqual(parsedEntry1, null);
    assert.strictEqual(
      parsedEntry1?.owner,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );
    assert.strictEqual(parsedEntry1?.active, 200);

    // Truncated entry -> null
    assert.strictEqual(
      parseUserEntryFromSlice(entry0Slice.subarray(0, 30)),
      null
    );

    // Invalid version (e.g. 99) -> null
    const invalidVersionEntry = new Uint8Array(entry0Slice);
    invalidVersionEntry[48] = 99;
    assert.strictEqual(parseUserEntryFromSlice(invalidVersionEntry), null);

    // C. Boundary checking on parseRegistryEntry
    assert.strictEqual(
      parseRegistryEntry(registryData, UNASSIGNED_REGISTRY_INDEX),
      null
    );
    assert.strictEqual(parseRegistryEntry(registryData, -1), null);
    assert.strictEqual(parseRegistryEntry(registryData, 100), null);
    assert.notStrictEqual(parseRegistryEntry(registryData, 0), null);
    assert.notStrictEqual(parseRegistryEntry(registryData, 2), null);

    // D. decodeAccountBase64Data safety
    assert.strictEqual(decodeAccountBase64Data(null), null);
    assert.strictEqual(
      decodeAccountBase64Data({ data: ["AQID", "base64"] })?.byteLength,
      3
    );
    assert.strictEqual(decodeAccountBase64Data({ data: ["", "base64"] }), null);
  });

  describe("calculateDeficitTotalAssets & Solvency Breaker Math", () => {
    it("should export correct domain constants", () => {
      assert.strictEqual(MIN_SOLVENCY_TOLERANCE, 10_000n);
      assert.strictEqual(MAX_SOLVENCY_TOLERANCE, 20_000_000n);
      assert.strictEqual(SOLVENCY_TOLERANCE_BPS, 1n);
      assert.strictEqual(DEFAULT_DEFICIT_USDC, 1.0);
      assert.ok(
        BigInt(DEFAULT_DEFICIT_USDC * 1_000_000) > MIN_SOLVENCY_TOLERANCE,
        "Default deficit must exceed MIN_SOLVENCY_TOLERANCE"
      );
    });

    it("should calculate correct total assets for 1:1 PST ratio", () => {
      // bookValue = 10 USDC (10_000_000 micro-USDC), deficit = 1 USDC (1_000_000 micro-USDC)
      // targetCurrentValue = 9 USDC (9_000_000 micro-USDC)
      // supply = balance = 10_000_000 PST
      const res = calculateDeficitTotalAssets({
        bookValue: 10_000_000n,
        deficitMicroUsdc: 1_000_000n,
        pstSupply: 10_000_000n,
        poolPstBalance: 10_000_000n,
      });
      assert.strictEqual(res, 9_000_000n);
    });

    it("should calculate correct total assets with non-trivial PST supply ratios", () => {
      // bookValue = 1,000 USDC, deficit = 50 USDC (target = 950 USDC)
      // pstSupply = 2,000,000, poolPstBalance = 1,000,000 (ratio = 2.0)
      const res = calculateDeficitTotalAssets({
        bookValue: 1_000_000_000n,
        deficitMicroUsdc: 50_000_000n,
        pstSupply: 2_000_000_000n,
        poolPstBalance: 1_000_000_000n,
      });
      assert.strictEqual(res, 1_900_000_000n);
    });

    it("should calculate correct total assets when deficit equals book value (complete wipeout)", () => {
      const res = calculateDeficitTotalAssets({
        bookValue: 5_000_000n,
        deficitMicroUsdc: 5_000_000n,
        pstSupply: 5_000_000n,
        poolPstBalance: 5_000_000n,
      });
      assert.strictEqual(res, 0n);
    });

    it("should handle zero pstSupply gracefully", () => {
      const res = calculateDeficitTotalAssets({
        bookValue: 5_000_000n,
        deficitMicroUsdc: 1_000_000n,
        pstSupply: 0n,
        poolPstBalance: 5_000_000n,
      });
      assert.strictEqual(res, 0n);
    });

    it("should throw RangeError when deficit is negative", () => {
      assert.throws(
        () =>
          calculateDeficitTotalAssets({
            bookValue: 10_000_000n,
            deficitMicroUsdc: -1n,
            pstSupply: 10_000_000n,
            poolPstBalance: 10_000_000n,
          }),
        /cannot be negative/
      );
    });

    it("should throw RangeError when deficit exceeds book value", () => {
      assert.throws(
        () =>
          calculateDeficitTotalAssets({
            bookValue: 100_000_000n,
            deficitMicroUsdc: 100_000_001n,
            pstSupply: 100_000_000n,
            poolPstBalance: 100_000_000n,
          }),
        /exceeds pool book value/
      );
    });

    it("should throw RangeError when poolPstBalance is zero", () => {
      assert.throws(
        () =>
          calculateDeficitTotalAssets({
            bookValue: 100_000_000n,
            deficitMicroUsdc: 1_000_000n,
            pstSupply: 100_000_000n,
            poolPstBalance: 0n,
          }),
        /Pool PST balance must be greater than zero/
      );
    });
  });

  describe("Admin Governance Instruction Builders", () => {
    it("should build nominateAdmin instruction", async () => {
      const admin = address("11111111111111111111111111111111");
      const pendingAdmin = address(
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
      );
      const ix = await buildNominateAdminInstruction({
        admin: createNoopSigner(admin),
        pendingAdmin,
      });
      assert.ok(ix);
      assert.equal(ix.programAddress, ANCHOR_PROGRAM_ADDRESS);
      assert.equal(ix.accounts.length, 4);
      assert.equal(ix.accounts[0].role, AccountRole.WRITABLE);
      assert.equal(ix.accounts[1].address, admin);
      assert.equal(ix.accounts[1].role, AccountRole.READONLY_SIGNER);
    });

    it("should build cancelAdminNomination instruction", async () => {
      const admin = address("11111111111111111111111111111111");
      const ix = await buildCancelAdminNominationInstruction({
        admin: createNoopSigner(admin),
      });
      assert.ok(ix);
      assert.equal(ix.programAddress, ANCHOR_PROGRAM_ADDRESS);
      assert.equal(ix.accounts.length, 4);
      assert.equal(ix.accounts[0].role, AccountRole.WRITABLE);
      assert.equal(ix.accounts[1].address, admin);
      assert.equal(ix.accounts[1].role, AccountRole.READONLY_SIGNER);
    });

    it("should build acceptAdmin instruction", async () => {
      const newAdmin = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ix = await buildAcceptAdminInstruction({
        newAdmin: createNoopSigner(newAdmin),
      });
      assert.ok(ix);
      assert.equal(ix.programAddress, ANCHOR_PROGRAM_ADDRESS);
      assert.equal(ix.accounts.length, 4);
      assert.equal(ix.accounts[0].role, AccountRole.WRITABLE);
      assert.equal(ix.accounts[1].address, newAdmin);
      assert.equal(ix.accounts[1].role, AccountRole.READONLY_SIGNER);
    });
  });

  describe("Ticket Registry Constants & Layout Helpers", () => {
    it("should define canonical on-chain layout constants", () => {
      assert.strictEqual(REGISTRY_HEADER_SIZE, 104);
      assert.strictEqual(USER_ENTRY_SIZE, 64);
      assert.strictEqual(REGISTRY_REALLOC_STEP, 10_240);
      assert.strictEqual(REGISTRY_MAX_SIZE, 10_485_760);
      assert.strictEqual(REGISTRY_INITIAL_SIZE, 262_248);
      assert.strictEqual(REGISTRY_INITIAL_CAPACITY, 4_096);
      assert.strictEqual(REGISTRY_MAX_CAPACITY, 163_776);
    });

    it("should calculate exact account byte space from capacity", () => {
      assert.strictEqual(ticketRegistrySpace(0), 104);
      assert.strictEqual(ticketRegistrySpace(1), 168);
      assert.strictEqual(
        ticketRegistrySpace(REGISTRY_INITIAL_CAPACITY),
        262_248
      );
      assert.strictEqual(ticketRegistrySpace(163_616), 10_471_528);
      assert.strictEqual(
        ticketRegistrySpace(REGISTRY_MAX_CAPACITY),
        10_481_768
      );
    });

    it("should calculate exact capacity from account byte length with boundary handling", () => {
      assert.strictEqual(ticketRegistryCapacity(0), 0);
      assert.strictEqual(ticketRegistryCapacity(50), 0);
      assert.strictEqual(ticketRegistryCapacity(103), 0);
      assert.strictEqual(ticketRegistryCapacity(104), 0);
      assert.strictEqual(ticketRegistryCapacity(104 + 63), 0);
      assert.strictEqual(ticketRegistryCapacity(104 + 64), 1);
      assert.strictEqual(ticketRegistryCapacity(262_248), 4_096);
      assert.strictEqual(ticketRegistryCapacity(10_481_768), 163_776);
    });

    it("should satisfy mathematical bijection on valid capacities", () => {
      const testCapacities = [0, 1, 10, 160, 4_096, 10_000, 163_616, 163_776];
      for (const cap of testCapacities) {
        assert.strictEqual(
          ticketRegistryCapacity(ticketRegistrySpace(cap)),
          cap
        );
      }
    });

    it("should correctly evaluate discrete expansion feasibility (canExpandTicketRegistry)", () => {
      assert.strictEqual(canExpandTicketRegistry(0), true);
      assert.strictEqual(canExpandTicketRegistry(4_096), true);
      // N=997: 10,471,528 + 10,240 = 10,481,768 <= 10,485,760 -> can expand
      assert.strictEqual(canExpandTicketRegistry(163_616), true);
      // N=998: 10,481,768 + 10,240 = 10,492,008 > 10,485,760 -> cannot expand
      assert.strictEqual(canExpandTicketRegistry(163_776), false);
    });

    it("should correctly evaluate max capacity threshold (isRegistryAtMaxCapacity)", () => {
      assert.strictEqual(isRegistryAtMaxCapacity(0), false);
      assert.strictEqual(isRegistryAtMaxCapacity(4_096), false);
      assert.strictEqual(isRegistryAtMaxCapacity(163_775), false);
      assert.strictEqual(isRegistryAtMaxCapacity(163_776), true);
      assert.strictEqual(isRegistryAtMaxCapacity(200_000), true);
    });

    it("should defensively validate inputs to layout helpers", () => {
      assert.throws(() => ticketRegistrySpace(-1), RangeError);
      assert.throws(() => ticketRegistrySpace(1.5), RangeError);
      assert.throws(() => ticketRegistrySpace(NaN), RangeError);
      assert.throws(() => ticketRegistrySpace(Infinity), RangeError);

      assert.throws(() => ticketRegistryCapacity(-1), RangeError);
      assert.throws(() => ticketRegistryCapacity(104.5), RangeError);
      assert.throws(() => ticketRegistryCapacity(NaN), RangeError);
      assert.throws(() => ticketRegistryCapacity(Infinity), RangeError);
    });

    it("should dynamically size buffer in serializeTicketRegistry when capacity is provided without totalSizeBytes", () => {
      const customBuffer = serializeTicketRegistry({
        poolId: 2,
        capacity: 10,
      });
      assert.strictEqual(customBuffer.byteLength, ticketRegistrySpace(10));
      assert.strictEqual(customBuffer.byteLength, 104 + 10 * 64);

      const parsed = parseTicketRegistry(customBuffer);
      assert.strictEqual(parsed.capacity, 10);
      assert.strictEqual(parsed.poolId, 2);
    });

    it("should verify discrete capacity expansion invariants across all 999 valid reallocation steps", () => {
      for (let step = 0; step <= 998; step++) {
        const cap = REGISTRY_INITIAL_CAPACITY + step * 160;
        const space = ticketRegistrySpace(cap);
        assert.ok(
          space <= REGISTRY_MAX_SIZE,
          `Space ${space} exceeds 10MB limit at step ${step}`
        );
        assert.strictEqual(ticketRegistryCapacity(space), cap);
        if (step < 998) {
          assert.strictEqual(
            canExpandTicketRegistry(cap),
            true,
            `Step ${step} (cap ${cap}) should be expandable`
          );
        } else {
          // Exactly at discrete maximum ceiling (N=998, 163,776 users)
          assert.strictEqual(
            canExpandTicketRegistry(cap),
            false,
            `Step 998 (cap ${cap}) must not be expandable`
          );
          assert.strictEqual(isRegistryAtMaxCapacity(cap), true);
        }
      }
    });

    it("should safely handle truncated or header-only buffers in parseTicketRegistry", () => {
      // Valid empty header
      const emptyHeaderBuffer = serializeTicketRegistry({
        poolId: 1,
        capacity: 0,
        totalSizeBytes: 104,
      });
      const parsed = parseTicketRegistry(emptyHeaderBuffer);
      assert.strictEqual(parsed.capacity, 0);
      assert.strictEqual(parsed.entries.length, 0);
    });
  });

  describe("Ticket Registry Headroom & Slot Calculations", () => {
    it("should calculate remaining slots accurately for both object and positional overloads", () => {
      // Positional
      assert.strictEqual(getRemainingRegistrySlots(4096, 3800), 296);
      // Object (RegistrySlotStats)
      assert.strictEqual(
        getRemainingRegistrySlots({ capacity: 4096, userCount: 3800 }),
        296
      );
      // Default userCount fallback when omitted in positional overload
      assert.strictEqual(getRemainingRegistrySlots(4096), 4096);
    });

    it("should evaluate exact boundary condition (remainingSlots <= threshold) for deficit", () => {
      const threshold = 320;
      // Exactly at threshold (320 remaining: 4096 - 3776 = 320) -> DEFICIT (true)
      assert.strictEqual(
        isRegistryHeadroomDeficit(4096, 3776, threshold),
        true
      );
      assert.strictEqual(
        isRegistryHeadroomDeficit(
          { capacity: 4096, userCount: 3776 },
          threshold
        ),
        true
      );

      // One slot above threshold (321 remaining: 4096 - 3775 = 321) -> HEALTHY (false)
      assert.strictEqual(
        isRegistryHeadroomDeficit(4096, 3775, threshold),
        false
      );
      assert.strictEqual(
        isRegistryHeadroomDeficit(
          { capacity: 4096, userCount: 3775 },
          threshold
        ),
        false
      );
    });

    it("should handle empty, full, and overflow registry states safely", () => {
      // Empty registry: full capacity remaining
      assert.strictEqual(getRemainingRegistrySlots(4096, 0), 4096);
      assert.strictEqual(isRegistryHeadroomDeficit(4096, 0, 320), false);

      // Full registry: 0 remaining -> deficit
      assert.strictEqual(getRemainingRegistrySlots(4096, 4096), 0);
      assert.strictEqual(isRegistryHeadroomDeficit(4096, 4096, 320), true);
      assert.strictEqual(isRegistryHeadroomDeficit(4096, 4096, 0), true);

      // Overflow registry (userCount > capacity): clamps to 0 remaining without negative numbers
      assert.strictEqual(getRemainingRegistrySlots(4096, 5000), 0);
      assert.strictEqual(isRegistryHeadroomDeficit(4096, 5000, 320), true);
    });

    it("should enforce chunk constants derived from Solana realloc bounds", () => {
      assert.strictEqual(REGISTRY_EXPANSION_CHUNK_USERS, 160);
      assert.strictEqual(
        REGISTRY_EXPANSION_CHUNK_USERS,
        REGISTRY_REALLOC_STEP / USER_ENTRY_SIZE
      );
    });
  });
});
