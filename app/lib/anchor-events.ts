/**
 * Lightweight Anchor event parser compatible with @solana/kit.
 *
 * Parses Anchor program events from transaction logs without depending on
 * @coral-xyz/anchor. Events are logged as `Program data: <base64>` entries,
 * where the data starts with an 8-byte discriminator (SHA-256("event:EventName")[..8])
 * followed by Borsh-serialized fields.
 */

import { Address, getBase58Decoder, getBase58Encoder } from "@solana/kit";

// ─── Event Type Definitions ──────────────────────────────────────────────────

export interface BondsPurchasedEvent {
  user: string;
  poolId: number;
  bonds: number;
  amount: bigint;
}

export interface BondsSoldEvent {
  user: string;
  poolId: number;
  bonds: number;
  principal: bigint;
  redemptionId: bigint;
}

export interface WinningsReinvestedEvent {
  winner: string;
  poolId: number;
  cycleId: number;
  bondsBought: number;
  amountReinvested: bigint;
  isFinalBatch: boolean;
}

export interface WinningsClaimedEvent {
  user: string;
  poolId: number;
  amount: bigint;
  redemptionId: bigint;
}

export interface RedemptionClaimedEvent {
  user: string;
  poolId: number;
  amount: bigint;
  redemptionId: bigint;
}

export interface DrawCompletedEvent {
  poolId: number;
  cycleId: number;
  prizePot: bigint;
  winnersCount: number;
}

export interface DrawForceUnlockedEvent {
  poolId: number;
  cycleId: number;
  admin: string;
  prizePot: bigint;
  cycleFeeCollected: bigint;
}

export type ProgramEvent =
  | {
      type: "BondsPurchased";
      data: BondsPurchasedEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "BondsSold";
      data: BondsSoldEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "WinningsReinvested";
      data: WinningsReinvestedEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "WinningsClaimed";
      data: WinningsClaimedEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "RedemptionClaimed";
      data: RedemptionClaimedEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "DrawCompleted";
      data: DrawCompletedEvent;
      signature: string;
      blockTime: number;
    }
  | {
      type: "DrawForceUnlocked";
      data: DrawForceUnlockedEvent;
      signature: string;
      blockTime: number;
    };

// ─── Discriminator computation ───────────────────────────────────────────────
// Anchor event discriminators: SHA-256("event:<EventName>")[..8]
const base58Decoder = getBase58Decoder();
const base58Encoder = getBase58Encoder();

const ANCHOR_EVENT_IX_TAG_HEX = "e445a52e51cb9a1d";

const DISCRIMINATOR_MAP: Record<string, string> = {
  "98577bdd8fc92b0f": "BondsPurchased",
  "0aa460b294f9dc2a": "BondsSold",
  aeeb2097b9e63e6e: "WinningsReinvested",
  bbb81dc436754696: "WinningsClaimed",
  "6bfbc7d53bad35bd": "RedemptionClaimed",
  c1882558b47c6014: "DrawCompleted",
  "1a1dc53ce504de2d": "DrawForceUnlocked",
};

// ─── Borsh Decoders ──────────────────────────────────────────────────────────

function readPubkey(view: DataView, data: Uint8Array, offset: number): string {
  const bytes = data.slice(offset, offset + 32);
  return base58Decoder.decode(bytes) as string;
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readU64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

function readBool(view: DataView, offset: number): boolean {
  return view.getUint8(offset) !== 0;
}

function decodeEventData(
  eventName: string,
  data: Uint8Array
): ProgramEvent["data"] | null {
  // Skip 8-byte discriminator
  const payload = data.slice(8);
  if (payload.length < 4) return null;

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );

  switch (eventName) {
    case "BondsPurchased": {
      // Pubkey(32) + u32(4) + u32(4) + u64(8) = 48
      if (payload.length < 48) return null;
      return {
        user: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        bonds: readU32(view, 36),
        amount: readU64(view, 40),
      } as BondsPurchasedEvent;
    }
    case "BondsSold": {
      // Pubkey(32) + u32(4) + u32(4) + u64(8) + u64(8) = 56
      if (payload.length < 56) return null;
      return {
        user: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        bonds: readU32(view, 36),
        principal: readU64(view, 40),
        redemptionId: readU64(view, 48),
      } as BondsSoldEvent;
    }
    case "WinningsReinvested": {
      // Pubkey(32) + u32(4) + u32(4) + u32(4) + u64(8) + bool(1) = 53
      if (payload.length < 53) return null;
      return {
        winner: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        cycleId: readU32(view, 36),
        bondsBought: readU32(view, 40),
        amountReinvested: readU64(view, 44),
        isFinalBatch: readBool(view, 52),
      } as WinningsReinvestedEvent;
    }
    case "WinningsClaimed": {
      // Pubkey(32) + u32(4) + u64(8) + u64(8) = 52
      if (payload.length < 52) return null;
      return {
        user: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        amount: readU64(view, 36),
        redemptionId: readU64(view, 44),
      } as WinningsClaimedEvent;
    }
    case "RedemptionClaimed": {
      // Pubkey(32) + u32(4) + u64(8) + u64(8) = 52
      if (payload.length < 52) return null;
      return {
        user: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        amount: readU64(view, 36),
        redemptionId: readU64(view, 44),
      } as RedemptionClaimedEvent;
    }
    case "DrawCompleted": {
      // u32(4) + u32(4) + u64(8) + u32(4) = 20
      if (payload.length < 20) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        prizePot: readU64(view, 8),
        winnersCount: readU32(view, 16),
      } as DrawCompletedEvent;
    }
    case "DrawForceUnlocked": {
      // u32(4) + u32(4) + Pubkey(32) + u64(8) + u64(8) = 56
      if (payload.length < 56) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        admin: readPubkey(view, payload, 8),
        prizePot: readU64(view, 40),
        cycleFeeCollected: readU64(view, 48),
      } as DrawForceUnlockedEvent;
    }
    default:
      return null;
  }
}

// ─── Transaction Parser (Logs + Inner Instructions) ──────────────────────────

/**
 * Parse Anchor events from transaction log messages and inner instructions.
 * Anchor emits events as `Program data: <base64>` log entries (emit!)
 * and as inner instructions (emit_cpi!).
 */
function parseEventsFromTxMeta(
  meta: Record<string, unknown> | null | undefined
): Array<{ type: string; data: ProgramEvent["data"] }> {
  const events: Array<{ type: string; data: ProgramEvent["data"] }> = [];
  if (!meta) return events;

  // 1. Parse log events (emit!)
  if (Array.isArray(meta.logMessages)) {
    for (const log of meta.logMessages) {
      if (typeof log !== "string" || !log.startsWith("Program data: "))
        continue;

      const b64 = log.slice("Program data: ".length);
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        continue;
      }

      if (bytes.length < 8) continue;

      const discHex = Array.from(bytes.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const eventName = DISCRIMINATOR_MAP[discHex];
      if (!eventName) continue;

      const decoded = decodeEventData(eventName, bytes);
      if (decoded) {
        events.push({ type: eventName, data: decoded });
      }
    }
  }

  // 2. Parse CPI inner instruction events (emit_cpi!)
  if (Array.isArray(meta.innerInstructions)) {
    for (const set of meta.innerInstructions) {
      if (!set || !Array.isArray(set.instructions)) continue;
      for (const ix of set.instructions) {
        if (!ix || !ix.data) continue;
        let bytes: Uint8Array;
        try {
          if (typeof ix.data === "string") {
            bytes = new Uint8Array(base58Encoder.encode(ix.data));
          } else if (ix.data instanceof Uint8Array) {
            bytes = ix.data;
          } else {
            continue;
          }
        } catch {
          continue;
        }

        if (bytes.length < 16) continue;

        const tagHex = Array.from(bytes.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        if (tagHex !== ANCHOR_EVENT_IX_TAG_HEX) continue;

        const discHex = Array.from(bytes.slice(8, 16))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const eventName = DISCRIMINATOR_MAP[discHex];
        if (!eventName) continue;

        const decoded = decodeEventData(eventName, bytes.slice(8));
        if (decoded) {
          events.push({ type: eventName, data: decoded });
        }
      }
    }
  }

  return events;
}

// ─── Public API ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcClient = any;

/**
 * Options for pagination and filtering when fetching program events.
 */
export interface FetchEventsOptions {
  /** Maximum number of signatures to fetch per page. Default: 100 */
  limit?: number;
  /** Stop fetching after this signature (for incremental fetching). */
  until?: string;
  /** Fetch signatures before this signature (pagination cursor). */
  before?: string;
}

export interface FetchEventsResult {
  events: ProgramEvent[];
  oldestRawSignature: string | null;
  hasMore: boolean;
}

/**
 * Fetch and parse Anchor program events for a given address.
 * Works with both user wallet addresses and PDA addresses.
 *
 * @param rpc - The @solana/kit RPC client (client.runtime.rpc)
 * @param targetAddress - The address to query signatures for
 * @param options - Pagination and filtering options
 * @returns FetchEventsResult with parsed events, oldest raw signature cursor, and hasMore status
 */
export async function fetchProgramEvents(
  rpc: RpcClient,
  targetAddress: Address,
  options: FetchEventsOptions = {}
): Promise<FetchEventsResult> {
  const { limit = 100, until, before } = options;

  // 1. Get recent transaction signatures for the target address
  const sigConfig: Record<string, unknown> = { limit, commitment: "confirmed" };
  if (until) sigConfig.until = until;
  if (before) sigConfig.before = before;

  const signatures = await rpc
    .getSignaturesForAddress(targetAddress, sigConfig)
    .send();

  if (!signatures || signatures.length === 0) {
    return { events: [], oldestRawSignature: null, hasMore: false };
  }

  const oldestRawSignature =
    signatures.length > 0
      ? (signatures[signatures.length - 1].signature as string)
      : null;
  const hasMore = signatures.length === limit;

  // 2. Filter out failed transactions
  const successSigs = signatures.filter(
    (s: { err: unknown }) => s.err === null
  );

  // 3. Fetch full transactions in parallel (batches of 5)
  const events: ProgramEvent[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < successSigs.length; i += BATCH_SIZE) {
    const batch = successSigs.slice(i, i + BATCH_SIZE);

    const txPromises = batch.map(
      async (sig: { signature: string; blockTime: number | null }) => {
        try {
          const tx = await rpc
            .getTransaction(sig.signature, {
              encoding: "json",
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            })
            .send();

          if (!tx?.meta) return [];

          const parsed = parseEventsFromTxMeta(tx.meta);
          return parsed.map(
            (e) =>
              ({
                ...e,
                signature: sig.signature,
                blockTime: sig.blockTime !== null ? Number(sig.blockTime) : 0,
              }) as ProgramEvent
          );
        } catch (err) {
          console.warn(`Failed to fetch tx ${sig.signature}:`, err);
          return [];
        }
      }
    );

    const results = await Promise.all(txPromises);
    for (const batch of results) {
      events.push(...batch);
    }
  }

  // 4. Sort by blockTime descending (most recent first)
  events.sort((a, b) => b.blockTime - a.blockTime);

  return {
    events,
    oldestRawSignature,
    hasMore,
  };
}

// ─── Cache Utilities ─────────────────────────────────────────────────────────

export interface EventCache {
  events: ProgramEvent[];
  lastSignature: string;
  oldestSignature: string | null;
  hasMore: boolean;
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Retrieves cached events from localStorage if they exist and are not expired.
 *
 * @param cacheKey - Unique key string identifying the cached user events.
 * @returns The cached event object, or null if empty or expired.
 */
export function getCachedEvents(cacheKey: string): EventCache | null {
  try {
    const raw = localStorage.getItem(`pb_events:${cacheKey}`);
    if (!raw) return null;
    const cache: EventCache = JSON.parse(raw, (_, value) =>
      value && typeof value === "object" && "__bigint" in value
        ? BigInt(value.__bigint)
        : value
    );
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

/**
 * Serializes and saves program events in the localStorage cache.
 *
 * @param cacheKey - Unique key string identifying the cache slot.
 * @param events - List of parsed events to store.
 * @param lastSignature - The signature cursor corresponding to the latest event cached.
 * @param oldestSignature - The signature cursor corresponding to the oldest transaction scanned.
 * @param hasMore - Whether additional historical transactions exist on-chain.
 */
export function setCachedEvents(
  cacheKey: string,
  events: ProgramEvent[],
  lastSignature: string,
  oldestSignature: string | null = null,
  hasMore: boolean = true
): void {
  try {
    const cache: EventCache = {
      events,
      lastSignature,
      oldestSignature,
      hasMore,
      timestamp: Date.now(),
    };
    const serialized = JSON.stringify(cache, (_, value) =>
      typeof value === "bigint" ? { __bigint: value.toString() } : value
    );
    localStorage.setItem(`pb_events:${cacheKey}`, serialized);
  } catch {
    // localStorage may be full or unavailable
  }
}
