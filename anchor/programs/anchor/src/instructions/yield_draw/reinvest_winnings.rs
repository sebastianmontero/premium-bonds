use crate::constants::{PAYOUT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::WinningsReinvested;
use crate::state::{PayoutRegistry, PoolStatus, PrizePool, TicketRegistry, UserWinnings};

use anchor_lang::prelude::*;

/// Synchronous, accounting-only reinvest.
///
/// Since yield is tracked on-chain via $PST price (not materialized USDC),
/// reinvesting simply means "buying more bonds" by increasing the principal
/// book value and registering new tickets. No token movement or CPI needed —
/// the $PST already represent the full pool value.
///
/// Dust (< 1 bond) is accumulated into the user's UserWinnings PDA.
#[derive(Accounts)]
#[instruction(cycle_id: u32, winner_index: u32)]
pub struct ReinvestWinnings<'info> {
    /// Permissionless crank — any signer can execute this instruction.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// CHECK: The winner's pubkey. Validated against the payout registry entry in the handler.
    pub winner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Box<Account<'info, PayoutRegistry>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(
        mut,
        seeds = [b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), winner.key().as_ref()],
        bump = user_winnings.bump,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<ReinvestWinnings>,
    _cycle_id: u32,
    winner_index: u32,
    max_bonds: u32,
) -> Result<()> {
    require!(max_bonds > 0, PremiumBondsError::InvalidBondQuantity);

    // ── 1. Validate winner entry ─────────────────────────────────────────────
    let payout_registry = &mut ctx.accounts.payout_registry;
    let winner = payout_registry.validate_winner(winner_index, &ctx.accounts.winner.key())?;

    // ── 2. Calculate remaining amount and bonds for this batch ────────────────
    let remaining_current = winner.claimable_amount();
    let already_reinvested = winner.amount_reinvested;

    let user_winnings = &mut ctx.accounts.user_winnings;
    let accumulated = user_winnings.unclaimed_non_reinvested_winnings;

    let total_available = remaining_current
        .checked_add(accumulated)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let pool = &mut ctx.accounts.pool;

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
            pool.status == PoolStatus::Active,
            PremiumBondsError::PoolNotActive
        );
        require!(
            !pool.is_frozen_for_draw,
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
        crate::utils::registry_add_tickets(
            &ctx.accounts.ticket_registry,
            &ctx.accounts.winner.key(),
            bonds_to_buy,
        )?;
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

    emit!(WinningsReinvested {
        winner: ctx.accounts.winner.key(),
        pool_id: pool.pool_id,
        cycle_id: _cycle_id,
        bonds_bought: bonds_to_buy,
        amount_reinvested: cost,
        is_final_batch,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
