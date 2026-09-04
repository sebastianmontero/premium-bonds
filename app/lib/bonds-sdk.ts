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
  getBase64Encoder,
  lamports,
  TransactionSigner,
  Instruction,
} from "@solana/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SolanaRpc = any;

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

export {
  decodeGlobalConfig,
  decodePrizePool,
  decodeDrawCycle,
  decodePayoutRegistry,
  decodeUserWinnings,
  decodePendingRedemption,
};
export type {
  GlobalConfig,
  PrizePool,
  DrawCycle,
  PayoutRegistry,
  UserWinnings,
  PendingRedemption,
};

import { MOCK_HUMA_PROGRAM_ADDRESS } from "./generated/mock-huma/src/generated";

import { DrawStatus } from "./generated/yield-bonds/src/generated";
import { DEFAULT_APY, DEFAULT_APY_BPS, bpsToRate } from "./formatters";
import {
  UNASSIGNED_REGISTRY_INDEX,
  REGISTRY_HEADER_SIZE,
  USER_ENTRY_SIZE,
} from "./ticket-registry-helpers";

export type { TicketRegistry } from "./ticket-registry-helpers";

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
import type { DrawStatusName, DrawStatusArchetype } from "../types";
export type { DrawStatusName, DrawStatusArchetype };

export {
  UNASSIGNED_REGISTRY_INDEX,
  PUBKEY_BYTES,
  USER_ENTRY_VERSION,
  USER_ENTRY_SIZE,
  REGISTRY_HEADER_SIZE,
  REGISTRY_HEADER_OFFSETS,
  USER_ENTRY_OFFSETS,
  parseUserEntryFromSlice,
  parseRegistryHeaderFromSlice,
  parseTicketRegistry,
  parseRegistryEntry,
  resolveUserTickets,
} from "./ticket-registry-helpers";
export type {
  UserEntryInfo,
  ResolvedUserTickets,
} from "./ticket-registry-helpers";

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
export const REGISTRY_INITIAL_SIZE = 262_248n;

export const HUMA_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_POOL_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_POOL_STATE = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_STATE || "11111111111111111111111111111111"
);
export const HUMA_MODE_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_LENDER_STATE = address(
  process.env.NEXT_PUBLIC_HUMA_LENDER_STATE ||
    "11111111111111111111111111111111"
);
export const HUMA_POOL_UNDERLYING_TOKEN = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
    "11111111111111111111111111111111"
);
export const HUMA_MODE_MINT = address(
  process.env.NEXT_PUBLIC_HUMA_MODE_MINT || "11111111111111111111111111111111"
);
export const HUMA_POOL_MODE_TOKEN = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    "11111111111111111111111111111111"
);
export const HUMA_REDEMPTION_REQUEST = address(
  process.env.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
    "11111111111111111111111111111111"
);

const textEncoder = new TextEncoder();
const base58Encoder = getBase58Encoder();
const base64Encoder = getBase64Encoder();

export function decodeAccountBase64Data(
  account:
    | { data: [string, string] }
    | { data?: [string, string] }
    | null
    | undefined
): Uint8Array | null {
  if (!account?.data?.[0]) return null;
  return new Uint8Array(base64Encoder.encode(account.data[0]));
}

export interface FetchBatchedBondsParams {
  rpc: SolanaRpc;
  poolId: number;
  userAddress?: Address | string;
  humaPoolStateAddress?: Address | string;
  pstMintAddress?: Address | string;
  humaModeConfigAddress?: Address | string;
}

export interface BatchedBondsAccounts {
  poolAccountData: Uint8Array | null;
  poolPstVaultData: Uint8Array | null;
  humaPoolStateData: Uint8Array | null;
  pstMintData: Uint8Array | null;
  humaModeConfigData: Uint8Array | null;
  userWinningsData: Uint8Array | null;
  userAtaData: Uint8Array | null;
}

export async function fetchBatchedBondsState(
  params: FetchBatchedBondsParams
): Promise<BatchedBondsAccounts> {
  const { rpc, poolId, userAddress } = params;
  const poolPda = await findPrizePoolPda(poolId);
  const poolPstVault = await findPoolPstVaultPda(poolId);
  const humaPoolState = params.humaPoolStateAddress
    ? address(params.humaPoolStateAddress)
    : HUMA_POOL_STATE;
  const pstMint = params.pstMintAddress
    ? address(params.pstMintAddress)
    : HUMA_MODE_MINT;
  const humaModeConfig = params.humaModeConfigAddress
    ? address(params.humaModeConfigAddress)
    : HUMA_MODE_CONFIG;

  const accountMap: { key: keyof BatchedBondsAccounts; address: Address }[] = [
    { key: "poolAccountData", address: poolPda },
    { key: "poolPstVaultData", address: poolPstVault },
    { key: "humaPoolStateData", address: humaPoolState },
    { key: "pstMintData", address: pstMint },
    { key: "humaModeConfigData", address: humaModeConfig },
  ];

  if (userAddress) {
    const userWinningsPda = await findUserWinningsPda(poolId, userAddress);
    const userAta = await findAtaAddress(userAddress.toString(), USDC_MINT);
    accountMap.push(
      { key: "userWinningsData", address: userWinningsPda },
      { key: "userAtaData", address: userAta }
    );
  }

  const res = await rpc
    .getMultipleAccounts(
      accountMap.map((a) => a.address),
      { encoding: "base64", commitment: "confirmed" }
    )
    .send();

  const result: BatchedBondsAccounts = {
    poolAccountData: null,
    poolPstVaultData: null,
    humaPoolStateData: null,
    pstMintData: null,
    humaModeConfigData: null,
    userWinningsData: null,
    userAtaData: null,
  };

  accountMap.forEach((entry, idx) => {
    result[entry.key] = decodeAccountBase64Data(res.value[idx]);
  });

  return result;
}

export async function fetchTicketRegistryHeaderSlice(
  rpc: SolanaRpc,
  registryAddress: Address | string
): Promise<Uint8Array | null> {
  try {
    const acc = await rpc
      .getAccountInfo(address(registryAddress), {
        dataSlice: { offset: 0, length: REGISTRY_HEADER_SIZE },
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();
    return decodeAccountBase64Data(acc?.value);
  } catch (err) {
    console.warn("Failed to fetch TicketRegistry header slice:", err);
    return null;
  }
}

export async function fetchUserRegistryEntrySlice(
  rpc: SolanaRpc,
  registryAddress: Address | string,
  registryEntryIndex: number
): Promise<Uint8Array | null> {
  if (
    registryEntryIndex === UNASSIGNED_REGISTRY_INDEX ||
    registryEntryIndex < 0 ||
    !Number.isInteger(registryEntryIndex)
  ) {
    return null;
  }
  try {
    const offset = REGISTRY_HEADER_SIZE + registryEntryIndex * USER_ENTRY_SIZE;
    const acc = await rpc
      .getAccountInfo(address(registryAddress), {
        dataSlice: { offset, length: USER_ENTRY_SIZE },
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();
    return decodeAccountBase64Data(acc?.value);
  } catch (err) {
    console.warn("Failed to fetch user entry slice:", err);
    return null;
  }
}

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

/**
 * Splits an array into chunks of `chunkSize` to avoid exceeding Solana RPC getMultipleAccounts limits.
 */
export function chunkArray<T>(items: T[], chunkSize: number = 80): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

// ─── PDA Derivations ─────────────────────────────────────────────────────────

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ADDRESS = address(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export async function findProgramDataPda(
  programAddress: Address = PROGRAM_ID
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM_ADDRESS,
    seeds: [getBase58Encoder().encode(programAddress)],
  });
  return addr;
}

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

/**
 * Fetches and parses a user's SPL token account balance from the RPC.
 * Returns raw base units as a number (e.g. 6 decimals = micro-USDC).
 * Returns 0 if the ATA does not exist or cannot be parsed.
 */
export async function fetchUserAtaBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: any,
  userAddress: string,
  mintAddress: string = USDC_MINT
): Promise<number> {
  try {
    const userAta = await findAtaAddress(userAddress, mintAddress);
    const ataAcc = await rpc
      .getAccountInfo(userAta, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();

    if (ataAcc && ataAcc.value && ataAcc.value.data?.[0]) {
      const tokenBytes = getBase64Encoder().encode(ataAcc.value.data[0]);
      if (tokenBytes.byteLength >= 72) {
        const tokenView = new DataView(
          tokenBytes.buffer,
          tokenBytes.byteOffset,
          tokenBytes.byteLength
        );
        return Number(tokenView.getBigUint64(64, true));
      }
    }
    return 0;
  } catch {
    return 0;
  }
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

  // Explicitly omit internal Anchor SVM bytes (discriminator, padding, reserved)
  return {
    poolId: decoded.poolId,
    tokenMint: decoded.tokenMint,
    ticketRegistry: decoded.ticketRegistry,
    feeWallet: decoded.feeWallet,
    currentDrawCycleId: decoded.currentDrawCycleId,
    maxYieldBasisPoints: decoded.maxYieldBasisPoints,
    vaultAuthorityBump: decoded.vaultAuthorityBump,
    version: decoded.version,
    status: statusName,
    bondPrice: Number(decoded.bondPrice),
    stakeCycleDurationHrs: Number(decoded.stakeCycleDurationHrs),
    totalDepositedPrincipal: Number(decoded.totalDepositedPrincipal),
    currentCycleEndAt: Number(decoded.currentCycleEndAt),
    nextRedemptionId: Number(decoded.nextRedemptionId),
    isFrozenForDraw: Boolean(decoded.isFrozenForDraw),
    feeBasisPoints: Number(decoded.feeBasisPoints),
    minYieldThreshold: Number(decoded.minYieldThreshold),
    totalPrizesDistributed: Number(decoded.totalPrizesDistributed),
    totalFeesAccrued: Number(decoded.totalFeesAccrued),
    totalFeesWithdrawn: Number(decoded.totalFeesWithdrawn),
    totalPrizesAllocated: Number(decoded.totalPrizesAllocated),
    totalPendingRedemptions: Number(decoded.totalPendingRedemptions),
    payoutTimelockSeconds: Number(decoded.payoutTimelockSeconds),
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

export function parseTokenAccountBalance(data: Uint8Array): bigint {
  if (data.byteLength < 72) return 0n;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(64, true);
}

export function parseMintSupply(data: Uint8Array): bigint {
  if (data.byteLength < 44) return 0n;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(36, true);
}

export interface MockHumaPoolStateInfo {
  numModes: number;
  totalAssets: bigint;
  numConfigKeys: number;
  nextRequestId: bigint;
  lastRequestId: bigint;
  pendingRequests: bigint;
}

export function parseMockHumaPoolState(
  data: Uint8Array
): MockHumaPoolStateInfo {
  if (data.byteLength < 30) {
    return {
      numModes: 0,
      totalAssets: 0n,
      numConfigKeys: 0,
      nextRequestId: 0n,
      lastRequestId: 0n,
      pendingRequests: 0n,
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const numModes = view.getUint32(26, true);
  let totalAssets = 0n;
  if (numModes > 0 && data.byteLength >= 46) {
    // Read 128-bit total_assets at offset 30..46
    const totalAssetsLow = view.getBigUint64(30, true);
    const totalAssetsHigh = view.getBigUint64(38, true);
    totalAssets = (totalAssetsHigh << 64n) | totalAssetsLow;
  }

  const modeConfigKeysOffset = 30 + numModes * 216;
  if (data.byteLength < modeConfigKeysOffset + 4) {
    return {
      numModes,
      totalAssets,
      numConfigKeys: 0,
      nextRequestId: 0n,
      lastRequestId: 0n,
      pendingRequests: 0n,
    };
  }

  const numConfigKeys = view.getUint32(modeConfigKeysOffset, true);
  const redemptionOffset = modeConfigKeysOffset + 4 + numConfigKeys * 32;

  let nextRequestId = 0n;
  let lastRequestId = 0n;
  if (data.byteLength >= redemptionOffset + 32) {
    const nextLow = view.getBigUint64(redemptionOffset, true);
    const nextHigh = view.getBigUint64(redemptionOffset + 8, true);
    nextRequestId = (nextHigh << 64n) | nextLow;

    const lastLow = view.getBigUint64(redemptionOffset + 16, true);
    const lastHigh = view.getBigUint64(redemptionOffset + 24, true);
    lastRequestId = (lastHigh << 64n) | lastLow;
  }

  const pendingRequests =
    lastRequestId >= nextRequestId ? lastRequestId - nextRequestId : 0n;

  return {
    numModes,
    totalAssets,
    numConfigKeys,
    nextRequestId,
    lastRequestId,
    pendingRequests,
  };
}

export interface PoolYieldCalculation {
  poolPstBalance: bigint;
  pstSupply: bigint;
  humaTotalAssets: bigint;
  currentValue: bigint;
  bookValue: bigint;
  grossYield: bigint;
  protocolFee: bigint;
  netYield: bigint;
  estimatedPrizePot: number;
  totalDepositedPrincipal: bigint;
  feesInVault: bigint;
  totalPrizesAllocated: bigint;
}

export interface ProtocolFeeParams {
  totalFeesAccrued?: bigint | number;
  totalFeesWithdrawn?: bigint | number;
}

/**
 * Computes undistributed protocol fees currently remaining in the pool.
 * Guarantees non-negative saturating subtraction (accrued - withdrawn).
 */
export function calculateAvailableFees(params: ProtocolFeeParams): bigint {
  const accrued = BigInt(params.totalFeesAccrued ?? 0n);
  const withdrawn = BigInt(params.totalFeesWithdrawn ?? 0n);
  return accrued > withdrawn ? accrued - withdrawn : 0n;
}

export interface BookValueParams extends ProtocolFeeParams {
  totalDepositedPrincipal: bigint | number;
  feesInVault?: bigint | number;
  totalPrizesAllocated?: bigint | number;
}

/**
 * Calculates the pool's book value (liabilities before new yield distribution).
 * On-chain invariant: book_value = total_deposited_principal + fees_in_vault + total_prizes_allocated
 */
export function calculateBookValue(params: BookValueParams): bigint {
  const principal = BigInt(params.totalDepositedPrincipal);
  const feesInVault =
    params.feesInVault !== undefined
      ? BigInt(params.feesInVault)
      : calculateAvailableFees(params);
  const totalPrizesAllocated = BigInt(params.totalPrizesAllocated ?? 0n);

  const safePrincipal = principal > 0n ? principal : 0n;
  const safeFees = feesInVault > 0n ? feesInVault : 0n;
  const safePrizes = totalPrizesAllocated > 0n ? totalPrizesAllocated : 0n;

  return safePrincipal + safeFees + safePrizes;
}

export interface CalculatePoolYieldParams extends BookValueParams {
  poolPstBalance: bigint;
  pstSupply: bigint;
  humaTotalAssets: bigint;
  feeBasisPoints?: number;
}

export function calculatePoolYield(
  params: CalculatePoolYieldParams
): PoolYieldCalculation {
  const principal = BigInt(params.totalDepositedPrincipal);
  const feesInVault =
    params.feesInVault !== undefined
      ? BigInt(params.feesInVault)
      : calculateAvailableFees(params);
  const totalPrizesAllocated = BigInt(params.totalPrizesAllocated ?? 0n);
  const feeBasisPoints = params.feeBasisPoints ?? 0;

  const bookValue = calculateBookValue({
    totalDepositedPrincipal: principal,
    feesInVault,
    totalPrizesAllocated,
  });

  let currentValue = 0n;
  if (params.pstSupply > 0n && params.poolPstBalance > 0n) {
    currentValue =
      (params.poolPstBalance * params.humaTotalAssets) / params.pstSupply;
  }

  const grossYield = currentValue > bookValue ? currentValue - bookValue : 0n;
  const protocolFee =
    feeBasisPoints > 0 ? (grossYield * BigInt(feeBasisPoints)) / 10000n : 0n;
  const netYield = grossYield > protocolFee ? grossYield - protocolFee : 0n;
  const estimatedPrizePot = Number(netYield);

  return {
    poolPstBalance: params.poolPstBalance,
    pstSupply: params.pstSupply,
    humaTotalAssets: params.humaTotalAssets,
    currentValue,
    bookValue,
    grossYield,
    protocolFee,
    netYield,
    estimatedPrizePot,
    totalDepositedPrincipal: principal,
    feesInVault,
    totalPrizesAllocated,
  };
}

export const HUMA_MODE_CONFIG_NAME_OFFSET = 42; // 8 (disc) + 1 (bump) + 1 (mint_bump) + 32 (id)
export const BORSH_STRING_LENGTH_PREFIX_SIZE = 4;
export const HUMA_MODE_CONFIG_MIN_BYTE_LENGTH = 48;

export interface HumaModeConfigInfo {
  targetApyBps: number;
  apy: number;
}

/**
 * Safely decodes Huma's ModeConfig account.
 * Handles the dynamic Borsh string length prefix for `name: string` to locate `target_apy_bps`.
 */
export function parseModeConfig(data: Uint8Array): HumaModeConfigInfo {
  if (data.byteLength < HUMA_MODE_CONFIG_MIN_BYTE_LENGTH) {
    return { targetApyBps: DEFAULT_APY_BPS, apy: DEFAULT_APY };
  }
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const nameLen = view.getUint32(HUMA_MODE_CONFIG_NAME_OFFSET, true);
    const targetApyOffset =
      HUMA_MODE_CONFIG_NAME_OFFSET + BORSH_STRING_LENGTH_PREFIX_SIZE + nameLen;
    if (data.byteLength >= targetApyOffset + 2) {
      const targetApyBps = view.getUint16(targetApyOffset, true);
      return {
        targetApyBps,
        apy: bpsToRate(targetApyBps),
      };
    }
  } catch (err) {
    console.warn(
      "Failed to parse Huma ModeConfig, falling back to default APY:",
      err
    );
  }
  return { targetApyBps: DEFAULT_APY_BPS, apy: DEFAULT_APY };
}

export interface PoolYieldOnChainState {
  humaTotalAssets: bigint;
  pstSupply: bigint;
  poolPstBalance: bigint;
  humaModeApy?: number;
}

export async function fetchPoolYieldOnChainState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: any,
  params: {
    poolId: number;
    humaPoolStateAddress?: Address | string;
    pstMintAddress?: Address | string;
    humaModeConfigAddress?: Address | string;
  }
): Promise<PoolYieldOnChainState> {
  const humaPoolState = params.humaPoolStateAddress
    ? address(params.humaPoolStateAddress)
    : null;
  const pstMint = params.pstMintAddress ? address(params.pstMintAddress) : null;
  const humaModeConfig = params.humaModeConfigAddress
    ? address(params.humaModeConfigAddress)
    : null;
  const poolPstVault = await findPoolPstVaultPda(params.poolId);

  const [humaRes, pstMintRes, poolPstVaultRes, humaModeConfigRes] =
    await Promise.allSettled([
      humaPoolState
        ? rpc
            .getAccountInfo(humaPoolState, {
              encoding: "base64",
              commitment: "confirmed",
            })
            .send()
        : Promise.resolve(null),
      pstMint
        ? rpc
            .getAccountInfo(pstMint, {
              encoding: "base64",
              commitment: "confirmed",
            })
            .send()
        : Promise.resolve(null),
      rpc
        .getAccountInfo(poolPstVault, {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send(),
      humaModeConfig
        ? rpc
            .getAccountInfo(humaModeConfig, {
              encoding: "base64",
              commitment: "confirmed",
            })
            .send()
        : Promise.resolve(null),
    ]);

  let humaTotalAssets = 0n;
  if (humaRes.status === "fulfilled" && humaRes.value?.value?.data?.[0]) {
    try {
      const data = new Uint8Array(
        base64Encoder.encode(humaRes.value.value.data[0])
      );
      humaTotalAssets = parseMockHumaPoolState(data).totalAssets;
    } catch {}
  }

  let pstSupply = 0n;
  if (pstMintRes.status === "fulfilled" && pstMintRes.value?.value?.data?.[0]) {
    try {
      const data = new Uint8Array(
        base64Encoder.encode(pstMintRes.value.value.data[0])
      );
      pstSupply = parseMintSupply(data);
    } catch {}
  }

  let poolPstBalance = 0n;
  if (
    poolPstVaultRes.status === "fulfilled" &&
    poolPstVaultRes.value?.value?.data?.[0]
  ) {
    try {
      const data = new Uint8Array(
        base64Encoder.encode(poolPstVaultRes.value.value.data[0])
      );
      poolPstBalance = parseTokenAccountBalance(data);
    } catch {}
  }

  let humaModeApy: number | undefined;
  if (
    humaModeConfigRes.status === "fulfilled" &&
    humaModeConfigRes.value?.value?.data?.[0]
  ) {
    try {
      const data = new Uint8Array(
        base64Encoder.encode(humaModeConfigRes.value.value.data[0])
      );
      humaModeApy = parseModeConfig(data).apy;
    } catch {}
  }

  return {
    humaTotalAssets,
    pstSupply,
    poolPstBalance,
    humaModeApy,
  };
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
  getResizeRegistryInstruction,
  getUpdatePoolConfigInstructionAsync,
  getUpdateGlobalConfigInstructionAsync,
  getWithdrawFeesInstructionAsync,
  getAdminForceUnlockDrawInstructionAsync,
  getCrankRebindExpiredRandomnessInstructionAsync,
  getPausePoolInstructionAsync,
  getUnpausePoolInstructionAsync,
  getClosePoolInstructionAsync,
  getAdminVoidPayoutRegistryInstructionAsync,
  getClaimRedemptionInstructionAsync,
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
  getResizeRegistryInstruction,
  getUpdatePoolConfigInstructionAsync,
  getUpdateGlobalConfigInstructionAsync,
  getWithdrawFeesInstructionAsync,
  getAdminForceUnlockDrawInstructionAsync,
  getCrankRebindExpiredRandomnessInstructionAsync,
  getPausePoolInstructionAsync,
  getUnpausePoolInstructionAsync,
  getClosePoolInstructionAsync,
  getAdminVoidPayoutRegistryInstructionAsync,
  getClaimRedemptionInstructionAsync,
  getSimulateYieldInstructionDataEncoder,
  getSettleRequestsInstructionDataEncoder,
  getInitializeMockPoolStateInstructionDataEncoder,
  getCreateLenderAccountsV2InstructionDataEncoder,
};

// ─── High-Level SDK Instruction Builder Wrappers for CLI & Scripts ─────────

export async function buildInitializeGlobalInstruction(params: {
  authority?: Address | TransactionSigner;
  admin?: Address | TransactionSigner;
  guardian?: Address | TransactionSigner;
  jobsAccount?: Address;
  programData?: Address;
  program?: Address;
}) {
  const signer = (params.authority ?? params.admin) as TransactionSigner;
  const authorityAddress =
    typeof signer === "string"
      ? (signer as unknown as Address)
      : (signer as TransactionSigner).address;

  const adminAddress = params.admin
    ? typeof params.admin === "string"
      ? params.admin
      : (params.admin as TransactionSigner).address
    : authorityAddress;

  const guardianAddress = params.guardian
    ? typeof params.guardian === "string"
      ? params.guardian
      : (params.guardian as TransactionSigner).address
    : adminAddress;

  const programData = params.programData ?? (await findProgramDataPda());

  return getInitializeGlobalInstructionAsync({
    authority: signer,
    admin: adminAddress,
    guardian: guardianAddress,
    jobsAccount: params.jobsAccount ?? authorityAddress,
    programData,
    program: params.program ?? PROGRAM_ID,
  });
}

export async function buildUpdateGlobalConfigInstruction(params: {
  admin: Address | TransactionSigner;
  newAdmin?: Address;
  newGuardian?: Address;
  newJobsAccount?: Address;
}) {
  return getUpdateGlobalConfigInstructionAsync({
    admin: params.admin as TransactionSigner,
    newAdmin: params.newAdmin ?? null,
    newGuardian: params.newGuardian ?? null,
    newJobsAccount: params.newJobsAccount ?? null,
  });
}

export type PrizeTierInput = { numWinners: number; basisPoints: number };

export const DEFAULT_PRIZE_TIERS: PrizeTierInput[] = [
  { numWinners: 1, basisPoints: 10_000 },
];

/**
 * Formats user-supplied prize tier definitions into Codama-compatible args with required padding.
 */
export function formatPrizeTiersForEncoder(tiers?: PrizeTierInput[]) {
  const source = tiers && tiers.length > 0 ? tiers : DEFAULT_PRIZE_TIERS;
  return source.map((t) => ({
    numWinners: t.numWinners,
    basisPoints: t.basisPoints,
    padding: new Uint8Array(2),
  }));
}

export async function buildCreatePoolInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  bondPrice: bigint | number;
  stakeCycleDurationHrs: bigint | number;
  feeBasisPoints: number;
  minYieldThreshold?: bigint | number;
  maxYieldBasisPoints?: number;
  payoutTimelockSeconds?: number;
  prizeTiers?: PrizeTierInput[];
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
    maxYieldBasisPoints: params.maxYieldBasisPoints ?? 0,
    payoutTimelockSeconds: params.payoutTimelockSeconds ?? 300,
    prizeTiers: formatPrizeTiersForEncoder(params.prizeTiers),
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
  tiers: PrizeTierInput[];
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getSetPrizeTiersInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    tiers: formatPrizeTiersForEncoder(params.tiers),
  });
}

export async function buildUpdatePoolConfigInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  newFeeBasisPoints?: number;
  newBondPrice?: bigint | number;
  newFeeWallet?: Address;
  newMinYieldThreshold?: bigint | number;
  newStakeCycleDurationHrs?: bigint | number;
  newMaxYieldBasisPoints?: number;
  newPayoutTimelockSeconds?: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const ix = await getUpdatePoolConfigInstructionAsync({
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
    newStakeCycleDurationHrs:
      params.newStakeCycleDurationHrs !== undefined
        ? BigInt(params.newStakeCycleDurationHrs)
        : null,
    newMaxYieldBasisPoints: params.newMaxYieldBasisPoints ?? null,
    newPayoutTimelockSeconds: params.newPayoutTimelockSeconds ?? null,
  });

  if (params.newFeeWallet) {
    return {
      ...ix,
      accounts: [
        ...ix.accounts,
        {
          address: params.newFeeWallet,
          role: 0, // ReadonlyAccount
        },
      ],
    };
  }

  return ix;
}

export async function buildPausePoolInstruction(params: {
  signer: Address | TransactionSigner;
  poolId: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getPausePoolInstructionAsync({
    signer: params.signer as TransactionSigner,
    pool,
  });
}

export async function buildUnpausePoolInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getUnpausePoolInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
  });
}

export async function buildClosePoolInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getClosePoolInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
  });
}

export async function buildAdminVoidPayoutRegistryInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  cycleId: number;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const currentDrawCycle = await findDrawCyclePda(
    params.poolId,
    params.cycleId
  );
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.cycleId
  );
  return getAdminVoidPayoutRegistryInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    currentDrawCycle,
    payoutRegistry,
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
    crank: params.crank as unknown as TransactionSigner,
    winner: params.winner,
    pool,
    payoutRegistry,
    userWinnings,
    ticketRegistry: params.ticketRegistry,
    cycleId: params.cycleId,
    winnerIndex: params.winnerIndex,
  });
}

/**
 * Resolves the target winner address for a given draw cycle and winner index.
 * If `winnerAddress` is provided, returns it directly without RPC roundtrips.
 * Otherwise, queries the on-chain PayoutRegistry account to extract the winner.
 */
export async function resolveWinnerAddress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: any,
  poolId: number,
  cycleId: number,
  winnerIndex: number,
  winnerAddress?: Address | string,
  fallbackAddress?: Address | string
): Promise<Address> {
  if (winnerAddress) {
    return address(winnerAddress);
  }
  try {
    const payoutPda = await findPayoutRegistryPda(poolId, cycleId);
    const payoutAcc = await rpc
      .getAccountInfo(payoutPda, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();
    if (payoutAcc?.value?.data) {
      const payoutBytes = new Uint8Array(
        base64Encoder.encode(payoutAcc.value.data[0])
      );
      const payout = parsePayoutRegistry(payoutBytes);
      if (payout.winners && payout.winners[winnerIndex]) {
        return address(payout.winners[winnerIndex].winner);
      }
    }
  } catch {
    // Fall back to fallbackAddress if on-chain fetch fails
  }
  if (fallbackAddress) {
    return address(fallbackAddress);
  }
  throw new Error(
    `Unable to resolve winner address for cycle #${cycleId} winner #${winnerIndex}`
  );
}

export async function buildInitializeHumaLenderInstruction(params: {
  admin: Address | TransactionSigner;
  poolId: number;
  humaStateAddresses?: Record<string, string | undefined>;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const addrs = params.humaStateAddresses ?? {};

  const humaConfig =
    addrs.humaConfig || addrs.NEXT_PUBLIC_HUMA_CONFIG || SYSTEM_PROGRAM_ID;
  const humaPoolConfig =
    addrs.humaPoolConfig ||
    addrs.NEXT_PUBLIC_HUMA_POOL_CONFIG ||
    SYSTEM_PROGRAM_ID;
  const humaPoolState =
    addrs.humaPoolState ||
    addrs.NEXT_PUBLIC_HUMA_POOL_STATE ||
    SYSTEM_PROGRAM_ID;
  const humaModeConfig =
    addrs.humaModeConfig ||
    addrs.NEXT_PUBLIC_HUMA_MODE_CONFIG ||
    SYSTEM_PROGRAM_ID;
  const humaModeMint =
    addrs.humaModeMint ||
    addrs.NEXT_PUBLIC_HUMA_MODE_MINT ||
    addrs.pstMint ||
    addrs.NEXT_PUBLIC_PST_MINT ||
    SYSTEM_PROGRAM_ID;
  const humaLenderState =
    addrs.humaLenderState ||
    addrs.NEXT_PUBLIC_HUMA_LENDER_STATE ||
    SYSTEM_PROGRAM_ID;
  const humaLenderModeToken =
    addrs.humaLenderModeToken ||
    addrs.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    addrs.humaPoolModeToken ||
    poolPstVault;

  return getInitializeHumaLenderInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    poolPstVault,
    humaConfig: address(humaConfig),
    humaPoolConfig: address(humaPoolConfig),
    humaPoolState: address(humaPoolState),
    humaModeConfig: address(humaModeConfig),
    humaModeMint: address(humaModeMint),
    humaLenderState: address(humaLenderState),
    humaLenderModeToken: address(humaLenderModeToken),
    pstTokenProgram: TOKEN_PROGRAM_ID,
  });
}

export async function buildResizeRegistryInstruction(params: {
  payer: Address | TransactionSigner;
  poolId: number;
  ticketRegistry: Address;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  return getResizeRegistryInstruction({
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
  humaStateAddresses?: Record<string, string | undefined>;
}) {
  const pool = await findPrizePoolPda(params.poolId);
  const addrs = params.humaStateAddresses ?? {};
  const humaPoolStateStr =
    addrs.humaPoolState ||
    addrs.NEXT_PUBLIC_HUMA_POOL_STATE ||
    SYSTEM_PROGRAM_ID;
  const humaPoolAuthority = await findHumaPoolAuthorityPda(humaPoolStateStr);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    params.nextRedemptionId
  );

  const humaConfig =
    addrs.humaConfig || addrs.NEXT_PUBLIC_HUMA_CONFIG || SYSTEM_PROGRAM_ID;
  const humaPoolConfig =
    addrs.humaPoolConfig ||
    addrs.NEXT_PUBLIC_HUMA_POOL_CONFIG ||
    SYSTEM_PROGRAM_ID;
  const humaModeConfig =
    addrs.humaModeConfig ||
    addrs.NEXT_PUBLIC_HUMA_MODE_CONFIG ||
    SYSTEM_PROGRAM_ID;
  const humaModeMint =
    addrs.humaModeMint ||
    addrs.NEXT_PUBLIC_HUMA_MODE_MINT ||
    addrs.pstMint ||
    addrs.NEXT_PUBLIC_PST_MINT ||
    SYSTEM_PROGRAM_ID;
  const humaRedemptionRequest =
    addrs.humaRedemptionRequest ||
    addrs.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
    humaPoolStateStr;
  const humaLenderState =
    addrs.humaLenderState ||
    addrs.NEXT_PUBLIC_HUMA_LENDER_STATE ||
    SYSTEM_PROGRAM_ID;
  const humaPoolModeToken =
    addrs.humaPoolModeToken ||
    addrs.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    addrs.humaLenderModeToken ||
    poolPstVault;

  return getWithdrawFeesInstructionAsync({
    admin: params.admin as TransactionSigner,
    pool,
    poolPstVault,
    pendingRedemption,
    feeWallet: params.feeWallet,
    tokenMint: params.tokenMint,
    amount: BigInt(params.amount),
    humaConfig: address(humaConfig),
    humaPoolConfig: address(humaPoolConfig),
    humaPoolState: address(humaPoolStateStr),
    humaModeConfig: address(humaModeConfig),
    humaModeMint: address(humaModeMint),
    humaRedemptionRequest: address(humaRedemptionRequest),
    humaLenderState: address(humaLenderState),
    humaPoolAuthority,
    humaPoolModeToken: address(humaPoolModeToken),
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

export interface HumaPoolAddresses {
  poolState: Address;
  config?: Address;
  poolConfig?: Address;
  modeConfig?: Address;
  lenderState?: Address;
  poolUnderlyingToken?: Address;
}

export interface BuildClaimRedemptionParams {
  crank: Address | TransactionSigner;
  beneficiary: Address;
  poolId: number;
  redemptionId: bigint | number;
  tokenMint: Address;
  humaAddresses: HumaPoolAddresses;
}

export async function buildClaimRedemptionInstruction(
  params: BuildClaimRedemptionParams
) {
  const pool = await findPrizePoolPda(params.poolId);
  const poolVaultAccount = await findPoolVaultPda(params.poolId);
  const pendingRedemption = await findPendingRedemptionPda(
    params.poolId,
    BigInt(params.redemptionId)
  );
  const beneficiaryTokenAccount = await findAtaAddress(
    params.beneficiary,
    params.tokenMint
  );
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    params.humaAddresses.poolState
  );
  const eventAuthority = await findEventAuthorityPda();

  return getClaimRedemptionInstructionAsync({
    caller: params.crank as TransactionSigner,
    beneficiary: params.beneficiary,
    pool,
    pendingRedemption,
    tokenMint: params.tokenMint,
    poolVaultAccount,
    beneficiaryTokenAccount,
    humaConfig: params.humaAddresses.config || SYSTEM_PROGRAM_ID,
    humaPoolConfig: params.humaAddresses.poolConfig || SYSTEM_PROGRAM_ID,
    humaPoolState: params.humaAddresses.poolState,
    humaModeConfig: params.humaAddresses.modeConfig || SYSTEM_PROGRAM_ID,
    humaLenderState: params.humaAddresses.lenderState || SYSTEM_PROGRAM_ID,
    humaPoolAuthority,
    humaPoolUnderlyingToken:
      params.humaAddresses.poolUnderlyingToken || poolVaultAccount,
    eventAuthority,
  });
}

export async function buildPackedReinvestWinningsInstructions(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  cycleId: number;
  winners: { winner: Address; winnerIndex: number }[];
  ticketRegistry: Address;
}): Promise<Instruction[]> {
  const instructions: Instruction[] = [];
  for (const item of params.winners) {
    const ix = await buildReinvestWinningsInstruction({
      crank: params.crank,
      winner: item.winner,
      poolId: params.poolId,
      cycleId: params.cycleId,
      winnerIndex: item.winnerIndex,
      ticketRegistry: params.ticketRegistry,
    });
    instructions.push(ix);
  }
  return instructions;
}

export async function buildAtomicRevealAndPickWinnersInstructions(params: {
  crank: Address | TransactionSigner;
  poolId: number;
  currentDrawCycleId: number;
  ticketRegistry: Address;
  randomnessAccount: Address;
  switchboardRevealInstruction?: Instruction;
}): Promise<Instruction[]> {
  const instructions: Instruction[] = [];
  if (params.switchboardRevealInstruction) {
    instructions.push(params.switchboardRevealInstruction);
  }
  const revealIx = await buildRevealAndPickWinnersInstruction({
    crank: params.crank,
    poolId: params.poolId,
    currentDrawCycleId: params.currentDrawCycleId,
    ticketRegistry: params.ticketRegistry,
    randomnessAccount: params.randomnessAccount,
  });
  instructions.push(revealIx);
  return instructions;
}
