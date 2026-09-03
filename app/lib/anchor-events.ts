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

// ─── Borsh Error & Reader ───────────────────────────────────────────────────

export class BorshDecodeError extends Error {
  constructor(message: string) {
    super(`[BorshDecodeError] ${message}`);
    this.name = "BorshDecodeError";
  }
}

const base58Decoder = getBase58Decoder();
const base58Encoder = getBase58Encoder();

export class BorshReader {
  private view: DataView;
  private offset = 0;

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );
  }

  private ensure(bytes: number) {
    if (this.offset + bytes > this.buffer.byteLength) {
      throw new BorshDecodeError(
        `Out of bounds: requested ${bytes} bytes at offset ${this.offset}, total length ${this.buffer.byteLength}`
      );
    }
  }

  readU8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    this.ensure(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readU128(): bigint {
    this.ensure(16);
    const low = this.view.getBigUint64(this.offset, true);
    const high = this.view.getBigUint64(this.offset + 8, true);
    this.offset += 16;
    return (high << 64n) | low;
  }

  readI64(): bigint {
    this.ensure(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readBool(): boolean {
    return this.readU8() !== 0;
  }

  readPubkey(): Address {
    this.ensure(32);
    const bytes = this.buffer.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return base58Decoder.decode(bytes) as Address;
  }

  readOption<T>(itemReader: (reader: BorshReader) => T): T | null {
    const isSome = this.readU8();
    if (isSome === 0) return null;
    if (isSome !== 1) {
      throw new BorshDecodeError(
        `Invalid Option discriminant: expected 0 or 1, got ${isSome} at offset ${this.offset - 1}`
      );
    }
    return itemReader(this);
  }

  readVec<T>(itemReader: (reader: BorshReader) => T, maxCount = 1000): T[] {
    const len = this.readU32();
    if (len > maxCount) {
      throw new BorshDecodeError(
        `Vector length ${len} exceeds sanity limit of ${maxCount}`
      );
    }
    if (len > this.remaining) {
      throw new BorshDecodeError(
        `Vector length ${len} exceeds remaining byte count ${this.remaining}`
      );
    }
    const items: T[] = [];
    for (let i = 0; i < len; i++) {
      items.push(itemReader(this));
    }
    return items;
  }

  get remaining(): number {
    return this.buffer.byteLength - this.offset;
  }
}

// ─── Event Type Definitions (All 23 Program Events) ─────────────────────────

export interface PrizeTierData {
  percentPotBps: number;
  winners: number;
}

export interface BondsPurchasedEvent {
  user: Address;
  poolId: number;
  bonds: number;
  amount: bigint;
  newTotalDepositedPrincipal?: bigint;
  userTotalBonds?: number;
  timestamp?: bigint;
}

export interface BondsSoldEvent {
  user: Address;
  poolId: number;
  bonds: number;
  principal: bigint;
  redemptionId: bigint;
  pstShares?: bigint;
  humaRequestId?: bigint;
  newTotalDepositedPrincipal?: bigint;
  userRemainingBonds?: number;
  timestamp?: bigint;
}

export interface WinningsReinvestedEvent {
  winner: Address;
  poolId: number;
  cycleId: number;
  winnerIndex: number;
  bondsBought: number;
  amountReinvested: bigint;
  timestamp?: bigint;
}

export interface WinningsClaimedEvent {
  user: Address;
  poolId: number;
  amount: bigint;
  redemptionId: bigint;
  pstShares?: bigint;
  humaRequestId?: bigint;
  timestamp?: bigint;
}

export interface RedemptionClaimedEvent {
  user: Address;
  poolId: number;
  amount: bigint;
  redemptionId: bigint;
  redemptionType?: number;
  pstSharesLocked?: bigint;
  humaRequestId?: bigint;
  requestedAt?: bigint;
  timestamp?: bigint;
}

export interface YieldHarvestedEvent {
  poolId: number;
  cycleId: number;
  rawYield: bigint;
  fee: bigint;
  prizePot: bigint;
  lockedTicketCount: number;
  randomnessAccount: Address;
  timestamp?: bigint;
}

export interface DrawSkippedEvent {
  poolId: number;
  cycleId: number;
  rawYield: bigint;
  threshold: bigint;
  timestamp?: bigint;
}

export interface DrawCompletedEvent {
  poolId: number;
  cycleId: number;
  prizePot: bigint;
  winnersCount: number;
  totalDistributed?: bigint;
  totalPrizesDistributed?: bigint;
  timestamp?: bigint;
}

export interface DrawForceUnlockedEvent {
  poolId: number;
  cycleId: number;
  admin: Address;
  prizePot: bigint;
  cycleFeeCollected: bigint;
  timestamp?: bigint;
}

export interface DrawVoidedEvent {
  poolId: number;
  cycleId: number;
  admin: Address;
  prizesReversed: bigint;
  feesReversed: bigint;
  timestamp?: bigint;
}

export interface DrawPreparationProgressEvent {
  poolId: number;
  cycleId: number;
  batchStart: number;
  batchEnd: number;
  userCount: number;
  isComplete: boolean;
  timestamp?: bigint;
}

export interface PoolCreatedEvent {
  poolId: number;
  admin: Address;
  tokenMint: Address;
  pstMint: Address;
  feeWallet: Address;
  ticketRegistry: Address;
  bondPrice: bigint;
  stakeCycleDurationHrs: bigint;
  feeBasisPoints: number;
  minYieldThreshold: bigint;
  maxYieldBasisPoints: number;
  payoutTimelockSeconds: number;
  tiersCount: number;
  totalWinners: number;
  timestamp?: bigint;
}

export interface HumaLenderInitializedEvent {
  poolId: number;
  admin: Address;
  timestamp?: bigint;
}

export interface GlobalConfigInitializedEvent {
  admin: Address;
  guardian: Address;
  jobsAccount: Address;
  timestamp?: bigint;
}

export interface GlobalConfigUpdatedEvent {
  authority: Address;
  oldAdmin: Address;
  newAdmin: Address;
  oldGuardian: Address;
  newGuardian: Address;
  oldJobsAccount: Address;
  newJobsAccount: Address;
  timestamp?: bigint;
}

export interface PoolConfigUpdatedEvent {
  poolId: number;
  admin: Address;
  oldFeeBasisPoints: number;
  newFeeBasisPoints: number;
  oldBondPrice: bigint;
  newBondPrice: bigint;
  oldFeeWallet: Address;
  newFeeWallet: Address;
  oldMinYieldThreshold: bigint;
  newMinYieldThreshold: bigint;
  oldStakeCycleDurationHrs: bigint;
  newStakeCycleDurationHrs: bigint;
  oldMaxYieldBasisPoints: number;
  newMaxYieldBasisPoints: number;
  oldPayoutTimelockSeconds: number;
  newPayoutTimelockSeconds: number;
  timestamp?: bigint;
}

export interface PoolStatusChangedEvent {
  poolId: number;
  previousStatus: number;
  newStatus: number;
  authority: Address;
  timestamp?: bigint;
}

export interface EmergencyInsolvencyDetectedEvent {
  poolId: number;
  currentValue: bigint;
  bookValue: bigint;
  deficit: bigint;
  timestamp?: bigint;
}

export interface YieldVelocityBreachedEvent {
  poolId: number;
  yieldGenerated: bigint;
  maxAllowedYield: bigint;
  timestamp?: bigint;
}

export interface PrizeTiersUpdatedEvent {
  poolId: number;
  admin: Address;
  oldTiersCount: number;
  oldTotalWinners: number;
  newTiersCount: number;
  newTotalWinners: number;
  tiers: PrizeTierData[];
  timestamp?: bigint;
}

export interface RegistryResizedEvent {
  poolId: number;
  caller: Address;
  oldCapacity: number;
  newCapacity: number;
  timestamp?: bigint;
}

export interface RandomnessReboundEvent {
  poolId: number;
  cycleId: number;
  oldRandomnessAccount: Address;
  newRandomnessAccount: Address;
  harvestSlot: bigint;
  timestamp?: bigint;
}

export interface FeesWithdrawnEvent {
  poolId: number;
  admin: Address;
  feeWallet: Address;
  amount: bigint;
  pstShares: bigint;
  redemptionId: bigint;
  humaRequestId?: bigint;
  timestamp?: bigint;
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
  | { type: "DrawPreparationProgress"; data: DrawPreparationProgressEvent }
  | { type: "PoolCreated"; data: PoolCreatedEvent }
  | { type: "HumaLenderInitialized"; data: HumaLenderInitializedEvent }
  | { type: "GlobalConfigInitialized"; data: GlobalConfigInitializedEvent }
  | { type: "GlobalConfigUpdated"; data: GlobalConfigUpdatedEvent }
  | { type: "PoolConfigUpdated"; data: PoolConfigUpdatedEvent }
  | { type: "PoolStatusChanged"; data: PoolStatusChangedEvent }
  | {
      type: "EmergencyInsolvencyDetected";
      data: EmergencyInsolvencyDetectedEvent;
    }
  | { type: "YieldVelocityBreached"; data: YieldVelocityBreachedEvent }
  | { type: "PrizeTiersUpdated"; data: PrizeTiersUpdatedEvent }
  | { type: "RegistryResized"; data: RegistryResizedEvent }
  | { type: "RandomnessRebound"; data: RandomnessReboundEvent }
  | { type: "FeesWithdrawn"; data: FeesWithdrawnEvent };

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
    case "PoolCreated":
      return createMetadata(evt.data.poolId, ["pool"]);
    case "HumaLenderInitialized":
      return createMetadata(evt.data.poolId, ["pool"]);
    case "GlobalConfigInitialized":
    case "GlobalConfigUpdated":
      return createMetadata(0, ["all"]);
    case "PoolConfigUpdated":
    case "PoolStatusChanged":
      return createMetadata(evt.data.poolId, ["pool"]);
    case "EmergencyInsolvencyDetected":
    case "YieldVelocityBreached":
      return createMetadata(evt.data.poolId, ["pool"]);
    case "PrizeTiersUpdated":
    case "RegistryResized":
      return createMetadata(evt.data.poolId, ["pool"]);
    case "RandomnessRebound":
      return createMetadata(evt.data.poolId, ["draws", "pool"]);
    case "FeesWithdrawn":
      return createMetadata(evt.data.poolId, ["pool", "redemptions"]);
  }
}

// ─── Discriminator computation ───────────────────────────────────────────────
// Anchor event discriminators: SHA-256("event:<EventName>")[..8]

const ANCHOR_EVENT_IX_TAG_HEX = "e445a52e51cb9a1d";

const DISCRIMINATOR_MAP: Record<string, ParsedProgramEvent["type"]> = {
  "98577bdd8fc92b0f": "BondsPurchased",
  "0aa460b294f9dc2a": "BondsSold",
  aeeb2097b9e63e6e: "WinningsReinvested",
  bbb81dc436754696: "WinningsClaimed",
  "6bfbc7d53bad35bd": "RedemptionClaimed",
  c1882558b47c6014: "DrawCompleted",
  "270b1dbe81f95cb4": "DrawSkipped",
  "1a1dc53ce504de2d": "DrawForceUnlocked",
  ca2c295868dc9d52: "PoolCreated",
  "42d0fe019915d733": "HumaLenderInitialized",
  "05ddac9e4d579d71": "GlobalConfigInitialized",
  e8ee9e7bd2ac9f2e: "GlobalConfigUpdated",
  ce211d0854548227: "PoolConfigUpdated",
  "94be513e51ef89bc": "PoolStatusChanged",
  a8998a09be43e611: "EmergencyInsolvencyDetected",
  "27085532e5244219": "YieldVelocityBreached",
  "992d33ee8e91030c": "DrawVoided",
  "2bbe139499882979": "PrizeTiersUpdated",
  "041bfd9b7cbe1deb": "RegistryResized",
  "31c5e2e89ad3f9de": "YieldHarvested",
  c2b5cada34801342: "RandomnessRebound",
  ea0f007794f12815: "FeesWithdrawn",
  b0870012acfe8782: "DrawPreparationProgress",
};

// ─── Borsh Decoders ──────────────────────────────────────────────────────────

function decodeEventData(
  eventName: ParsedProgramEvent["type"],
  data: Uint8Array
): ParsedProgramEvent["data"] | null {
  // Skip 8-byte discriminator
  if (data.length < 8) return null;
  const payload = data.subarray(8);
  const reader = new BorshReader(payload);

  try {
    switch (eventName) {
      case "BondsPurchased": {
        const user = reader.readPubkey();
        const poolId = reader.readU32();
        const bonds = reader.readU32();
        const amount = reader.readU64();
        let newTotalDepositedPrincipal: bigint | undefined;
        let userTotalBonds: number | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8)
          newTotalDepositedPrincipal = reader.readU64();
        if (reader.remaining >= 4) userTotalBonds = reader.readU32();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          user,
          poolId,
          bonds,
          amount,
          newTotalDepositedPrincipal,
          userTotalBonds,
          timestamp,
        } as BondsPurchasedEvent;
      }
      case "BondsSold": {
        const user = reader.readPubkey();
        const poolId = reader.readU32();
        const bonds = reader.readU32();
        const principal = reader.readU64();
        const redemptionId = reader.readU64();
        let pstShares: bigint | undefined;
        let humaRequestId: bigint | undefined;
        let newTotalDepositedPrincipal: bigint | undefined;
        let userRemainingBonds: number | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) pstShares = reader.readU64();
        if (reader.remaining >= 16) humaRequestId = reader.readU128();
        if (reader.remaining >= 8)
          newTotalDepositedPrincipal = reader.readU64();
        if (reader.remaining >= 4) userRemainingBonds = reader.readU32();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          user,
          poolId,
          bonds,
          principal,
          redemptionId,
          pstShares,
          humaRequestId,
          newTotalDepositedPrincipal,
          userRemainingBonds,
          timestamp,
        } as BondsSoldEvent;
      }
      case "WinningsReinvested": {
        const winner = reader.readPubkey();
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const winnerIndex = reader.readU32();
        const bondsBought = reader.readU32();
        const amountReinvested = reader.readU64();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          winner,
          poolId,
          cycleId,
          winnerIndex,
          bondsBought,
          amountReinvested,
          timestamp,
        } as WinningsReinvestedEvent;
      }
      case "WinningsClaimed": {
        const user = reader.readPubkey();
        const poolId = reader.readU32();
        const amount = reader.readU64();
        const redemptionId = reader.readU64();
        let pstShares: bigint | undefined;
        let humaRequestId: bigint | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) pstShares = reader.readU64();
        if (reader.remaining >= 16) humaRequestId = reader.readU128();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          user,
          poolId,
          amount,
          redemptionId,
          pstShares,
          humaRequestId,
          timestamp,
        } as WinningsClaimedEvent;
      }
      case "RedemptionClaimed": {
        const user = reader.readPubkey();
        const poolId = reader.readU32();
        const amount = reader.readU64();
        const redemptionId = reader.readU64();
        let redemptionType: number | undefined;
        let pstSharesLocked: bigint | undefined;
        let humaRequestId: bigint | undefined;
        let requestedAt: bigint | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 1) redemptionType = reader.readU8();
        if (reader.remaining >= 8) pstSharesLocked = reader.readU64();
        if (reader.remaining >= 16) humaRequestId = reader.readU128();
        if (reader.remaining >= 8) requestedAt = reader.readI64();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          user,
          poolId,
          amount,
          redemptionId,
          redemptionType,
          pstSharesLocked,
          humaRequestId,
          requestedAt,
          timestamp,
        } as RedemptionClaimedEvent;
      }
      case "YieldHarvested": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const rawYield = reader.readU64();
        const fee = reader.readU64();
        const prizePot = reader.readU64();
        const lockedTicketCount = reader.readU32();
        const randomnessAccount = reader.readPubkey();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          rawYield,
          fee,
          prizePot,
          lockedTicketCount,
          randomnessAccount,
          timestamp,
        } as YieldHarvestedEvent;
      }
      case "DrawSkipped": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const rawYield = reader.readU64();
        const threshold = reader.readU64();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          rawYield,
          threshold,
          timestamp,
        } as DrawSkippedEvent;
      }
      case "DrawCompleted": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const prizePot = reader.readU64();
        const winnersCount = reader.readU32();
        let totalDistributed: bigint | undefined;
        let totalPrizesDistributed: bigint | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) totalDistributed = reader.readU64();
        if (reader.remaining >= 8) totalPrizesDistributed = reader.readU64();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          prizePot,
          winnersCount,
          totalDistributed: totalDistributed ?? prizePot,
          totalPrizesDistributed,
          timestamp,
        } as DrawCompletedEvent;
      }
      case "DrawForceUnlocked": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const admin = reader.readPubkey();
        const prizePot = reader.readU64();
        const cycleFeeCollected = reader.readU64();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          admin,
          prizePot,
          cycleFeeCollected,
          timestamp,
        } as DrawForceUnlockedEvent;
      }
      case "DrawVoided": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const admin = reader.readPubkey();
        const prizesReversed = reader.readU64();
        const feesReversed = reader.readU64();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          admin,
          prizesReversed,
          feesReversed,
          timestamp,
        } as DrawVoidedEvent;
      }
      case "DrawPreparationProgress": {
        const poolId = reader.readU32();
        const cycleId = reader.readU32();
        const batchStart = reader.readU32();
        const batchEnd = reader.readU32();
        const userCount = reader.readU32();
        const isComplete = reader.readBool();
        let timestamp: bigint | undefined;
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          cycleId,
          batchStart,
          batchEnd,
          userCount,
          isComplete,
          timestamp,
        } as DrawPreparationProgressEvent;
      }
      case "PoolCreated": {
        return {
          poolId: reader.readU32(),
          admin: reader.readPubkey(),
          tokenMint: reader.readPubkey(),
          pstMint: reader.readPubkey(),
          feeWallet: reader.readPubkey(),
          ticketRegistry: reader.readPubkey(),
          bondPrice: reader.readU64(),
          stakeCycleDurationHrs: reader.readI64(),
          feeBasisPoints: reader.readU16(),
          minYieldThreshold: reader.readU64(),
          maxYieldBasisPoints: reader.readU16(),
          payoutTimelockSeconds: reader.readU32(),
          tiersCount: reader.readU8(),
          totalWinners: reader.readU32(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as PoolCreatedEvent;
      }
      case "HumaLenderInitialized": {
        return {
          poolId: reader.readU32(),
          admin: reader.readPubkey(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as HumaLenderInitializedEvent;
      }
      case "GlobalConfigInitialized": {
        return {
          admin: reader.readPubkey(),
          guardian: reader.readPubkey(),
          jobsAccount: reader.readPubkey(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as GlobalConfigInitializedEvent;
      }
      case "GlobalConfigUpdated": {
        return {
          authority: reader.readPubkey(),
          oldAdmin: reader.readPubkey(),
          newAdmin: reader.readPubkey(),
          oldGuardian: reader.readPubkey(),
          newGuardian: reader.readPubkey(),
          oldJobsAccount: reader.readPubkey(),
          newJobsAccount: reader.readPubkey(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as GlobalConfigUpdatedEvent;
      }
      case "PoolConfigUpdated": {
        return {
          poolId: reader.readU32(),
          admin: reader.readPubkey(),
          oldFeeBasisPoints: reader.readU16(),
          newFeeBasisPoints: reader.readU16(),
          oldBondPrice: reader.readU64(),
          newBondPrice: reader.readU64(),
          oldFeeWallet: reader.readPubkey(),
          newFeeWallet: reader.readPubkey(),
          oldMinYieldThreshold: reader.readU64(),
          newMinYieldThreshold: reader.readU64(),
          oldStakeCycleDurationHrs: reader.readI64(),
          newStakeCycleDurationHrs: reader.readI64(),
          oldMaxYieldBasisPoints: reader.readU16(),
          newMaxYieldBasisPoints: reader.readU16(),
          oldPayoutTimelockSeconds: reader.readU32(),
          newPayoutTimelockSeconds: reader.readU32(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as PoolConfigUpdatedEvent;
      }
      case "PoolStatusChanged": {
        return {
          poolId: reader.readU32(),
          previousStatus: reader.readU8(),
          newStatus: reader.readU8(),
          authority: reader.readPubkey(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as PoolStatusChangedEvent;
      }
      case "EmergencyInsolvencyDetected": {
        return {
          poolId: reader.readU32(),
          currentValue: reader.readU64(),
          bookValue: reader.readU64(),
          deficit: reader.readU64(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as EmergencyInsolvencyDetectedEvent;
      }
      case "YieldVelocityBreached": {
        return {
          poolId: reader.readU32(),
          yieldGenerated: reader.readU64(),
          maxAllowedYield: reader.readU64(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as YieldVelocityBreachedEvent;
      }
      case "PrizeTiersUpdated": {
        const poolId = reader.readU32();
        const admin = reader.readPubkey();
        const oldTiersCount = reader.readU8();
        const oldTotalWinners = reader.readU32();
        const newTiersCount = reader.readU8();
        const newTotalWinners = reader.readU32();
        const tiers = reader.readVec((r) => ({
          percentPotBps: r.readU16(),
          winners: r.readU32(),
        }));
        const timestamp = reader.remaining >= 8 ? reader.readI64() : undefined;
        return {
          poolId,
          admin,
          oldTiersCount,
          oldTotalWinners,
          newTiersCount,
          newTotalWinners,
          tiers,
          timestamp,
        } as PrizeTiersUpdatedEvent;
      }
      case "RegistryResized": {
        return {
          poolId: reader.readU32(),
          caller: reader.readPubkey(),
          oldCapacity: reader.readU32(),
          newCapacity: reader.readU32(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as RegistryResizedEvent;
      }
      case "RandomnessRebound": {
        return {
          poolId: reader.readU32(),
          cycleId: reader.readU32(),
          oldRandomnessAccount: reader.readPubkey(),
          newRandomnessAccount: reader.readPubkey(),
          harvestSlot: reader.readU64(),
          timestamp: reader.remaining >= 8 ? reader.readI64() : undefined,
        } as RandomnessReboundEvent;
      }
      case "FeesWithdrawn": {
        const poolId = reader.readU32();
        const admin = reader.readPubkey();
        const feeWallet = reader.readPubkey();
        const amount = reader.readU64();
        const pstShares = reader.readU64();
        const redemptionId = reader.readU64();
        let humaRequestId: bigint | undefined;
        let timestamp: bigint | undefined;
        if (reader.remaining >= 16) humaRequestId = reader.readU128();
        if (reader.remaining >= 8) timestamp = reader.readI64();
        return {
          poolId,
          admin,
          feeWallet,
          amount,
          pstShares,
          redemptionId,
          humaRequestId,
          timestamp,
        } as FeesWithdrawnEvent;
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn(`[BorshReader] Error decoding event ${eventName}:`, err);
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
