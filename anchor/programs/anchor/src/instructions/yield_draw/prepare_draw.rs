use crate::constants::{DRAW_CYCLE_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::DrawPreparationProgress;
use crate::state::{DrawCycle, DrawStatus, PrizePool, TicketRegistry};
use crate::utils::get_ticket_registry_mut;
use anchor_lang::prelude::*;

/// Accounts required for the `prepare_draw` instruction.
///
/// This instruction prepares user entries for picking winners by performing
/// lazy merge calculations over a batch of entries.
///
/// # Accounts
///
/// * `crank`: The permissionless signer running the draw preparation.
/// * `pool`: The prize pool state account. It must be frozen for draw.
/// * `draw_cycle`: The current draw cycle account, which must be in `AwaitingRandomness` status.
/// * `ticket_registry`: The ticket registry account loader containing the user entries.
///
/// # PDA Derivations
///
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`
/// * `draw_cycle`: PDA derived with seeds `[DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), draw_cycle.cycle_id.to_le_bytes().as_ref()]` (i.e. `b"draw_cycle"`) and a dynamic bump
#[derive(Accounts)]
pub struct PrepareDraw<'info> {
    /// The permissionless signer running the draw preparation.
    pub crank: Signer<'info>,

    /// The prize pool state account, validated to be frozen for draw.
    #[account(
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry,
        constraint = pool.load()?.status == (crate::state::PoolStatus::Active as u8) @ PremiumBondsError::PoolNotActive,
        constraint = pool.load()?.is_frozen_for_draw != 0 @ PremiumBondsError::PoolNotFrozen,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The current draw cycle account, validated to be awaiting randomness.
    #[account(
        seeds = [DRAW_CYCLE_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
        constraint = draw_cycle.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        constraint = draw_cycle.status == DrawStatus::AwaitingRandomness @ PremiumBondsError::InvalidDrawStatus
    )]
    pub draw_cycle: Box<Account<'info, DrawCycle>>,

    /// The ticket registry loader.
    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,
}

/// Prepares a batch of ticket registry entries for the upcoming draw.
///
/// It processes `batch_size` user entries in the ticket registry starting from
/// `draw_prepared_up_to`. For each entry, it applies the lazy merge logic to catch up
/// the entry's state to the latest draw cycle, calculates the cumulative active tickets,
/// and saves the updated entries back to the registry. Finally, it updates the progress
/// indicator `draw_prepared_up_to`.
pub fn handle(ctx: Context<PrepareDraw>, batch_size: u32) -> Result<()> {
    require!(batch_size > 0, PremiumBondsError::InvalidBatchSize);
    ctx.accounts.pool.load()?.check_version()?;

    let progress = {
        let registry_ai = ctx.accounts.ticket_registry.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;
        let mut view = get_ticket_registry_mut(&mut data)?;
        view.prepare_draw_batch(batch_size)?
    };

    emit!(DrawPreparationProgress {
        pool_id: ctx.accounts.pool.load()?.pool_id,
        cycle_id: ctx.accounts.draw_cycle.cycle_id,
        crank: ctx.accounts.crank.key(),
        batch_start: progress.start,
        batch_end: progress.end,
        user_count: progress.user_count,
        is_complete: progress.is_complete,
        timestamp: Clock::get()?.unix_timestamp,
    });

    #[cfg(feature = "debug-logs")]
    msg!(
        "Prepared entries from index {} to {}. Cumulative active: {}",
        progress.start,
        progress.end,
        progress.final_cumulative
    );

    Ok(())
}
