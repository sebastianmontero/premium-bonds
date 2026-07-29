use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PrizePool};
use anchor_lang::prelude::*;

/// Accounts required for the `admin_force_unlock_draw` instruction.
///
/// This instruction is used by the admin to force unlock a pool frozen for a draw
/// if the draw process gets stuck.
///
/// # Accounts
///
/// * `global_config`: The global configuration account, checked for admin authorization.
/// * `admin`: The admin signer executing the instruction.
/// * `pool`: The prize pool account to unlock.
/// * `current_draw_cycle`: The current draw cycle account to finalize.
///
/// # PDA Derivations
///
/// * `global_config`: PDA derived with seeds `[GLOBAL_CONFIG_SEED]` (i.e. `b"global_config"`) and a dynamic bump.
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`.
/// * `current_draw_cycle`: PDA derived with seeds `[DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()]` (i.e. `b"draw_cycle"`) and a dynamic bump.
#[derive(Accounts)]
pub struct AdminForceUnlockDraw<'info> {
    /// The global configuration account, validated to contain the admin address.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin signer executing the force unlock.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The prize pool state account to unlock.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    /// The current draw cycle account, validated to be awaiting randomness.
    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,
}

/// Force unlocks a prize pool and completes the draw cycle.
///
/// If a draw process gets stuck (e.g. due to Switchboard randomness issues), the admin can call this
/// instruction to unfreeze the pool (`is_frozen_for_draw` set to false) and mark the current draw cycle
/// status as `ForceUnlocked`. It also decrements `total_prizes_allocated` and `total_fees_accrued` by the
/// amounts committed during harvest to prevent corrupting future yield calculations.
pub fn handle(ctx: Context<AdminForceUnlockDraw>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.is_frozen_for_draw = false;

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(
        draw_cycle.status == DrawStatus::AwaitingRandomness,
        PremiumBondsError::InvalidDrawStatus
    );
    draw_cycle.status = DrawStatus::ForceUnlocked;

    if draw_cycle.prize_pot > 0 {
        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_sub(draw_cycle.prize_pot)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    if draw_cycle.cycle_fee_collected > 0 {
        pool.total_fees_accrued = pool
            .total_fees_accrued
            .checked_sub(draw_cycle.cycle_fee_collected)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    msg!(
        "AdminForceUnlockDraw: force unlocked pool_id={}, cycle_id={}",
        pool.pool_id,
        draw_cycle.cycle_id
    );
    Ok(())
}
