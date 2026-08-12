/**
 * Codama SDK Adapter for YieldBonds & MockHuma Programs.
 *
 * Account decoders, program addresses, and instruction builders are generated
 * by Codama from Anchor IDLs and exported here.
 */

import {
  address,
  Address,
  getProgramDerivedAddress,
  getBase58Encoder,
  lamports,
  TransactionSigner,
} from "@solana/kit";
import {
  ANCHOR_PROGRAM_ADDRESS,
  decodeGlobalConfig,
  decodePrizePool,
  decodeDrawCycle,
  decodePayoutRegistry,
  decodeUserWinnings,
  decodePendingRedemption,
} from "./generated/yield-bonds/src/generated";
import type {
  GlobalConfig,
  PrizePool,
  DrawCycle,
  PayoutRegistry,
  UserWinnings,
  PendingRedemption,
} from "./generated/yield-bonds/src/generated";

import { MOCK_HUMA_PROGRAM_ADDRESS } from "./generated/mock-huma/src/generated";

import { DrawStatus } from "./generated/yield-bonds/src/generated";

export {
  RedemptionType,
  DrawStatus,
} from "./generated/yield-bonds/src/generated";

export enum PoolStatus {
  Active = 0,
  Paused = 1,
  Closed = 2,
}

export type PoolStatusName = "Active" | "Paused" | "Closed";
export type DrawStatusName =
  | "AwaitingYield"
  | "AwaitingRandomness"
  | "Complete"
  | "ForceUnlocked"
  | "Skipped";

export {
  parseTicketRegistry,
  parseRegistryEntry,
} from "./ticket-registry-helpers";
export type { UserEntryInfo } from "./ticket-registry-helpers";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PROGRAM_ID = ANCHOR_PROGRAM_ADDRESS;
export const HUMA_PROGRAM_ID = MOCK_HUMA_PROGRAM_ADDRESS;
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ATA_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const USDC_MINT = address(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

const textEncoder = new TextEncoder();
const base58Encoder = getBase58Encoder();

export function encodeU32(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, val, true);
  return buf;
}

export function encodeU64(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(val), true);
  return buf;
}

// ─── PDA Derivations ─────────────────────────────────────────────────────────

export async function findGlobalConfigPda(): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("global_config")],
  });
  return addr;
}

export async function findPrizePoolPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("prize_pool"), encodeU32(poolId)],
  });
  return addr;
}

export async function findPoolVaultPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("pool_vault"), encodeU32(poolId)],
  });
  return addr;
}

export async function findPoolPstVaultPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("pool_pst"), encodeU32(poolId)],
  });
  return addr;
}

export async function findUserWinningsPda(
  poolId: number,
  user: string | Address
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("user_winnings"),
      encodeU32(poolId),
      base58Encoder.encode(address(user)),
    ],
  });
  return addr;
}

export async function findPendingRedemptionPda(
  poolId: number,
  redemptionId: bigint | number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("pending_redemption"),
      encodeU32(poolId),
      encodeU64(redemptionId),
    ],
  });
  return addr;
}

export async function findHumaPoolAuthorityPda(
  poolState: string
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: HUMA_PROGRAM_ID,
    seeds: [
      textEncoder.encode("pool_authority"),
      base58Encoder.encode(address(poolState)),
    ],
  });
  return addr;
}

export async function findPayoutRegistryPda(
  poolId: number,
  cycleId: number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("payout"),
      encodeU32(poolId),
      encodeU32(cycleId),
    ],
  });
  return addr;
}

export async function findDrawCyclePda(
  poolId: number,
  cycleId: number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("draw_cycle"),
      encodeU32(poolId),
      encodeU32(cycleId),
    ],
  });
  return addr;
}

export async function findEventAuthorityPda(): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("__event_authority")],
  });
  return addr;
}

export async function findAtaAddress(
  owner: string,
  mint: string
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM_ID,
    seeds: [
      base58Encoder.encode(address(owner)),
      base58Encoder.encode(TOKEN_PROGRAM_ID),
      base58Encoder.encode(address(mint)),
    ],
  });
  return addr;
}

// ─── Codama Account Decoders ─────────────────────────────────────────────────

function mockAccount(data: Uint8Array) {
  return {
    address: PROGRAM_ID,
    programAddress: PROGRAM_ID,
    executable: false,
    lamports: lamports(0n),
    space: BigInt(data.byteLength),
    exists: true,
    data,
  } as const;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodedData<T>(result: any): T {
  if (!result.exists) throw new Error("Account decode failed");
  return result.data as T;
}

export function parseGlobalConfig(data: Uint8Array): GlobalConfig {
  return decodedData<GlobalConfig>(decodeGlobalConfig(mockAccount(data)));
}

export function parsePrizePool(data: Uint8Array) {
  const decoded = decodedData<PrizePool>(decodePrizePool(mockAccount(data)));
  const statusName = PoolStatus[decoded.status] as PoolStatusName | undefined;
  if (!statusName) {
    throw new Error(
      `Invalid PoolStatus byte '${decoded.status}' decoded from PrizePool account data.`
    );
  }
  const prizeTiersCount = Number(decoded.prizeTiersCount);

  const prizeTiers = decoded.prizeTiers
    .slice(0, prizeTiersCount)
    .filter((tier) => tier.basisPoints > 0 && tier.numWinners > 0)
    .map((tier) => ({
      basisPoints: tier.basisPoints,
      numWinners: tier.numWinners,
    }));

  return {
    ...decoded,
    status: statusName,
    bondPrice: Number(decoded.bondPrice),
    stakeCycleDurationHrs: Number(decoded.stakeCycleDurationHrs),
    totalDepositedPrincipal: Number(decoded.totalDepositedPrincipal),
    currentCycleEndAt: Number(decoded.currentCycleEndAt),
    nextRedemptionId: Number(decoded.nextRedemptionId),
    isFrozenForDraw: Boolean(decoded.isFrozenForDraw),
    ticketRegistry: decoded.ticketRegistry,
    prizeTiersCount,
    prizeTiers,
  };
}

export function parseDrawCycle(data: Uint8Array) {
  const decoded = decodedData<DrawCycle>(decodeDrawCycle(mockAccount(data)));
  const statusName = DrawStatus[decoded.status] as DrawStatusName | undefined;
  if (!statusName) {
    throw new Error(
      `Invalid DrawStatus byte '${decoded.status}' decoded from DrawCycle account data.`
    );
  }
  return {
    ...decoded,
    status: statusName,
    randomnessSeed: new Uint8Array(decoded.randomnessSeed),
  };
}

export function parsePayoutRegistry(data: Uint8Array) {
  const decoded = decodedData<PayoutRegistry>(
    decodePayoutRegistry(mockAccount(data))
  );
  return {
    ...decoded,
    winnersCount: Number(decoded.winnersCount),
    payoutsCompleted: Number(decoded.payoutsCompleted),
  };
}

export function parseUserWinnings(data: Uint8Array): UserWinnings {
  return decodedData<UserWinnings>(decodeUserWinnings(mockAccount(data)));
}

export function parsePendingRedemption(data: Uint8Array): PendingRedemption {
  return decodedData<PendingRedemption>(
    decodePendingRedemption(mockAccount(data))
  );
}

// Re-export Codama generated types
export type UserWinningsInfo = ReturnType<typeof parseUserWinnings>;
export type PrizePoolInfo = ReturnType<typeof parsePrizePool>;
export type DrawCycleInfo = ReturnType<typeof parseDrawCycle>;
export type PayoutRegistryInfo = ReturnType<typeof parsePayoutRegistry>;
export type PendingRedemptionInfo = ReturnType<typeof parsePendingRedemption>;
export type GlobalConfigInfo = ReturnType<typeof parseGlobalConfig>;

// ─── Re-exported Encoders & Codama Instructions ────────────────────────────

import {
  getInitializeGlobalInstructionDataEncoder,
  getCreatePoolInstructionDataEncoder,
  getSetPrizeTiersInstructionDataEncoder,
  getInitializeGlobalInstructionAsync,
  getCreatePoolInstructionAsync,
  getSetPrizeTiersInstructionAsync,
  getHarvestYieldAndCommitInstructionAsync,
  getRevealAndPickWinnersInstructionAsync,
  getReinvestWinningsInstructionAsync,
  getPrepareDrawInstruction,
  getInitializeHumaLenderInstructionAsync,
  getResizeRegistryInstructionAsync,
  getUpdatePoolConfigInstructionAsync,
  getUpdateGlobalConfigInstructionAsync,
  getWithdrawFeesInstructionAsync,
  getAdminForceUnlockDrawInstructionAsync,
  getCrankRebindExpiredRandomnessInstructionAsync,
} from "./generated/yield-bonds/src/generated/instructions";

import {
  getSimulateYieldInstructionDataEncoder,
  getSettleRequestsInstructionDataEncoder,
  getInitializeMockPoolStateInstructionDataEncoder,
  getCreateLenderAccountsV2InstructionDataEncoder,
} from "./generated/mock-huma/src/generated/instructions";

export {
  getInitializeGlobalInstructionDataEncoder,
  getCreatePoolInstructionDataEncoder,
  getSetPrizeTiersInstructionDataEncoder,
  getInitializeGlobalInstructionAsync,
  getCreatePoolInstructionAsync,
  getSetPrizeTiersInstructionAsync,
  getHarvestYieldAndCommitInstructionAsync,
  getRevealAndPickWinnersInstructionAsync,
  getReinvestWinningsInstructionAsync,
  getPrepareDrawInstruction,
  getInitializeHumaLenderInstructionAsync,
  getResizeRegistryInstructionAsync,
  getUpdatePoolConfigInstructionAsync,
  getUpdateGlobalConfigInstructionAsync,
  getWithdrawFeesInstructionAsync,
  getAdminForceUnlockDrawInstructionAsync,
  getCrankRebindExpiredRandomnessInstructionAsync,
  getSimulateYieldInstructionDataEncoder,
  getSettleRequestsInstructionDataEncoder,
  getInitializeMockPoolStateInstructionDataEncoder,
  getCreateLenderAccountsV2InstructionDataEncoder,
};

// ─── High-Level SDK Instruction Builder Wrappers for CLI & Scripts ─────────

export async function buildInitializeGlobalInstruction(params: {
  admin: Address | TransactionSigner;
  jobsAccount?: Address;
}) {
  return getInitializeGlobalInstructionAsync({
    admin: params.admin as TransactionSigner,
    jobsAccount: params.jobsAccount ?? (params.admin as Address),
  });
}

export async function buildUpdateGlobalConfigInstruction(params: {
  admin: Address | TransactionSigner;
  newAdmin?: Address;
  newJobsAccount?: Address;
}) {
  return getUpdateGlobalConfigInstructionAsync({
    admin: params.admin as TransactionSigner,
    newAdmin: params.newAdmin ?? null,
    newJobsAccount: params.newJobsAccount ?? null,
  });
}

export async function buildCreatePoolInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  bondPrice: bigint | number;
  stakeCycleDurationHrs: bigint | number;
  feeBasisPoints: number;
  minYieldThreshold?: bigint | number;
  tokenMint: Address;
  pstMint: Address;
  ticketRegistry: Address;
  feeWallet: Address;
  pstTokenProgram?: Address;
}) {
  return getCreatePoolInstructionAsync({
    admin: params.admin as TransactionSigner,
    poolId: params.poolId,
    bondPrice: BigInt(params.bondPrice),
    stakeCycleDurationHrs: BigInt(params.stakeCycleDurationHrs),
    feeBasisPoints: params.feeBasisPoints,
    minYieldThreshold:
      params.minYieldThreshold !== undefined
        ? BigInt(params.minYieldThreshold)
        : 0n,
    tokenMint: params.tokenMint,
    pstMint: params.pstMint,
    ticketRegistry: params.ticketRegistry,
    feeWallet: params.feeWallet,
    pstTokenProgram: params.pstTokenProgram ?? TOKEN_PROGRAM_ID,
  });
}

export async function buildSetPrizeTiersInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  tiers: Array<{ numWinners: number; basisPoints: number }>;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getSetPrizeTiersInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    tiers: params.tiers.map((t) => ({
      numWinners: t.numWinners,
      basisPoints: t.basisPoints,
      padding: new Uint8Array(2),
    })),
  });
}

export async function buildUpdatePoolConfigInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  newFeeBasisPoints?: number;
  newBondPrice?: bigint | number;
  newFeeWallet?: Address;
  newMinYieldThreshold?: bigint | number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getUpdatePoolConfigInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    newFeeBasisPoints: params.newFeeBasisPoints ?? null,
    newBondPrice:
      params.newBondPrice !== undefined ? BigInt(params.newBondPrice) : null,
    newFeeWallet: params.newFeeWallet ?? null,
    newMinYieldThreshold:
      params.newMinYieldThreshold !== undefined
        ? BigInt(params.newMinYieldThreshold)
        : null,
  });
}

export async function buildPrepareDrawInstruction(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  currentDrawCycleId: number;
  ticketRegistry: Address;
  batchSize: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const drawCycle = await findDrawCyclePda(
    params.poolId,
    params.currentDrawCycleId
  );
  return getPrepareDrawInstruction({
    crank: params.crank as TransactionSigner,
    pool,
    drawCycle,
    ticketRegistry: params.ticketRegistry,
    batchSize: params.batchSize,
  });
}

export async function buildHarvestYieldAndCommitInstruction(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  ticketRegistry: Address;
  currentDrawCycleId: number;
  pstMint: Address;
  humaPoolState: Address;
  randomnessAccount: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const currentDrawCycle = await findDrawCyclePda(
    params.poolId,
    params.currentDrawCycleId
  );
  const poolPstVault = await findPoolPstVaultPda(params.poolId);

  return getHarvestYieldAndCommitInstructionAsync({
    crank: params.crank as TransactionSigner,
    pool,
    ticketRegistry: params.ticketRegistry,
    currentDrawCycle,
    poolPstVault,
    pstMint: params.pstMint,
    humaPoolState: params.humaPoolState,
    randomnessAccount: params.randomnessAccount,
    pstTokenProgram: TOKEN_PROGRAM_ID,
  });
}

export async function buildRevealAndPickWinnersInstruction(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  currentDrawCycleId: number;
  ticketRegistry: Address;
  randomnessAccount: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const currentDrawCycle = await findDrawCyclePda(
    params.poolId,
    params.currentDrawCycleId
  );
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.currentDrawCycleId
  );

  return getRevealAndPickWinnersInstructionAsync({
    crank: params.crank as TransactionSigner,
    pool,
    currentDrawCycle,
    payoutRegistry,
    ticketRegistry: params.ticketRegistry,
    randomnessAccount: params.randomnessAccount,
  });
}

export async function buildReinvestWinningsInstruction(params: {
  crank: Address | TransactionSigner;
  winner: Address;
  poolId: number;
  cycleId: number;
  winnerIndex: number;
  ticketRegistry: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.cycleId
  );
  const userWinnings = await findUserWinningsPda(params.poolId, params.winner);

  return getReinvestWinningsInstructionAsync({
    crank: params.crank as TransactionSigner,
    winner: params.winner,
    pool,
    payoutRegistry,
    userWinnings,
    ticketRegistry: params.ticketRegistry,
    cycleId: params.cycleId,
    winnerIndex: params.winnerIndex,
  });
}

export async function buildInitializeHumaLenderInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  humaStateAddresses: Record<string, string>;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);

  return getInitializeHumaLenderInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    poolPstVault,
    humaConfig: address(params.humaStateAddresses.humaConfig),
    humaPoolConfig: address(params.humaStateAddresses.humaPoolConfig),
    humaPoolState: address(params.humaStateAddresses.humaPoolState),
    humaModeConfig: address(params.humaStateAddresses.humaModeConfig),
    humaModeMint: address(params.humaStateAddresses.humaModeMint),
    humaLenderState: address(params.humaStateAddresses.humaLenderState),
    humaLenderModeToken: address(params.humaStateAddresses.humaLenderModeToken),
    pstTokenProgram: TOKEN_PROGRAM_ID,
  });
}

export async function buildResizeRegistryInstruction(params: {
  crank: Address | TransactionSigner;
  payer: Address | TransactionSigner;
  poolId: number;
  ticketRegistry: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getResizeRegistryInstructionAsync({
    crank: params.crank as TransactionSigner,
    payer: params.payer as TransactionSigner,
    pool,
    ticketRegistry: params.ticketRegistry,
  });
}

export async function buildWithdrawFeesInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  amount: bigint | number;
  tokenMint: Address;
  feeWallet: Address;
  nextRedemptionId: bigint | number;
  humaStateAddresses: Record<string, string>;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    params.humaStateAddresses.humaPoolState
  );
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    params.nextRedemptionId
  );

  return getWithdrawFeesInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    poolPstVault,
    pendingRedemption,
    feeWallet: params.feeWallet,
    tokenMint: params.tokenMint,
    amount: BigInt(params.amount),
    humaConfig: address(params.humaStateAddresses.humaConfig),
    humaPoolConfig: address(params.humaStateAddresses.humaPoolConfig),
    humaPoolState: address(params.humaStateAddresses.humaPoolState),
    humaModeConfig: address(params.humaStateAddresses.humaModeConfig),
    humaModeMint: address(params.humaStateAddresses.humaModeMint),
    humaRedemptionRequest: address(
      params.humaStateAddresses.humaRedemptionRequest ??
        params.humaStateAddresses.humaPoolState
    ),
    humaLenderState: address(params.humaStateAddresses.humaLenderState),
    humaPoolAuthority,
    humaPoolModeToken: address(params.humaStateAddresses.humaLenderModeToken),
    pstTokenProgram: TOKEN_PROGRAM_ID,
  });
}

export async function buildAdminForceUnlockDrawInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  cycleId: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const currentDrawCycle = await findDrawCyclePda(
    params.poolId,
    params.cycleId
  );
  return getAdminForceUnlockDrawInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    currentDrawCycle,
  });
}

export async function buildCrankRebindExpiredRandomnessInstruction(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  cycleId: number;
  newRandomnessAccount: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const currentDrawCycle = await findDrawCyclePda(
    params.poolId,
    params.cycleId
  );
  return getCrankRebindExpiredRandomnessInstructionAsync({
    crank: params.crank as TransactionSigner,
    pool,
    currentDrawCycle,
    newRandomnessAccount: params.newRandomnessAccount,
  });
}
