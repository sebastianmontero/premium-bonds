CREATE TABLE "bonds_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"signature" varchar(88) NOT NULL,
	"event_index" integer DEFAULT 0 NOT NULL,
	"user_address" varchar(44) NOT NULL,
	"pool_id" integer NOT NULL,
	"activity_type" varchar(32) NOT NULL,
	"bonds" bigint DEFAULT 0 NOT NULL,
	"amount_usdc" bigint NOT NULL,
	"redemption_id" bigint,
	"cycle_id" integer,
	"block_time" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draw_history" (
	"pool_id" integer NOT NULL,
	"cycle_id" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"prize_pot" bigint NOT NULL,
	"cycle_fee_collected" bigint DEFAULT 0 NOT NULL,
	"locked_ticket_count" bigint DEFAULT 0 NOT NULL,
	"harvest_slot" bigint DEFAULT 0 NOT NULL,
	"randomness_account" varchar(44) DEFAULT '' NOT NULL,
	"vrf_seed_hex" varchar(64) DEFAULT '' NOT NULL,
	"winners_count" integer DEFAULT 0 NOT NULL,
	"total_distributed" bigint DEFAULT 0 NOT NULL,
	"winners_synced" boolean DEFAULT false NOT NULL,
	"initiated_at" bigint,
	"revealed_at" bigint,
	"completed_at" bigint,
	"signature" varchar(88) NOT NULL,
	"block_time" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_draw_history" PRIMARY KEY("pool_id","cycle_id")
);
--> statement-breakpoint
CREATE TABLE "draw_winners" (
	"pool_id" integer NOT NULL,
	"cycle_id" integer NOT NULL,
	"winner_index" integer NOT NULL,
	"winner_address" varchar(44) NOT NULL,
	"tier_index" integer NOT NULL,
	"amount_owed" bigint NOT NULL,
	"winning_ticket_idx" bigint,
	"processed" boolean DEFAULT false NOT NULL,
	"bonds_bought" bigint DEFAULT 0 NOT NULL,
	"dust_accumulated" bigint DEFAULT 0 NOT NULL,
	"claim_signature" varchar(88),
	"revealed_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_draw_winners" PRIMARY KEY("pool_id","cycle_id","winner_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"network" varchar(32) PRIMARY KEY NOT NULL,
	"contiguous_signature" varchar(88),
	"contiguous_slot" bigint DEFAULT 0,
	"latest_seen_signature" varchar(88),
	"latest_seen_slot" bigint DEFAULT 0,
	"last_block_time" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_redemptions" (
	"pool_id" integer NOT NULL,
	"redemption_id" bigint NOT NULL,
	"user_address" varchar(44) NOT NULL,
	"redemption_type" varchar(32) NOT NULL,
	"amount_usdc" bigint NOT NULL,
	"pst_shares_locked" bigint,
	"huma_request_id" numeric(39, 0),
	"status" varchar(32) DEFAULT 'settling' NOT NULL,
	"request_signature" varchar(88) NOT NULL,
	"claim_signature" varchar(88),
	"requested_at" bigint NOT NULL,
	"claimed_at" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pending_redemptions" PRIMARY KEY("pool_id","redemption_id")
);
--> statement-breakpoint
CREATE TABLE "pool_snapshots" (
	"pool_id" integer NOT NULL,
	"cycle_id" integer NOT NULL,
	"snapshot_time" bigint NOT NULL,
	"total_deposited_principal" bigint NOT NULL,
	"total_fees_accrued" bigint NOT NULL,
	"total_fees_withdrawn" bigint NOT NULL,
	"total_prizes_distributed" bigint NOT NULL,
	"raw_yield" bigint DEFAULT 0 NOT NULL,
	"prize_pot" bigint DEFAULT 0 NOT NULL,
	"fee_collected" bigint DEFAULT 0 NOT NULL,
	"locked_ticket_count" bigint DEFAULT 0 NOT NULL,
	"effective_apy" numeric(8, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pool_snapshots" PRIMARY KEY("pool_id","cycle_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"signature" varchar(88) NOT NULL,
	"event_index" integer DEFAULT 0 NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"pool_id" integer NOT NULL,
	"user_address" varchar(44),
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_portfolio_stats" (
	"pool_id" integer NOT NULL,
	"user_address" varchar(44) NOT NULL,
	"active_bonds" bigint DEFAULT 0 NOT NULL,
	"total_deposited_usdc" bigint DEFAULT 0 NOT NULL,
	"total_withdrawn_usdc" bigint DEFAULT 0 NOT NULL,
	"total_won_usdc" bigint DEFAULT 0 NOT NULL,
	"total_claimed_usdc" bigint DEFAULT 0 NOT NULL,
	"total_reinvested_usdc" bigint DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"deposit_count" integer DEFAULT 0 NOT NULL,
	"withdraw_count" integer DEFAULT 0 NOT NULL,
	"first_activity_at" bigint NOT NULL,
	"last_activity_at" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_portfolio_stats" PRIMARY KEY("pool_id","user_address")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bonds_activity_sig_idx" ON "bonds_activity" USING btree ("signature","event_index");--> statement-breakpoint
CREATE INDEX "idx_activity_user_block_id" ON "bonds_activity" USING btree ("user_address","block_time","id");--> statement-breakpoint
CREATE INDEX "idx_activity_user_pool_block_id" ON "bonds_activity" USING btree ("user_address","pool_id","block_time","id");--> statement-breakpoint
CREATE INDEX "idx_draw_history_sync" ON "draw_history" USING btree ("winners_synced","status","pool_id");--> statement-breakpoint
CREATE INDEX "idx_draw_winners_user_pool_time" ON "draw_winners" USING btree ("winner_address","pool_id","revealed_at");--> statement-breakpoint
CREATE INDEX "idx_draw_winners_cycle_tier" ON "draw_winners" USING btree ("pool_id","cycle_id","tier_index","winner_index");--> statement-breakpoint
CREATE INDEX "idx_pending_redemptions_user_pool" ON "pending_redemptions" USING btree ("user_address","pool_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "idx_pending_redemptions_active" ON "pending_redemptions" USING btree ("pool_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "idx_pool_snapshots_pool_time" ON "pool_snapshots" USING btree ("pool_id","snapshot_time");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_protocol_events_sig_idx" ON "protocol_events" USING btree ("signature","event_index");--> statement-breakpoint
CREATE INDEX "idx_events_pool_block" ON "protocol_events" USING btree ("pool_id","block_time");--> statement-breakpoint
CREATE INDEX "idx_events_user_block" ON "protocol_events" USING btree ("user_address","block_time");--> statement-breakpoint
CREATE INDEX "idx_user_portfolio_won" ON "user_portfolio_stats" USING btree ("pool_id","total_won_usdc");--> statement-breakpoint
CREATE INDEX "idx_user_portfolio_bonds" ON "user_portfolio_stats" USING btree ("pool_id","active_bonds");