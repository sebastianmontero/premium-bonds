import type {
  PoolInfo,
  UserTicketInfo,
  PayoutInfo,
  UserPreferenceInfo,
  RecentWinner,
  PrizeHistoryEntry,
  ActivityEntry,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Convert a human-readable USDC amount to on-chain base units. */
function usdc(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

/** Unix timestamp in seconds, offset from now by the given hours. */
function hoursFromNow(hours: number): number {
  return Math.floor(Date.now() / 1000) + hours * 3600;
}

// ─── Mock Pool ───────────────────────────────────────────────────────────────

export const MOCK_POOL: PoolInfo = {
  poolId: 1,
  tokenMint: USDC_MINT,
  tokenSymbol: "USDC",
  tokenDecimals: USDC_DECIMALS,
  bondPrice: usdc(5), // 1 ticket = 5 USDC
  stakeCycleDurationHrs: 168, // weekly
  feeBasisPoints: 250, // 2.5%
  status: "Active",
  totalDepositedPrincipal: usdc(125_340),
  currentCycleEndAt: hoursFromNow(60), // ~2.5 days from now
  isFrozenForDraw: false,
  currentDrawCycleId: 42,
  prizeTiers: [
    { basisPoints: 5000, numWinners: 1 }, // 50% — Grand Prize
    { basisPoints: 3000, numWinners: 3 }, // 30% — Runner-up (10% each)
    { basisPoints: 2000, numWinners: 10 }, // 20% — Consolation (2% each)
  ],
  autoReinvestDefault: true,
  estimatedPrizePot: usdc(4_520),
};

// ─── Mock User ───────────────────────────────────────────────────────────────

export const MOCK_USER_ADDRESS =
  "7xKX...q3Fp"; // truncated for display

export const MOCK_WALLET_BALANCE = usdc(500); // 500 USDC available

export const MOCK_USER_TICKETS: UserTicketInfo = {
  poolId: 1,
  activeTicketsCount: 250,
  pendingTicketsCount: 0,
};

export const MOCK_USER_PREFERENCE: UserPreferenceInfo = {
  poolId: 1,
  user: MOCK_USER_ADDRESS,
  autoReinvest: true,
};

// ─── Mock Payout (unclaimed) ─────────────────────────────────────────────────

export const MOCK_PAYOUT: PayoutInfo = {
  poolId: 1,
  cycleId: 41,
  winnersCount: 14,
  payoutsCompleted: 12,
  winners: [
    {
      winnerPubkey: MOCK_USER_ADDRESS,
      amountOwed: usdc(85),
      paidOut: false,
      tierIndex: 2, // consolation
      amountReinvested: 0,
    },
  ],
};

// ─── Recent Winners (for ticker) ─────────────────────────────────────────────

export const MOCK_RECENT_WINNERS: RecentWinner[] = [
  { address: "9fBk...mN2x", amount: usdc(2_260), tierIndex: 0, cycleId: 41, tokenSymbol: "USDC" },
  { address: "3vPq...hR7z", amount: usdc(452), tierIndex: 1, cycleId: 41, tokenSymbol: "USDC" },
  { address: "Dp8L...wK4a", amount: usdc(452), tierIndex: 1, cycleId: 41, tokenSymbol: "USDC" },
  { address: "7xKX...q3Fp", amount: usdc(85), tierIndex: 2, cycleId: 41, tokenSymbol: "USDC" },
  { address: "Ym3J...cV9e", amount: usdc(85), tierIndex: 2, cycleId: 41, tokenSymbol: "USDC" },
  { address: "Qw2N...pL5d", amount: usdc(85), tierIndex: 2, cycleId: 41, tokenSymbol: "USDC" },
  { address: "Bk7R...zX1m", amount: usdc(85), tierIndex: 2, cycleId: 41, tokenSymbol: "USDC" },
  { address: "Hn4T...sW8f", amount: usdc(85), tierIndex: 2, cycleId: 41, tokenSymbol: "USDC" },
];

// ─── Format helpers ──────────────────────────────────────────────────────────

/** Format base-unit amount to human-readable with commas. */
export function formatTokenAmount(
  amount: number,
  decimals: number = USDC_DECIMALS,
  fractionDigits: number = 2,
): string {
  return (amount / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Map tier index to a human label. */
export function tierLabel(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "Grand Prize";
    case 1:
      return "Runner-up";
    default:
      return "Consolation";
  }
}

/** Map tier index to a Tailwind color class. */
export function tierColor(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "text-amber-400";
    case 1:
      return "text-secondary";
    default:
      return "text-tertiary";
  }
}

/** Map tier index to a badge background class. */
export function tierBadgeClass(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "pill pill-warning"; // amber/gold
    case 1:
      return "pill pill-info"; // purple/primary
    default:
      return "pill pill-amber"; // teal-ish consolation
  }
}

// ─── Portfolio: Aggregate stats ──────────────────────────────────────────────

export const MOCK_LIFETIME_WINNINGS = usdc(170);
export const MOCK_AUTO_REINVESTED_TOTAL = usdc(85);

// ─── Portfolio: Prize History Ledger ─────────────────────────────────────────

export const MOCK_PRIZE_HISTORY: PrizeHistoryEntry[] = [
  {
    drawCycleId: 41,
    date: "2024-04-18",
    tierIndex: 2,
    amount: usdc(85),
    status: "unclaimed",
  },
  {
    drawCycleId: 38,
    date: "2024-04-11",
    tierIndex: 1,
    amount: usdc(85),
    status: "auto-reinvested",
    reinvestedTickets: 17,
  },
  {
    drawCycleId: 35,
    date: "2024-04-04",
    tierIndex: 2,
    amount: usdc(42),
    status: "claimed",
  },
];

// ─── Portfolio: Activity Feed ────────────────────────────────────────────────

export const MOCK_ACTIVITY_FEED: ActivityEntry[] = [
  {
    id: "act-1",
    date: "2024-04-20",
    type: "deposit",
    description: "Deposited 500 USDC → 100 tickets",
    amount: usdc(500),
  },
  {
    id: "act-2",
    date: "2024-04-18",
    type: "win",
    description: "Won $85.00 USDC · Consolation · Draw #41",
    amount: usdc(85),
  },
  {
    id: "act-3",
    date: "2024-04-15",
    type: "auto-reinvest",
    description: "Auto-reinvested $85.00 → +17 tickets, $0.00 dust",
    amount: usdc(85),
  },
  {
    id: "act-4",
    date: "2024-04-10",
    type: "deposit",
    description: "Deposited 750 USDC → 150 tickets",
    amount: usdc(750),
  },
];

