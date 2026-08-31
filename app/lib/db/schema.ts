import {
  pgTable,
  serial,
  varchar,
  bigint,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * 1. Indexer Cursor (Decoupled contiguous sync watermark vs latest webhook slot)
 */
export const indexerCursor = pgTable("indexer_cursor", {
  network: varchar("network", { length: 32 }).primaryKey(),
  contiguousSignature: varchar("contiguous_signature", { length: 88 }),
  contiguousSlot: bigint("contiguous_slot", { mode: "number" }).default(0),
  latestSeenSignature: varchar("latest_seen_signature", { length: 88 }),
  latestSeenSlot: bigint("latest_seen_slot", { mode: "number" }).default(0),
  lastBlockTime: bigint("last_block_time", { mode: "number" })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * 2. Raw Protocol Events Log (Complete audit trail)
 */
export const protocolEvents = pgTable(
  "protocol_events",
  {
    id: serial("id").primaryKey(),
    signature: varchar("signature", { length: 88 }).notNull(),
    eventIndex: integer("event_index").notNull().default(0),
    slot: bigint("slot", { mode: "number" }).notNull(),
    blockTime: bigint("block_time", { mode: "number" }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    poolId: integer("pool_id").notNull(),
    userAddress: varchar("user_address", { length: 44 }),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqSigEventIdx: uniqueIndex("uq_protocol_events_sig_idx").on(
      t.signature,
      t.eventIndex
    ),
    idxPoolBlock: index("idx_events_pool_block").on(t.poolId, t.blockTime),
    idxUserBlock: index("idx_events_user_block").on(t.userAddress, t.blockTime),
  })
);

/**
 * 3. Normalized User Bonds Activity (Deposit / Withdraw / Redemption / Reinvest / Win)
 */
export const bondsActivity = pgTable(
  "bonds_activity",
  {
    id: serial("id").primaryKey(),
    signature: varchar("signature", { length: 88 }).notNull(),
    eventIndex: integer("event_index").notNull().default(0),
    userAddress: varchar("user_address", { length: 44 }).notNull(),
    poolId: integer("pool_id").notNull(),
    activityType: varchar("activity_type", { length: 32 }).notNull(),
    bonds: bigint("bonds", { mode: "number" }).notNull().default(0),
    amountUsdc: bigint("amount_usdc", { mode: "bigint" }).notNull(),
    redemptionId: bigint("redemption_id", { mode: "bigint" }),
    cycleId: integer("cycle_id"),
    blockTime: bigint("block_time", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqActivitySigIdx: uniqueIndex("uq_bonds_activity_sig_idx").on(
      t.signature,
      t.eventIndex
    ),
    idxUserBlockId: index("idx_activity_user_block_id").on(
      t.userAddress,
      t.blockTime,
      t.id
    ),
    idxUserFilteredId: index("idx_activity_user_pool_block_id").on(
      t.userAddress,
      t.poolId,
      t.blockTime,
      t.id
    ),
  })
);

/**
 * 4. Normalized Draw Cycles Summary (Complete contract fields + outbox hydrator tracking)
 */
export const drawHistory = pgTable(
  "draw_history",
  {
    poolId: integer("pool_id").notNull(),
    cycleId: integer("cycle_id").notNull(),
    status: varchar("status", { length: 32 }).notNull(), // 'Complete' | 'ForceUnlocked' | 'Voided' | 'Skipped' | 'AwaitingRandomness'
    prizePot: bigint("prize_pot", { mode: "bigint" }).notNull(),
    cycleFeeCollected: bigint("cycle_fee_collected", { mode: "bigint" })
      .notNull()
      .default(0n),
    lockedTicketCount: bigint("locked_ticket_count", { mode: "bigint" })
      .notNull()
      .default(0n),
    harvestSlot: bigint("harvest_slot", { mode: "number" })
      .notNull()
      .default(0),
    randomnessAccount: varchar("randomness_account", { length: 44 })
      .notNull()
      .default(""),
    vrfSeedHex: varchar("vrf_seed_hex", { length: 64 }).notNull().default(""),
    winnersCount: integer("winners_count").notNull().default(0),
    totalDistributed: bigint("total_distributed", { mode: "bigint" })
      .notNull()
      .default(0n),
    winnersSynced: boolean("winners_synced").notNull().default(false),
    initiatedAt: bigint("initiated_at", { mode: "number" }),
    revealedAt: bigint("revealed_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    signature: varchar("signature", { length: 88 }).notNull(),
    blockTime: bigint("block_time", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.poolId, t.cycleId], name: "pk_draw_history" }),
    idxWinnersSync: index("idx_draw_history_sync").on(
      t.winnersSynced,
      t.status,
      t.poolId
    ),
  })
);

/**
 * 5. Normalized Draw Winners (Individual Winner Roster per Cycle)
 */
export const drawWinners = pgTable(
  "draw_winners",
  {
    poolId: integer("pool_id").notNull(),
    cycleId: integer("cycle_id").notNull(),
    winnerIndex: integer("winner_index").notNull(),
    winnerAddress: varchar("winner_address", { length: 44 }).notNull(),
    tierIndex: integer("tier_index").notNull(),
    amountOwed: bigint("amount_owed", { mode: "bigint" }).notNull(),
    winningTicketIdx: bigint("winning_ticket_idx", { mode: "bigint" }),
    processed: boolean("processed").notNull().default(false),
    bondsBought: bigint("bonds_bought", { mode: "bigint" })
      .notNull()
      .default(0n),
    dustAccumulated: bigint("dust_accumulated", { mode: "bigint" })
      .notNull()
      .default(0n),
    claimSignature: varchar("claim_signature", { length: 88 }),
    revealedAt: bigint("revealed_at", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.poolId, t.cycleId, t.winnerIndex],
      name: "pk_draw_winners",
    }),
    idxUserLookup: index("idx_draw_winners_user_pool_time").on(
      t.winnerAddress,
      t.poolId,
      t.revealedAt
    ),
    idxCycleTier: index("idx_draw_winners_cycle_tier").on(
      t.poolId,
      t.cycleId,
      t.tierIndex,
      t.winnerIndex
    ),
  })
);

/**
 * 6. Pending Redemptions (Async Withdrawal & Settlement Tracker)
 */
export const pendingRedemptions = pgTable(
  "pending_redemptions",
  {
    poolId: integer("pool_id").notNull(),
    redemptionId: bigint("redemption_id", { mode: "bigint" }).notNull(),
    userAddress: varchar("user_address", { length: 44 }).notNull(),
    redemptionType: varchar("redemption_type", { length: 32 }).notNull(), // 'bond_sale' | 'prize_claim' | 'fee_withdrawal'
    amountUsdc: bigint("amount_usdc", { mode: "bigint" }).notNull(),
    pstSharesLocked: bigint("pst_shares_locked", { mode: "bigint" }),
    humaRequestId: numeric("huma_request_id", { precision: 39, scale: 0 }),
    status: varchar("status", { length: 32 }).notNull().default("settling"), // 'settling' | 'ready' | 'claimed'
    requestSignature: varchar("request_signature", { length: 88 }).notNull(),
    claimSignature: varchar("claim_signature", { length: 88 }),
    requestedAt: bigint("requested_at", { mode: "number" }).notNull(),
    claimedAt: bigint("claimed_at", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.poolId, t.redemptionId],
      name: "pk_pending_redemptions",
    }),
    idxUserLookup: index("idx_pending_redemptions_user_pool").on(
      t.userAddress,
      t.poolId,
      t.status,
      t.requestedAt
    ),
    idxActiveSentinel: index("idx_pending_redemptions_active").on(
      t.poolId,
      t.status,
      t.requestedAt
    ),
  })
);

/**
 * 7. Pool Snapshots (Historical TVL & APY Metrics)
 */
export const poolSnapshots = pgTable(
  "pool_snapshots",
  {
    poolId: integer("pool_id").notNull(),
    cycleId: integer("cycle_id").notNull(),
    snapshotTime: bigint("snapshot_time", { mode: "number" }).notNull(),
    totalDepositedPrincipal: bigint("total_deposited_principal", {
      mode: "bigint",
    }).notNull(),
    totalFeesAccrued: bigint("total_fees_accrued", {
      mode: "bigint",
    }).notNull(),
    totalFeesWithdrawn: bigint("total_fees_withdrawn", {
      mode: "bigint",
    }).notNull(),
    totalPrizesDistributed: bigint("total_prizes_distributed", {
      mode: "bigint",
    }).notNull(),
    rawYield: bigint("raw_yield", { mode: "bigint" }).notNull().default(0n),
    prizePot: bigint("prize_pot", { mode: "bigint" }).notNull().default(0n),
    feeCollected: bigint("fee_collected", { mode: "bigint" })
      .notNull()
      .default(0n),
    lockedTicketCount: bigint("locked_ticket_count", { mode: "bigint" })
      .notNull()
      .default(0n),
    effectiveApy: numeric("effective_apy", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.poolId, t.cycleId],
      name: "pk_pool_snapshots",
    }),
    idxPoolTime: index("idx_pool_snapshots_pool_time").on(
      t.poolId,
      t.snapshotTime
    ),
  })
);

/**
 * 8. User Portfolio Stats (Materialized Summaries & Leaderboard)
 */
export const userPortfolioStats = pgTable(
  "user_portfolio_stats",
  {
    poolId: integer("pool_id").notNull(),
    userAddress: varchar("user_address", { length: 44 }).notNull(),
    activeBonds: bigint("active_bonds", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalDepositedUsdc: bigint("total_deposited_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalWithdrawnUsdc: bigint("total_withdrawn_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalWonUsdc: bigint("total_won_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalClaimedUsdc: bigint("total_claimed_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalReinvestedUsdc: bigint("total_reinvested_usdc", { mode: "bigint" })
      .notNull()
      .default(0n),
    winCount: integer("win_count").notNull().default(0),
    depositCount: integer("deposit_count").notNull().default(0),
    withdrawCount: integer("withdraw_count").notNull().default(0),
    firstActivityAt: bigint("first_activity_at", { mode: "number" }).notNull(),
    lastActivityAt: bigint("last_activity_at", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.poolId, t.userAddress],
      name: "pk_user_portfolio_stats",
    }),
    idxLeaderboardWon: index("idx_user_portfolio_won").on(
      t.poolId,
      t.totalWonUsdc
    ),
    idxLeaderboardBonds: index("idx_user_portfolio_bonds").on(
      t.poolId,
      t.activeBonds
    ),
  })
);
