import type {
  PoolInfo,
  UserTicketInfo,
  PayoutInfo,
  RecentWinner,
  PrizeHistoryEntry,
  ActivityEntry,
  PendingRedemption,
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
  estimatedPrizePot: usdc(4_520),
};

// ─── Mock User ───────────────────────────────────────────────────────────────

export const MOCK_USER_ADDRESS = "7xKX...q3Fp"; // truncated for display

export const MOCK_WALLET_BALANCE = usdc(500); // 500 USDC available

export const MOCK_USER_TICKETS: UserTicketInfo = {
  poolId: 1,
  activeTicketsCount: 250,
  pendingTicketsCount: 0,
};

export const INITIAL_PENDING_REDEMPTIONS: PendingRedemption[] = [
  {
    redemptionId: "red-mock-1",
    amount: usdc(50),
    status: "settling",
    requestedAt: "2026-06-27T15:03:00.000Z", // Static time representation
    type: "bond_sale",
  },
  {
    redemptionId: "red-mock-2",
    amount: usdc(85),
    status: "ready",
    requestedAt: "2026-06-27T15:53:00.000Z", // Static time representation
    type: "prize_claim",
  },
  {
    redemptionId: "red-mock-3",
    amount: usdc(120),
    status: "settling",
    requestedAt: "2026-06-26T10:15:00.000Z",
    type: "bond_sale",
  },
  {
    redemptionId: "red-mock-4",
    amount: usdc(300),
    status: "ready",
    requestedAt: "2026-06-25T18:40:00.000Z",
    type: "prize_claim",
  },
  {
    redemptionId: "red-mock-5",
    amount: usdc(25),
    status: "ready",
    requestedAt: "2026-06-24T09:20:00.000Z",
    type: "bond_sale",
  },
];

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
  {
    address: "9fBk...mN2x",
    amount: usdc(2_260),
    tierIndex: 0,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "3vPq...hR7z",
    amount: usdc(452),
    tierIndex: 1,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "Dp8L...wK4a",
    amount: usdc(452),
    tierIndex: 1,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "7xKX...q3Fp",
    amount: usdc(85),
    tierIndex: 2,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "Ym3J...cV9e",
    amount: usdc(85),
    tierIndex: 2,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "Qw2N...pL5d",
    amount: usdc(85),
    tierIndex: 2,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "Bk7R...zX1m",
    amount: usdc(85),
    tierIndex: 2,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
  {
    address: "Hn4T...sW8f",
    amount: usdc(85),
    tierIndex: 2,
    cycleId: 41,
    tokenSymbol: "USDC",
  },
];

// ─── Format helpers ──────────────────────────────────────────────────────────

/** Format base-unit amount to human-readable with commas. */
export function formatTokenAmount(
  amount: number,
  decimals: number = USDC_DECIMALS,
  minFractionDigits: number = 2,
  maxFractionDigits?: number
): string {
  const finalMax =
    maxFractionDigits ??
    (minFractionDigits < 2
      ? minFractionDigits
      : Math.max(minFractionDigits, 6));

  return (amount / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: finalMax,
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
      return "inline-flex items-center gap-1 border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300 rounded-full shadow-[0_0_12px_rgba(245,158,11,0.15)]";
    case 1:
      return "inline-flex items-center gap-1 border border-secondary/30 bg-secondary/10 px-2.5 py-0.5 text-xs font-semibold text-secondary rounded-full";
    default:
      return "inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant px-2.5 py-0.5 text-xs font-medium text-on-surface-variant rounded-full";
  }
}

// ─── Portfolio: Aggregate stats ──────────────────────────────────────────────

// ─── Portfolio: Aggregate stats ──────────────────────────────────────────────

export const MOCK_LIFETIME_WINNINGS = usdc(1912); // Sum of winnings: 85 (Draw 41) + 85 + 42 + 25 + 1500 + 18 + 22 + 120 = 1912 (in usdc)
export const MOCK_AUTO_REINVESTED_TOTAL = usdc(1802); // Sum of reinvested: 85 (Draw 38) + 40 (Draw 35) + 25 (Draw 32) + 1500 (Draw 29) + 15 (Draw 26) + 20 (Draw 23) + 120 (Draw 20) = 1805. Let's make it 1805.

// ─── Portfolio: Prize History Ledger ─────────────────────────────────────────

export const MOCK_PRIZE_HISTORY: PrizeHistoryEntry[] = [
  {
    drawCycleId: 41,
    date: "2024-04-18",
    tierIndex: 2,
    amount: usdc(85),
    winnerIndex: 0,
    status: "processing",
    amountReinvested: 0,
    winningTicket: "154289",
    vrfSeed:
      "0x8f2d59ae7a5e8e3d0c2dbb5514f738ac2d19f8e3c12f4581aaefb0f20d5a3721",
    txSignature:
      "5bV9k8Pz7R2t1qJyXs8hM3nKa4Lp7dGf2s9e5w4x3c2v1b0n9m8a7s6d5f4g3h2j",
  },
  {
    drawCycleId: 38,
    date: "2024-04-11",
    tierIndex: 1,
    amount: usdc(85),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(85),
    dustAccumulated: usdc(0),
    reinvestedTickets: 17,
    winningTicket: "098231",
    vrfSeed:
      "0x3e21ab74d9e03f568a2d12f38c4ab798625df3890ce7cd842ebfae812d4a1b02",
    txSignature:
      "3tZ6X4yW8K9mNpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn",
  },
  {
    drawCycleId: 35,
    date: "2024-04-04",
    tierIndex: 2,
    amount: usdc(42),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(40),
    dustAccumulated: usdc(2),
    reinvestedTickets: 8,
    winningTicket: "042912",
    vrfSeed:
      "0xfa729e81b2c4d79a2ebdf01235de98214fa3bc876e9a8f4cde231bf584e03d79",
    txSignature:
      "2vR4w5qY9L8pHsDtFyGuJiKoLzMxNzPxQxRxSxTxUxVxWxXxYxZxAxBxCxDxExFx",
  },
  {
    drawCycleId: 32,
    date: "2024-03-28",
    tierIndex: 2,
    amount: usdc(25),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(25),
    dustAccumulated: usdc(0),
    reinvestedTickets: 5,
    winningTicket: "019482",
    vrfSeed:
      "0xbc892ea0124f5a381de0f9b6e82c578abef9a12cd0294e7b8f9aef1c2b5e670d",
    txSignature:
      "4aP8z9qK5W7mLxNtByCuViKoLzPxQxRxSxTxUxVxWxXxYxZxAxBxCxDxExFxGxHx",
  },
  {
    drawCycleId: 29,
    date: "2024-03-21",
    tierIndex: 0,
    amount: usdc(1500),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(1500),
    dustAccumulated: usdc(0),
    reinvestedTickets: 300,
    winningTicket: "005391",
    vrfSeed:
      "0x12a9e3d82f5b4c7f9ea0e81c72f5d027e8a9d1cd20e8b7c3d4fba7c125aefb98",
    txSignature:
      "9zL8x7kP2R4wJtQyXs8hM3nKa4Lp7dGf2s9e5w4x3c2v1b0n9m8a7s6d5f4g3h2j",
  },
  {
    drawCycleId: 26,
    date: "2024-03-14",
    tierIndex: 2,
    amount: usdc(18),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(18),
    usedPriorDust: usdc(2),
    dustAccumulated: usdc(0),
    reinvestedTickets: 4,
    winningTicket: "001289",
    vrfSeed:
      "0x78a1bc2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    txSignature:
      "6yT4r3eW2Q5nMbQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn",
  },
  {
    drawCycleId: 23,
    date: "2024-03-07",
    tierIndex: 2,
    amount: usdc(22),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(20),
    dustAccumulated: usdc(2),
    reinvestedTickets: 4,
    winningTicket: "000542",
    vrfSeed:
      "0x89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    txSignature:
      "7uI8o9pL0K2mNxDtFyGuJiKoLzMxNzPxQxRxSxTxUxVxWxXxYxZxAxBxCxDxExFx",
  },
  {
    drawCycleId: 20,
    date: "2024-02-29",
    tierIndex: 1,
    amount: usdc(120),
    winnerIndex: 0,
    status: "reinvested",
    amountReinvested: usdc(120),
    dustAccumulated: usdc(0),
    reinvestedTickets: 24,
    winningTicket: "000210",
    vrfSeed:
      "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    txSignature:
      "8iO9p0lK1J3bVcQyXs8hM3nKa4Lp7dGf2s9e5w4x3c2v1b0n9m8a7s6d5f4g3h2j",
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
  {
    id: "act-5",
    date: "2024-04-05",
    type: "claim-redemption",
    description: "Claimed settled redemption of 200 USDC to wallet",
    amount: usdc(200),
  },
  {
    id: "act-6",
    date: "2024-03-28",
    type: "withdraw",
    description: "Sold 40 bonds (200 USDC) · Pending settle",
    amount: usdc(200),
  },
  {
    id: "act-7",
    date: "2024-03-21",
    type: "win",
    description: "Won $1,500.00 USDC · Jackpot · Draw #29",
    amount: usdc(1500),
  },
  {
    id: "act-8",
    date: "2024-03-21",
    type: "auto-reinvest",
    description: "Auto-reinvested $1,500.00 → +300 tickets",
    amount: usdc(1500),
  },
  {
    id: "act-9",
    date: "2024-03-14",
    type: "win",
    description: "Won $18.00 USDC · Consolation · Draw #26",
    amount: usdc(18),
  },
  {
    id: "act-10",
    date: "2024-03-14",
    type: "auto-reinvest",
    description: "Auto-reinvested $18.00 winnings + $2.00 prior dust → +4 tickets",
    amount: usdc(20),
  },
  {
    id: "act-11",
    date: "2024-03-07",
    type: "win",
    description: "Won $22.00 USDC · Consolation · Draw #23",
    amount: usdc(22),
  },
  {
    id: "act-12",
    date: "2024-03-01",
    type: "deposit",
    description: "Deposited 1,000 USDC → 200 tickets",
    amount: usdc(1000),
  },
  {
    id: "act-13",
    date: "2024-02-29",
    type: "win",
    description: "Won $120.00 USDC · Tier 2 · Draw #20",
    amount: usdc(120),
  },
  {
    id: "act-14",
    date: "2024-02-20",
    type: "claim-redemption",
    description: "Claimed settled redemption of 50 USDC to wallet",
    amount: usdc(50),
  },
  {
    id: "act-15",
    date: "2024-02-15",
    type: "withdraw",
    description: "Sold 10 bonds (50 USDC) · Pending settle",
    amount: usdc(50),
  },
  {
    id: "act-16",
    date: "2024-02-01",
    type: "deposit",
    description: "Deposited 250 USDC → 50 tickets",
    amount: usdc(250),
  },
];
