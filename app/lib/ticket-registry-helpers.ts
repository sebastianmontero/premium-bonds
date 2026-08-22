import {
  Address,
  getBase58Decoder,
  getBase58Encoder,
  lamports,
} from "@solana/kit";
import {
  decodeTicketRegistry,
  getTicketRegistryEncoder,
  TICKET_REGISTRY_DISCRIMINATOR,
  TicketRegistry,
  TicketRegistryArgs,
} from "./generated/yield-bonds/src/generated/accounts";

export { TICKET_REGISTRY_DISCRIMINATOR };

const base58Decoder = getBase58Decoder();
const base58Encoder = getBase58Encoder();

export interface UserEntryInfo {
  owner: Address;
  active: number;
  pending: number;
  mergedThroughCycle: number;
  cumulativeActive: number;
}

export interface ResolvedUserTickets {
  activeTicketsCount: number;
  pendingTicketsCount: number;
  isStale: boolean;
}

/**
 * Resolves a user's active and pending ticket balance taking into account lazy merges
 * and active draw-in-progress state (frozen pool).
 *
 * Single authoritative source of truth across UI components, hooks, and CLI tools.
 *
 * During a draw in progress (`isFrozenForDraw = true`), the draw cycle id has been
 * incremented on-chain for accounting, but the draw being resolved is `currentCycle - 1`.
 * Pending tickets purchased during that cycle are not eligible for the draw in progress
 * and remain pending until the draw reveals and the pool unfreezes.
 */
export function resolveUserTickets(
  entry: UserEntryInfo | null | undefined,
  currentCycle: number,
  isFrozenForDraw: boolean = false
): ResolvedUserTickets {
  if (!entry) {
    return { activeTicketsCount: 0, pendingTicketsCount: 0, isStale: false };
  }

  const effectiveCycle = isFrozenForDraw
    ? Math.max(0, currentCycle - 1)
    : currentCycle;

  const isStale = entry.mergedThroughCycle < effectiveCycle;

  if (isStale) {
    return {
      activeTicketsCount: entry.active + entry.pending,
      pendingTicketsCount: 0,
      isStale: true,
    };
  }

  return {
    activeTicketsCount: entry.active,
    pendingTicketsCount: entry.pending,
    isStale: false,
  };
}

export interface ExtendedTicketRegistry extends TicketRegistry {
  entries: UserEntryInfo[];
}

/**
 * Parses a single user entry from a TicketRegistry zero-copy byte buffer at the given index.
 *
 * @param data - Raw byte buffer of the TicketRegistry account.
 * @param index - Zero-based index of the user entry.
 * @returns Parsed UserEntryInfo or null if out of bounds.
 */
export function parseRegistryEntry(
  data: Uint8Array,
  index: number
): UserEntryInfo | null {
  if (data.length < 104) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const userCount = view.getUint32(16, true);
  if (index >= userCount) return null;

  const offset = 104 + index * 64;
  if (offset + 64 > data.byteLength) return null;

  const ownerBytes = data.slice(offset, offset + 32);
  const owner = base58Decoder.decode(ownerBytes) as Address;
  const active = view.getUint32(offset + 32, true);
  const pending = view.getUint32(offset + 36, true);
  const mergedThroughCycle = view.getUint32(offset + 40, true);
  const cumulativeActive = view.getUint32(offset + 44, true);

  return {
    owner,
    active,
    pending,
    mergedThroughCycle,
    cumulativeActive,
  };
}

/**
 * Parses the TicketRegistry header via Codama generated decoder and extracts user entries.
 *
 * @param data - Raw byte buffer of the TicketRegistry account.
 * @returns Deserialized TicketRegistry including parsed user entries.
 */
export function parseTicketRegistry(data: Uint8Array): ExtendedTicketRegistry {
  const decoded = decodeTicketRegistry({
    address: "" as Address,
    programAddress: "" as Address,
    executable: false,
    lamports: lamports(0n),
    space: BigInt(data.byteLength),
    exists: true,
    data,
  } as const);
  if (!decoded.exists) throw new Error("TicketRegistry decode failed");
  const header = decoded.data;

  const entries: UserEntryInfo[] = [];
  const maxEntries = Math.min(
    header.userCount,
    Math.floor((data.byteLength - 104) / 64)
  );

  for (let i = 0; i < maxEntries; i++) {
    const entry = parseRegistryEntry(data, i);
    if (entry) {
      entries.push(entry);
    }
  }

  return {
    ...header,
    entries,
  };
}

export interface SerializeTicketRegistryOptions {
  poolId: number;
  capacity?: number;
  userCount?: number;
  totalActiveTickets?: number;
  totalPendingTickets?: number;
  drawCycleId?: number;
  drawPreparedUpTo?: number;
  version?: number;
  totalSizeBytes?: number;
  entries?: UserEntryInfo[];
}

export const USER_ENTRY_VERSION = 1;
export const USER_ENTRY_SIZE = 64;
export const REGISTRY_HEADER_SIZE = 104;

/**
 * Serializes a single UserEntry struct into a 64-byte binary buffer.
 */
export function serializeUserEntry(
  entry: UserEntryInfo,
  version: number = USER_ENTRY_VERSION
): Uint8Array {
  const buf = new Uint8Array(USER_ENTRY_SIZE);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ownerBytes = base58Encoder.encode(entry.owner);
  buf.set(ownerBytes, 0);
  view.setUint32(32, entry.active, true);
  view.setUint32(36, entry.pending, true);
  view.setUint32(40, entry.mergedThroughCycle, true);
  view.setUint32(44, entry.cumulativeActive, true);
  view.setUint8(48, version);
  // Bytes 49-51 are padding [u8; 3] (0)
  // Bytes 52-63 are reserved [u8; 12] (0)
  return buf;
}

/**
 * Serializes a full TicketRegistry account (header + user entries) into a byte buffer.
 */
export function serializeTicketRegistry(
  options: SerializeTicketRegistryOptions
): Uint8Array {
  const totalSizeBytes = options.totalSizeBytes ?? 262248;
  const capacity =
    options.capacity ??
    Math.floor((totalSizeBytes - REGISTRY_HEADER_SIZE) / USER_ENTRY_SIZE);
  const entries = options.entries ?? [];
  const userCount = options.userCount ?? entries.length;

  const headerArgs: TicketRegistryArgs = {
    poolId: options.poolId,
    capacity,
    userCount,
    totalActiveTickets: options.totalActiveTickets ?? 0,
    totalPendingTickets: options.totalPendingTickets ?? 0,
    drawCycleId: options.drawCycleId ?? 0,
    drawPreparedUpTo: options.drawPreparedUpTo ?? 0,
    version: options.version ?? USER_ENTRY_VERSION,
    reserved: new Uint8Array(67),
  };

  const headerBytes = getTicketRegistryEncoder().encode(headerArgs);
  const fullBuffer = new Uint8Array(totalSizeBytes);
  fullBuffer.set(headerBytes, 0);

  entries.forEach((entry, idx) => {
    const entryOffset = REGISTRY_HEADER_SIZE + idx * USER_ENTRY_SIZE;
    if (entryOffset + USER_ENTRY_SIZE <= totalSizeBytes) {
      fullBuffer.set(serializeUserEntry(entry), entryOffset);
    }
  });

  return fullBuffer;
}
