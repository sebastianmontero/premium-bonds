ALTER TABLE "bonds_activity" ADD COLUMN "claimable_usdc" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bonds_activity" ADD COLUMN "used_prior_dust_usdc" bigint DEFAULT 0 NOT NULL;