use crate::constants::{DRAW_CYCLE_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{DrawCycle, DrawStatus, PrizePool, TicketRegistry};
use crate::utils::{registry_get_entry, registry_set_entry};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct PrepareDraw<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry,
        constraint = pool.is_frozen_for_draw @ PremiumBondsError::PoolNotFrozen,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
        constraint = draw_cycle.status == DrawStatus::AwaitingRandomness @ PremiumBondsError::InvalidDrawStatus
    )]
    pub draw_cycle: Box<Account<'info, DrawCycle>>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,
}

pub fn handle(ctx: Context<PrepareDraw>, batch_size: u32) -> Result<()> {
    let registry_loader = &ctx.accounts.ticket_registry;
    let (merge_cycle_id, start, end) = {
        let registry = registry_loader.load_mut()?;
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
    msg!(
        "Prepared entries from index {} to {}. Cumulative active: {}",
        start,
        end,
        cumulative
    );

    Ok(())
}
