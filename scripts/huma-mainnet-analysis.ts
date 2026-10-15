/**
 * Read-only mainnet analysis of Huma Finance redemption and valuation semantics (issue #15).
 *
 * Collects a state snapshot (getProgramAccounts) and a targeted transaction history
 * (pool mode-token escrows, loss authorities, sampled lender states), decodes them with
 * the checked-in Huma IDL and answers the five open questions with evidence.
 *
 * Nothing is signed or sent. Usage:
 *   npm run huma:analyze -- [--rpc <url>] [--max-signatures 5000] [--lender-sample 40]
 *                           [--concurrency 4] [--cache-dir <dir>] [--skip-history]
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseArgs } from "node:util";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getProgramDerivedAddress,
  isOffCurveAddress,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { findAtaAddress } from "../app/lib/bonds-sdk";
import { createResilientRpc, type ResilientRpcClient } from "./utils";
import { assertCluster, MAINNET_DEFAULT_RPC_URL } from "./cluster-state";
import humaIdlJson from "../anchor/huma-finance-idl.json";

export const HUMA_MAINNET_PROGRAM_ID =
  "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn";
const ANCHOR_EVENT_CPI_TAG = "e4a545ea51cb9a1d";
const SOLSCAN_TX = "https://solscan.io/tx/";

const idl = humaIdlJson as unknown as Idl;
const coder = new BorshCoder(idl);
const base58Decoder = getBase58Decoder();
const base58Encoder = getBase58Encoder();
const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Plain =
  | string
  | number
  | bigint
  | boolean
  | null
  | Plain[]
  | { [key: string]: Plain };

export interface ModeStateSnap {
  assets: bigint;
  losses: bigint;
  cumulativeYields: bigint;
  assetsRefreshedAt: bigint;
}

export interface PoolSnap {
  poolConfig: string;
  poolState: string;
  poolId: string;
  name: string;
  underlyingMint: string;
  poolAuthority: string;
  poolOwner: string;
  lossAuthority: string;
  nextRequestId: bigint;
  lastRequestId: bigint;
  modeConfigKeys: string[];
  modeStates: ModeStateSnap[];
  operators: string[];
}

export interface ModeSnap {
  modeConfig: string;
  poolConfig: string;
  name: string;
  modeMint: string;
  modeTokenProgram: string;
  mintSupply: bigint;
  poolModeToken: string;
}

export interface LenderSnap {
  address: string;
  lender: string;
  numPending: bigint;
  processed: bigint;
  withdrawn: bigint;
  sharesPending: bigint;
}

export interface RequestSnap {
  address: string;
  id: bigint;
  lender: string;
  modeConfig: string;
  sharesRequested: bigint;
  requestedAt: bigint;
}

export interface Snapshot {
  slot: bigint;
  pools: PoolSnap[];
  modes: ModeSnap[];
  lenders: LenderSnap[];
  openRequests: RequestSnap[];
  /** PoolOperator PDAs; operator keys are not stored, so signers are matched by re-deriving. */
  operatorPdas: string[];
}

/** Normalized, JSON-safe transaction shape cached on disk. */
export interface RawIx {
  programIdIndex: number;
  accounts: number[];
  data: string; // base58
}

export interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner: string | null;
  amount: string;
}

export interface RawTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
  accountKeys: string[];
  instructions: RawIx[];
  inner: { index: number; instructions: RawIx[] }[];
  logs: string[];
  preTokenBalances: RawTokenBalance[];
  postTokenBalances: RawTokenBalance[];
}

export interface DecodedIx {
  /** Top-level instruction index this call belongs to. */
  topIndex: number;
  inner: boolean;
  name: string;
  /**
   * `current` matches the checked-in IDL, `legacy` matches a verified older layout and
   * `unknown` means positional account names are unreliable (only `signer` at index 0 is safe).
   */
  layout: "current" | "legacy" | "unknown";
  accounts: Record<string, string>;
  args: Plain;
}

export interface DecodedEvent {
  topIndex: number;
  name: string;
  /** Decoded with the pre-upgrade u128 field layout. */
  legacy: boolean;
  data: Record<string, Plain>;
}

export interface TokenDelta {
  account: string;
  mint: string;
  owner: string | null;
  pre: bigint;
  post: bigint;
}

export interface HumaTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  ixs: DecodedIx[];
  events: DecodedEvent[];
  tokenBalances: TokenDelta[];
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Converts Anchor-decoded values (BN, PublicKey, enums) into plain JSON-friendly values. */
export function toPlain(value: unknown): Plain {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint" || typeof value === "boolean") return value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Uint8Array) return toHex(value);
  const obj = value as { toBase58?: () => string; toString: () => string };
  if (typeof obj.toBase58 === "function") return obj.toBase58();
  if (
    value.constructor?.name === "BN" ||
    (typeof (value as { toArrayLike?: unknown }).toArrayLike === "function" &&
      typeof (value as { words?: unknown }).words === "object")
  ) {
    return BigInt(obj.toString());
  }
  const out: Record<string, Plain> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = toPlain(v);
  }
  return out;
}

interface IdlIxMeta {
  name: string;
  accountNames: string[];
}

const IX_BY_DISC = new Map<string, IdlIxMeta>(
  (
    humaIdlJson as unknown as {
      instructions: {
        name: string;
        discriminator: number[];
        accounts: { name: string }[];
      }[];
    }
  ).instructions.map((ix) => [
    toHex(Uint8Array.from(ix.discriminator)),
    { name: ix.name, accountNames: ix.accounts.map((a) => a.name) },
  ])
);

export const HUMA_EVENT_NAMES = [
  "RedemptionRequestAddedEventV2",
  "RedemptionRequestProcessedEvent",
  "RedemptionRequestCanceledEvent",
  "FullyCanceledRedemptionRequestSkippedEvent",
  "LenderFundDisbursedEvent",
  "LossDeclaredEvent",
  "LossRecoveredEvent",
  "ModeAssetsRefreshedEvent",
] as const;

export function eventDiscriminator(name: string): Uint8Array {
  return crypto
    .createHash("sha256")
    .update(`event:${name}`)
    .digest()
    .subarray(0, 8);
}

const EVENT_BY_DISC = new Map<string, string>(
  HUMA_EVENT_NAMES.map((n) => [toHex(eventDiscriminator(n)), n])
);

type IdlField = { name: string; type: unknown };
type IdlTypeDef = { name: string; type: { kind: string; fields?: IdlField[] } };

const PRIMITIVE_SIZES: Record<string, number> = {
  u8: 1,
  bool: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  i64: 8,
  f64: 8,
  u128: 16,
  pubkey: 32,
};

/** Borsh size of a struct made only of primitives; null when any field is variable-length. */
function fixedStructSize(def: IdlTypeDef | undefined): number | null {
  let size = 0;
  for (const f of def?.type.fields ?? []) {
    const s = typeof f.type === "string" ? PRIMITIVE_SIZES[f.type] : undefined;
    if (s === undefined) return null;
    size += s;
  }
  return def ? size : null;
}

/**
 * Before slot ~418M Huma emitted amount/share fields as u128 (verified: every widened
 * `RedemptionRequestProcessedEvent.amount_processed` equals the lender's USDC delta).
 * The legacy layout widens every u64 except `*_at` timestamps.
 */
const legacyIdl = (() => {
  const clone = JSON.parse(JSON.stringify(humaIdlJson)) as {
    types: IdlTypeDef[];
  };
  for (const def of clone.types) {
    if (!(HUMA_EVENT_NAMES as readonly string[]).includes(def.name)) continue;
    for (const f of def.type.fields ?? []) {
      if (f.type === "u64" && !f.name.endsWith("_at")) f.type = "u128";
    }
  }
  return clone;
})();
const legacyCoder = new BorshCoder(legacyIdl as unknown as Idl);
const typeDef = (source: { types: IdlTypeDef[] }, name: string) =>
  source.types.find((t) => t.name === name);

/** Decodes `<8-byte event discriminator><borsh payload>`; returns null for unknown events. */
export function decodeEventBytes(
  bytes: Uint8Array
): { name: string; legacy: boolean; data: Record<string, Plain> } | null {
  if (bytes.length < 8) return null;
  const name = EVENT_BY_DISC.get(toHex(bytes.subarray(0, 8)));
  if (!name) return null;
  const payload = Buffer.from(bytes.subarray(8));
  const legacySize = fixedStructSize(typeDef(legacyIdl, name));
  const currentSize = fixedStructSize(
    typeDef(humaIdlJson as unknown as { types: IdlTypeDef[] }, name)
  );
  const legacy =
    legacySize !== null &&
    legacySize !== currentSize &&
    payload.length === legacySize;
  const decoded = (legacy ? legacyCoder : coder).types.decode(name, payload);
  return { name, legacy, data: toPlain(decoded) as Record<string, Plain> };
}

const idlAccountNames = (ixName: string): string[] =>
  [...IX_BY_DISC.values()].find((m) => m.name === ixName)?.accountNames ?? [];

/**
 * Older on-chain account layouts, keyed by instruction and account count. Verified against
 * mainnet: before slot ~391M `process_redemption_request` had no `strategy_manager_wallet`
 * (re-mapped this way every legacy call targets the lender's ATA, the None sentinel, or a
 * skipped request).
 */
const LEGACY_ACCOUNT_LAYOUTS: Record<string, Record<number, string[]>> = {
  process_redemption_request: {
    17: idlAccountNames("process_redemption_request").filter(
      (n) => n !== "strategy_manager_wallet"
    ),
  },
};

function decodeIx(
  ix: RawIx,
  keys: string[],
  topIndex: number,
  inner: boolean
): DecodedIx | null {
  if (keys[ix.programIdIndex] !== HUMA_MAINNET_PROGRAM_ID) return null;
  const data = base58Encoder.encode(ix.data);
  if (data.length < 8) return null;
  const meta = IX_BY_DISC.get(toHex(data.subarray(0, 8)));
  if (!meta) return null;
  const legacyNames = LEGACY_ACCOUNT_LAYOUTS[meta.name]?.[ix.accounts.length];
  const layout =
    ix.accounts.length === meta.accountNames.length
      ? "current"
      : legacyNames
        ? "legacy"
        : "unknown";
  const accounts: Record<string, string> = {};
  (legacyNames ?? meta.accountNames).forEach((name, i) => {
    const idx = ix.accounts[i];
    if (idx !== undefined) accounts[name] = keys[idx];
  });
  let args: Plain = null;
  try {
    const decoded = coder.instruction.decode(Buffer.from(data));
    args = decoded ? toPlain(decoded.data) : null;
  } catch {
    args = null;
  }
  return { topIndex, inner, name: meta.name, layout, accounts, args };
}

/**
 * Extracts Huma events from `Program data:` logs (attributed via the invoke stack) and
 * from `emit_cpi!` self-invocations.
 */
export function decodeEvents(tx: RawTx): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  const stack: string[] = [];
  let topIndex = -1;
  for (const line of tx.logs) {
    const invoke = /^Program (\S+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      if (invoke[2] === "1") topIndex += 1;
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \S+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (
      line.startsWith("Program data: ") &&
      stack[stack.length - 1] === HUMA_MAINNET_PROGRAM_ID
    ) {
      const decoded = decodeEventBytes(
        Buffer.from(line.slice("Program data: ".length), "base64")
      );
      if (decoded) events.push({ topIndex, ...decoded });
    }
  }
  for (const set of tx.inner) {
    for (const ix of set.instructions) {
      if (tx.accountKeys[ix.programIdIndex] !== HUMA_MAINNET_PROGRAM_ID)
        continue;
      const data = base58Encoder.encode(ix.data);
      if (toHex(data.subarray(0, 8)) !== ANCHOR_EVENT_CPI_TAG) continue;
      const decoded = decodeEventBytes(data.subarray(8));
      if (decoded) events.push({ topIndex: set.index, ...decoded });
    }
  }
  return events;
}

export function tokenBalances(tx: RawTx): TokenDelta[] {
  const byIndex = new Map<number, TokenDelta>();
  const upsert = (b: RawTokenBalance, field: "pre" | "post") => {
    const existing = byIndex.get(b.accountIndex) ?? {
      account: tx.accountKeys[b.accountIndex],
      mint: b.mint,
      owner: b.owner,
      pre: 0n,
      post: 0n,
    };
    existing[field] = BigInt(b.amount);
    existing.owner = existing.owner ?? b.owner;
    byIndex.set(b.accountIndex, existing);
  };
  tx.preTokenBalances.forEach((b) => upsert(b, "pre"));
  tx.postTokenBalances.forEach((b) => upsert(b, "post"));
  return [...byIndex.values()];
}

export function decodeHumaTx(tx: RawTx): HumaTx {
  const ixs: DecodedIx[] = [];
  tx.instructions.forEach((ix, i) => {
    const d = decodeIx(ix, tx.accountKeys, i, false);
    if (d) ixs.push(d);
  });
  for (const set of tx.inner) {
    for (const ix of set.instructions) {
      const d = decodeIx(ix, tx.accountKeys, set.index, true);
      if (d) ixs.push(d);
    }
  }
  return {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    ixs,
    events: decodeEvents(tx),
    tokenBalances: tokenBalances(tx),
  };
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

export function u128Bytes(value: bigint, endian: "le" | "be"): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byte = Number((value >> BigInt(8 * i)) & 0xffn);
    out[endian === "le" ? i : 15 - i] = byte;
  }
  return out;
}

export async function deriveRedemptionRequestPda(
  id: bigint,
  poolConfig: string,
  endian: "le" | "be"
): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(HUMA_MAINNET_PROGRAM_ID),
    seeds: [
      textEncoder.encode("redemption_request"),
      u128Bytes(id, endian),
      base58Encoder.encode(poolConfig),
    ],
  });
  return pda;
}

/** Derives a Huma PDA; string seeds are UTF-8 encoded by kit. */
async function derivePda(
  seeds: (string | ReadonlyUint8Array)[]
): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(HUMA_MAINNET_PROGRAM_ID),
    seeds,
  });
  return pda;
}

// ---------------------------------------------------------------------------
// Analysis (pure functions over snapshot + decoded history)
// ---------------------------------------------------------------------------

const asBig = (v: Plain | undefined): bigint => BigInt(v as string | bigint);
const asStr = (v: Plain | undefined): string => String(v);

/** Instructions with a trustworthy account mapping (`unknown` layouts only when requested). */
function successfulIxs(
  txs: HumaTx[],
  name: string,
  allowUnknownLayout = false
) {
  return txs.flatMap((tx) =>
    tx.ixs
      .filter(
        (ix) =>
          ix.name === name && (allowUnknownLayout || ix.layout !== "unknown")
      )
      .map((ix) => ({ tx, ix }))
  );
}

export type Q1Category =
  | "none_passed"
  | "canonical_ata"
  | "other_lender_owned_account"
  | "not_owned_by_lender"
  | "owner_unknown";

export interface Q1Row {
  signature: string;
  instruction: string;
  lender: string;
  lenderIsPda: boolean;
  lenderUnderlyingToken: string;
  expectedAta: string;
  owner: string | null;
  category: Q1Category;
  usdcDelta: bigint | null;
}

/** Q1: which account receives the USDC on `process_redemption_request` / `disburse`. */
export async function analyzeQ1(txs: HumaTx[]): Promise<Q1Row[]> {
  const rows: Q1Row[] = [];
  for (const name of ["process_redemption_request", "disburse"]) {
    for (const { tx, ix } of successfulIxs(txs, name)) {
      const lender = ix.accounts.lender;
      const target = ix.accounts.lender_underlying_token;
      const mint = ix.accounts.underlying_mint;
      const tokenProgram =
        ix.accounts.underlying_token_program ?? ix.accounts.token_program;
      if (!lender || !target || !mint || !tokenProgram) continue;
      const expectedAta = await findAtaAddress(
        lender,
        mint,
        address(tokenProgram)
      );
      const bal = tx.tokenBalances.find((b) => b.account === target);
      const owner = bal?.owner ?? null;
      // Anchor encodes an omitted optional account as the program's own id.
      const category: Q1Category =
        target === HUMA_MAINNET_PROGRAM_ID
          ? "none_passed"
          : target === expectedAta
            ? "canonical_ata"
            : owner === null
              ? "owner_unknown"
              : owner === lender
                ? "other_lender_owned_account"
                : "not_owned_by_lender";
      rows.push({
        signature: tx.signature,
        instruction: name,
        lender,
        lenderIsPda: isOffCurveAddress(address(lender)),
        lenderUnderlyingToken: target,
        expectedAta,
        owner,
        category,
        usdcDelta: bal ? bal.post - bal.pre : null,
      });
    }
  }
  return rows;
}

export interface Q2LenderEvidence {
  lenderState: string;
  lender: string;
  processed: bigint;
  withdrawn: bigint;
  pushedInHistory: bigint;
  disbursedInHistory: bigint;
  processTxs: number;
  disburseTxs: number;
}

export interface Q2Result {
  population: {
    lendersWithProcessed: number;
    withdrawnEqualsProcessed: number;
    withdrawnBelowProcessed: number;
    withdrawnAboveProcessed: number;
  };
  /**
   * Lender states touched by `process_redemption_request` in the fetched history, split by
   * whether the Sentinel ever passed None for them and by their current record.
   */
  processedInHistory: {
    pushOnlyWithdrawnEqualsProcessed: number;
    pushOnlyWithdrawnBelowProcessed: number;
    someNoneWithdrawnEqualsProcessed: number;
    someNoneWithdrawnBelowProcessed: number;
  };
  sampled: Q2LenderEvidence[];
  verdict: string;
}

/**
 * Q2: does a successful push increase `total_amount_withdrawn`?
 * Strongest evidence: sampled lenders whose full lender_state history has pushes but no disburse.
 */
export function analyzeQ2(
  snapshot: Snapshot,
  txs: HumaTx[],
  sampledLenderStates: string[]
): Q2Result {
  const withProcessed = snapshot.lenders.filter((l) => l.processed > 0n);
  const population = {
    lendersWithProcessed: withProcessed.length,
    withdrawnEqualsProcessed: withProcessed.filter(
      (l) => l.withdrawn === l.processed
    ).length,
    withdrawnBelowProcessed: withProcessed.filter(
      (l) => l.withdrawn < l.processed
    ).length,
    withdrawnAboveProcessed: withProcessed.filter(
      (l) => l.withdrawn > l.processed
    ).length,
  };
  const sampled: Q2LenderEvidence[] = [];
  for (const stateAddr of sampledLenderStates) {
    const snap = snapshot.lenders.find((l) => l.address === stateAddr);
    if (!snap) continue;
    let pushed = 0n;
    let disbursed = 0n;
    let processTxs = 0;
    let disburseTxs = 0;
    for (const tx of txs) {
      for (const ix of tx.ixs) {
        if (ix.accounts.lender_state !== stateAddr) continue;
        const target = ix.accounts.lender_underlying_token;
        const delta = tx.tokenBalances.find((b) => b.account === target);
        const received = delta ? delta.post - delta.pre : 0n;
        if (ix.name === "process_redemption_request") {
          processTxs += 1;
          pushed += received > 0n ? received : 0n;
        } else if (ix.name === "disburse") {
          disburseTxs += 1;
          disbursed += tx.events
            .filter(
              (e) =>
                e.name === "LenderFundDisbursedEvent" &&
                e.topIndex === ix.topIndex &&
                e.data.lender === snap.lender
            )
            .reduce((s, e) => s + asBig(e.data.amount_disbursed), 0n);
        }
      }
    }
    sampled.push({
      lenderState: stateAddr,
      lender: snap.lender,
      processed: snap.processed,
      withdrawn: snap.withdrawn,
      pushedInHistory: pushed,
      disbursedInHistory: disbursed,
      processTxs,
      disburseTxs,
    });
  }
  const sentNone = new Map<string, boolean>();
  for (const { ix } of successfulIxs(txs, "process_redemption_request")) {
    const state = ix.accounts.lender_state;
    const none =
      ix.accounts.lender_underlying_token === HUMA_MAINNET_PROGRAM_ID;
    sentNone.set(state, (sentNone.get(state) ?? false) || none);
  }
  const processedInHistory = {
    pushOnlyWithdrawnEqualsProcessed: 0,
    pushOnlyWithdrawnBelowProcessed: 0,
    someNoneWithdrawnEqualsProcessed: 0,
    someNoneWithdrawnBelowProcessed: 0,
  };
  const byAddress = new Map(snapshot.lenders.map((l) => [l.address, l]));
  for (const [state, none] of sentNone) {
    const snap = byAddress.get(state);
    if (!snap || snap.withdrawn > snap.processed) continue;
    const equal = snap.withdrawn === snap.processed;
    const key = none
      ? equal
        ? "someNoneWithdrawnEqualsProcessed"
        : "someNoneWithdrawnBelowProcessed"
      : equal
        ? "pushOnlyWithdrawnEqualsProcessed"
        : "pushOnlyWithdrawnBelowProcessed";
    processedInHistory[key] += 1;
  }
  const pushOnly = sampled.filter(
    (s) => s.pushedInHistory > 0n && s.disburseTxs === 0
  );
  const pushNotCounted = pushOnly.filter((s) => s.withdrawn < s.processed);
  const pushOnlyStates =
    processedInHistory.pushOnlyWithdrawnEqualsProcessed +
    processedInHistory.pushOnlyWithdrawnBelowProcessed;
  const verdict =
    pushOnlyStates === 0 && pushOnly.length === 0
      ? "Inconclusive: no lender state was only ever pushed to."
      : processedInHistory.pushOnlyWithdrawnBelowProcessed === 0 &&
          pushNotCounted.length === 0
        ? `Push increases total_amount_withdrawn: all ${pushOnlyStates} push-only lender states (and ${pushOnly.length}/${pushOnly.length} sampled push-only lenders with full history) have withdrawn == processed.`
        : `Mixed: ${processedInHistory.pushOnlyWithdrawnBelowProcessed} push-only lender states and ${pushNotCounted.length} sampled push-only lenders have withdrawn < processed.`;
  return { population, processedInHistory, sampled, verdict };
}

export interface Q3PoolResult {
  poolConfig: string;
  nextRequestId: bigint;
  lastRequestId: bigint;
  openRequestIds: bigint[];
  addedIdCount: number;
  /**
   * Longest gap-free run of added ids ending at the highest observed id. History is sampled,
   * so gaps below the run usually mean "not fetched", not "skipped by Huma".
   */
  recentContiguousRun: { from: bigint; to: bigint; count: number } | null;
  /** Pairs where a later transaction carries a lower request id (0 => ids grow monotonically). */
  idTimeInversions: number;
  maxAddedId: bigint | null;
  maxResolvedId: bigint | null;
  pdaEndianness: "le" | "be" | "mismatch" | "unknown";
}

/** Q3: request-id allocation and the meaning of next/last_request_id. */
export async function analyzeQ3(
  snapshot: Snapshot,
  txs: HumaTx[]
): Promise<Q3PoolResult[]> {
  const results: Q3PoolResult[] = [];
  for (const pool of snapshot.pools) {
    const addIxs = successfulIxs(txs, "add_redemption_request_v2").filter(
      ({ ix }) => ix.accounts.pool_config === pool.poolConfig
    );
    const added: { id: bigint; slot: number }[] = [];
    let le = 0;
    let be = 0;
    let checked = 0;
    for (const { tx, ix } of addIxs) {
      const evt = tx.events.find(
        (e) =>
          e.name === "RedemptionRequestAddedEventV2" &&
          e.topIndex === ix.topIndex
      );
      if (!evt) continue;
      const id = asBig(evt.data.request_id);
      added.push({ id, slot: tx.slot });
      const reqAddr = ix.accounts.redemption_request;
      if (reqAddr) {
        checked += 1;
        if (
          (await deriveRedemptionRequestPda(id, pool.poolConfig, "le")) ===
          reqAddr
        )
          le += 1;
        else if (
          (await deriveRedemptionRequestPda(id, pool.poolConfig, "be")) ===
          reqAddr
        )
          be += 1;
      }
    }
    const poolModes = new Set(pool.modeConfigKeys);
    const resolvedIds = txs.flatMap((tx) =>
      tx.events
        .filter(
          (e) =>
            e.name === "RedemptionRequestProcessedEvent" ||
            e.name === "FullyCanceledRedemptionRequestSkippedEvent"
        )
        .filter((e) =>
          tx.ixs.some(
            (ix) =>
              ix.topIndex === e.topIndex &&
              ix.accounts.pool_config === pool.poolConfig
          )
        )
        .map((e) => asBig(e.data.request_id))
    );
    const sorted = [...new Set(added.map((a) => a.id))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    let runStart = sorted.length - 1;
    while (runStart > 0 && sorted[runStart - 1] === sorted[runStart] - 1n)
      runStart -= 1;
    const bySlot = [...added].sort((a, b) => a.slot - b.slot);
    const idTimeInversions = bySlot.filter(
      (a, i) => i > 0 && a.id < bySlot[i - 1].id
    ).length;
    const max = (xs: bigint[]) =>
      xs.length ? xs.reduce((a, b) => (a > b ? a : b)) : null;
    results.push({
      poolConfig: pool.poolConfig,
      nextRequestId: pool.nextRequestId,
      lastRequestId: pool.lastRequestId,
      openRequestIds: snapshot.openRequests
        .filter((r) => poolModes.has(r.modeConfig))
        .map((r) => r.id),
      addedIdCount: sorted.length,
      recentContiguousRun: sorted.length
        ? {
            from: sorted[runStart],
            to: sorted[sorted.length - 1],
            count: sorted.length - runStart,
          }
        : null,
      idTimeInversions,
      maxAddedId: max(sorted),
      maxResolvedId: max(resolvedIds),
      pdaEndianness:
        checked === 0
          ? "unknown"
          : le === checked
            ? "le"
            : be === checked
              ? "be"
              : "mismatch",
    });
  }
  return results;
}

export interface Q4PriceRow {
  signature: string;
  requestId: bigint;
  shares: bigint;
  amount: bigint;
  /** amount / shares in micro-USDC per 1e6 shares. */
  pricePerMillionShares: bigint;
}

export interface Q4Result {
  modesWithLosses: {
    modeConfig: string;
    assets: bigint;
    losses: bigint;
    supply: bigint;
  }[];
  lossEvents: {
    signature: string;
    name: string;
    data: Record<string, Plain>;
  }[];
  currentPricesPerMillionShares: {
    modeConfig: string;
    gross: bigint | null;
    netOfLosses: bigint | null;
  }[];
  recentProcessedPrices: Q4PriceRow[];
  verdict: string;
}

/** Q4: is ModeState.assets already net of ModeState.losses? */
export function analyzeQ4(snapshot: Snapshot, txs: HumaTx[]): Q4Result {
  const modesWithLosses: Q4Result["modesWithLosses"] = [];
  const currentPrices: Q4Result["currentPricesPerMillionShares"] = [];
  for (const pool of snapshot.pools) {
    pool.modeConfigKeys.forEach((modeConfig, i) => {
      const state = pool.modeStates[i];
      const mode = snapshot.modes.find((m) => m.modeConfig === modeConfig);
      if (!state || !mode) return;
      if (state.losses > 0n)
        modesWithLosses.push({
          modeConfig,
          assets: state.assets,
          losses: state.losses,
          supply: mode.mintSupply,
        });
      const price = (assets: bigint) =>
        mode.mintSupply > 0n ? (assets * 1_000_000n) / mode.mintSupply : null;
      currentPrices.push({
        modeConfig,
        gross: price(state.assets),
        netOfLosses: price(
          state.assets > state.losses ? state.assets - state.losses : 0n
        ),
      });
    });
  }
  const lossEvents = txs.flatMap((tx) =>
    tx.events
      .filter(
        (e) => e.name === "LossDeclaredEvent" || e.name === "LossRecoveredEvent"
      )
      .map((e) => ({ signature: tx.signature, name: e.name, data: e.data }))
  );
  const recentProcessedPrices = txs
    .flatMap((tx) =>
      tx.events
        .filter((e) => e.name === "RedemptionRequestProcessedEvent")
        .map((e) => ({ tx, e }))
    )
    .sort((a, b) => b.tx.slot - a.tx.slot)
    .slice(0, 20)
    .map(({ tx, e }) => {
      const shares = asBig(e.data.shares_processed);
      const amount = asBig(e.data.amount_processed);
      return {
        signature: tx.signature,
        requestId: asBig(e.data.request_id),
        shares,
        amount,
        pricePerMillionShares:
          shares > 0n ? (amount * 1_000_000n) / shares : 0n,
      };
    });
  const declared = lossEvents.filter((e) => e.name === "LossDeclaredEvent");
  const verdict =
    modesWithLosses.length === 0 && declared.length === 0
      ? "Not determinable on-chain: no mode has nonzero losses and no LossDeclaredEvent was observed, so gross and net valuations coincide. Ask Huma or read their source."
      : "Losses observed: compare recentProcessedPrices against gross vs net prices around the loss events (see evidence).";
  return {
    modesWithLosses,
    lossEvents,
    currentPricesPerMillionShares: currentPrices,
    recentProcessedPrices,
    verdict,
  };
}

export type Q5SignerRole =
  | "lender"
  /** The key that signs `process_redemption_request` (Huma's Sentinel). */
  | "sentinel"
  | "pool_operator"
  | "pool_owner"
  | "request_payer"
  | "other";

export interface Q5Row {
  signature: string;
  blockTime: number | null;
  signer: string;
  signerRole: Q5SignerRole;
  requestId: bigint | null;
  lender: string | null;
  shares: bigint | null;
  /** Lender-owned account whose mode-token balance increased (layout-independent). */
  lenderModeToken: string | null;
  lenderModeTokenOwner: string | null;
  sharesReturned: bigint | null;
  secondsSinceRequest: number | null;
}

/** Q5: who cancels redemption requests and where the shares go. */
export function analyzeQ5(snapshot: Snapshot, txs: HumaTx[]): Q5Row[] {
  const addedAt = new Map<
    string,
    { blockTime: number | null; payer: string }
  >();
  for (const tx of txs) {
    for (const e of tx.events) {
      if (e.name !== "RedemptionRequestAddedEventV2") continue;
      addedAt.set(`${asStr(e.data.mode_config)}:${asStr(e.data.request_id)}`, {
        blockTime: tx.blockTime,
        payer: asStr(e.data.payer),
      });
    }
  }
  const sentinels = new Set(
    successfulIxs(txs, "process_redemption_request").map(
      ({ ix }) => ix.accounts.signer
    )
  );
  const rows: Q5Row[] = [];
  // Legacy cancel layouts are unverified, so only `signer` (index 0), events and token
  // balances are used here.
  for (const { tx, ix } of successfulIxs(
    txs,
    "cancel_redemption_request",
    true
  )) {
    const evt = tx.events.find(
      (e) =>
        e.name === "RedemptionRequestCanceledEvent" &&
        e.topIndex === ix.topIndex
    );
    const pool = evt
      ? snapshot.pools.find((p) =>
          p.modeConfigKeys.includes(asStr(evt.data.mode_config))
        )
      : undefined;
    const lender = evt ? asStr(evt.data.lender) : null;
    const requestId = evt ? asBig(evt.data.request_id) : null;
    const added =
      evt &&
      addedAt.get(
        `${asStr(evt.data.mode_config)}:${asStr(evt.data.request_id)}`
      );
    const signer = ix.accounts.signer;
    const signerRole: Q5SignerRole =
      signer === lender
        ? "lender"
        : sentinels.has(signer)
          ? "sentinel"
          : pool?.operators.includes(signer)
            ? "pool_operator"
            : signer === pool?.poolOwner
              ? "pool_owner"
              : added && signer === added.payer
                ? "request_payer"
                : "other";
    const bal = tx.tokenBalances.find(
      (b) => lender !== null && b.owner === lender && b.post > b.pre
    );
    rows.push({
      signature: tx.signature,
      blockTime: tx.blockTime,
      signer,
      signerRole,
      requestId,
      lender,
      shares: evt ? asBig(evt.data.shares) : null,
      lenderModeToken: bal?.account ?? null,
      lenderModeTokenOwner: bal?.owner ?? null,
      sharesReturned: bal ? bal.post - bal.pre : null,
      secondsSinceRequest:
        added?.blockTime && tx.blockTime
          ? tx.blockTime - added.blockTime
          : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Collection (RPC)
// ---------------------------------------------------------------------------

function accountDiscriminator(name: string): Uint8Array {
  const acc = (
    humaIdlJson as unknown as {
      accounts: { name: string; discriminator: number[] }[];
    }
  ).accounts.find((a) => a.name === name);
  if (!acc) throw new Error(`Account ${name} missing from Huma IDL`);
  return Uint8Array.from(acc.discriminator);
}

async function fetchProgramAccounts(
  rpc: ResilientRpcClient,
  accountName: string,
  dataSlice?: { offset: number; length: number }
): Promise<{ pubkey: string; data: Buffer }[]> {
  const result = await rpc
    .getProgramAccounts(address(HUMA_MAINNET_PROGRAM_ID), {
      encoding: "base64",
      dataSlice: dataSlice
        ? { offset: dataSlice.offset, length: dataSlice.length }
        : undefined,
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: base58Decoder.decode(
              accountDiscriminator(accountName)
            ) as never,
            encoding: "base58",
          },
        },
      ],
    })
    .send();
  return (
    result as unknown as {
      pubkey: string;
      account: { data: [string, string] };
    }[]
  ).map((r) => ({
    pubkey: r.pubkey,
    data: Buffer.from(r.account.data[0], "base64"),
  }));
}

const decodeAccount = (name: string, data: Buffer) =>
  toPlain(coder.accounts.decode(name, data)) as Record<string, Plain>;

const readU128 = (buf: Buffer, offset: number): bigint =>
  buf.readBigUInt64LE(offset) + (buf.readBigUInt64LE(offset + 8) << 64n);

export async function collectSnapshot(
  rpc: ResilientRpcClient
): Promise<Snapshot> {
  const slot = await rpc.getSlot().send();
  const poolConfigs = await fetchProgramAccounts(rpc, "PoolConfig");
  const poolStates = await fetchProgramAccounts(rpc, "PoolState");
  const modeConfigs = await fetchProgramAccounts(rpc, "ModeConfig");
  const operatorAccounts = await fetchProgramAccounts(rpc, "PoolOperator");
  const requests = await fetchProgramAccounts(rpc, "RedemptionRequest");
  // LenderState: bump(1) + lender(32) + 4 x u128, read after the 8-byte discriminator.
  const lenderStates = await fetchProgramAccounts(rpc, "LenderState", {
    offset: 8,
    length: 1 + 32 + 64,
  });

  const pools: PoolSnap[] = [];
  for (const pc of poolConfigs) {
    let cfg: Record<string, Plain>;
    try {
      cfg = decodeAccount("PoolConfig", pc.data);
    } catch {
      // Legacy test pools use an older layout than the checked-in IDL.
      console.warn(
        `  skipping PoolConfig ${pc.pubkey}: does not match IDL layout (${pc.data.length} bytes)`
      );
      continue;
    }
    const poolState = await derivePda([
      "pool_state",
      base58Encoder.encode(pc.pubkey),
    ]);
    const stateAcc = poolStates.find((s) => s.pubkey === poolState);
    if (!stateAcc) continue;
    const st = decodeAccount("PoolState", stateAcc.data);
    const redemption = st.redemption as Record<string, Plain>;
    const poolAuthority = await derivePda([
      "pool_authority",
      base58Encoder.encode(pc.pubkey),
    ]);
    pools.push({
      poolConfig: pc.pubkey,
      poolState,
      poolId: asStr(cfg.pool_id),
      name: asStr(cfg.pool_name),
      underlyingMint: asStr(cfg.underlying_mint),
      poolAuthority,
      poolOwner: asStr(cfg.pool_owner),
      lossAuthority: asStr(cfg.loss_authority),
      nextRequestId: asBig(redemption.next_request_id),
      lastRequestId: asBig(redemption.last_request_id),
      modeConfigKeys: (st.mode_config_keys as Plain[]).map(asStr),
      modeStates: (st.mode_states as Record<string, Plain>[]).map((m) => ({
        assets: asBig(m.assets),
        losses: asBig(m.losses),
        cumulativeYields: asBig(m.cumulative_yields),
        assetsRefreshedAt: asBig(m.assets_refreshed_at),
      })),
      operators: [],
    });
  }

  const modes: ModeSnap[] = [];
  for (const mc of modeConfigs) {
    const pool = pools.find((p) => p.modeConfigKeys.includes(mc.pubkey));
    if (!pool) continue;
    const cfg = decodeAccount("ModeConfig", mc.data);
    const modeMint = await derivePda([
      "mode_mint",
      base58Encoder.encode(pool.poolConfig),
      base58Encoder.encode(mc.pubkey),
    ]);
    const mintInfo = await rpc
      .getAccountInfo(address(modeMint), { encoding: "base64" })
      .send();
    const modeTokenProgram = mintInfo.value?.owner ?? "";
    const supply = await rpc.getTokenSupply(address(modeMint)).send();
    modes.push({
      modeConfig: mc.pubkey,
      poolConfig: pool.poolConfig,
      name: asStr(cfg.name),
      modeMint,
      modeTokenProgram,
      mintSupply: BigInt(supply.value.amount),
      poolModeToken: await findAtaAddress(
        pool.poolAuthority,
        modeMint,
        address(modeTokenProgram)
      ),
    });
  }

  const lenders: LenderSnap[] = lenderStates.map(({ pubkey, data }) => ({
    address: pubkey,
    lender: base58Decoder.decode(data.subarray(1, 33)),
    numPending: readU128(data, 33),
    processed: readU128(data, 49),
    withdrawn: readU128(data, 65),
    sharesPending: readU128(data, 81),
  }));

  const openRequests: RequestSnap[] = requests.map(({ pubkey, data }) => {
    const r = decodeAccount("RedemptionRequest", data);
    return {
      address: pubkey,
      id: asBig(r.id),
      lender: asStr(r.lender),
      modeConfig: asStr(r.mode_config),
      sharesRequested: asBig(r.shares_requested),
      requestedAt: asBig(r.requested_at),
    };
  });

  return {
    slot,
    pools,
    modes,
    lenders,
    openRequests,
    operatorPdas: operatorAccounts.map((o) => o.pubkey),
  };
}

/** Marks a signer as operator when PDA("pool_operator", pool_config, signer) exists. */
export async function resolveOperators(
  snapshot: Snapshot,
  candidates: string[]
): Promise<void> {
  for (const pool of snapshot.pools) {
    for (const signer of new Set(candidates)) {
      const pda = await derivePda([
        "pool_operator",
        base58Encoder.encode(pool.poolConfig),
        base58Encoder.encode(signer),
      ]);
      if (
        snapshot.operatorPdas.includes(pda) &&
        !pool.operators.includes(signer)
      ) {
        pool.operators.push(signer);
      }
    }
  }
}

async function fetchSignatures(
  rpc: ResilientRpcClient,
  target: string,
  max: number
): Promise<string[]> {
  const out: string[] = [];
  let before: string | undefined;
  while (out.length < max) {
    const page = await rpc
      .getSignaturesForAddress(address(target), {
        limit: Math.min(1000, max - out.length),
        before: before as never,
      })
      .send();
    if (page.length === 0) break;
    for (const s of page) if (s.err === null) out.push(s.signature);
    before = page[page.length - 1].signature;
    if (page.length < 1000) break;
  }
  return out;
}

function normalizeTx(signature: string, raw: unknown): RawTx {
  const tx = raw as {
    slot: bigint;
    blockTime: bigint | null;
    meta: {
      err: unknown;
      logMessages: string[] | null;
      innerInstructions:
        | {
            index: number;
            instructions: {
              programIdIndex: number;
              accounts: number[];
              data: string;
            }[];
          }[]
        | null;
      loadedAddresses?: { writable: string[]; readonly: string[] };
      preTokenBalances: {
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
      postTokenBalances: {
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
    };
    transaction: {
      message: {
        accountKeys: string[];
        instructions: {
          programIdIndex: number;
          accounts: number[];
          data: string;
        }[];
      };
    };
  };
  const ixOf = (ix: {
    programIdIndex: number;
    accounts: number[];
    data: string;
  }): RawIx => ({
    programIdIndex: Number(ix.programIdIndex),
    accounts: ix.accounts.map(Number),
    data: ix.data,
  });
  const balOf = (b: {
    accountIndex: number;
    mint: string;
    owner?: string;
    uiTokenAmount: { amount: string };
  }): RawTokenBalance => ({
    accountIndex: Number(b.accountIndex),
    mint: b.mint,
    owner: b.owner ?? null,
    amount: b.uiTokenAmount.amount,
  });
  return {
    signature,
    slot: Number(tx.slot),
    blockTime: tx.blockTime === null ? null : Number(tx.blockTime),
    failed: tx.meta.err !== null,
    accountKeys: [
      ...tx.transaction.message.accountKeys,
      ...(tx.meta.loadedAddresses?.writable ?? []),
      ...(tx.meta.loadedAddresses?.readonly ?? []),
    ],
    instructions: tx.transaction.message.instructions.map(ixOf),
    inner: (tx.meta.innerInstructions ?? []).map((s) => ({
      index: Number(s.index),
      instructions: s.instructions.map(ixOf),
    })),
    logs: tx.meta.logMessages ?? [],
    preTokenBalances: (tx.meta.preTokenBalances ?? []).map(balOf),
    postTokenBalances: (tx.meta.postTokenBalances ?? []).map(balOf),
  };
}

/** Fetches transactions with a JSONL cache keyed by signature. */
async function fetchTransactions(
  rpc: ResilientRpcClient,
  signatures: string[],
  cacheFile: string,
  concurrency: number
): Promise<RawTx[]> {
  const cache = new Map<string, RawTx>();
  if (fs.existsSync(cacheFile)) {
    for (const line of fs.readFileSync(cacheFile, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const tx = JSON.parse(line) as RawTx;
      cache.set(tx.signature, tx);
    }
  }
  const missing = [...new Set(signatures)].filter((s) => !cache.has(s));
  console.log(
    `  transactions: ${cache.size} cached, ${missing.length} to fetch`
  );
  let done = 0;
  const queue = [...missing];
  const worker = async () => {
    for (let sig = queue.shift(); sig; sig = queue.shift()) {
      const raw = await rpc
        .getTransaction(sig as never, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      if (raw) {
        const tx = normalizeTx(sig, raw);
        cache.set(sig, tx);
        fs.appendFileSync(cacheFile, JSON.stringify(tx) + "\n");
      }
      done += 1;
      if (done % 200 === 0) console.log(`  fetched ${done}/${missing.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return [...new Set(signatures)]
    .map((s) => cache.get(s))
    .filter((t): t is RawTx => t !== undefined);
}

/** Picks lenders with processed redemptions, mixing withdrawn==processed and withdrawn<processed. */
export function sampleLenders(snapshot: Snapshot, size: number): string[] {
  const withProcessed = snapshot.lenders
    .filter((l) => l.processed > 0n)
    .sort((a, b) => (a.address < b.address ? -1 : 1));
  const equal = withProcessed.filter((l) => l.withdrawn === l.processed);
  const below = withProcessed.filter((l) => l.withdrawn < l.processed);
  const half = Math.ceil(size / 2);
  return [
    ...equal.slice(0, half),
    ...below.slice(0, size - Math.min(half, equal.length)),
  ].map((l) => l.address);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const jsonReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

async function main() {
  const { values } = parseArgs({
    options: {
      rpc: { type: "string" },
      "max-signatures": { type: "string", default: "5000" },
      "lender-sample": { type: "string", default: "40" },
      concurrency: { type: "string", default: "4" },
      "cache-dir": {
        type: "string",
        default: path.join(os.tmpdir(), "huma-analysis"),
      },
      "skip-history": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm run huma:analyze -- [--rpc <url>] [--max-signatures N] [--lender-sample N] [--concurrency N] [--cache-dir DIR] [--skip-history]"
    );
    return;
  }
  const rpcUrl =
    values.rpc || process.env.MAINNET_RPC_URL || MAINNET_DEFAULT_RPC_URL;
  const cacheDir = values["cache-dir"] as string;
  fs.mkdirSync(cacheDir, { recursive: true });
  const rpc = createResilientRpc(rpcUrl, { maxRetries: 8 });
  await assertCluster(rpc, "mainnet-beta");
  console.log(`RPC: ${new URL(rpcUrl).host} (mainnet-beta verified)`);

  console.log("Collecting state snapshot...");
  const snapshot = await collectSnapshot(rpc);
  console.log(
    `  slot ${snapshot.slot}: ${snapshot.pools.length} pools, ${snapshot.modes.length} modes, ${snapshot.lenders.length} lender states, ${snapshot.openRequests.length} open requests`
  );
  fs.writeFileSync(
    path.join(cacheDir, "snapshot.json"),
    JSON.stringify(snapshot, jsonReplacer, 2)
  );

  let txs: HumaTx[] = [];
  let sampled: string[] = [];
  if (!values["skip-history"]) {
    const max = Number(values["max-signatures"]);
    const sigs: string[] = [];
    for (const mode of snapshot.modes) {
      const s = await fetchSignatures(rpc, mode.poolModeToken, max);
      console.log(
        `  ${mode.name} escrow ${mode.poolModeToken}: ${s.length} sigs`
      );
      sigs.push(...s);
    }
    for (const pool of snapshot.pools) {
      const s = await fetchSignatures(rpc, pool.lossAuthority, max);
      console.log(`  ${pool.name} loss authority: ${s.length} sigs`);
      sigs.push(...s);
    }
    sampled = sampleLenders(snapshot, Number(values["lender-sample"]));
    for (const ls of sampled)
      sigs.push(...(await fetchSignatures(rpc, ls, 200)));
    const raw = await fetchTransactions(
      rpc,
      sigs,
      path.join(cacheDir, "transactions.jsonl"),
      Number(values.concurrency)
    );
    txs = raw
      .filter((t) => !t.failed)
      .map(decodeHumaTx)
      .filter((t) => t.ixs.length > 0);
    const slots = txs.map((t) => t.slot);
    console.log(
      `  ${txs.length} successful Huma txs, slots ${Math.min(...slots)}..${Math.max(...slots)}`
    );
    await resolveOperators(
      snapshot,
      txs.flatMap((t) =>
        t.ixs.filter((ix) => ix.accounts.signer).map((ix) => ix.accounts.signer)
      )
    );
  }

  const q1 = await analyzeQ1(txs);
  const q2 = analyzeQ2(snapshot, txs, sampled);
  const q3 = await analyzeQ3(snapshot, txs);
  const q4 = analyzeQ4(snapshot, txs);
  const q5 = analyzeQ5(snapshot, txs);

  const countBy = <T>(xs: T[], key: (x: T) => string) =>
    xs.reduce<Record<string, number>>((acc, x) => {
      acc[key(x)] = (acc[key(x)] ?? 0) + 1;
      return acc;
    }, {});
  const ixCounts = countBy(
    txs.flatMap((t) => t.ixs),
    (ix) => ix.name
  );

  const findings = {
    generatedAt: new Date().toISOString(),
    rpcHost: new URL(rpcUrl).host,
    snapshotSlot: snapshot.slot,
    pools: snapshot.pools,
    modes: snapshot.modes,
    openRequests: snapshot.openRequests,
    ixCounts,
    q1: {
      byCategory: countBy(q1, (r) => `${r.instruction}:${r.category}`),
      pushObserved: q1.filter(
        (r) =>
          r.instruction === "process_redemption_request" &&
          (r.usdcDelta ?? 0n) > 0n
      ).length,
      lenderPdaCount: q1.filter((r) => r.lenderIsPda).length,
      examples: q1.slice(0, 10),
      nonAta: q1.filter((r) => r.category !== "canonical_ata").slice(0, 20),
    },
    q2,
    q3,
    q4,
    q5: { bySignerRole: countBy(q5, (r) => r.signerRole), rows: q5 },
  };
  const out = path.join(cacheDir, "findings.json");
  fs.writeFileSync(out, JSON.stringify(findings, jsonReplacer, 2));

  console.log("\nInstruction counts:", ixCounts);
  console.log(
    "Q1 target accounts:",
    findings.q1.byCategory,
    "push observed:",
    findings.q1.pushObserved
  );
  console.log("Q2:", q2.population, q2.processedInHistory, "\n   ", q2.verdict);
  for (const r of q3)
    console.log(
      `Q3 ${r.poolConfig}: next=${r.nextRequestId} last=${r.lastRequestId} open=[${r.openRequestIds.join(",")}] maxAdded=${r.maxAddedId} maxResolved=${r.maxResolvedId} recentRun=${r.recentContiguousRun ? `${r.recentContiguousRun.from}..${r.recentContiguousRun.to} (${r.recentContiguousRun.count})` : "none"} inversions=${r.idTimeInversions} pda=${r.pdaEndianness}`
    );
  console.log("Q4:", q4.verdict);
  console.log("Q5 cancellations by signer role:", findings.q5.bySignerRole);
  console.log(`\nFindings written to ${out}`);
  if (q1[0]) console.log(`Example: ${SOLSCAN_TX}${q1[0].signature}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
