import {
  Address,
  type Instruction,
  type Rpc,
  type GetAccountInfoApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  getBuyBondsInstructionAsync,
  getSellBondsInstructionAsync,
  getClaimRedemptionInstructionAsync,
  getReinvestWinningsInstructionAsync,
  getClaimNonReinvestedWinningsInstructionAsync,
} from "./generated/yield-bonds/src/generated/instructions";
import {
  findPrizePoolPda,
  findUserWinningsPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findPendingRedemptionPda,
  findHumaPoolAuthorityPda,
  fetchTicketRegistryHeaderSlice,
  fetchUserRegistryEntrySlice,
  parsePrizePool,
  decodeAccountBase64Data,
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  HUMA_CONFIG,
  HUMA_POOL_CONFIG,
  HUMA_POOL_STATE,
  HUMA_MODE_CONFIG,
  HUMA_MODE_MINT,
  HUMA_POOL_UNDERLYING_TOKEN,
  HUMA_POOL_MODE_TOKEN,
  HUMA_REDEMPTION_REQUEST,
  HUMA_LENDER_STATE,
} from "./bonds-sdk";
import {
  parseRegistryHeaderFromSlice,
  parseUserEntryFromSlice,
} from "./ticket-registry-helpers";
import type { PoolId } from "./query-keys";

export async function buildBuyBondsInstruction(params: {
  poolId: PoolId;
  userAddress: Address;
  ticketsToBuy: number;
  ticketRegistry: Address;
  userTokenAccount: Address;
}): Promise<Instruction> {
  const pool = await findPrizePoolPda(params.poolId);
  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const poolVaultAccount = await findPoolVaultPda(params.poolId);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);

  return getBuyBondsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    userWinnings,
    pool,
    ticketRegistry: params.ticketRegistry,
    userTokenAccount: params.userTokenAccount,
    tokenMint: USDC_MINT,
    poolVaultAccount,
    poolPstVault,
    humaConfig: HUMA_CONFIG,
    humaPoolConfig: HUMA_POOL_CONFIG,
    humaPoolState: HUMA_POOL_STATE,
    humaModeConfig: HUMA_MODE_CONFIG,
    humaModeMint: HUMA_MODE_MINT,
    humaPoolAuthority,
    humaPoolUnderlyingToken: HUMA_POOL_UNDERLYING_TOKEN,
    pstTokenProgram: TOKEN_PROGRAM_ID,
    ticketsToBuy: params.ticketsToBuy,
  });
}

export async function buildSellBondsInstruction(params: {
  rpc: Rpc<GetAccountInfoApi>;
  poolId: PoolId;
  userAddress: Address;
  activeToSell: number;
  pendingToSell: number;
  userRegistryIndex: number;
  currentUserTotalTickets: number;
}): Promise<Instruction> {
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
        role: 1 /* writable */,
      });
    }
  }

  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(poolInfo.nextRedemptionId)
  );
  const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);

  const ix = await getSellBondsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    userWinnings,
    pool: poolPda,
    ticketRegistry: ticketRegistryAddress,
    tokenMint: USDC_MINT,
    poolPstVault,
    pendingRedemption,
    humaConfig: HUMA_CONFIG,
    humaPoolConfig: HUMA_POOL_CONFIG,
    humaPoolState: HUMA_POOL_STATE,
    humaModeConfig: HUMA_MODE_CONFIG,
    humaModeMint: HUMA_MODE_MINT,
    humaRedemptionRequest: HUMA_REDEMPTION_REQUEST,
    humaLenderState: HUMA_LENDER_STATE,
    humaPoolAuthority,
    humaPoolModeToken: HUMA_POOL_MODE_TOKEN,
    pstTokenProgram: TOKEN_PROGRAM_ID,
    activeToSell: params.activeToSell,
    pendingToSell: params.pendingToSell,
  });

  return {
    ...ix,
    accounts: [...(ix.accounts || []), ...remainingAccounts],
  };
}

export async function buildClaimRedemptionInstruction(params: {
  poolId: PoolId;
  userAddress: Address;
  redemptionId: number | bigint;
  userTokenAccount: Address;
}): Promise<Instruction> {
  const pool = await findPrizePoolPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(params.redemptionId)
  );
  const poolVaultAccount = await findPoolVaultPda(params.poolId);
  const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);

  return getClaimRedemptionInstructionAsync({
    caller: params.userAddress as unknown as TransactionSigner,
    beneficiary: params.userAddress,
    pool,
    pendingRedemption,
    tokenMint: USDC_MINT,
    poolVaultAccount,
    beneficiaryTokenAccount: params.userTokenAccount,
    humaConfig: HUMA_CONFIG,
    humaPoolConfig: HUMA_POOL_CONFIG,
    humaPoolState: HUMA_POOL_STATE,
    humaModeConfig: HUMA_MODE_CONFIG,
    humaLenderState: HUMA_LENDER_STATE,
    humaPoolAuthority,
    humaPoolUnderlyingToken: HUMA_POOL_UNDERLYING_TOKEN,
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
  const payoutRegistry = await import("./bonds-sdk").then((m) =>
    m.findPayoutRegistryPda(params.poolId, params.cycleId)
  );
  const userWinnings = await findUserWinningsPda(params.poolId, winner);

  return getReinvestWinningsInstructionAsync({
    crank: params.userAddress as unknown as TransactionSigner,
    winner,
    payoutRegistry,
    pool,
    userWinnings,
    ticketRegistry: params.ticketRegistry,
    cycleId: params.cycleId,
    winnerIndex: params.winnerIndex,
  });
}

export async function buildClaimNonReinvestedWinningsInstruction(params: {
  poolId: PoolId;
  userAddress: Address;
  amount: bigint | number;
  nextRedemptionId: number | bigint;
}): Promise<Instruction> {
  const pool = await findPrizePoolPda(params.poolId);
  const userWinnings = await findUserWinningsPda(
    params.poolId,
    params.userAddress
  );
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(params.nextRedemptionId)
  );
  const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);

  return getClaimNonReinvestedWinningsInstructionAsync({
    user: params.userAddress as unknown as TransactionSigner,
    pool,
    userWinnings,
    poolPstVault,
    pendingRedemption,
    humaConfig: HUMA_CONFIG,
    humaPoolConfig: HUMA_POOL_CONFIG,
    humaPoolState: HUMA_POOL_STATE,
    humaModeConfig: HUMA_MODE_CONFIG,
    humaModeMint: HUMA_MODE_MINT,
    humaRedemptionRequest: HUMA_REDEMPTION_REQUEST,
    humaLenderState: HUMA_LENDER_STATE,
    humaPoolAuthority,
    humaPoolModeToken: HUMA_POOL_MODE_TOKEN,
    pstTokenProgram: TOKEN_PROGRAM_ID,
  });
}
