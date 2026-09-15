import test from "node:test";
import assert from "node:assert/strict";
import { address, AccountRole } from "@solana/kit";
import {
  buildBuyBondsInstruction,
  buildClaimRedemptionInstruction,
  buildReinvestWinningsInstruction,
  buildClaimNonReinvestedWinningsInstruction,
  buildSellBondsInstruction,
} from "../bonds-instruction-factory";
import {
  buildMockPrizePoolEncoded,
  buildMockTicketRegistryEncoded,
  MockRpcBuilder,
} from "../test-harness";

const BUY_BONDS_HUMA_POOL_STATE_INDEX = 11;
const BUY_BONDS_HUMA_POOL_AUTHORITY_INDEX = 14;

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

  assert.ok(ix, "Instruction must be successfully created");
  assert.ok(ix.accounts, "Instruction must contain accounts array");
  assert.equal(
    ix.accounts.length,
    21,
    "Buy bonds instruction must contain exactly 21 accounts"
  );
  assert.equal(
    ix.accounts[0].address,
    dummyUser,
    "Payer must be the first account in instruction"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "Payer account must be a writable signer"
  );
  assert.ok(
    ix.data && ix.data.length > 8,
    "Instruction data must contain 8-byte discriminator plus encoded parameters"
  );
});

test("bonds-instruction-factory: derives humaPoolAuthority dynamically from custom humaPoolState", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const dummyRegistry = address("11111111111111111111111111111111");
  const customHumaPoolState = address(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
  const { findHumaPoolAuthorityPda } = await import("../bonds-sdk");
  const expectedHumaAuthority =
    await findHumaPoolAuthorityPda(customHumaPoolState);

  const ix = await buildBuyBondsInstruction({
    poolId: 1,
    userAddress: dummyUser,
    ticketsToBuy: 1,
    ticketRegistry: dummyRegistry,
    userTokenAccount: dummyUser,
    humaPoolState: customHumaPoolState,
  });

  assert.ok(ix, "Instruction must be created");
  assert.ok(ix.accounts, "Instruction accounts must be defined");
  assert.equal(
    ix.accounts[BUY_BONDS_HUMA_POOL_STATE_INDEX].address,
    customHumaPoolState,
    "Huma pool state account must match custom override"
  );
  assert.equal(
    ix.accounts[BUY_BONDS_HUMA_POOL_AUTHORITY_INDEX].address,
    expectedHumaAuthority,
    "Huma pool authority account must be derived from custom huma pool state"
  );
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

  assert.ok(ix, "Claim redemption instruction must be created");
  assert.ok(ix.accounts, "Claim redemption accounts must be defined");
  assert.equal(
    ix.accounts.length,
    19,
    "Claim redemption instruction must contain 19 accounts"
  );
  assert.equal(
    ix.accounts[0].address,
    dummyUser,
    "User must be first account in claim redemption instruction"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User must be writable signer for claim redemption"
  );
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

  assert.ok(ix, "Reinvest winnings instruction must be created");
  assert.ok(ix.accounts, "Instruction accounts must be defined");
  assert.equal(
    ix.accounts.length,
    9,
    "Reinvest winnings instruction must contain 9 accounts"
  );
  assert.equal(
    ix.accounts[0].address,
    dummyUser,
    "User address must be payer signer"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User account must be a writable signer"
  );
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

  assert.ok(ix, "Reinvest winnings instruction for crank must be created");
  assert.ok(ix.accounts, "Accounts array must be defined");
  assert.equal(ix.accounts.length, 9, "Instruction must contain 9 accounts");
  assert.equal(
    ix.accounts[0].address,
    dummyCrank,
    "Crank address must be payer signer"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "Crank account must be a writable signer"
  );
});

test("bonds-instruction-factory: builds claim non-reinvested winnings instruction", async () => {
  const dummyUser = address("11111111111111111111111111111111");

  const ix = await buildClaimNonReinvestedWinningsInstruction({
    poolId: 1,
    userAddress: dummyUser,
    amount: 0,
    nextRedemptionId: 5,
  });

  assert.ok(ix, "Claim non-reinvested winnings instruction must be created");
  assert.ok(ix.accounts, "Accounts array must be defined");
  assert.equal(
    ix.accounts.length,
    20,
    "Claim non-reinvested winnings instruction must contain 20 accounts"
  );
  assert.equal(ix.accounts[0].address, dummyUser, "User must be first account");
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User must be writable signer"
  );
});

test("bonds-instruction-factory: builds sell bonds instruction with positional remaining accounts on full exit", async () => {
  const dummyUser = address("11111111111111111111111111111111");
  const mockRegistryAddress = address(
    "SysvarRent111111111111111111111111111111111"
  );
  const lastUserOwner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const { findPrizePoolPda } = await import("../bonds-sdk");
  const poolPda = await findPrizePoolPda(1);

  const mockPoolBytes = buildMockPrizePoolEncoded({
    poolId: 1,
    bondPrice: 5_000_000n,
    stakeCycleDurationHrs: 168n,
    totalDepositedPrincipal: 100_000_000n,
    tokenMint: dummyUser,
    ticketRegistry: mockRegistryAddress,
    feeWallet: dummyUser,
    humaPoolState: dummyUser,
  });

  const mockRegistryBytes = buildMockTicketRegistryEncoded({
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

  const mockRpc = new MockRpcBuilder()
    .withAccount(mockRegistryAddress, mockRegistryBytes)
    .withAccount(poolPda, mockPoolBytes)
    .build();

  const ix = await buildSellBondsInstruction({
    rpc: mockRpc as unknown as Parameters<
      typeof buildSellBondsInstruction
    >[0]["rpc"],
    poolId: 1,
    userAddress: dummyUser,
    activeToSell: 10,
    pendingToSell: 0,
    userRegistryIndex: 0,
    currentUserTotalTickets: 10,
  });

  assert.ok(ix, "Sell bonds instruction must be created");
  assert.ok(ix.accounts, "Accounts array must be defined");
  // Base accounts (22) + 1 remaining account = 23
  assert.equal(
    ix.accounts.length,
    23,
    "Full exit sell bonds instruction must include the last registry user as remaining account"
  );
  assert.equal(
    ix.accounts[0].address,
    dummyUser,
    "Seller user must be the first account in sell instruction"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "Seller user must be a writable signer"
  );
  const remainingAccount = ix.accounts[ix.accounts.length - 1];
  assert.equal(
    remainingAccount.role,
    AccountRole.WRITABLE,
    "Remaining account for last registry user swap must be writable"
  );
});
