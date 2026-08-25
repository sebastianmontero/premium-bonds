use crate::constants::{PAYOUT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::WinningsReinvested;
use crate::state::{PayoutRegistry, PoolStatus, PrizePool, TicketRegistry, UserWinnings};
use crate::utils::{registry_get_entry, registry_set_entry};

use anchor_lang::prelude::*;

/// Synchronous, accounting-only reinvest.
///
/// Since yield is tracked on-chain via $PST price (not materialized USDC),
/// reinvesting simply means "buying more bonds" by increasing the principal
/// book value and registering new tickets. No token movement or CPI needed —
/// the $PST already represent the full pool value.
///
/// Dust (< 1 bond) is accumulated into the user's UserWinnings PDA.
/// Accounts required for the `reinvest_winnings` instruction.
///
/// This instruction is used to reinvest a winner's claimable prize back into the pool to buy
/// more bonds. Reinvestment is synchronous and accounting-only since the underlying assets ($PST)
/// are already held in the pool's vault.
///
/// # Accounts
///
/// * `crank`: The permissionless signer running the reinvestment.
/// * `winner`: The winner's pubkey, validated against the payout registry.
/// * `payout_registry`: The payout registry containing the winners and payout details.
/// * `pool`: The prize pool account.
/// * `user_winnings`: The winner's winnings state tracking account.
/// * `ticket_registry`: The ticket registry loader.
/// * `system_program`: The Solana System program.
///
/// # PDA Derivations
///
/// * `payout_registry`: PDA derived with seeds `[PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()]` (i.e. `b"payout"`) and a dynamic bump.
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`.
/// * `user_winnings`: PDA derived with seeds `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), winner.key().as_ref()]` and bump `user_winnings.bump`.
#[derive(Accounts)]
#[instruction(cycle_id: u32, winner_index: u32)]
pub struct ReinvestWinnings<'info> {
    /// Permissionless crank — any signer can execute this instruction.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// CHECK: This is the public key of the winner whose winnings are being reinvested. It is unchecked because we only need its public key to validate against the corresponding entry in the `payout_registry` (checked in the handler via `payout_registry.validate_winner`).
    pub winner: UncheckedAccount<'info>,

    /// The payout registry containing the winner lists.
    #[account(
        mut,
        seeds = [PAYOUT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: AccountLoader<'info, PayoutRegistry>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The winner's user winnings state account.
    #[account(
        mut,
        seeds = [b"user_winnings", pool.load()?.pool_id.to_le_bytes().as_ref(), winner.key().as_ref()],
        bump = user_winnings.bump,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    /// The ticket registry account loader.
    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Reinvests a winner's claimable prize to purchase new bonds.
///
/// The handler validates the winner's key against the payout registry entry. It calculates the total
/// available winnings (including any previously accumulated non-reinvested winnings), and uses them to
/// buy new bonds atomically.
///
/// Because yield is tracked on-chain via $PST token balance and is not materialized into USDC, reinvesting
/// does not require moving tokens or making external CPI calls. The pool simply registers the new tickets in
/// the registry and increases the `total_deposited_principal` while decreasing `total_prizes_allocated`.
///
/// Any leftover dust less than the price of a single bond is stored in the user's `UserWinnings` state
/// to be claimed or aggregated in subsequent reinvestments.
pub fn handle(
    ctx: Context<ReinvestWinnings>,
    _cycle_id: u32,
    winner_index: u32,
) -> Result<()> {
    // ── 1. Validate winner entry & statuses ──────────────────────────────────
    let payout_registry = &mut ctx.accounts.payout_registry.load_mut()?;
    payout_registry.ensure_current_version()?;
    require!(
        payout_registry.status == (crate::state::PayoutRegistryStatus::Active as u8),
        PremiumBondsError::DrawVoided
    );

    let pool = &mut ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;
    require!(
        pool.status == (crate::state::PoolStatus::Active as u8),
        PremiumBondsError::PoolNotActive
    );
    require!(
        pool.is_frozen_for_draw == 0,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let clock = Clock::get()?;
    if pool.payout_timelock_seconds > 0 {
        let eligible_at = payout_registry
            .revealed_at
            .checked_add(pool.payout_timelock_seconds as i64)
            .ok_or(PremiumBondsError::MathOverflow)?;
        require!(
            clock.unix_timestamp >= eligible_at,
            PremiumBondsError::PayoutTimelockActive
        );
    }

    let user_winnings = &mut ctx.accounts.user_winnings;
    user_winnings.ensure_current_version()?;
    let winner = payout_registry.validate_winner(winner_index, user_winnings)?;

    // ── 2. Calculate remaining amount and bonds for atomic reinvestment ──────
    let remaining_current = winner.amount_owed;
    let accumulated = user_winnings.unclaimed_non_reinvested_winnings;

    let total_available = remaining_current
        .checked_add(accumulated)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // How many total bonds can be bought with the total available?
    let mut bonds_to_buy: u32 = total_available
        .checked_div(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?
        .try_into()
        .map_err(|_| error!(PremiumBondsError::MathOverflow))?;

    // Graceful fallback for exited users when registry is full:
    // If an exited user (registry_entry_index == u32::MAX) wins a prize and reinvest_winnings is called
    // while TicketRegistry is at 100% capacity, set bonds_to_buy = 0.
    // This routes 100% of their prize to unclaimed_non_reinvested_winnings (dust) and marks the winner as processed
    // so crank operations complete cleanly without reverting with RegistryFull.
    let user_entry_idx = user_winnings.registry_entry_index;
    let is_new = user_entry_idx == u32::MAX;
    if is_new {
        let registry = ctx.accounts.ticket_registry.load()?;
        if registry.user_count >= registry.capacity {
            bonds_to_buy = 0;
        }
    }

    let cost = (bonds_to_buy as u64)
        .checked_mul(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // How much of the cost is paid from the current winnings vs accumulated?
    let from_current = cost.min(remaining_current);
    let from_accumulated = cost
        .checked_sub(from_current)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Set bonds_bought and update user_winnings dust accounting
    payout_registry.winners[winner_index as usize].bonds_bought = bonds_to_buy;

    user_winnings.unclaimed_non_reinvested_winnings = accumulated
        .checked_sub(from_accumulated)
        .ok_or(PremiumBondsError::MathOverflow)?
        .checked_add(remaining_current.checked_sub(from_current).ok_or(PremiumBondsError::MathOverflow)?)
        .ok_or(PremiumBondsError::MathOverflow)?;

    if bonds_to_buy > 0 {
        user_winnings.total_reinvested = user_winnings
            .total_reinvested
            .checked_add(cost)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    // Mark winner as processed
    payout_registry.mark_processed(winner_index)?;

    // ── 3. Reinvest: accounting-only bond registration ──────────────────────
    //
    // No token movement needed. The $PST in pool_pst_vault already represent
    // the entire pool value including unrealized yield. We simply "re-book"
    // the winnings as principal and register new tickets.
    if bonds_to_buy > 0 {
        // Update principal (accounting)
        pool.total_deposited_principal = pool
            .total_deposited_principal
            .checked_add(cost)
            .ok_or(PremiumBondsError::MathOverflow)?;

        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_sub(cost)
            .ok_or(PremiumBondsError::MathOverflow)?;

        // Register new tickets
        let mut user_entry_idx = ctx.accounts.user_winnings.registry_entry_index;
        let is_new = user_entry_idx == u32::MAX;

        let registry_loader = &ctx.accounts.ticket_registry;
        let current_cycle = {
            let registry = registry_loader.load()?;
            registry.draw_cycle_id
        };

        if is_new {
            let mut registry = registry_loader.load_mut()?;
            registry.ensure_current_version()?;
            require!(
                registry.user_count < registry.capacity,
                crate::error::PremiumBondsError::RegistryFull
            );
            user_entry_idx = registry.user_count;
            ctx.accounts.user_winnings.registry_entry_index = user_entry_idx;
            registry.user_count = registry
                .user_count
                .checked_add(1)
                .ok_or(PremiumBondsError::MathOverflow)?;
            registry.total_active_tickets = registry
                .total_active_tickets
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;
        } else {
            let mut registry = registry_loader.load_mut()?;
            registry.ensure_current_version()?;
            registry.total_active_tickets = registry
                .total_active_tickets
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }

        let registry_ai = registry_loader.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;

        if is_new {
            let new_entry = crate::state::UserEntry {
                owner: ctx.accounts.winner.key(),
                active: bonds_to_buy,
                pending: 0,
                merged_through_cycle: current_cycle,
                cumulative_active: 0,
                version: crate::state::UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            };
            registry_set_entry(&mut data, user_entry_idx as usize, &new_entry)?;
        } else {
            let mut entry = registry_get_entry(&data, user_entry_idx as usize)?;
            require!(
                entry.owner == ctx.accounts.winner.key(),
                PremiumBondsError::InvalidUserEntryHint
            );

            entry.lazy_merge(current_cycle)?;
            entry.active = entry
                .active
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;

            registry_set_entry(&mut data, user_entry_idx as usize, &entry)?;
        }
    }

    // ── 5. Log for off-chain indexing ─────────────────────────────────────────
    #[cfg(feature = "debug-logs")]
    msg!(
        "ReinvestWinnings: winner={}, bonds={}, amount_reinvested={}",
        ctx.accounts.winner.key(),
        bonds_to_buy,
        cost,
    );

    emit_cpi!(WinningsReinvested {
        winner: ctx.accounts.winner.key(),
        pool_id: pool.pool_id,
        cycle_id: _cycle_id,
        bonds_bought: bonds_to_buy,
        amount_reinvested: cost,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
