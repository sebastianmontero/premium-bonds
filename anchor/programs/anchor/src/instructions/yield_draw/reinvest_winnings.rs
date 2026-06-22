use crate::constants::{PAYOUT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{PayoutRegistry, PoolStatus, PrizePool, TicketRegistry};
use crate::utils::registry_set_ticket;
use anchor_lang::prelude::*;

/// Synchronous, accounting-only reinvest.
///
/// Since yield is tracked on-chain via $PST price (not materialized USDC),
/// reinvesting simply means "buying more bonds" by increasing the principal
/// book value and registering new tickets. No token movement or CPI needed —
/// the $PST already represent the full pool value.
///
/// Dust (< 1 bond) remains as `claimable_amount` on the payout entry,
/// claimable via the async `claim_prize` flow.
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
    let remaining = winner.claimable_amount();
    let already_reinvested = winner.amount_reinvested;
    let _ = winner;

    let pool = &mut ctx.accounts.pool;

    // How many total bonds can be bought with the remaining amount?
    let total_remaining_bonds = (remaining / pool.bond_price) as u32;
    // Cap this batch at max_bonds
    let bonds_this_batch = total_remaining_bonds.min(max_bonds);
    let reinvest_amount = (bonds_this_batch as u64)
        .checked_mul(pool.bond_price)
        .unwrap();

    // After this batch, determine if we're done
    let new_amount_reinvested = already_reinvested.checked_add(reinvest_amount).unwrap();
    let is_final_batch = bonds_this_batch == total_remaining_bonds;

    // Dust only matters on the final batch (leftover that can't buy a whole bond)
    let dust = if is_final_batch {
        remaining.checked_sub(reinvest_amount).unwrap()
    } else {
        0
    };

    // ── 3. Reinvest: accounting-only bond registration ──────────────────────
    //
    // No token movement needed. The $PST in pool_pst_vault already represent
    // the entire pool value including unrealized yield. We simply "re-book"
    // the winnings as principal and register new tickets.
    if bonds_this_batch > 0 {
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
            .checked_add(reinvest_amount)
            .unwrap();

        // Register new tickets (same 3-phase logic as buy_bonds)
        let insert_start;
        {
            let registry = ctx.accounts.ticket_registry.load()?;
            let current_total = registry.active_tickets_count + registry.pending_tickets_count;
            require!(
                current_total + bonds_this_batch <= registry.capacity,
                PremiumBondsError::RegistryFull
            );
            insert_start =
                (registry.active_tickets_count + registry.pending_tickets_count) as usize;
        }

        {
            let registry_ai = ctx.accounts.ticket_registry.to_account_info();
            let mut data = registry_ai.try_borrow_mut_data()?;
            let winner_key = ctx.accounts.winner.key();
            for i in 0..bonds_this_batch as usize {
                registry_set_ticket(&mut data, insert_start + i, &winner_key);
            }
        }

        {
            let mut registry = ctx.accounts.ticket_registry.load_mut()?;
            registry.pending_tickets_count += bonds_this_batch;
        }
    }

    // ── 4. Update reinvestment progress ──────────────────────────────────────
    payout_registry.winners[winner_index as usize].amount_reinvested = new_amount_reinvested;

    if is_final_batch {
        // If no dust, mark fully paid. If dust exists, leave claimable for async claim_prize.
        if dust == 0 {
            payout_registry.mark_paid(winner_index);
        }
        // Dust remains as claimable_amount — user claims via claim_prize → claim_redemption
    }

    // ── 5. Log for off-chain indexing ─────────────────────────────────────────
    msg!(
        "ReinvestWinnings: winner={}, bonds={}, reinvested_this_batch={}, total_reinvested={}, dust={}, final={}",
        ctx.accounts.winner.key(),
        bonds_this_batch,
        reinvest_amount,
        new_amount_reinvested,
        dust,
        is_final_batch,
    );

    Ok(())
}
