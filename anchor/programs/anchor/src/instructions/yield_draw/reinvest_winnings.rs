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
/// buy up to `max_bonds` bonds.
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
    max_bonds: u32,
) -> Result<()> {
    require!(max_bonds > 0, PremiumBondsError::InvalidBondQuantity);

    // ── 1. Validate winner entry ─────────────────────────────────────────────
    let payout_registry = &mut ctx.accounts.payout_registry.load_mut()?;
    let user_winnings = &mut ctx.accounts.user_winnings;
    let winner = payout_registry.validate_winner(winner_index, user_winnings)?;

    // ── 2. Calculate remaining amount and bonds for this batch ────────────────
    let remaining_current = winner.claimable_amount()?;
    let already_reinvested = winner.amount_reinvested;

    let accumulated = user_winnings.unclaimed_non_reinvested_winnings;

    let total_available = remaining_current
        .checked_add(accumulated)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let pool = &mut ctx.accounts.pool.load_mut()?;

    // How many total bonds can be bought with the total available?
    let total_bonds_available = (total_available / pool.bond_price) as u32;
    // Cap this batch at max_bonds
    let bonds_to_buy = total_bonds_available.min(max_bonds);
    let cost = (bonds_to_buy as u64)
        .checked_mul(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Determine if we're done (is this the final batch for current winnings?)
    // If total_bonds_available <= bonds_to_buy, then after this batch, the remaining total_available
    // will be less than pool.bond_price, which means we can't buy any more bonds.
    // So this is the final batch!
    let is_final_batch = total_bonds_available <= bonds_to_buy;

    // How much of the cost is paid from the current winnings vs accumulated?
    let from_current = cost.min(remaining_current);
    let from_accumulated = cost
        .checked_sub(from_current)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Update winner and user_winnings accounting
    let new_amount_reinvested = already_reinvested
        .checked_add(from_current)
        .ok_or(PremiumBondsError::MathOverflow)?;
    payout_registry.winners[winner_index as usize].amount_reinvested = new_amount_reinvested;

    user_winnings.unclaimed_non_reinvested_winnings = accumulated
        .checked_sub(from_accumulated)
        .ok_or(PremiumBondsError::MathOverflow)?;

    if bonds_to_buy > 0 {
        user_winnings.total_reinvested = user_winnings
            .total_reinvested
            .checked_add(cost)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    // If final batch, mark winner as processed, and transfer any remaining dust from current winnings
    if is_final_batch {
        let dust = remaining_current
            .checked_sub(from_current)
            .ok_or(PremiumBondsError::MathOverflow)?;
        if dust > 0 {
            user_winnings.unclaimed_non_reinvested_winnings = user_winnings
                .unclaimed_non_reinvested_winnings
                .checked_add(dust)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }
        payout_registry.mark_processed(winner_index);
    }

    // ── 3. Reinvest: accounting-only bond registration ──────────────────────
    //
    // No token movement needed. The $PST in pool_pst_vault already represent
    // the entire pool value including unrealized yield. We simply "re-book"
    // the winnings as principal and register new tickets.
    if bonds_to_buy > 0 {
        require!(
            pool.status == (PoolStatus::Active as u8),
            PremiumBondsError::PoolNotActive
        );
        require!(
            pool.is_frozen_for_draw == 0,
            PremiumBondsError::AwaitingRandomnessFreeze
        );

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
            registry.total_pending_tickets = registry
                .total_pending_tickets
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;
        } else {
            let mut registry = registry_loader.load_mut()?;
            registry.total_pending_tickets = registry
                .total_pending_tickets
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }

        let registry_ai = registry_loader.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;

        if is_new {
            let new_entry = crate::state::UserEntry {
                owner: ctx.accounts.winner.key(),
                active: 0,
                pending: bonds_to_buy,
                merged_through_cycle: current_cycle,
                cumulative_active: 0,
                version: 1,
                _reserved: [0; 15],
            };
            registry_set_entry(&mut data, user_entry_idx as usize, &new_entry);
        } else {
            let mut entry = registry_get_entry(&data, user_entry_idx as usize);
            require!(
                entry.owner == ctx.accounts.winner.key(),
                PremiumBondsError::InvalidUserEntryHint
            );

            entry.lazy_merge(current_cycle)?;
            entry.pending = entry
                .pending
                .checked_add(bonds_to_buy)
                .ok_or(PremiumBondsError::MathOverflow)?;

            registry_set_entry(&mut data, user_entry_idx as usize, &entry);
        }
    }

    // ── 5. Log for off-chain indexing ─────────────────────────────────────────
    msg!(
        "ReinvestWinnings: winner={}, bonds={}, reinvested_this_batch={}, total_reinvested={}, dust={}, final={}",
        ctx.accounts.winner.key(),
        bonds_to_buy,
        cost,
        new_amount_reinvested,
        if is_final_batch { remaining_current.checked_sub(from_current).unwrap_or(0) } else { 0 },
        is_final_batch,
    );

    emit_cpi!(WinningsReinvested {
        winner: ctx.accounts.winner.key(),
        pool_id: pool.pool_id,
        cycle_id: _cycle_id,
        bonds_bought: bonds_to_buy,
        amount_reinvested: cost,
        is_final_batch,
    });

    Ok(())
}
