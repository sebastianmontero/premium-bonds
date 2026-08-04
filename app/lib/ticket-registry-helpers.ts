import { Address, getBase58Decoder, lamports } from "@solana/kit";
import {
  decodeTicketRegistry,
  TicketRegistry,
} from "./generated/yield-bonds/src/generated/accounts";

const base58Decoder = getBase58Decoder();

export interface UserEntryInfo {
  owner: Address;
  active: number;
  pending: number;
  mergedThroughCycle: number;
  cumulativeActive: number;
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
