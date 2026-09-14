use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PAYOUT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::DrawVoided;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PayoutRegistry, PrizePool};
use anchor_lang::prelude::*;

/// Accounts required for an admin to void a completed draw and roll back prize allocations.
#[derive(Accounts)]
pub struct AdminVoidPayoutRegistry<'info> {
    /// The global configuration state, used to verify the admin signature.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority.
    pub admin: Signer<'info>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The draw cycle account to void.
    #[account(
        mut,
        seeds = [
            DRAW_CYCLE_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            current_draw_cycle.cycle_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = current_draw_cycle.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        constraint = current_draw_cycle.status == DrawStatus::Complete @ PremiumBondsError::InvalidDrawStatus
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// The payout registry account to void.
    #[account(
        mut,
        seeds = [
            PAYOUT_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            current_draw_cycle.cycle_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub payout_registry: AccountLoader<'info, PayoutRegistry>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Voids a completed draw and cleanly rolls back accounting without corrupting invariants.
///
/// Can only be executed while `payouts_completed == 0`.
/// Reverses `pool.total_prizes_allocated` by the exact sum of winners' prizes (`total_distributed`).
/// Reverses `pool.total_fees_accrued` by `draw_cycle.cycle_fee_collected` after verifying unwithdrawn fees.
pub fn handle(ctx: Context<AdminVoidPayoutRegistry>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;
    require!(
        pool.status != (crate::state::PoolStatus::Closed as u8),
        PremiumBondsError::PoolClosed
    );
    require!(
        !pool.is_frozen(),
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let payout_ai = ctx.accounts.payout_registry.to_account_info();
    let mut payout_data = payout_ai.try_borrow_mut_data()?;
    let mut payout_view = crate::utils::get_payout_registry_mut(&mut payout_data)?;
    payout_view.header.ensure_current_version()?;

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;

    // 1. Mark voided and get total distributed prize sum
    let total_distributed = payout_view.void_draw()?;

    // 2. Rollback liabilities atomically and update draw cycle status
    let current_time = Clock::get()?.unix_timestamp;
    draw_cycle.void(current_time)?;
    pool.rollback_draw_liabilities(total_distributed, draw_cycle.cycle_fee_collected)?;

    emit_cpi!(DrawVoided {
        pool_id: pool.pool_id,
        cycle_id: draw_cycle.cycle_id,
        admin: ctx.accounts.admin.key(),
        prizes_reversed: total_distributed,
        fees_reversed: draw_cycle.cycle_fee_collected,
        timestamp: draw_cycle.completed_at,
    });

    Ok(())
}
