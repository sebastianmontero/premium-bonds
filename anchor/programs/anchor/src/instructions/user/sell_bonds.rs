use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED};
use crate::error::PremiumBondsError;
use crate::events::BondsSold;
use crate::state::{
    InitPendingRedemptionParams, PendingRedemption, PrizePool, RedemptionBatch, RedemptionType,
    TicketRegistry, UserWinnings,
};
use crate::utils::get_ticket_registry_mut;
use anchor_lang::prelude::*;

/// Accounts required for a user to sell/redeem bonds into the active accumulating batch.
///
/// Notice: Zero Huma CPI accounts and zero token accounts!
///
/// ### Remaining Accounts
/// If the user's entry is removed and it was not the last entry in the `ticket_registry`,
/// the registry swaps the last entry into the deleted slot to fill the gap. In this swap case,
/// a single remaining account must be passed:
/// 1. `swapped_user_winnings` (mut, unchecked): The `UserWinnings` PDA of the owner of the swapped entry.
///    - PDA seeds: `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), swapped_owner.as_ref()]`.
#[derive(Accounts)]
pub struct SellBonds<'info> {
    /// The user selling the bonds. Signs and pays for the `pending_redemption` account rent.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The user winnings/metadata PDA tracking the user's registry index and winnings.
    ///
    /// PDA seeds: `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()]`.
    #[account(
        mut,
        seeds = [b"user_winnings", pool.load()?.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump,
        constraint = user_winnings.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    /// The prize pool state account.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]`.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The active accumulating redemption batch account.
    ///
    /// PDA seeds: `[REDEMPTION_BATCH_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.accumulating_redemption_batch_id.to_le_bytes().as_ref()]`.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.accumulating_redemption_batch_id.to_le_bytes().as_ref()
        ],
        bump = redemption_batch.bump
    )]
    pub redemption_batch: Box<Account<'info, RedemptionBatch>>,

    /// The zero-copy ticket registry storing all raffle ticket entries for this pool.
    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// PendingRedemption PDA created to track this async batch withdrawal receipt.
    ///
    /// PDA seeds: `[PENDING_REDEMPTION_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.next_redemption_id.to_le_bytes().as_ref()]`.
    #[account(
        init,
        payer = user,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Allows a user to sell/redeem their active and/or pending tickets.
///
/// Instead of making immediate Huma CPIs, this queues the redemption into the pool's
/// active `RedemptionBatch` account. Lightweight, gas-efficient, and free of external CPI accounts.
pub fn handle(ctx: Context<SellBonds>, active_to_sell: u32, pending_to_sell: u32) -> Result<()> {
    let bonds_to_sell = active_to_sell
        .checked_add(pending_to_sell)
        .ok_or(PremiumBondsError::MathOverflow)?;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondQuantity);

    let user_key = ctx.accounts.user.key();
    ctx.accounts.user_winnings.ensure_current_version()?;
    let user_entry_idx = ctx.accounts.user_winnings.registry_entry_index;
    require!(
        user_entry_idx != u32::MAX,
        PremiumBondsError::InvalidUserEntryHint
    );

    // Read-only pre-flight validation using check_version() (&self)
    {
        let registry = ctx.accounts.ticket_registry.load()?;
        registry.check_version()?;
        registry.validate_user_entry_index(user_entry_idx)?;
    }

    let (bond_price, pool_id_for_seeds) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;
        require!(
            pool.status != (crate::state::PoolStatus::Paused as u8),
            PremiumBondsError::PoolPaused
        );
        require!(
            pool.is_frozen_for_draw == 0,
            PremiumBondsError::AwaitingRandomnessFreeze
        );
        (pool.bond_price, pool.pool_id)
    };

    let expected_principal = (bonds_to_sell as u64)
        .checked_mul(bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Post-solvency single-borrow mutation scope via TicketRegistryMut
    let debit_result = {
        let registry_ai = ctx.accounts.ticket_registry.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;
        let mut reg_view = get_ticket_registry_mut(&mut data)?;
        reg_view.debit_tickets(user_entry_idx, user_key, active_to_sell, pending_to_sell)?
    };

    if debit_result.remaining_bonds == 0 {
        ctx.accounts.user_winnings.registry_entry_index =
            crate::state::UserWinnings::UNASSIGNED_ENTRY_INDEX;
    }

    if let Some(swapped) = debit_result.swapped_entry {
        crate::state::UserWinnings::reindex_swapped(
            ctx.remaining_accounts.first(),
            ctx.program_id,
            pool_id_for_seeds,
            swapped.owner,
            swapped.old_index,
            swapped.new_index,
        )?;
    }

    let clock = Clock::get()?;

    // Queue redemption into the active batch and update pool accounting
    let (pool_id, batch_id, current_redemption_id, new_total_deposited_principal) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
        let current_redemption_id = pool.queue_bond_sale_redemption(
            &mut ctx.accounts.redemption_batch,
            expected_principal,
        )?;
        (
            pool.pool_id,
            ctx.accounts.redemption_batch.batch_id,
            current_redemption_id,
            pool.total_deposited_principal,
        )
    };

    // Create PendingRedemption receipt referencing the batch_id
    ctx.accounts
        .pending_redemption
        .init(InitPendingRedemptionParams {
            pool_id,
            redemption_id: current_redemption_id,
            batch_id,
            bump: ctx.bumps.pending_redemption,
            user: ctx.accounts.user.key(),
            amount: expected_principal,
            requested_at: clock.unix_timestamp,
            redemption_type: RedemptionType::BondSale,
        });

    #[cfg(feature = "debug-logs")]
    msg!(
        "SellBonds: user={}, bonds={}, principal={}, batch_id={}, redemption_id={}",
        ctx.accounts.user.key(),
        bonds_to_sell,
        expected_principal,
        batch_id,
        current_redemption_id,
    );

    emit_cpi!(BondsSold {
        user: ctx.accounts.user.key(),
        pool_id,
        batch_id,
        bonds: bonds_to_sell,
        principal: expected_principal,
        redemption_id: current_redemption_id,
        new_total_deposited_principal,
        user_remaining_bonds: debit_result.remaining_bonds,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
