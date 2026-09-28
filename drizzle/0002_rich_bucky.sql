ALTER TABLE "draw_history" RENAME COLUMN "harvest_slot" TO "vrf_seed_slot";--> statement-breakpoint
CREATE INDEX "idx_activity_user_type_block_id" ON "bonds_activity" USING btree ("user_address","pool_id","activity_type","block_time","id");--> statement-breakpoint
CREATE INDEX "idx_draw_winners_user_filter_sort" ON "draw_winners" USING btree ("winner_address","pool_id","processed","tier_index","cycle_id");--> statement-breakpoint
CREATE INDEX "idx_draw_winners_pool_cycle_processed" ON "draw_winners" USING btree ("pool_id","cycle_id","processed");