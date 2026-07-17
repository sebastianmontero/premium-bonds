#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod huma;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx");

#[program]
pub mod anchor {
    use super::*;

    pub fn initialize_global(
        ctx: Context<InitializeGlobal>,
        max_tickets_per_buy: u32,
    ) -> Result<()> {
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
    ) -> Result<()> {
        instructions::admin::create_pool::handle(
            ctx,
            pool_id,
            bond_price,
            stake_cycle_duration_hrs,
            fee_basis_points,
        )
    }

    pub fn initialize_huma_lender(ctx: Context<InitializeHumaLender>) -> Result<()> {
        instructions::admin::initialize_huma_lender::handle(ctx)
    }

    pub fn buy_bonds(ctx: Context<BuyBonds>, tickets_to_buy: u32) -> Result<()> {
        instructions::user::buy_bonds::handle(ctx, tickets_to_buy)
    }

    pub fn resize_registry(ctx: Context<ResizeRegistry>) -> Result<()> {
        instructions::admin::resize_registry::handle(ctx)
    }

    pub fn sell_bonds(
        ctx: Context<SellBonds>,
        active_indices: Vec<u32>,
        pending_indices: Vec<u32>,
    ) -> Result<()> {
        instructions::user::sell_bonds::handle(ctx, active_indices, pending_indices)
    }

    pub fn claim_redemption(ctx: Context<ClaimRedemption>) -> Result<()> {
        instructions::user::claim_redemption::handle(ctx)
    }

    pub fn set_prize_tiers(ctx: Context<SetPrizeTiers>, tiers: Vec<PrizeTier>) -> Result<()> {
        instructions::admin::set_prize_tiers::handle(ctx, tiers)
    }

    pub fn harvest_yield_and_commit(ctx: Context<HarvestYieldAndCommit>) -> Result<()> {
        instructions::yield_draw::harvest_yield_and_commit::handle(ctx)
    }

    pub fn reveal_and_pick_winners(ctx: Context<RevealAndPickWinners>) -> Result<()> {
        instructions::yield_draw::reveal_and_pick_winners::handle(ctx)
    }

    pub fn admin_force_unlock_draw(ctx: Context<AdminForceUnlockDraw>) -> Result<()> {
        instructions::yield_draw::admin_force_unlock_draw::handle(ctx)
    }

    pub fn crank_rebind_expired_randomness(
        ctx: Context<CrankRebindExpiredRandomness>,
    ) -> Result<()> {
        instructions::yield_draw::crank_rebind_expired_randomness::handle(ctx)
    }

    pub fn claim_non_reinvested_winnings(ctx: Context<ClaimNonReinvestedWinnings>) -> Result<()> {
        instructions::yield_draw::claim_non_reinvested_winnings::handle(ctx)
    }

    pub fn update_pool_config(
        ctx: Context<UpdatePoolConfig>,
        new_fee_basis_points: Option<u16>,
        new_bond_price: Option<u64>,
        new_fee_wallet: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::update_pool_config::handle(
            ctx,
            new_fee_basis_points,
            new_bond_price,
            new_fee_wallet,
        )
    }

    pub fn reinvest_winnings(
        ctx: Context<ReinvestWinnings>,
        cycle_id: u32,
        winner_index: u32,
        max_bonds: u32,
    ) -> Result<()> {
        instructions::yield_draw::reinvest_winnings::handle(ctx, cycle_id, winner_index, max_bonds)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_fees::handle(ctx, amount)
    }
}
