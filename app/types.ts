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
  autoReinvestDefault: boolean;
  /** Estimated prize pot for the current cycle (off-chain calc) */
  estimatedPrizePot: number;
}

export interface UserTicketInfo {
  poolId: number;
  activeTicketsCount: number;
  pendingTicketsCount: number;
}

export interface WinnerEntry {
  winnerPubkey: string;
  amountOwed: number;
  paidOut: boolean;
  tierIndex: number;
  amountReinvested: number;
}

export interface PayoutInfo {
  poolId: number;
  cycleId: number;
  winnersCount: number;
  payoutsCompleted: number;
  winners: WinnerEntry[];
}

export interface UserPreferenceInfo {
  poolId: number;
  user: string;
  autoReinvest: boolean;
}

// ─── UI-only composite types ─────────────────────────────────────────────────

export interface RecentWinner {
  address: string;
  amount: number;
  tierIndex: number;
  cycleId: number;
  tokenSymbol: string;
}

export type PrizeStatus = "unclaimed" | "claimed" | "auto-reinvested";

/** A single entry in the Prize History Ledger */
export interface PrizeHistoryEntry {
  drawCycleId: number;
  date: string; // ISO date string
  tierIndex: number; // 0 = Grand Prize, 1 = Runner-up, 2 = Consolation
  amount: number; // base units
  status: PrizeStatus;
  reinvestedTickets?: number; // present when status is "auto-reinvested"
}

export type ActivityType = "deposit" | "withdraw" | "win" | "auto-reinvest";

/** A single entry in the Activity Feed */
export interface ActivityEntry {
  id: string;
  date: string; // ISO date string
  type: ActivityType;
  description: string; // human-readable summary
  amount?: number; // base units, optional
}
