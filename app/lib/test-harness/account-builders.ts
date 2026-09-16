import { Address, getAddressEncoder } from "@solana/kit";
import {
  PrizePool,
  PrizePoolArgs,
  getPrizePoolEncoder,
  PRIZE_POOL_DISCRIMINATOR,
} from "../generated/yield-bonds/src/generated/accounts/prizePool";
import {
  DrawCycle,
  DrawCycleArgs,
  getDrawCycleEncoder,
  DRAW_CYCLE_DISCRIMINATOR,
} from "../generated/yield-bonds/src/generated/accounts/drawCycle";
import { PoolStatus } from "../generated/yield-bonds/src/generated/types/poolStatus";
import { DrawStatus } from "../generated/yield-bonds/src/generated/types/drawStatus";
import {
  serializeTicketRegistry,
  SerializeTicketRegistryOptions,
  TICKET_REGISTRY_DISCRIMINATOR,
  TicketRegistry,
} from "../ticket-registry-helpers";
import {
  serializePayoutRegistry,
  PayoutRegistry,
  PAYOUT_REGISTRY_DISCRIMINATOR,
  ExtendedPayoutRegistry,
  Winner,
} from "../payout-registry-helpers";
import type { DrawCycleInfo } from "../bonds-sdk";
import { TEST_ADDRESSES } from "./addresses";

const MOCK_PUBKEY = TEST_ADDRESSES.USER;
const MOCK_TOKEN_MINT = TEST_ADDRESSES.MINT;

export {
  PRIZE_POOL_DISCRIMINATOR,
  DRAW_CYCLE_DISCRIMINATOR,
  TICKET_REGISTRY_DISCRIMINATOR,
  PAYOUT_REGISTRY_DISCRIMINATOR,
  PoolStatus,
  DrawStatus,
};

export type {
  PrizePool,
  PrizePoolArgs,
  DrawCycle,
  DrawCycleArgs,
  PayoutRegistry,
  TicketRegistry,
  ExtendedPayoutRegistry,
  Winner,
  DrawCycleInfo,
};

export function buildMockPrizePool(
  overrides: Partial<PrizePool> = {}
): PrizePool {
  return {
    discriminator: PRIZE_POOL_DISCRIMINATOR,
    poolId: 1,
    tokenMint: MOCK_TOKEN_MINT,
    ticketRegistry: MOCK_PUBKEY,
    feeWallet: MOCK_PUBKEY,
    humaPoolState: MOCK_PUBKEY,
    bondPrice: 1_000_000n,
    stakeCycleDurationHrs: 24n,
    minYieldThreshold: 0n,
    totalDepositedPrincipal: 0n,
    currentCycleEndAt: 0n,
    nextRedemptionId: 1n,
    totalFeesAccrued: 0n,
    totalFeesWithdrawn: 0n,
    totalPrizesAllocated: 0n,
    totalPendingRedemptions: 0n,
    currentDrawCycleId: 1,
    feeBasisPoints: 500,
    maxYieldBasisPoints: 1000,
    payoutTimelockSeconds: 300,
    vaultAuthorityBump: 255,
    status: PoolStatus.Active,
    isFrozenForDraw: 0,
    version: 1,
    prizeTiersCount: 1,
    padding: new Uint8Array(3),
    prizeTiers: [
      { basisPoints: 10000, numWinners: 1, padding: new Uint8Array(2) },
      ...Array.from({ length: 9 }, () => ({
        basisPoints: 0,
        numWinners: 0,
        padding: new Uint8Array(2),
      })),
    ],
    reserved: new Uint8Array(128),
    ...overrides,
  };
}

export function buildMockPrizePoolArgs(
  overrides: Partial<PrizePoolArgs> = {}
): PrizePoolArgs {
  return {
    poolId: 1,
    tokenMint: MOCK_TOKEN_MINT,
    ticketRegistry: MOCK_PUBKEY,
    feeWallet: MOCK_PUBKEY,
    humaPoolState: MOCK_PUBKEY,
    bondPrice: 1_000_000n,
    stakeCycleDurationHrs: 24n,
    minYieldThreshold: 0n,
    totalDepositedPrincipal: 0n,
    currentCycleEndAt: 0n,
    nextRedemptionId: 1n,
    totalFeesAccrued: 0n,
    totalFeesWithdrawn: 0n,
    totalPrizesAllocated: 0n,
    totalPendingRedemptions: 0n,
    currentDrawCycleId: 1,
    feeBasisPoints: 500,
    maxYieldBasisPoints: 1000,
    payoutTimelockSeconds: 300,
    vaultAuthorityBump: 255,
    status: PoolStatus.Active,
    isFrozenForDraw: 0,
    version: 1,
    prizeTiersCount: 1,
    padding: new Uint8Array(3),
    prizeTiers: [
      { basisPoints: 10000, numWinners: 1, padding: new Uint8Array(2) },
      ...Array.from({ length: 9 }, () => ({
        basisPoints: 0,
        numWinners: 0,
        padding: new Uint8Array(2),
      })),
    ],
    reserved: new Uint8Array(128),
    ...overrides,
  };
}

export function buildMockPrizePoolEncoded(
  overrides: Partial<PrizePoolArgs> = {}
): Uint8Array {
  const poolArgs = buildMockPrizePoolArgs(overrides);
  return new Uint8Array(getPrizePoolEncoder().encode(poolArgs));
}

export function buildMockDrawCycle(
  overrides: Partial<DrawCycle> = {}
): DrawCycle {
  return {
    discriminator: DRAW_CYCLE_DISCRIMINATOR,
    prizePot: 9_500_000n,
    cycleFeeCollected: 500_000n,
    harvestSlot: 1000n,
    initiatedAt: 1700000000n,
    completedAt: 1700086400n,
    randomnessAccount: MOCK_PUBKEY,
    poolId: 1,
    cycleId: 1,
    lockedTicketCount: 5000,
    status: DrawStatus.Complete,
    version: 1,
    randomnessSeed: new Uint8Array(32),
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

export function buildMockDrawCycleArgs(
  overrides: Partial<DrawCycleArgs> = {}
): DrawCycleArgs {
  return {
    prizePot: 9_500_000n,
    cycleFeeCollected: 500_000n,
    harvestSlot: 1000n,
    initiatedAt: 1700000000n,
    completedAt: 1700086400n,
    randomnessAccount: MOCK_PUBKEY,
    poolId: 1,
    cycleId: 1,
    lockedTicketCount: 5000,
    status: DrawStatus.Complete,
    version: 1,
    randomnessSeed: new Uint8Array(32),
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

export function buildMockDrawCycleEncoded(
  overrides: Partial<DrawCycleArgs> = {}
): Uint8Array {
  const cycleArgs = buildMockDrawCycleArgs(overrides);
  return new Uint8Array(getDrawCycleEncoder().encode(cycleArgs));
}

export function buildMockTicketRegistry(
  overrides: Partial<TicketRegistry> = {}
): TicketRegistry {
  return {
    discriminator: TICKET_REGISTRY_DISCRIMINATOR,
    poolId: 1,
    drawCycleId: 1,
    version: 1,
    userCount: 10,
    capacity: 100,
    totalActiveTickets: 500,
    totalPendingTickets: 0,
    drawPreparedUpTo: 10,
    padding: new Uint8Array(3),
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

export function buildMockTicketRegistryEncoded(
  options: SerializeTicketRegistryOptions = { poolId: 1 }
): Uint8Array {
  return serializeTicketRegistry(options);
}

export function buildMockPayoutRegistry(
  overrides: Partial<PayoutRegistry> & { winners?: Winner[] } = {}
): PayoutRegistry & { winners: Winner[] } {
  const winners: Winner[] = overrides.winners ?? [
    {
      winner: MOCK_PUBKEY,
      amountOwed: 50_000_000n,
      bondsBought: 10,
      processed: 0,
      tierIndex: 0,
      version: 1,
      padding: new Uint8Array(1),
      reserved: new Uint8Array(8),
    },
  ];

  return {
    discriminator: PAYOUT_REGISTRY_DISCRIMINATOR,
    poolId: 1,
    cycleId: 1,
    status: 0,
    winnersCount: overrides.winnersCount ?? winners.length,
    payoutsCompleted: 0,
    revealedAt: 1700000000n,
    version: 1,
    padding: new Uint8Array(6),
    reserved: new Uint8Array(64),
    ...overrides,
    winners,
  };
}

export function buildMockPayoutRegistryInfo(
  overrides: Partial<ExtendedPayoutRegistry> = {}
): ExtendedPayoutRegistry {
  const defaultWinners: Winner[] = [
    {
      winner: MOCK_PUBKEY,
      amountOwed: 50_000_000n,
      bondsBought: 10,
      processed: 0,
      tierIndex: 0,
      version: 1,
      padding: new Uint8Array(1),
      reserved: new Uint8Array(8),
    },
  ];

  const winners = overrides.winners ?? defaultWinners;

  return {
    discriminator: PAYOUT_REGISTRY_DISCRIMINATOR,
    poolId: 1,
    cycleId: 1,
    status: 0,
    winnersCount: overrides.winnersCount ?? winners.length,
    payoutsCompleted: overrides.payoutsCompleted ?? 0,
    revealedAt: overrides.revealedAt ?? 1700000000n,
    version: 1,
    padding: new Uint8Array(6),
    reserved: new Uint8Array(64),
    ...overrides,
    winners,
  };
}

export function buildMockPayoutRegistryEncoded(
  options: Parameters<typeof serializePayoutRegistry>[0] = {
    poolId: 1,
    cycleId: 1,
  }
): Uint8Array {
  return serializePayoutRegistry(options);
}

export function buildMockDrawCycleInfo(
  overrides: Partial<DrawCycleInfo> = {}
): DrawCycleInfo {
  return {
    discriminator: DRAW_CYCLE_DISCRIMINATOR,
    poolId: 1,
    cycleId: 1,
    status: "Complete" as const,
    prizePot: 100_000_000n,
    cycleFeeCollected: 5_000_000n,
    harvestSlot: 1000n,
    initiatedAt: 1700000000n,
    completedAt: 1700003600n,
    randomnessAccount: MOCK_PUBKEY,
    lockedTicketCount: 500,
    version: 1,
    randomnessSeed: new Uint8Array(32).fill(7),
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

export function buildMockTokenAccountBytes(
  amount: bigint,
  mint: Address = MOCK_TOKEN_MINT,
  owner: Address = MOCK_PUBKEY
): Uint8Array {
  const data = new Uint8Array(165);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const addressEncoder = getAddressEncoder();

  data.set(addressEncoder.encode(mint), 0);
  data.set(addressEncoder.encode(owner), 32);
  view.setBigUint64(64, amount, true);
  data[72] = 1; // Initialized byte
  return data;
}
