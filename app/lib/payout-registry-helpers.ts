import {
  getPayoutRegistryDecoder,
  getPayoutRegistryEncoder,
  PAYOUT_REGISTRY_DISCRIMINATOR,
  PayoutRegistry,
  PayoutRegistryArgs,
} from "./generated/yield-bonds/src/generated/accounts";
import {
  fixDecoderSize,
  fixEncoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  getU32Decoder,
  getU32Encoder,
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  getU8Encoder,
  type Decoder,
  type Encoder,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";

export interface Winner {
  winner: Address;
  amountOwed: bigint;
  bondsBought: number;
  processed: number;
  tierIndex: number;
  version: number;
  padding?: ReadonlyUint8Array;
  reserved?: ReadonlyUint8Array;
}

export interface WinnerArgs {
  winner: Address;
  amountOwed: bigint | number;
  bondsBought: number;
  processed: number;
  tierIndex: number;
  version?: number;
  padding?: ReadonlyUint8Array;
  reserved?: ReadonlyUint8Array;
}

export function getWinnerEncoder(): Encoder<WinnerArgs> {
  return getStructEncoder([
    ["winner", getAddressEncoder()],
    ["amountOwed", getU64Encoder()],
    ["bondsBought", getU32Encoder()],
    ["processed", getU8Encoder()],
    ["tierIndex", getU8Encoder()],
    ["version", getU8Encoder()],
    ["padding", fixEncoderSize(getBytesEncoder(), 1)],
    ["reserved", fixEncoderSize(getBytesEncoder(), 8)],
  ]) as unknown as Encoder<WinnerArgs>;
}

export function getWinnerDecoder(): Decoder<Winner> {
  return getStructDecoder([
    ["winner", getAddressDecoder()],
    ["amountOwed", getU64Decoder()],
    ["bondsBought", getU32Decoder()],
    ["processed", getU8Decoder()],
    ["tierIndex", getU8Decoder()],
    ["version", getU8Decoder()],
    ["padding", fixDecoderSize(getBytesDecoder(), 1)],
    ["reserved", fixDecoderSize(getBytesDecoder(), 8)],
  ]);
}

export { PAYOUT_REGISTRY_DISCRIMINATOR };
export type { PayoutRegistry, PayoutRegistryArgs };

export const MAX_TOTAL_WINNERS = 180;
export const WINNER_VERSION = 1;
export const WINNER_SIZE = 56;
export const PAYOUT_REGISTRY_HEADER_SIZE = 104;
export const PAYOUT_REGISTRY_MAGIC = PAYOUT_REGISTRY_DISCRIMINATOR;
export const PAYOUT_REGISTRY_VERSION = 1;
export const WINNER_RECORD_SIZE = WINNER_SIZE;

export enum PayoutRegistryStatus {
  Active = 0,
  Voided = 1,
}

export type PayoutRegistryStatusName = "Active" | "Voided";

export function formatPayoutRegistryStatus(
  status: number | PayoutRegistryStatus
): string {
  return PayoutRegistryStatus[status] ?? `Unknown (${status})`;
}

export function isPayoutRegistryVoided(
  registry: Pick<PayoutRegistry, "status">
): boolean {
  return registry.status === PayoutRegistryStatus.Voided;
}

export function canClosePayoutRegistry(
  registry: Pick<PayoutRegistry, "winnersCount" | "payoutsCompleted" | "status">
): boolean {
  return (
    isPayoutRegistryVoided(registry) ||
    (registry.status === PayoutRegistryStatus.Active &&
      registry.winnersCount > 0 &&
      registry.payoutsCompleted === registry.winnersCount)
  );
}

export function payoutRegistrySpace(winnersCount: number): number {
  if (winnersCount <= 0 || winnersCount > MAX_TOTAL_WINNERS) {
    throw new Error(
      `Invalid winnersCount: expected 1..=${MAX_TOTAL_WINNERS}, got ${winnersCount}`
    );
  }
  return PAYOUT_REGISTRY_HEADER_SIZE + winnersCount * WINNER_SIZE;
}

export const getPayoutRegistryAccountSize = payoutRegistrySpace;

export type ParsedPayoutRegistry = ExtendedPayoutRegistry;
export type ParsedWinner = WinnerInfo;

const winnerDecoder = getWinnerDecoder();
const winnerEncoder = getWinnerEncoder();

export interface WinnerInfo extends Winner {
  isProcessed?: boolean;
}

export interface ExtendedPayoutRegistry extends PayoutRegistry {
  winners: WinnerInfo[];
}

export function assertValidDiscriminator(
  data: Uint8Array | ReadonlyUint8Array,
  expected: Uint8Array | ReadonlyUint8Array
): void {
  if (data.byteLength < expected.byteLength) {
    throw new Error("Buffer too small to contain discriminator");
  }
  for (let i = 0; i < expected.byteLength; i++) {
    if (data[i] !== expected[i]) {
      throw new Error("Invalid account discriminator");
    }
  }
}

export function parseWinnerFromSlice(
  sliceBytes: Uint8Array
): WinnerInfo | null {
  if (sliceBytes.byteLength < WINNER_SIZE) return null;
  try {
    const decoded = winnerDecoder.decode(sliceBytes.subarray(0, WINNER_SIZE));
    if (decoded.version !== WINNER_VERSION) return null;
    return {
      ...decoded,
      isProcessed: decoded.processed !== 0,
    };
  } catch {
    return null;
  }
}

export function parsePayoutRegistryEntry(
  dataOrAccount: Uint8Array | { data: Uint8Array },
  index: number
): WinnerInfo | null {
  const data =
    dataOrAccount instanceof Uint8Array
      ? dataOrAccount
      : (dataOrAccount as { data: Uint8Array }).data;
  if (
    !data ||
    data.length < PAYOUT_REGISTRY_HEADER_SIZE ||
    index < 0 ||
    !Number.isInteger(index)
  ) {
    return null;
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PAYOUT_REGISTRY_DISCRIMINATOR[i]) return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const winnersCount = view.getUint32(16, true);
  if (index >= winnersCount) return null;
  const offset = PAYOUT_REGISTRY_HEADER_SIZE + index * WINNER_SIZE;
  if (offset + WINNER_SIZE > data.byteLength) return null;
  return parseWinnerFromSlice(data.subarray(offset, offset + WINNER_SIZE));
}

export function parsePayoutRegistry(
  dataOrAccount: Uint8Array | { data: Uint8Array }
): ExtendedPayoutRegistry {
  const data =
    dataOrAccount instanceof Uint8Array
      ? dataOrAccount
      : (dataOrAccount as { data: Uint8Array }).data;
  if (!data || data.byteLength < PAYOUT_REGISTRY_HEADER_SIZE) {
    throw new Error(
      `PayoutRegistry buffer too small: expected >= ${PAYOUT_REGISTRY_HEADER_SIZE}B, got ${data?.byteLength ?? 0}B`
    );
  }
  assertValidDiscriminator(data, PAYOUT_REGISTRY_DISCRIMINATOR);

  const header = getPayoutRegistryDecoder().decode(
    data.subarray(0, PAYOUT_REGISTRY_HEADER_SIZE)
  );
  const winnersCount = Number(header.winnersCount);
  const requiredBytes =
    PAYOUT_REGISTRY_HEADER_SIZE + winnersCount * WINNER_SIZE;
  if (data.byteLength < requiredBytes) {
    throw new Error(
      `PayoutRegistry buffer truncated: header reported ${winnersCount} winners (${requiredBytes}B required), but buffer has ${data.byteLength}B`
    );
  }

  const winners: WinnerInfo[] = [];
  for (let i = 0; i < winnersCount; i++) {
    const offset = PAYOUT_REGISTRY_HEADER_SIZE + i * WINNER_SIZE;
    const entry = parseWinnerFromSlice(
      data.subarray(offset, offset + WINNER_SIZE)
    );
    if (!entry) {
      throw new Error(
        `Corrupted winner entry at index ${i} in PayoutRegistry buffer`
      );
    }
    winners.push(entry);
  }

  return {
    ...header,
    winnersCount,
    payoutsCompleted: Number(header.payoutsCompleted),
    winners,
  };
}

export function serializeWinner(
  winner: WinnerInfo | Winner | WinnerArgs
): Uint8Array {
  const processed =
    "isProcessed" in winner && typeof winner.isProcessed === "boolean"
      ? winner.isProcessed
        ? 1
        : 0
      : winner.processed;
  const encoded = winnerEncoder.encode({
    winner: winner.winner,
    amountOwed: winner.amountOwed,
    bondsBought: winner.bondsBought,
    processed,
    tierIndex: winner.tierIndex,
    version: winner.version ?? WINNER_VERSION,
    padding: winner.padding ?? new Uint8Array(1),
    reserved: winner.reserved ?? new Uint8Array(8),
  });
  return new Uint8Array(encoded);
}

export function serializePayoutRegistry(options: {
  poolId: number;
  cycleId: number;
  winnersCount?: number;
  payoutsCompleted?: number;
  revealedAt?: bigint;
  status?: number;
  version?: number;
  winners?: (WinnerInfo | Winner)[];
  totalSizeBytes?: number;
}): Uint8Array {
  const winners = options.winners ?? [];
  const winnersCount = options.winnersCount ?? winners.length;
  const totalSize =
    options.totalSizeBytes ??
    PAYOUT_REGISTRY_HEADER_SIZE + winnersCount * WINNER_SIZE;

  const headerArgs: PayoutRegistryArgs = {
    poolId: options.poolId,
    cycleId: options.cycleId,
    winnersCount,
    payoutsCompleted: options.payoutsCompleted ?? 0,
    revealedAt: options.revealedAt ?? BigInt(Math.floor(Date.now() / 1000)),
    status: options.status ?? 0,
    version: options.version ?? 1,
    padding: new Uint8Array(6),
    reserved: new Uint8Array(64),
  };

  const headerBytes = getPayoutRegistryEncoder().encode(headerArgs);
  const buffer = new Uint8Array(totalSize);
  buffer.set(headerBytes, 0);

  winners.forEach((winner, idx) => {
    const offset = PAYOUT_REGISTRY_HEADER_SIZE + idx * WINNER_SIZE;
    if (offset + WINNER_SIZE <= totalSize) {
      buffer.set(serializeWinner(winner), offset);
    }
  });

  return buffer;
}
