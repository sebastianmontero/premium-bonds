use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::BondsSold;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool, RedemptionType, TicketRegistry, UserWinnings};
use crate::utils::{registry_get_entry, registry_set_entry};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required for a user to sell/redeem bonds.
///
/// ### Remaining Accounts
/// If the user's entry is removed and it was not the last entry in the `ticket_registry`,
/// the registry swaps the last entry into the deleted slot to fill the gap. In this swap case,
/// a single remaining account must be passed:
/// 1. `swapped_user_winnings` (mut, unchecked): The `UserWinnings` PDA of the owner of the swapped entry.
///    - PDA seeds: `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), swapped_owner.as_ref()]`.
///    - Verified in the handler to match the expected PDA address and updated to reflect the new registry index.
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
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    /// The prize pool state account.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The zero-copy ticket registry storing all raffle ticket entries for this pool.
    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool's $PST vault holding Huma shares. Shares are redeemed from here.
    ///
    /// PDA seeds: `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_pst"` + pool_id).
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PendingRedemption PDA created to track this async withdrawal.
    ///
    /// PDA seeds: `[PENDING_REDEMPTION_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.next_redemption_id.to_le_bytes().as_ref()]`
    /// (i.e., `b"pending_redemption"` + pool_id + next_redemption_id).
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

    // ── Huma Finance accounts ───────────────────────────────────────────────
    /// CHECK: This is the Huma Finance program account. It is validated via the address constraint
    /// to ensure it matches the hardcoded `HUMA_PROGRAM_ID`. It is used to target the CPI call.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,

    /// CHECK: This is the Huma global configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_pool_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool state account. It is validated via the owner constraint
    /// to ensure it is owned by the Huma program, and its internal structures/amounts (assets, redemption queues)
    /// are read manually via Huma state parsers in the handler and further validated during the Huma CPI.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// The Huma mode token mint ($PST token mint).
    #[account(
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: This is the Huma redemption request PDA that will be initialized. It is unchecked here because
    /// its initialization and ownership are fully managed and validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,

    /// CHECK: This is the Huma lender state account. It is unchecked here because its structure,
    /// ownership, and authorization are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool authority PDA. It is unchecked here because its validity as the
    /// pool's authority is fully validated by the Huma program during the CPI call.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool's mode token account (holding underlying mode tokens). It is unchecked
    /// here because its address and token authority are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// The SPL Token program interface for $PST tokens.
    pub pst_token_program: Interface<'info, TokenInterface>,

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
/// This queues an async redemption with the Huma Finance program to reclaim the underlying principal.
/// The instruction creates a `PendingRedemption` receipt. Once settled by the Huma program, the user
/// can claim the USDC using `claim_redemption`.
///
/// If a user completely exits their position, their entry is removed from the registry. To prevent registry gaps,
/// the last entry in the registry is swapped into the user's vacated index. If a swap occurs, the `UserWinnings`
/// PDA of the swapped user must be supplied as the first remaining account.
///
/// # Parameters
/// * `ctx` - The context of the sell bonds instruction.
/// * `active_to_sell` - The number of active tickets to sell.
/// * `pending_to_sell` - The number of pending tickets to sell.
pub fn handle(ctx: Context<SellBonds>, active_to_sell: u32, pending_to_sell: u32) -> Result<()> {
    let (bond_price, pool_id_for_seeds) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
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

    let bonds_to_sell = active_to_sell
        .checked_add(pending_to_sell)
        .ok_or(PremiumBondsError::MathOverflow)?;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondQuantity);

    let expected_principal = (bonds_to_sell as u64)
        .checked_mul(bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let user_key = ctx.accounts.user.key();
    let user_winnings = &mut ctx.accounts.user_winnings;
    user_winnings.ensure_current_version()?;
    let registry_loader = &ctx.accounts.ticket_registry;
    let user_entry_idx = user_winnings.registry_entry_index;

    require!(
        user_entry_idx != u32::MAX,
        PremiumBondsError::InvalidUserEntryHint
    );

    let (current_cycle, last_entry_idx) = {
        let mut registry = registry_loader.load_mut()?;
        registry.ensure_current_version()?;
        let last_idx = if registry.user_count > 0 {
            registry.user_count - 1
        } else {
            0
        };
        (registry.draw_cycle_id, last_idx)
    };

    let registry_ai = registry_loader.to_account_info();

    let mut swapped_owner = Pubkey::default();
    let will_exit;

    // 1. First scope: read, validate, merge, check exit status, write entries.
    let user_remaining_bonds = {
        let mut data = registry_ai.try_borrow_mut_data()?;
        let mut entry = registry_get_entry(&data, user_entry_idx as usize)?;
        require!(
            entry.owner == user_key,
            PremiumBondsError::InvalidUserEntryHint
        );

        entry.lazy_merge(current_cycle)?;

        require!(
            entry.active >= active_to_sell,
            PremiumBondsError::InsufficientActiveTickets
        );
        require!(
            entry.pending >= pending_to_sell,
            PremiumBondsError::InsufficientPendingTickets
        );

        entry.active = entry
            .active
            .checked_sub(active_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;
        entry.pending = entry
            .pending
            .checked_sub(pending_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;

        will_exit = entry.active == 0 && entry.pending == 0;

        let remaining = if will_exit {
            user_winnings.registry_entry_index = u32::MAX;
            if user_entry_idx != last_entry_idx {
                let last_entry = registry_get_entry(&data, last_entry_idx as usize)?;
                swapped_owner = last_entry.owner;
                registry_set_entry(&mut data, user_entry_idx as usize, &last_entry)?;
            }
            registry_set_entry(
                &mut data,
                last_entry_idx as usize,
                &crate::state::UserEntry::default(),
            )?;
            0u32
        } else {
            registry_set_entry(&mut data, user_entry_idx as usize, &entry)?;
            entry
                .active
                .checked_add(entry.pending)
                .ok_or(PremiumBondsError::MathOverflow)?
        };
        remaining
    };

    // 2. Second scope: update global counters, decrement user count, handle swapped winnings pda.
    {
        let mut registry = registry_loader.load_mut()?;
        registry.total_active_tickets = registry
            .total_active_tickets
            .checked_sub(active_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;
        registry.total_pending_tickets = registry
            .total_pending_tickets
            .checked_sub(pending_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;

        if will_exit {
            if user_entry_idx != last_entry_idx {
                let pool_id_bytes = pool_id_for_seeds.to_le_bytes();
                let expected_seeds = &[
                    b"user_winnings",
                    pool_id_bytes.as_ref(),
                    swapped_owner.as_ref(),
                ];
                let (expected_pda, _) =
                    Pubkey::find_program_address(expected_seeds, ctx.program_id);

                let swapped_user_winnings_info = ctx
                    .remaining_accounts
                    .iter()
                    .find(|acc| acc.key() == expected_pda)
                    .ok_or(PremiumBondsError::MissingSwappedUserWinnings)?;

                let mut swapped_winnings =
                    Account::<UserWinnings>::try_from(swapped_user_winnings_info)?;
                swapped_winnings.registry_entry_index = user_entry_idx;
                swapped_winnings.exit(ctx.program_id)?; // serialize changes back to account
            }
            registry.user_count = registry
                .user_count
                .checked_sub(1)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }
    }

    // Update pool principal & redemption counter in a scoped borrow
    let (pool_id, pool_id_bytes, authority_bump, current_redemption_id, new_total_deposited_principal) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.total_deposited_principal = pool
            .total_deposited_principal
            .checked_sub(expected_principal)
            .ok_or(PremiumBondsError::MathOverflow)?;

        let current_redemption_id = pool.next_redemption_id;
        pool.next_redemption_id = pool
            .next_redemption_id
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;

        pool.total_pending_redemptions = pool
            .total_pending_redemptions
            .checked_add(expected_principal)
            .ok_or(PremiumBondsError::MathOverflow)?;

        let pool_id = pool.pool_id;
        let pool_id_bytes = pool_id.to_le_bytes();
        let authority_bump = pool.vault_authority_bump;
        let new_principal = pool.total_deposited_principal;
        (
            pool_id,
            pool_id_bytes,
            authority_bump,
            current_redemption_id,
            new_principal,
        )
    };

    // Verify that the huma_mode_mint matches the pool_pst_vault mint
    require!(
        ctx.accounts.pool_pst_vault.mint == ctx.accounts.huma_mode_mint.key(),
        PremiumBondsError::InvalidModeMint
    );

    // Calculate $PST shares to redeem for the principal amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let pst_shares = huma::usdc_to_pst_shares(expected_principal, pst_supply, total_assets)?;

    // Read current last_request_id from the queue before Huma increments it.
    // Huma assigns the new request ID as the pre-increment `last_request_id` (0-indexed).
    // When Huma settles request M, `next_request_id` becomes M + 1, making `next_request_id > M` true.
    let (_, huma_request_id) =
        huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // CPI: request async redemption from Huma
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.user.to_account_info(), // payer
        ctx.accounts.pool.to_account_info(), // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_redemption_request.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_mode_token.to_account_info(),
        ctx.accounts.pool_pst_vault.to_account_info(), // lender_mode_token
        ctx.accounts.pst_token_program.to_account_info(), // token_program
        ctx.accounts.system_program.to_account_info(),
        pst_shares,
        signer_seeds,
    )?;

    let clock = Clock::get()?;

    // Create PendingRedemption receipt
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool_id;
    pending.redemption_id = current_redemption_id;
    pending.user = ctx.accounts.user.key();
    pending.amount = expected_principal;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = clock.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;
    pending.version = PendingRedemption::CURRENT_VERSION;
    pending.redemption_type = RedemptionType::BondSale;

    #[cfg(feature = "debug-logs")]
    msg!(
        "SellBonds: user={}, bonds={}, principal={}, pst_shares={}, redemption_id={}",
        ctx.accounts.user.key(),
        bonds_to_sell,
        expected_principal,
        pst_shares,
        pending.redemption_id,
    );

    emit_cpi!(BondsSold {
        user: ctx.accounts.user.key(),
        pool_id,
        bonds: bonds_to_sell,
        principal: expected_principal,
        redemption_id: pending.redemption_id,
        pst_shares,
        huma_request_id,
        new_total_deposited_principal,
        user_remaining_bonds,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
