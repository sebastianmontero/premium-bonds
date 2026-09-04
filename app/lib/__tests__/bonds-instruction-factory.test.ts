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
});
