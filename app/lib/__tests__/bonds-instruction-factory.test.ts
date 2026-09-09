import test from "node:test";
import assert from "node:assert/strict";
import { address } from "@solana/kit";
import {
  buildBuyBondsInstruction,
  buildClaimRedemptionInstruction,
  buildReinvestWinningsInstruction,
  buildClaimNonReinvestedWinningsInstruction,
} from "../bonds-instruction-factory";

test("bonds-instruction-factory: builds buy bonds instruction with all derived accounts", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const dummyRegistry = address("11111111111111111111111111111111");
  const dummyUserToken = address("11111111111111111111111111111111");

  const ix = await buildBuyBondsInstruction({
    poolId: 1,
    userAddress: dummyUser,
    ticketsToBuy: 5,
    ticketRegistry: dummyRegistry,
    userTokenAccount: dummyUserToken,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  assert.equal(ix.accounts.length, 21);
  assert.equal(ix.accounts[0].address, dummyUser);
  assert.equal(ix.accounts[0].role, 3); // AccountRole.WRITABLE_SIGNER
  assert.ok(ix.data && ix.data.length > 8);
});

test("bonds-instruction-factory: builds claim redemption instruction", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const dummyUserToken = address("11111111111111111111111111111111");

  const ix = await buildClaimRedemptionInstruction({
    poolId: 1,
    userAddress: dummyUser,
    redemptionId: 0,
    userTokenAccount: dummyUserToken,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  assert.equal(ix.accounts.length, 19);
  assert.equal(ix.accounts[0].address, dummyUser);
  assert.equal(ix.accounts[0].role, 3); // AccountRole.WRITABLE_SIGNER
});

test("bonds-instruction-factory: builds reinvest winnings instruction for self", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const dummyRegistry = address("11111111111111111111111111111111");

  const ix = await buildReinvestWinningsInstruction({
    poolId: 1,
    userAddress: dummyUser,
    cycleId: 1,
    winnerIndex: 0,
    ticketRegistry: dummyRegistry,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  assert.equal(ix.accounts.length, 9);
  assert.equal(ix.accounts[0].address, dummyUser);
  assert.equal(ix.accounts[0].role, 3); // AccountRole.WRITABLE_SIGNER
});

test("bonds-instruction-factory: builds reinvest winnings instruction for third-party crank", async () => {
  const dummyCrank = address("11111111111111111111111111111111");
  const dummyWinner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const dummyRegistry = address("11111111111111111111111111111111");

  const ix = await buildReinvestWinningsInstruction({
    poolId: 1,
    userAddress: dummyCrank,
    winnerAddress: dummyWinner,
    cycleId: 1,
    winnerIndex: 2,
    ticketRegistry: dummyRegistry,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  assert.equal(ix.accounts.length, 9);
  assert.equal(ix.accounts[0].address, dummyCrank);
  assert.equal(ix.accounts[0].role, 3); // AccountRole.WRITABLE_SIGNER
});

test("bonds-instruction-factory: builds claim non-reinvested winnings instruction", async () => {
  const dummyUser = address("11111111111111111111111111111111");

  const ix = await buildClaimNonReinvestedWinningsInstruction({
    poolId: 1,
    userAddress: dummyUser,
    amount: 0,
    nextRedemptionId: 5,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  assert.equal(ix.accounts.length, 20);
  assert.equal(ix.accounts[0].address, dummyUser);
  assert.equal(ix.accounts[0].role, 3); // AccountRole.WRITABLE_SIGNER
});

test("bonds-instruction-factory: builds sell bonds instruction with positional remaining accounts on full exit", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const { AccountRole, getBase64Decoder } = await import("@solana/kit");
  const { getPrizePoolEncoder } =
    await import("../generated/yield-bonds/src/generated/accounts");
  const { serializeTicketRegistry } =
    await import("../ticket-registry-helpers");
  const base64Decoder = getBase64Decoder();

  const mockRegistryAddress = address(
    "SysvarRent111111111111111111111111111111111"
  );
  const lastUserOwner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  const mockPoolBytes = getPrizePoolEncoder().encode({
    poolId: 1,
    bondPrice: 5_000_000n,
    stakeCycleDurationHrs: 168n,
    minYieldThreshold: 0n,
    totalDepositedPrincipal: 100_000_000n,
    currentCycleEndAt: 0n,
    nextRedemptionId: 1n,
    totalFeesAccrued: 0n,
    totalFeesWithdrawn: 0n,
    totalPrizesAllocated: 0n,
    totalPendingRedemptions: 0n,
    currentDrawCycleId: 1,
    feeBasisPoints: 500,
    maxYieldBasisPoints: 1000,
    payoutTimelockSeconds: 300,
    vaultAuthorityBump: 255,
    status: 1, // Active
    isFrozenForDraw: 0,
    version: 1,
    prizeTiersCount: 1,
    padding: new Uint8Array(3),
    tokenMint: dummyUser,
    ticketRegistry: mockRegistryAddress,
    feeWallet: dummyUser,
    humaPoolState: dummyUser,
    prizeTiers: [
      { basisPoints: 10000, numWinners: 1, padding: new Uint8Array(2) },
      ...Array.from({ length: 9 }, () => ({
        basisPoints: 0,
        numWinners: 0,
        padding: new Uint8Array(2),
      })),
    ],
    reserved: new Uint8Array(128),
  });

  const mockRegistryBytes = serializeTicketRegistry({
    poolId: 1,
    userCount: 2,
    entries: [
      {
        owner: dummyUser,
        active: 10,
        pending: 0,
        mergedThroughCycle: 1,
        cumulativeActive: 10,
      },
      {
        owner: lastUserOwner,
        active: 20,
        pending: 0,
        mergedThroughCycle: 1,
        cumulativeActive: 30,
      },
    ],
  });

  const mockRpc = {
    getAccountInfo: (
      _address: unknown,
      config?: { dataSlice?: { offset: number; length: number } }
    ) => ({
      send: async () => {
        if (config?.dataSlice) {
          const slice = mockRegistryBytes.subarray(
            config.dataSlice.offset,
            config.dataSlice.offset + config.dataSlice.length
          );
          return {
            value: { data: [base64Decoder.decode(slice), "base64"] },
          };
        }
        return {
          value: { data: [base64Decoder.decode(mockPoolBytes), "base64"] },
        };
      },
    }),
  } as unknown as Parameters<typeof buildSellBondsInstruction>[0]["rpc"];

  const { buildSellBondsInstruction } =
    await import("../bonds-instruction-factory");
  const ix = await buildSellBondsInstruction({
    rpc: mockRpc,
    poolId: 1,
    userAddress: dummyUser,
    activeToSell: 10,
    pendingToSell: 0,
    userRegistryIndex: 0,
    currentUserTotalTickets: 10,
  });

  assert.ok(ix);
  assert.ok(ix.accounts);
  // Base accounts (22) + 1 remaining account = 23
  assert.equal(ix.accounts.length, 23);
  assert.equal(ix.accounts[0].address, dummyUser);
  assert.equal(ix.accounts[0].role, AccountRole.WRITABLE_SIGNER);
  const remainingAccount = ix.accounts[ix.accounts.length - 1];
  assert.equal(remainingAccount.role, AccountRole.WRITABLE);
});
