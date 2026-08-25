use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::RandomnessRebound;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PrizePool};
use anchor_lang::prelude::*;

/// Accounts required for the `crank_rebind_expired_randomness` instruction.
///
/// This instruction allows the authorized jobs account to rebind a draw cycle
/// to a new Switchboard randomness account if the previous randomness request expired
/// (i.e. more than 1000 slots have passed since harvest without resolution).
///
/// # Accounts
///
/// * `crank`: The crank signer executing the instruction. Must match the `jobs_account` specified in `global_config`.
/// * `global_config`: The global configuration account for checking authorization.
/// * `pool`: The prize pool account.
/// * `current_draw_cycle`: The current draw cycle account to modify.
/// * `new_randomness_account`: The new Switchboard On-Demand randomness account.
///
/// # PDA Derivations
///
/// * `global_config`: PDA derived with seeds `[GLOBAL_CONFIG_SEED]` (i.e. `b"global_config"`) and a dynamic bump.
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`.
/// * `current_draw_cycle`: PDA derived with seeds `[DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()]` (i.e. `b"draw_cycle"`) and a dynamic bump.
#[derive(Accounts)]
pub struct CrankRebindExpiredRandomness<'info> {
    /// The crank signer executing the instruction. Must match the jobs_account.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The global configuration account, checked to verify that the signer is the authorized jobs account.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        constraint = pool.load()?.status == (crate::state::PoolStatus::Active as u8) @ PremiumBondsError::PoolNotActive,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The current draw cycle account whose randomness is being rebound.
    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// CHECK: This is the raw new randomness account to be bound to the draw cycle. It is unchecked because it is a Switchboard On-Demand account. We enforce safety by validating that its owner matches the Switchboard On-Demand program ID.
    #[account(
        constraint = new_randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub new_randomness_account: UncheckedAccount<'info>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Rebinds the current draw cycle to a new Switchboard randomness account.
///
/// If a randomness request is committed but cannot be resolved or is not revealed
/// within 1000 slots (~6.6 minutes), the randomness request expires and becomes stale.
/// This instruction allows the crank bot to specify a new Switchboard randomness account and
/// reset the harvest slot, enabling the draw cycle resolution flow to be retried.
pub fn handle(ctx: Context<CrankRebindExpiredRandomness>) -> Result<()> {
    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.ensure_current_version()?;
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

    let old_randomness = draw_cycle.randomness_account;

    // Rebind our contract state to the new randomness account and reset harvest slot.
    // The crank bot must have already created this new randomness account on Switchboard and committed it.
    draw_cycle.randomness_account = ctx.accounts.new_randomness_account.key();
    draw_cycle.harvest_slot = clock.slot;

    let pool_id = ctx.accounts.pool.load()?.pool_id;

    #[cfg(feature = "debug-logs")]
    msg!(
        "CrankRebindExpiredRandomness: re-bound pool_id={}, cycle_id={} to new randomness_account={}",
        pool_id,
        draw_cycle.cycle_id,
        draw_cycle.randomness_account
    );

    emit_cpi!(RandomnessRebound {
        pool_id,
        cycle_id: draw_cycle.cycle_id,
        old_randomness_account: old_randomness,
        new_randomness_account: draw_cycle.randomness_account,
        harvest_slot: clock.slot,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
