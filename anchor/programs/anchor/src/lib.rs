pub mod constants;
pub mod error;
pub mod instructions;
pub mod kamino;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6pqRfnwjovBRjLcw2LmsRTM6ozKhiXDAa6iLc5eQKnbf");

#[program]
pub mod anchor {
    use super::*;

    pub fn initialize_global(ctx: Context<InitializeGlobal>, max_tickets_per_buy: u32) -> Result<()> {
        instructions::admin::initialize_global::handle(ctx, max_tickets_per_buy)
    }

    pub fn update_global_config(
        ctx: Context<UpdateGlobalConfig>,
        new_admin: Option<Pubkey>,
        new_jobs_account: Option<Pubkey>,
        new_max_tickets_per_buy: Option<u32>,
    ) -> Result<()> {
        instructions::admin::update_global_config::handle(
            ctx,
            new_admin,
            new_jobs_account,
            new_max_tickets_per_buy,
        )
    }

    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_id: u32,
        bond_price: u64,
        stake_cycle_duration_hrs: i64,
        fee_basis_points: u16,
        max_withdrawal_slippage_dust: u64,
    ) -> Result<()> {
        instructions::admin::create_pool::handle(
            ctx,
            pool_id,
            bond_price,
            stake_cycle_duration_hrs,
            fee_basis_points,
            max_withdrawal_slippage_dust,
        )
    }

    pub fn buy_bonds(ctx: Context<BuyBonds>, tickets_to_buy: u32) -> Result<()> {
        instructions::user::buy_bonds::handle(ctx, tickets_to_buy)
    }

    pub fn sell_bonds(
        ctx: Context<SellBonds>,
        active_indices: Vec<u32>,
        pending_indices: Vec<u32>,
        ktokens_to_burn: u64,
    ) -> Result<()> {
        instructions::user::sell_bonds::handle(
            ctx,
            active_indices,
            pending_indices,
            ktokens_to_burn,
        )
    }

    pub fn harvest_yield_and_commit(
        ctx: Context<HarvestYieldAndCommit>,
        ktokens_to_burn: u64,
    ) -> Result<()> {
        instructions::yield_draw::harvest_yield_and_commit::handle(ctx, ktokens_to_burn)
    }

    pub fn reveal_and_pick_winners(
        ctx: Context<RevealAndPickWinners>,
        random_seed: [u8; 32],
        num_winners: u32,
    ) -> Result<()> {
        instructions::yield_draw::reveal_and_pick_winners::handle(ctx, random_seed, num_winners)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, cycle_id: u32, winner_index: u32) -> Result<()> {
        instructions::yield_draw::claim_prize::handle(ctx, cycle_id, winner_index)
    }
}
