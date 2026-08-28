import {
  pgTable,
  serial,
  varchar,
  bigint,
  integer,
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
 * 4. Normalized Draw Cycles Summary (Complete contract fields)
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
    lockedTicketCount: integer("locked_ticket_count").notNull().default(0),
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
    signature: varchar("signature", { length: 88 }).notNull(),
    blockTime: bigint("block_time", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.poolId, t.cycleId], name: "pk_draw_history" }),
  })
);
