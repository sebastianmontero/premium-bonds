use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PrizePool};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CrankRebindExpiredRandomness<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// CHECK: Checked by owner constraint
    #[account(
        constraint = new_randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub new_randomness_account: UncheckedAccount<'info>,
}

pub fn handle(ctx: Context<CrankRebindExpiredRandomness>) -> Result<()> {
    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(
        draw_cycle.status == DrawStatus::AwaitingRandomness,
        PremiumBondsError::InvalidDrawStatus
    );

    let clock = Clock::get()?;
    // Require that at least 1000 slots (~6.6 mins) have passed since harvest
    require!(
        clock.slot.saturating_sub(draw_cycle.harvest_slot) > 1000,
        PremiumBondsError::RandomnessNotExpired
    );

    // Rebind our contract state to the new randomness account and reset harvest slot.
    // The crank bot must have already created this new randomness account on Switchboard and committed it.
    draw_cycle.randomness_account = ctx.accounts.new_randomness_account.key();
    draw_cycle.harvest_slot = clock.slot;

    msg!(
        "CrankRebindExpiredRandomness: re-bound pool_id={}, cycle_id={} to new randomness_account={}",
        ctx.accounts.pool.pool_id,
        draw_cycle.cycle_id,
        draw_cycle.randomness_account
    );
    Ok(())
}
