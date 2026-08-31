/**
 * Lightweight Anchor event parser compatible with @solana/kit.
 *
 * Parses Anchor program events from transaction logs without depending on
 * @coral-xyz/anchor. Events are logged as `Program data: <base64>` entries,
 * where the data starts with an 8-byte discriminator (SHA-256("event:EventName")[..8])
 * followed by Borsh-serialized fields.
 */

import { Address, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import type { ProtocolSyncScope } from "./protocol-sync-bus";

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

export interface YieldHarvestedEvent {
  poolId: number;
  cycleId: number;
  rawYield: bigint;
  fee: bigint;
  prizePot: bigint;
  lockedTicketCount: number;
  randomnessAccount: string;
}

export interface DrawSkippedEvent {
  poolId: number;
  cycleId: number;
  rawYield: bigint;
  threshold: bigint;
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

export interface DrawVoidedEvent {
  poolId: number;
  cycleId: number;
  admin: string;
  prizesReversed: bigint;
  feesReversed: bigint;
}

export interface DrawPreparationProgressEvent {
  poolId: number;
  cycleId: number;
  batchStart: number;
  batchEnd: number;
  userCount: number;
  isComplete: boolean;
}

export type ParsedProgramEvent =
  | { type: "BondsPurchased"; data: BondsPurchasedEvent }
  | { type: "BondsSold"; data: BondsSoldEvent }
  | { type: "WinningsReinvested"; data: WinningsReinvestedEvent }
  | { type: "WinningsClaimed"; data: WinningsClaimedEvent }
  | { type: "RedemptionClaimed"; data: RedemptionClaimedEvent }
  | { type: "YieldHarvested"; data: YieldHarvestedEvent }
  | { type: "DrawCompleted"; data: DrawCompletedEvent }
  | { type: "DrawForceUnlocked"; data: DrawForceUnlockedEvent }
  | { type: "DrawVoided"; data: DrawVoidedEvent }
  | { type: "DrawSkipped"; data: DrawSkippedEvent }
  | { type: "DrawPreparationProgress"; data: DrawPreparationProgressEvent };

export type ProgramEvent = ParsedProgramEvent & {
  signature: string;
  blockTime: number;
};

export type NonEmptyScopes = readonly [
  ProtocolSyncScope,
  ...ProtocolSyncScope[],
];

export interface EventMetadata {
  poolId: number;
  userAddress?: string;
  scopes: NonEmptyScopes;
  /** @deprecated Use `scopes` array instead. Returns primary scope (`scopes[0]`). */
  readonly scope: ProtocolSyncScope;
}

function createMetadata(
  poolId: number,
  scopes: NonEmptyScopes,
  userAddress?: string
): EventMetadata {
  return {
    poolId,
    userAddress,
    scopes,
    scope: scopes[0],
  };
}

export function resolveEventMetadata(evt: ParsedProgramEvent): EventMetadata {
  switch (evt.type) {
    case "BondsPurchased":
      return createMetadata(evt.data.poolId, ["pool", "user"], evt.data.user);
    case "BondsSold":
      return createMetadata(
        evt.data.poolId,
        ["pool", "user", "redemptions"],
        evt.data.user
      );
    case "WinningsReinvested":
      return createMetadata(
        evt.data.poolId,
        ["draws", "user", "pool"],
        evt.data.winner
      );
    case "WinningsClaimed":
      return createMetadata(
        evt.data.poolId,
        ["draws", "user", "pool", "redemptions"],
        evt.data.user
      );
    case "RedemptionClaimed":
      return createMetadata(
        evt.data.poolId,
        ["pool", "user", "redemptions"],
        evt.data.user
      );
    case "YieldHarvested":
      return createMetadata(evt.data.poolId, ["draws", "pool", "clock"]);
    case "DrawCompleted":
    case "DrawForceUnlocked":
    case "DrawVoided":
      return createMetadata(evt.data.poolId, ["draws", "pool"]);
    case "DrawSkipped":
      return createMetadata(evt.data.poolId, ["draws", "pool", "clock"]);
    case "DrawPreparationProgress":
      return createMetadata(evt.data.poolId, ["draws"]);
  }
}

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
  "31c5e2e89ad3f9de": "YieldHarvested",
  c1882558b47c6014: "DrawCompleted",
  "1a1dc53ce504de2d": "DrawForceUnlocked",
  "992d33ee8e91030c": "DrawVoided",
  "270b1dbe81f95cb4": "DrawSkipped",
  b0870012acfe8782: "DrawPreparationProgress",
};

// ─── Borsh Decoders ──────────────────────────────────────────────────────────

function readPubkey(view: DataView, data: Uint8Array, offset: number): string {
  const bytes = data.slice(offset, offset + 32);
  return base58Decoder.decode(bytes) as string;
}

function readBool(view: DataView, offset: number): boolean {
  return view.getUint8(offset) !== 0;
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readU64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
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
      // Pubkey(32) + u32(4) + u32(4) + u32(4) + u64(8) = 52
      if (payload.length < 52) return null;
      return {
        winner: readPubkey(view, payload, 0),
        poolId: readU32(view, 32),
        cycleId: readU32(view, 36),
        bondsBought: readU32(view, 40),
        amountReinvested: readU64(view, 44),
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
    case "YieldHarvested": {
      // u32(4) + u32(4) + u64(8) + u64(8) + u64(8) + u32(4) + Pubkey(32) = 68
      if (payload.length < 68) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        rawYield: readU64(view, 8),
        fee: readU64(view, 16),
        prizePot: readU64(view, 24),
        lockedTicketCount: readU32(view, 32),
        randomnessAccount: readPubkey(view, payload, 36),
      } as YieldHarvestedEvent;
    }
    case "DrawSkipped": {
      // u32(4) + u32(4) + u64(8) + u64(8) = 24
      if (payload.length < 24) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        rawYield: readU64(view, 8),
        threshold: readU64(view, 16),
      } as DrawSkippedEvent;
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
    case "DrawVoided": {
      // u32(4) + u32(4) + Pubkey(32) + u64(8) + u64(8) = 56
      if (payload.length < 56) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        admin: readPubkey(view, payload, 8),
        prizesReversed: readU64(view, 40),
        feesReversed: readU64(view, 48),
      } as DrawVoidedEvent;
    }
    case "DrawPreparationProgress": {
      // u32(4) + u32(4) + u32(4) + u32(4) + u32(4) + bool(1) = 21
      if (payload.length < 21) return null;
      return {
        poolId: readU32(view, 0),
        cycleId: readU32(view, 4),
        batchStart: readU32(view, 8),
        batchEnd: readU32(view, 12),
        userCount: readU32(view, 16),
        isComplete: readBool(view, 20),
      } as DrawPreparationProgressEvent;
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
export function parseEventsFromTxMeta(
  meta: Record<string, unknown> | null | undefined
): ParsedProgramEvent[] {
  const events: ParsedProgramEvent[] = [];
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
        events.push({ type: eventName, data: decoded } as ParsedProgramEvent);
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
          events.push({ type: eventName, data: decoded } as ParsedProgramEvent);
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
  genesisHash?: string;
}

const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetches the cluster's genesis hash from the RPC client.
 * Returns null if the query fails or times out.
 */
export async function fetchClusterGenesisHash(
  rpc: RpcClient
): Promise<string | null> {
  try {
    const res = await rpc.getGenesisHash().send();
    if (typeof res === "string" && res.length > 0) {
      return res;
    }
  } catch (err) {
    console.warn("Failed to fetch cluster genesis hash:", err);
  }
  return null;
}

/**
 * Retrieves cached events from localStorage if they exist, match the expected cluster genesis hash,
 * and have not expired.
 *
 * @param userAddress - The user wallet address.
 * @param expectedGenesisHash - Optional cluster genesis hash to validate ledger identity.
 * @returns The cached event object, or null if empty, mismatched, or expired.
 */
export function getCachedEvents(
  userAddress: string,
  expectedGenesisHash?: string
): EventCache | null {
  try {
    const storageKey = expectedGenesisHash
      ? `pb_events:activity:${expectedGenesisHash}:${userAddress}`
      : `pb_events:activity:${userAddress}`;

    // Clean up un-namespaced legacy key if expectedGenesisHash is provided
    const legacyKey = `pb_events:activity:${userAddress}`;
    if (expectedGenesisHash && localStorage.getItem(legacyKey)) {
      localStorage.removeItem(legacyKey);
    }

    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const cache: EventCache = JSON.parse(raw, (_, value) =>
      value && typeof value === "object" && "__bigint" in value
        ? BigInt(value.__bigint)
        : value
    );
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    // Strict genesis check: if expectedGenesisHash is specified, require exact match (reject undefined / mismatch)
    if (expectedGenesisHash && cache.genesisHash !== expectedGenesisHash) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

/**
 * Serializes and saves program events in the localStorage cache scoped by cluster genesis hash.
 *
 * @param userAddress - The user wallet address.
 * @param events - List of parsed events to store.
 * @param lastSignature - The signature cursor corresponding to the latest event cached.
 * @param oldestSignature - The signature cursor corresponding to the oldest transaction scanned.
 * @param hasMore - Whether additional historical transactions exist on-chain.
 * @param genesisHash - Optional cluster genesis hash for ledger isolation.
 */
export function setCachedEvents(
  userAddress: string,
  events: ProgramEvent[],
  lastSignature: string,
  oldestSignature: string | null = null,
  hasMore: boolean = true,
  genesisHash?: string
): void {
  try {
    const storageKey = genesisHash
      ? `pb_events:activity:${genesisHash}:${userAddress}`
      : `pb_events:activity:${userAddress}`;
    const cache: EventCache = {
      events,
      lastSignature,
      oldestSignature,
      hasMore,
      timestamp: Date.now(),
      genesisHash,
    };
    const serialized = JSON.stringify(cache, (_, value) =>
      typeof value === "bigint" ? { __bigint: value.toString() } : value
    );
    localStorage.setItem(storageKey, serialized);
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Purges cached activity feed entries from localStorage.
 *
 * @param userAddress - Optional user address to target.
 * @param genesisHash - Optional genesis hash to target.
 */
export function clearCachedEvents(
  userAddress?: string,
  genesisHash?: string
): void {
  try {
    if (userAddress && genesisHash) {
      localStorage.removeItem(
        `pb_events:activity:${genesisHash}:${userAddress}`
      );
    } else if (userAddress) {
      localStorage.removeItem(`pb_events:activity:${userAddress}`);
      // Also purge all cluster-namespaced keys for this address
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          key.startsWith("pb_events:activity:") &&
          key.endsWith(`:${userAddress}`)
        ) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } else {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("pb_events:")) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}
