use crate::constants::{GLOBAL_CONFIG_SEED, PAYOUT_SEED};
use crate::error::PremiumBondsError;
use crate::events::PayoutRegistryClosed;
use crate::state::{GlobalConfig, PayoutRegistry};
use anchor_lang::prelude::*;

/// Accounts required for `crank_close_payout_registry` instruction.
///
/// Closes a fully processed or voided PayoutRegistry account, reimbursing 100% of the rent lamports
/// directly back to the crank bot (jobs_account or admin fallback).
#[derive(Accounts)]
#[instruction(pool_id: u32, cycle_id: u32)]
pub struct CrankClosePayoutRegistry<'info> {
    /// The global configuration state, verifying crank jobs_account (or admin fallback) authorization.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = (crank.key() == global_config.jobs_account || crank.key() == global_config.admin)
            @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The crank jobs account (or admin) receiving 100% of reclaimed rent lamports.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The payout registry account to close.
    #[account(
        mut,
        close = crank,
        seeds = [PAYOUT_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: AccountLoader<'info, PayoutRegistry>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Closes the payout registry account if all payouts are completed or the draw was voided.
pub fn handle(ctx: Context<CrankClosePayoutRegistry>, _pool_id: u32, _cycle_id: u32) -> Result<()> {
    let payout_registry = ctx.accounts.payout_registry.load()?;
    payout_registry.check_version()?;
    require!(
        payout_registry.can_close(),
        PremiumBondsError::PayoutsPending
    );

    let pool_id = payout_registry.pool_id;
    let cycle_id = payout_registry.cycle_id;

    emit_cpi!(PayoutRegistryClosed {
        pool_id,
        cycle_id,
        crank: ctx.accounts.crank.key(),
        rent_reclaimed_lamports: ctx.accounts.payout_registry.to_account_info().lamports(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
