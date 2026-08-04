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
  const statusMap = ["Active", "Paused", "Closed"];
  return {
    ...decoded,
    status: (statusMap[decoded.status] || "Active") as
      | "Active"
      | "Paused"
      | "Closed",
    bondPrice: Number(decoded.bondPrice),
    stakeCycleDurationHrs: Number(decoded.stakeCycleDurationHrs),
    totalDepositedPrincipal: Number(decoded.totalDepositedPrincipal),
    currentCycleEndAt: Number(decoded.currentCycleEndAt),
    nextRedemptionId: Number(decoded.nextRedemptionId),
    isFrozenForDraw: Boolean(decoded.isFrozenForDraw),
    ticketRegistry: decoded.ticketRegistry,
  };
}

export function parseDrawCycle(data: Uint8Array) {
  const decoded = decodedData<DrawCycle>(decodeDrawCycle(mockAccount(data)));
  const statusMap = ["AwaitingYield", "AwaitingRandomness", "Complete"];
  return {
    ...decoded,
    status: (statusMap[decoded.status] || "AwaitingYield") as
      | "AwaitingYield"
      | "AwaitingRandomness"
      | "Complete",
    randomnessSeed: new Uint8Array(decoded.randomnessSeed),
  };
}

export function parsePayoutRegistry(data: Uint8Array) {
  const decoded = decodedData<PayoutRegistry>(
    decodePayoutRegistry(mockAccount(data))
  );
  return {
    ...decoded,
    winnersCount: decoded.winners.length,
    payoutsCompleted: decoded.winners.filter((w) => w.processed).length,
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
