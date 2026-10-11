CREATE TABLE IF NOT EXISTS "redemption_batches" (
	"pool_id" integer NOT NULL,
	"batch_id" bigint NOT NULL,
	"status" varchar(32) DEFAULT 'Accumulating' NOT NULL,
	"total_principal_requested" bigint DEFAULT 0 NOT NULL,
	"settled_usdc_received" bigint DEFAULT 0 NOT NULL,
	"claimed_principal" bigint DEFAULT 0 NOT NULL,
	"huma_request_id" numeric(39, 0),
	"created_at" bigint NOT NULL,
	"submitted_at" bigint,
	"settled_at" bigint,
	"closed_at" bigint,
	"submit_signature" varchar(88),
	"settle_signature" varchar(88),
	"close_signature" varchar(88),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_redemption_batches" PRIMARY KEY("pool_id","batch_id")
);
--> statement-breakpoint
ALTER TABLE "pending_redemptions" ADD COLUMN IF NOT EXISTS "batch_id" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pending_redemptions" DROP COLUMN IF EXISTS "huma_request_id";
--> statement-breakpoint
ALTER TABLE "redemption_batches" DROP COLUMN IF EXISTS "total_pst_shares_locked";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_redemption_batches_pool_status" ON "redemption_batches" USING btree ("pool_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_redemptions_batch" ON "pending_redemptions" USING btree ("pool_id","batch_id","status");
