import {
  Address,
  AccountRole,
  type Instruction,
  type Rpc,
  type GetAccountInfoApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  getBuyBondsInstructionAsync,
  getSellBondsInstructionAsync,
  getReinvestWinningsInstructionAsync,
  getClaimNonReinvestedWinningsInstructionAsync,
} from "./generated/yield-bonds/src/generated/instructions";
import {
  findPrizePoolPda,
  findPayoutRegistryPda,
  findUserWinningsPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findRedemptionBatchPda,
  findPendingRedemptionPda,
  findHumaPoolAuthorityPda,
  findAtaAddress,
  fetchTicketRegistryHeaderSlice,
  fetchUserRegistryEntrySlice,
  parsePrizePool,
  decodeAccountBase64Data,
  elevateSignerRole,
  buildClaimRedemptionInstruction as sdkBuildClaimRedemptionInstruction,
  buildClaimRedemptionInstructions as sdkBuildClaimRedemptionInstructions,
  buildCrankSubmitRedemptionBatchInstruction,
  buildSettleRedemptionBatchInstruction,
  buildCrankCloseRedemptionBatchInstruction,
  buildCloseExpiredRedemptionInstruction,
  buildEnableImpairedModeInstruction,
  buildRecapitalizePoolInstruction,
  RedemptionType,
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  type HumaPoolAddresses,
  resolveHumaAddresses,
  requireHumaAddresses,
  resolveAndRequireHumaAddresses,
} from "./bonds-sdk";
import {
  parseRegistryHeaderFromSlice,
  parseUserEntryFromSlice,
} from "./ticket-registry-helpers";
import type { PoolId } from "./query-keys";

export {
  elevateSignerRole,
  RedemptionType,
  resolveHumaAddresses,
  requireHumaAddresses,
  resolveAndRequireHumaAddresses,
  buildCrankSubmitRedemptionBatchInstruction,
  buildSettleRedemptionBatchInstruction,
  buildCrankCloseRedemptionBatchInstruction,
  buildCloseExpiredRedemptionInstruction,
  buildEnableImpairedModeInstruction,
  buildRecapitalizePoolInstruction,
};

export const BUY_BONDS_REQUIRED_HUMA_KEYS = [
  "poolState",
  "config",
  "poolConfig",
  "modeConfig",
  "modeMint",
] as const;

export const SELL_BONDS_REQUIRED_HUMA_KEYS = [
  "poolState",
  "config",
  "poolConfig",
  "modeConfig",
  "modeMint",
  "redemptionRequest",
  "lenderState",
] as const;

export interface BuyBondsFactoryParams {
  poolId: PoolId;
  userAddress: Address;
  ticketsToBuy: number;
  ticketRegistry: Address;
  userTokenAccount?: Address;
  tokenMint?: Address;
  humaAddresses?: Partial<HumaPoolAddresses>;
}

export async function buildBuyBondsInstruction(
  params: BuyBondsFactoryParams
): Promise<Instruction> {
  const tokenMint = params.tokenMint ?? USDC_MINT;
  const userTokenAccount =
    params.userTokenAccount ??
    (await findAtaAddress(
      params.userAddress.toString(),
      tokenMint,
      TOKEN_PROGRAM_ID
    ));
  const huma = resolveAndRequireHumaAddresses(
    params.humaAddresses,
    BUY_BONDS_REQUIRED_HUMA_KEYS,
    "BuyBonds"
  );
  const pool = await findPrizePoolPda(params.poolId);
  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const poolVaultAccount = await findPoolVaultPda(params.poolId);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    huma.poolState,
    huma.program
  );
  const humaPoolUnderlyingToken =
    huma.poolUnderlyingToken ??
    (await findAtaAddress(humaPoolAuthority, tokenMint, TOKEN_PROGRAM_ID));

  const ix = await getBuyBondsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    userWinnings,
    pool,
    ticketRegistry: params.ticketRegistry,
    userTokenAccount,
    tokenMint,
    poolVaultAccount,
    poolPstVault,
    humaConfig: huma.config,
    humaPoolConfig: huma.poolConfig,
    humaPoolState: huma.poolState,
    humaModeConfig: huma.modeConfig,
    humaModeMint: huma.modeMint,
    humaPoolAuthority,
    humaPoolUnderlyingToken,
    pstTokenProgram: TOKEN_PROGRAM_ID,
    ticketsToBuy: params.ticketsToBuy,
  });

  return elevateSignerRole(ix, params.userAddress);
}

export interface SellBondsFactoryParams {
  rpc: Rpc<GetAccountInfoApi>;
  poolId: PoolId;
  userAddress: Address;
  activeToSell: number;
  pendingToSell: number;
  userRegistryIndex: number;
  currentUserTotalTickets: number;
  humaAddresses?: Partial<HumaPoolAddresses>;
}

export async function buildSellBondsInstruction(
  params: SellBondsFactoryParams
): Promise<Instruction> {
  const poolPda = await findPrizePoolPda(params.poolId);
  const poolAcc = await params.rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc.value?.data) throw new Error("PrizePool account not found");

  const poolBytes = decodeAccountBase64Data(poolAcc.value);
  const poolInfo = parsePrizePool(poolBytes!);
  const ticketRegistryAddress = poolInfo.ticketRegistry;

  const headerBytes = await fetchTicketRegistryHeaderSlice(
    params.rpc,
    ticketRegistryAddress
  );
  const header = parseRegistryHeaderFromSlice(headerBytes!);
  const lastEntryIdx = (header?.userCount ?? 1) - 1;

  const remainingAccounts: { address: Address; role: number }[] = [];

  // Swap-and-pop check: exit occurs if user sells ALL tickets
  const totalSelling = params.activeToSell + params.pendingToSell;
  const willExit = params.currentUserTotalTickets === totalSelling;
  if (
    willExit &&
    params.userRegistryIndex !== lastEntryIdx &&
    lastEntryIdx >= 0
  ) {
    const lastEntryBytes = await fetchUserRegistryEntrySlice(
      params.rpc,
      ticketRegistryAddress,
      lastEntryIdx
    );
    const lastEntry = parseUserEntryFromSlice(lastEntryBytes!);
    if (lastEntry) {
      const swappedUserWinningsPda = await findUserWinningsPda(
        params.poolId,
        lastEntry.owner
      );
      remainingAccounts.push({
        address: swappedUserWinningsPda,
        role: AccountRole.WRITABLE,
      });
    }
  }

  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const redemptionBatch = await findRedemptionBatchPda(
    params.poolId,
    poolInfo.accumulatingRedemptionBatchId
  );
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(poolInfo.nextRedemptionId)
  );

  const ix = await getSellBondsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    userWinnings,
    pool: poolPda,
    redemptionBatch,
    ticketRegistry: ticketRegistryAddress,
    pendingRedemption,
    activeToSell: params.activeToSell,
    pendingToSell: params.pendingToSell,
  });

  return elevateSignerRole(
    {
      ...ix,
      accounts: [...(ix.accounts || []), ...remainingAccounts],
    },
    params.userAddress
  );
}

export interface ClaimRedemptionFactoryParams {
  poolId: PoolId;
  caller?: Address;
  userAddress?: Address;
  beneficiary?: Address;
  redemptionId: number | bigint;
  batchId: number | bigint;
  beneficiaryTokenAccount?: Address;
  userTokenAccount?: Address;
  redemptionType?: RedemptionType;
  feeWallet?: Address;
  tokenProgram?: Address;
}

export async function buildClaimRedemptionInstruction(
  params: ClaimRedemptionFactoryParams
): Promise<Instruction> {
  const caller = params.caller ?? params.userAddress;
  if (!caller) throw new Error("Caller or userAddress is required");
  const beneficiary = params.beneficiary ?? params.userAddress ?? caller;
  const beneficiaryTokenAccount =
    params.beneficiaryTokenAccount ?? params.userTokenAccount;

  return sdkBuildClaimRedemptionInstruction({
    crank: caller,
    beneficiary,
    poolId: params.poolId,
    redemptionId: params.redemptionId,
    batchId: params.batchId,
    tokenMint: USDC_MINT,
    redemptionType: params.redemptionType,
    feeWallet: params.feeWallet,
    beneficiaryTokenAccount,
    tokenProgram: params.tokenProgram || TOKEN_PROGRAM_ID,
  });
}

export async function buildClaimRedemptionInstructions(
  params: ClaimRedemptionFactoryParams
): Promise<Instruction[]> {
  const caller = params.caller ?? params.userAddress;
  if (!caller) throw new Error("Caller or userAddress is required");
  const beneficiary = params.beneficiary ?? params.userAddress ?? caller;
  const beneficiaryTokenAccount =
    params.beneficiaryTokenAccount ?? params.userTokenAccount;

  return sdkBuildClaimRedemptionInstructions({
    crank: caller,
    beneficiary,
    poolId: params.poolId,
    redemptionId: params.redemptionId,
    batchId: params.batchId,
    tokenMint: USDC_MINT,
    redemptionType: params.redemptionType,
    feeWallet: params.feeWallet,
    beneficiaryTokenAccount,
    tokenProgram: params.tokenProgram || TOKEN_PROGRAM_ID,
  });
}

export async function buildReinvestWinningsInstruction(params: {
  poolId: PoolId;
  userAddress: Address;
  cycleId: number;
  winnerIndex: number;
  ticketRegistry: Address;
  winnerAddress?: Address;
}): Promise<Instruction> {
  const winner = params.winnerAddress ?? params.userAddress;
  const pool = await findPrizePoolPda(params.poolId);
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.cycleId
  );
  const userWinnings = await findUserWinningsPda(params.poolId, winner);

  const ix = await getReinvestWinningsInstructionAsync({
    crank: params.userAddress as unknown as TransactionSigner,
    winner,
    payoutRegistry,
    pool,
    userWinnings,
    ticketRegistry: params.ticketRegistry,
    cycleId: params.cycleId,
    winnerIndex: params.winnerIndex,
  });

  return elevateSignerRole(ix, params.userAddress);
}

export interface ClaimNonReinvestedWinningsFactoryParams {
  poolId: PoolId;
  userAddress: Address;
  amount: bigint | number;
  nextRedemptionId: number | bigint;
  accumulatingRedemptionBatchId: number | bigint;
}

export async function buildClaimNonReinvestedWinningsInstruction(
  params: ClaimNonReinvestedWinningsFactoryParams
): Promise<Instruction> {
  const pool = await findPrizePoolPda(params.poolId);
  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const redemptionBatch = await findRedemptionBatchPda(
    params.poolId,
    params.accumulatingRedemptionBatchId
  );
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(params.nextRedemptionId)
  );

  const ix = await getClaimNonReinvestedWinningsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    pool,
    userWinnings,
    redemptionBatch,
    pendingRedemption,
  });

  return elevateSignerRole(ix, params.userAddress);
}
