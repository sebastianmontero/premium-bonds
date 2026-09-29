import test from "node:test";
import assert from "node:assert/strict";
import { address, AccountRole, Address } from "@solana/kit";
import {
  buildBuyBondsInstruction,
  buildClaimRedemptionInstruction,
  buildClaimRedemptionInstructions,
  buildReinvestWinningsInstruction,
  buildClaimNonReinvestedWinningsInstruction,
  buildSellBondsInstruction,
} from "../bonds-instruction-factory";
import {
  findAtaAddress,
  findPrizePoolPda,
  findPoolPstVaultPda,
  findHumaPoolAuthorityPda,
  createAssociatedTokenIdempotentInstruction,
  buildWithdrawFeesInstruction,
  HumaConfigurationError,
  requireHumaAddresses,
  resolveHumaAddresses,
  RedemptionType,
  TOKEN_PROGRAM_ID,
  ATA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  USDC_MINT,
} from "../bonds-sdk";
import {
  buildMockPrizePoolEncoded,
  buildMockTicketRegistryEncoded,
  MockRpcBuilder,
  TEST_ADDRESSES,
  createMockHumaAddresses,
  MOCK_HUMA_ADDRESSES,
} from "../test-harness";

const BUY_BONDS_HUMA_POOL_STATE_INDEX = 11;
const BUY_BONDS_HUMA_POOL_AUTHORITY_INDEX = 14;
const BUY_BONDS_HUMA_POOL_UNDERLYING_INDEX = 15;

test("bonds-instruction-factory: builds buy bonds instruction with auto-derived userTokenAccount", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");
  const mockHuma = createMockHumaAddresses();
  const expectedUserAta = await findAtaAddress(
    user,
    USDC_MINT,
    TOKEN_PROGRAM_ID
  );

  const ix = await buildBuyBondsInstruction({
    poolId: 1,
    userAddress: user,
    ticketsToBuy: 5,
    ticketRegistry: mockRegistry,
    humaAddresses: mockHuma,
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
    user,
    "Payer must be the first account in instruction"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "Payer account must be a writable signer"
  );
  // userTokenAccount is at index 4
  assert.equal(
    ix.accounts[4].address,
    expectedUserAta,
    "userTokenAccount should be auto-derived when omitted"
  );
  assert.ok(
    ix.data && ix.data.length > 8,
    "Instruction data must contain 8-byte discriminator plus encoded parameters"
  );
});

test("bonds-instruction-factory: derives humaPoolAuthority dynamically from custom humaAddresses.poolState", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");
  const customHumaPoolState = address(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
  const mockHuma = createMockHumaAddresses({ poolState: customHumaPoolState });
  const expectedHumaAuthority = await findHumaPoolAuthorityPda(
    customHumaPoolState,
    mockHuma.program
  );

  const ix = await buildBuyBondsInstruction({
    poolId: 1,
    userAddress: user,
    ticketsToBuy: 1,
    ticketRegistry: mockRegistry,
    humaAddresses: mockHuma,
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

test("bonds-instruction-factory: auto-derives both poolUnderlyingToken and poolModeToken via ATA derivations", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");
  const mockHuma = createMockHumaAddresses();
  // Clear poolUnderlyingToken to test auto-derivation
  const humaWithoutUnderlying = { ...mockHuma, poolUnderlyingToken: undefined };

  const authority = await findHumaPoolAuthorityPda(
    mockHuma.poolState!,
    mockHuma.program
  );
  const expectedUnderlyingAta = await findAtaAddress(
    authority,
    USDC_MINT,
    TOKEN_PROGRAM_ID
  );

  const ix = await buildBuyBondsInstruction({
    poolId: 1,
    userAddress: user,
    ticketsToBuy: 1,
    ticketRegistry: mockRegistry,
    humaAddresses: humaWithoutUnderlying,
  });

  assert.equal(
    ix.accounts?.[BUY_BONDS_HUMA_POOL_UNDERLYING_INDEX].address,
    expectedUnderlyingAta,
    "poolUnderlyingToken must be auto-derived as ATA of humaPoolAuthority when omitted"
  );
});

test("bonds-instruction-factory: buildWithdrawFeesInstruction eliminates Anchor 2040 collision", async () => {
  const admin = TEST_ADDRESSES.ADMIN;
  const feeWallet = TEST_ADDRESSES.USER;
  const mockHuma = createMockHumaAddresses();
  const mockHumaWithoutPoolModeToken = {
    ...mockHuma,
    poolModeToken: undefined,
  };

  const poolPstVault = await findPoolPstVaultPda(1);
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    mockHuma.poolState!,
    mockHuma.program
  );
  const expectedHumaPoolModeToken = await findAtaAddress(
    humaPoolAuthority,
    mockHuma.modeMint!,
    TOKEN_PROGRAM_ID
  );

  const ix = await buildWithdrawFeesInstruction({
    admin: { address: admin } as unknown as Parameters<
      typeof buildWithdrawFeesInstruction
    >[0]["admin"],
    poolId: 1,
    amount: 1000n,
    tokenMint: USDC_MINT,
    feeWallet,
    nextRedemptionId: 1n,
    humaAddresses: mockHumaWithoutPoolModeToken,
  });

  assert.ok(ix, "WithdrawFees instruction must be created");
  assert.ok(ix.accounts, "Instruction accounts must be defined");

  // Verify poolPstVault and humaPoolModeToken are distinct
  assert.notEqual(
    poolPstVault,
    expectedHumaPoolModeToken,
    "poolPstVault and humaPoolModeToken must not collide"
  );

  // Find account occurrences
  const poolPstVaultAccounts = ix.accounts.filter(
    (a) => a.address === poolPstVault
  );
  const humaPoolModeTokenAccounts = ix.accounts.filter(
    (a) => a.address === expectedHumaPoolModeToken
  );

  assert.equal(
    poolPstVaultAccounts.length,
    1,
    "poolPstVault must appear exactly once in instruction accounts"
  );
  assert.equal(
    humaPoolModeTokenAccounts.length,
    1,
    "humaPoolModeToken must appear exactly once in instruction accounts"
  );
});

test("bonds-instruction-factory: omitting required keys throws HumaConfigurationError", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");

  // BuyBonds without poolState
  await assert.rejects(
    async () => {
      await buildBuyBondsInstruction({
        poolId: 1,
        userAddress: user,
        ticketsToBuy: 1,
        ticketRegistry: mockRegistry,
        humaAddresses: { config: MOCK_HUMA_ADDRESSES.config },
      });
    },
    (err: unknown) => {
      assert.ok(
        err instanceof HumaConfigurationError,
        "Should throw HumaConfigurationError"
      );
      assert.equal(err.code, "CONFIG_MISSING_HUMA_ADDRESSES");
      assert.ok(err.missingKeys.includes("poolState"));
      return true;
    }
  );

  // ClaimRedemption without lenderState
  await assert.rejects(
    async () => {
      await buildClaimRedemptionInstruction({
        poolId: 1,
        userAddress: user,
        redemptionId: 0,
        humaAddresses: { poolState: MOCK_HUMA_ADDRESSES.poolState },
      });
    },
    (err: unknown) => {
      assert.ok(
        err instanceof HumaConfigurationError,
        "Should throw HumaConfigurationError"
      );
      assert.equal(err.code, "CONFIG_MISSING_HUMA_ADDRESSES");
      assert.ok(err.missingKeys.includes("lenderState"));
      return true;
    }
  );
});

test("bonds-sdk: requireHumaAddresses rejects dummy sentinel addresses", () => {
  const dummySentinel = "11111111111111111111111111111111";

  assert.throws(
    () => {
      const resolved = resolveHumaAddresses({
        poolState: dummySentinel as unknown as Address,
      });
      requireHumaAddresses(resolved, ["poolState"], "TestOp");
    },
    (err: unknown) => {
      assert.ok(err instanceof HumaConfigurationError);
      assert.ok(err.missingKeys.includes("poolState"));
      return true;
    }
  );
});

test("bonds-instruction-factory: builds claim redemption instruction", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockHuma = createMockHumaAddresses();

  const ix = await buildClaimRedemptionInstruction({
    poolId: 1,
    userAddress: user,
    redemptionId: 0,
    humaAddresses: mockHuma,
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
    user,
    "User must be first account in claim redemption instruction"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User must be writable signer for claim redemption"
  );
});

test("bonds-instruction-factory: builds reinvest winnings instruction for self", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");

  const ix = await buildReinvestWinningsInstruction({
    poolId: 1,
    userAddress: user,
    cycleId: 1,
    winnerIndex: 0,
    ticketRegistry: mockRegistry,
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
    user,
    "User address must be payer signer"
  );
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User account must be a writable signer"
  );
});

test("bonds-instruction-factory: builds reinvest winnings instruction for third-party crank", async () => {
  const dummyCrank = TEST_ADDRESSES.USER;
  const dummyWinner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const mockRegistry = address("SysvarRent111111111111111111111111111111111");

  const ix = await buildReinvestWinningsInstruction({
    poolId: 1,
    userAddress: dummyCrank,
    winnerAddress: dummyWinner,
    cycleId: 1,
    winnerIndex: 2,
    ticketRegistry: mockRegistry,
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
  const user = TEST_ADDRESSES.USER;
  const mockHuma = createMockHumaAddresses();

  const ix = await buildClaimNonReinvestedWinningsInstruction({
    poolId: 1,
    userAddress: user,
    amount: 0,
    nextRedemptionId: 5,
    humaAddresses: mockHuma,
  });

  assert.ok(ix, "Claim non-reinvested winnings instruction must be created");
  assert.ok(ix.accounts, "Accounts array must be defined");
  assert.equal(
    ix.accounts.length,
    20,
    "Claim non-reinvested winnings instruction must contain 20 accounts"
  );
  assert.equal(ix.accounts[0].address, user, "User must be first account");
  assert.equal(
    ix.accounts[0].role,
    AccountRole.WRITABLE_SIGNER,
    "User must be writable signer"
  );
});

test("bonds-instruction-factory: builds sell bonds instruction with positional remaining accounts on full exit", async () => {
  const user = TEST_ADDRESSES.USER;
  const mockRegistryAddress = address(
    "SysvarRent111111111111111111111111111111111"
  );
  const lastUserOwner = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const poolPda = await findPrizePoolPda(1);
  const mockHuma = createMockHumaAddresses();

  const mockPoolBytes = buildMockPrizePoolEncoded({
    poolId: 1,
    bondPrice: 5_000_000n,
    stakeCycleDurationHrs: 168n,
    totalDepositedPrincipal: 100_000_000n,
    tokenMint: user,
    ticketRegistry: mockRegistryAddress,
    feeWallet: user,
    humaPoolState: mockHuma.poolState,
  });

  const mockRegistryBytes = buildMockTicketRegistryEncoded({
    poolId: 1,
    userCount: 2,
    entries: [
      {
        owner: user,
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
    userAddress: user,
    activeToSell: 10,
    pendingToSell: 0,
    userRegistryIndex: 0,
    currentUserTotalTickets: 10,
    humaAddresses: mockHuma,
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
    user,
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

test("bonds-sdk: createAssociatedTokenIdempotentInstruction generates correct layout", () => {
  const payer = TEST_ADDRESSES.USER;
  const owner = TEST_ADDRESSES.USER_2;
  const mint = TEST_ADDRESSES.MINT;
  const ata = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  const ix = createAssociatedTokenIdempotentInstruction({
    payer,
    owner,
    mint,
    ata,
  });

  assert.equal(ix.programAddress, ATA_PROGRAM_ID);
  assert.deepEqual(Array.from(ix.data || []), [1]);
  assert.equal(ix.accounts?.length, 6);
  assert.equal(ix.accounts[0].address, payer);
  assert.equal(ix.accounts[0].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(ix.accounts[1].address, ata);
  assert.equal(ix.accounts[1].role, AccountRole.WRITABLE);
  assert.equal(ix.accounts[2].address, owner);
  assert.equal(ix.accounts[2].role, AccountRole.READONLY);
  assert.equal(ix.accounts[3].address, mint);
  assert.equal(ix.accounts[3].role, AccountRole.READONLY);
  assert.equal(ix.accounts[4].address, SYSTEM_PROGRAM_ID);
  assert.equal(ix.accounts[4].role, AccountRole.READONLY);
  assert.equal(ix.accounts[5].address, TOKEN_PROGRAM_ID);
  assert.equal(ix.accounts[5].role, AccountRole.READONLY);
});

test("bonds-sdk: findAtaAddress supports standard SPL and custom token programs", async () => {
  const owner = TEST_ADDRESSES.USER;
  const mint = TEST_ADDRESSES.MINT;
  const token2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

  const defaultAta = await findAtaAddress(owner, mint);
  const splAta = await findAtaAddress(owner, mint, TOKEN_PROGRAM_ID);
  const token2022Ata = await findAtaAddress(owner, mint, token2022);

  assert.equal(
    defaultAta,
    splAta,
    "Default tokenProgram must match TOKEN_PROGRAM_ID"
  );
  assert.notEqual(
    splAta,
    token2022Ata,
    "Token-2022 ATA must have distinct derived address"
  );
});

test("bonds-instruction-factory: buildClaimRedemptionInstructions routes FeeWithdrawal to feeWallet with 1 instruction", async () => {
  const crank = TEST_ADDRESSES.USER;
  const feeWallet = TEST_ADDRESSES.ADMIN;
  const mockHuma = createMockHumaAddresses();

  const ixs = await buildClaimRedemptionInstructions({
    poolId: 1,
    caller: crank,
    beneficiary: crank,
    redemptionId: 4,
    redemptionType: RedemptionType.FeeWithdrawal,
    feeWallet,
    humaAddresses: mockHuma,
  });

  assert.equal(
    ixs.length,
    1,
    "FeeWithdrawal should produce exactly 1 instruction (claim only)"
  );
  const claimIx = ixs[0];
  assert.equal(claimIx.accounts?.length, 19);
  // beneficiaryTokenAccount is at account index 6
  assert.equal(
    claimIx.accounts?.[6].address,
    feeWallet,
    "Claim instruction must route destination to pool.feeWallet"
  );
});

test("bonds-instruction-factory: buildClaimRedemptionInstructions prepends idempotent ATA creation for user redemptions", async () => {
  const crank = TEST_ADDRESSES.USER;
  const user = TEST_ADDRESSES.USER_2;
  const mockHuma = createMockHumaAddresses();

  const ixs = await buildClaimRedemptionInstructions({
    poolId: 1,
    caller: crank,
    beneficiary: user,
    redemptionId: 1,
    redemptionType: RedemptionType.BondSale,
    humaAddresses: mockHuma,
  });

  assert.equal(
    ixs.length,
    2,
    "BondSale should produce 2 instructions (create ATA + claim)"
  );
  const [createAtaIx, claimIx] = ixs;

  assert.equal(createAtaIx.programAddress, ATA_PROGRAM_ID);
  assert.deepEqual(Array.from(createAtaIx.data || []), [1]);
  assert.equal(
    createAtaIx.accounts?.[0].address,
    crank,
    "Payer of ATA creation must be crank"
  );
  assert.equal(
    createAtaIx.accounts?.[2].address,
    user,
    "Owner of ATA must be beneficiary user"
  );

  const expectedAta = createAtaIx.accounts?.[1].address;
  assert.equal(
    claimIx.accounts?.[6].address,
    expectedAta,
    "Claim instruction must disburse funds into derived user ATA"
  );
});
