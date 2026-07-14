use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PrizePool};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AdminForceUnlockDraw<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(mut)]
    pub admin: Signer<'info>,

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
}

pub fn handle(ctx: Context<AdminForceUnlockDraw>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.is_frozen_for_draw = false;

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(
        draw_cycle.status == DrawStatus::AwaitingRandomness,
        PremiumBondsError::InvalidDrawStatus
    );
    draw_cycle.status = DrawStatus::Complete;

    msg!(
        "AdminForceUnlockDraw: force unlocked pool_id={}, cycle_id={}",
        pool.pool_id,
        draw_cycle.cycle_id
    );
    Ok(())
}
