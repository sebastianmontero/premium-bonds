use crate::constants::{DRAW_CYCLE_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{DrawCycle, DrawStatus, PrizePool, TicketRegistry};
use crate::utils::{registry_get_entry, registry_set_entry};
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
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The prize pool state account, validated to be frozen for draw.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry,
        constraint = pool.load()?.status == (crate::state::PoolStatus::Active as u8) @ PremiumBondsError::PoolNotActive,
        constraint = pool.load()?.is_frozen_for_draw != 0 @ PremiumBondsError::PoolNotFrozen,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The current draw cycle account, validated to be awaiting randomness.
    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
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
    let registry_loader = &ctx.accounts.ticket_registry;
    let (merge_cycle_id, start, end) = {
        let mut registry = registry_loader.load_mut()?;
        registry.ensure_current_version()?;
        let cycle_id = registry.draw_cycle_id.saturating_sub(1);
        let start = registry.draw_prepared_up_to;
        let end = (start + batch_size).min(registry.user_count);
        (cycle_id, start, end)
    };

    let registry_ai = registry_loader.to_account_info();
    let mut data = registry_ai.try_borrow_mut_data()?;

    let mut cumulative = if start == 0 {
        0
    } else {
        registry_get_entry(&data, (start - 1) as usize).cumulative_active
    };

    for i in start..end {
        let mut entry = registry_get_entry(&data, i as usize);

        // Apply lazy merge
        entry.lazy_merge(merge_cycle_id)?;

        cumulative = cumulative
            .checked_add(entry.active)
            .ok_or(PremiumBondsError::MathOverflow)?;
        entry.cumulative_active = cumulative;

        registry_set_entry(&mut data, i as usize, &entry);
    }

    drop(data);

    let mut registry = registry_loader.load_mut()?;
    registry.draw_prepared_up_to = end;
    #[cfg(feature = "debug-logs")]
    msg!(
        "Prepared entries from index {} to {}. Cumulative active: {}",
        start,
        end,
        cumulative
    );

    Ok(())
}
