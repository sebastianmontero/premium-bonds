import { USDC_DECIMALS, USDC_MINT, usdc } from "./lib/formatters";

// ─── On-chain state mirrors ───────────────────────────────────────────────────
// These interfaces mirror the Anchor account structs in
// anchor/programs/anchor/src/state/*.rs
// They will be populated from RPC later; for now they drive mock data.

export type PoolStatus = "Active" | "Paused" | "Closed";

export interface PrizeTier {
  basisPoints: number; // share of yield each winner in this tier receives
  numWinners: number;
}

export interface PoolInfo {
  poolId: number;
  tokenMint: string;
  tokenSymbol: string; // UI-only helper
  tokenDecimals: number; // UI-only helper
  bondPrice: number; // lamports / base units
  stakeCycleDurationHrs: number;
  feeBasisPoints: number;
  status: PoolStatus;
  totalDepositedPrincipal: number;
  currentCycleEndAt: number; // unix timestamp (seconds)
  isFrozenForDraw: boolean;
  currentDrawCycleId: number;
  prizeTiers: PrizeTier[];
  /** Estimated prize pot for the current cycle (off-chain calc, base units) */
  estimatedPrizePot: number;
  /** Total accrued gross yield before protocol fees (base units) */
  grossYield?: number;
  /** Protocol reserve fee amount deducted from gross yield (base units) */
  protocolFeeAmount?: number;
  /** Minimum required gross yield threshold to execute draw (base units) */
  minYieldThreshold?: number;
  /** Underlying lending APY rate (e.g. 0.085 for 8.50%) */
  underlyingApy?: number;
  /** Unix timestamp (in seconds) when the on-chain yield snapshot was fetched */
  lastSyncedAt?: number;
  /** Total unique depositors/participants registered on-chain in TicketRegistry */
  totalUsers?: number;
  /** Total amount of prizes distributed over the lifetime of the pool (base units) */
  totalPrizesDistributed?: number;
  /** Timelock buffer in seconds before winner payouts can be cranked (default: 300s) */
  payoutTimelockSeconds?: number;
}

export interface YieldBreakdown {
  grossYieldBase: number;
  protocolFeeBase: number;
  netYieldBase: number;
  grossYieldUi: number;
  protocolFeeUi: number;
  netYieldUi: number;
  feeBasisPoints: number;
  feePercentFormatted: string;
  underlyingApy: number;
  underlyingApyFormatted: string;
  netApy: number;
  netApyFormatted: string;
}

export interface YieldAmount {
  base: number;
  ui: number;
}

export interface YieldThresholdProgress {
  isMet: boolean;
  isConfigured: boolean;
  progressPercent: number; // 0..100 clamped
  currentBase: number;
  targetBase: number;
  currentUi: number;
  targetUi: number;
}

export interface PoolThresholdBreakdown {
  isConfigured: boolean;
  isMet: boolean;
  progressPercent: number;
  gross: {
    currentUi: number;
    targetUi: number;
    currentBase: number;
    targetBase: number;
  };
  net: {
    currentUi: number;
    targetUi: number;
    currentBase: number;
    targetBase: number;
  };
  feeBasisPoints: number;
  feePercentFormatted: string;
  tokenSymbol: string;
}

/**
 * Creates a default fallback PoolInfo structure for initial hydration and testing.
 */
export function createDefaultPoolFallback(poolId: number = 1): PoolInfo {
  return {
    poolId,
    tokenMint: USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: USDC_DECIMALS,
    bondPrice: usdc(5),
    stakeCycleDurationHrs: 168,
    feeBasisPoints: 250,
    status: "Active",
    totalDepositedPrincipal: 0,
    currentCycleEndAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    isFrozenForDraw: false,
    currentDrawCycleId: 1,
    prizeTiers: [
      { basisPoints: 5000, numWinners: 1 },
      { basisPoints: 3000, numWinners: 3 },
      { basisPoints: 2000, numWinners: 10 },
    ],
    estimatedPrizePot: 0,
    grossYield: 0,
    protocolFeeAmount: 0,
    minYieldThreshold: 0,
    underlyingApy: 0.085,
    lastSyncedAt: Math.floor(Date.now() / 1000),
    totalUsers: 0,
    totalPrizesDistributed: 0,
    payoutTimelockSeconds: 300,
  };
}

export interface UserTicketInfo {
  poolId: number;
  activeTicketsCount: number;
  pendingTicketsCount: number;
}

export interface WinnerEntry {
  winner: string;
  winnerPubkey?: string;
  amountOwed: number;
  paidOut: boolean;
  tierIndex: number;
  bondsBought?: number;
}

export interface PayoutInfo {
  poolId: number;
  cycleId: number;
  winnersCount: number;
  payoutsCompleted: number;
  winners: WinnerEntry[];
}

// ─── UI-only composite types ─────────────────────────────────────────────────

export interface RecentWinner {
  address: string;
  amount: number;
  tierIndex: number;
  cycleId: number;
  tokenSymbol: string;
}

export type PrizeStatus = "processing" | "reinvested";

/** A single entry in the Prize History Ledger */
export interface PrizeHistoryEntry {
  drawCycleId: number;
  date: string; // ISO date string
  tierIndex: number; // 0 = Grand Prize, 1 = Runner-up, 2 = Consolation
  amount: number; // base units (total amount won in this draw)
  winnerIndex: number; // index in PayoutRegistry.winners[] — needed for crank
  status: PrizeStatus;
  bondsBought?: number; // count of bonds bought via reinvestment
  dustAccumulated?: number; // dust accumulated from this draw (when finalized)
  usedPriorDust?: number; // base units of previously accumulated dust applied to purchase tickets
  reinvestedTickets?: number; // present when status is "reinvested"
  winningTicket?: string;
  vrfSeed?: string;
  txSignature?: string;
  revealedAt?: number; // unix timestamp (seconds) from PayoutRegistry
}

export type ActivityType =
  | "deposit"
  | "withdraw"
  | "win"
  | "auto-reinvest"
  | "claim-redemption";

/** A single entry in the Activity Feed */
export interface ActivityEntry {
  id: string;
  date: string; // ISO date string
  type: ActivityType;
  description: string; // human-readable summary
  amount?: number; // base units, optional
  txSignature?: string; // Solana transaction signature (base58)
}

export interface PendingRedemption {
  redemptionId: string;
  amount: number;
  status: "settling" | "ready";
  requestedAt: string; // ISO date string
  type: "bond_sale" | "prize_claim";
}

// ─── Protocol Draw Explorer Types ───────────────────────────────────────────

export type DrawStatusName =
  | "AwaitingYield"
  | "AwaitingRandomness"
  | "Complete"
  | "ForceUnlocked"
  | "Skipped"
  | "Voided"
  | "HaltedInsolvent"
  | "HaltedYieldSpike";

export interface DrawWinnerRecord {
  winnerIndex: number;
  slotInTier: number;
  winnerAddress: string;
  amountOwed: number; // base units
  bondsBought: number;
  processed: boolean;
  tierIndex: number;
  winningTicketIndex?: number;
}

export interface DrawCycleSummary {
  poolId: number;
  cycleId: number;
  status: DrawStatusName;
  prizePot: number; // base units
  cycleFeeCollected: number;
  lockedTicketCount: number;
  harvestSlot: number;
  randomnessAccount: string;
  randomnessSeed: Uint8Array;
  vrfSeedHex: string;
  revealedAt?: number; // unix timestamp (seconds) from PayoutRegistry
  initiatedAt?: number; // unix timestamp (seconds) from DrawCycle
  completedAt?: number; // unix timestamp (seconds) from DrawCycle
  winnersCount: number;
  payoutsCompleted: number;
  hasPayoutRegistry: boolean;
}

export interface DetailedDrawCycle extends DrawCycleSummary {
  payoutRegistryStatus?: "Active" | "Voided";
  winners: DrawWinnerRecord[];
  isUserWinner?: boolean;
  userWinningsTotal?: number;
}

export interface DrawHistoryStats {
  totalYieldDistributed: number; // base units
  totalDrawsCompleted: number;
  totalWinningBonds: number;
  averagePrizePot: number; // base units
}
