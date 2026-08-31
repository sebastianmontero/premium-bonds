import {
  Address,
  getBase58Decoder,
  getBase58Encoder,
  lamports,
} from "@solana/kit";
import {
  decodeTicketRegistry,
  getTicketRegistryDecoder,
  getTicketRegistryEncoder,
  TICKET_REGISTRY_DISCRIMINATOR,
  TicketRegistry,
  TicketRegistryArgs,
} from "./generated/yield-bonds/src/generated/accounts";

export { TICKET_REGISTRY_DISCRIMINATOR };
export type { TicketRegistry, TicketRegistryArgs };

const base58Decoder = getBase58Decoder();
const base58Encoder = getBase58Encoder();

export const UNASSIGNED_REGISTRY_INDEX = 0xffffffff;
export const PUBKEY_BYTES = 32;
export const USER_ENTRY_VERSION = 1;
export const USER_ENTRY_SIZE = 64;
export const REGISTRY_HEADER_SIZE = 104;

export const REGISTRY_HEADER_OFFSETS = {
  DISCRIMINATOR: 0,
  POOL_ID: 8,
  CAPACITY: 12,
  USER_COUNT: 16,
  TOTAL_ACTIVE_TICKETS: 20,
  TOTAL_PENDING_TICKETS: 24,
  DRAW_CYCLE_ID: 28,
  DRAW_PREPARED_UP_TO: 32,
  VERSION: 36,
} as const;

export const USER_ENTRY_OFFSETS = {
  OWNER: 0,
  ACTIVE: 32,
  PENDING: 36,
  MERGED_THROUGH_CYCLE: 40,
  CUMULATIVE_ACTIVE: 44,
  VERSION: 48,
} as const;

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
 * Parses a 64-byte slice directly fetched via Solana RPC dataSlice.
 */
export function parseUserEntryFromSlice(
  sliceBytes: Uint8Array
): UserEntryInfo | null {
  if (sliceBytes.byteLength < USER_ENTRY_SIZE) return null;
  const view = new DataView(
    sliceBytes.buffer,
    sliceBytes.byteOffset,
    USER_ENTRY_SIZE
  );
  const ownerBytes = sliceBytes.subarray(
    USER_ENTRY_OFFSETS.OWNER,
    USER_ENTRY_OFFSETS.OWNER + PUBKEY_BYTES
  );
  const owner = base58Decoder.decode(ownerBytes) as Address;
  const active = view.getUint32(USER_ENTRY_OFFSETS.ACTIVE, true);
  const pending = view.getUint32(USER_ENTRY_OFFSETS.PENDING, true);
  const mergedThroughCycle = view.getUint32(
    USER_ENTRY_OFFSETS.MERGED_THROUGH_CYCLE,
    true
  );
  const cumulativeActive = view.getUint32(
    USER_ENTRY_OFFSETS.CUMULATIVE_ACTIVE,
    true
  );

  const version = view.getUint8(USER_ENTRY_OFFSETS.VERSION);
  if (version !== USER_ENTRY_VERSION) {
    return null;
  }

  return {
    owner,
    active,
    pending,
    mergedThroughCycle,
    cumulativeActive,
  };
}

/**
 * Parses the 104-byte header slice using the generated Codama decoder.
 */
export function parseRegistryHeaderFromSlice(
  headerBytes: Uint8Array
): TicketRegistry | null {
  if (headerBytes.byteLength < REGISTRY_HEADER_SIZE) return null;
  for (let i = 0; i < 8; i++) {
    if (headerBytes[i] !== TICKET_REGISTRY_DISCRIMINATOR[i]) {
      return null;
    }
  }
  try {
    return getTicketRegistryDecoder().decode(
      headerBytes.subarray(0, REGISTRY_HEADER_SIZE)
    );
  } catch (err) {
    console.warn("Failed to decode TicketRegistry header slice:", err);
    return null;
  }
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
  if (data.length < REGISTRY_HEADER_SIZE) return null;
  if (
    index < 0 ||
    index === UNASSIGNED_REGISTRY_INDEX ||
    !Number.isInteger(index)
  ) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const userCount = view.getUint32(REGISTRY_HEADER_OFFSETS.USER_COUNT, true);
  if (index >= userCount) return null;

  const offset = REGISTRY_HEADER_SIZE + index * USER_ENTRY_SIZE;
  if (offset + USER_ENTRY_SIZE > data.byteLength) return null;

  return parseUserEntryFromSlice(
    data.subarray(offset, offset + USER_ENTRY_SIZE)
  );
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
    Math.floor((data.byteLength - REGISTRY_HEADER_SIZE) / USER_ENTRY_SIZE)
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

export interface SerializeTicketRegistryOptions {
  poolId: number;
  capacity?: number;
  userCount?: number;
  totalActiveTickets?: number;
  totalPendingTickets?: number;
  drawCycleId?: number;
  drawPreparedUpTo?: number;
  bump?: number;
  version?: number;
  totalSizeBytes?: number;
  reserved?: Uint8Array;
  entries?: (
    | UserEntryInfo
    | {
        owner: Address;
        active?: number;
        pending?: number;
        mergedThroughCycle?: number;
        cumulativeActive?: number;
        activeTickets?: number;
        pendingTickets?: number;
        lastActiveCycle?: number;
        bump?: number;
        version?: number;
        reserved?: Uint8Array;
      }
  )[];
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
    padding: new Uint8Array(3),
    reserved: options.reserved ?? new Uint8Array(64),
  };

  const headerBytes = getTicketRegistryEncoder().encode(headerArgs);
  const fullBuffer = new Uint8Array(totalSizeBytes);
  fullBuffer.set(headerBytes, 0);

  entries.forEach((rawEntry, idx) => {
    const entryOffset = REGISTRY_HEADER_SIZE + idx * USER_ENTRY_SIZE;
    if (entryOffset + USER_ENTRY_SIZE <= totalSizeBytes) {
      const normalizedEntry: UserEntryInfo = {
        owner: rawEntry.owner,
        active:
          "active" in rawEntry && rawEntry.active !== undefined
            ? rawEntry.active
            : "activeTickets" in rawEntry &&
                rawEntry.activeTickets !== undefined
              ? rawEntry.activeTickets
              : 0,
        pending:
          "pending" in rawEntry && rawEntry.pending !== undefined
            ? rawEntry.pending
            : "pendingTickets" in rawEntry &&
                rawEntry.pendingTickets !== undefined
              ? rawEntry.pendingTickets
              : 0,
        mergedThroughCycle:
          "mergedThroughCycle" in rawEntry &&
          rawEntry.mergedThroughCycle !== undefined
            ? rawEntry.mergedThroughCycle
            : "lastActiveCycle" in rawEntry &&
                rawEntry.lastActiveCycle !== undefined
              ? rawEntry.lastActiveCycle
              : 0,
        cumulativeActive:
          "cumulativeActive" in rawEntry &&
          rawEntry.cumulativeActive !== undefined
            ? rawEntry.cumulativeActive
            : 0,
      };
      fullBuffer.set(serializeUserEntry(normalizedEntry), entryOffset);
    }
  });

  return fullBuffer;
}
