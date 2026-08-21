use crate::constants::{POOL_PST_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::events::BondsPurchased;
use crate::huma;
use crate::state::{PrizePool, TicketRegistry};

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts required for a user to buy bonds.
#[derive(Accounts)]
pub struct BuyBonds<'info> {
    /// The user purchasing the bonds, who signs and pays for the transaction.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The user winnings/metadata PDA. It tracks the user's active/pending tickets
    /// and accumulated winnings for this pool.
    ///
    /// PDA seeds: `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()]`.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + crate::state::UserWinnings::INIT_SPACE,
        seeds = [b"user_winnings", pool.load()?.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_winnings: Box<Account<'info, crate::state::UserWinnings>>,

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

    /// The user's underlying token account (e.g. USDC source) to purchase bonds from.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
        token::token_program = token_program
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The pool's underlying token vault where USDC is deposited.
    ///
    /// PDA seeds: `[POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_vault"` + pool_id).
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool's $PST vault — receives minted $PST from Huma deposit.
    ///
    /// PDA seeds: `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_pst"` + pool_id).
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

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
    /// to ensure it is owned by the Huma program, and further validated during the Huma CPI.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode mint account. It is unchecked here because its structure
    /// and validity are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_mode_mint: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool authority PDA. It is unchecked here because its validity as the
    /// pool's authority is fully validated by the Huma program during the CPI call.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool's underlying token vault. It is unchecked here because its address
    /// and token authority are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

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

/// Allows a user to buy bonds by depositing underlying tokens (e.g., USDC).
///
/// The deposited amount is transferred to the pool vault and immediately deposited into the Huma program
/// to generate yield via $PST tokens. The user's entry in the ticket registry is created or updated
/// to record the pending ticket balance.
///
/// # Parameters
/// * `ctx` - The context of the buy bonds instruction.
/// * `bonds_to_buy` - The number of bonds/tickets the user wants to purchase.
pub fn handle(ctx: Context<BuyBonds>, bonds_to_buy: u32) -> Result<()> {
    let (amount, pool_id, pool_id_bytes, authority_bump) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        let amount = pool.validate_buy_bonds(bonds_to_buy)?;
        let pool_id = pool.pool_id;
        let pool_id_bytes = pool_id.to_le_bytes();
        let authority_bump = pool.vault_authority_bump;
        (amount, pool_id, pool_id_bytes, authority_bump)
    };

    // 1. Transfer USDC from user → pool vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.pool_vault_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // 2. CPI into Huma: deposit USDC → receive $PST
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::deposit(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.pool.to_account_info(), // depositor (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.token_mint.to_account_info(), // underlying_mint
        ctx.accounts.huma_pool_underlying_token.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(), // depositor_underlying_token
        ctx.accounts.pool_pst_vault.to_account_info(),     // depositor_mode_token
        ctx.accounts.token_program.to_account_info(),      // underlying_token_program
        ctx.accounts.pst_token_program.to_account_info(),  // mode_token_program
        amount,
        signer_seeds,
    )?;

    // 3. Update State
    {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.total_deposited_principal = pool
            .total_deposited_principal
            .checked_add(amount)
            .ok_or(crate::error::PremiumBondsError::MathOverflow)?;
    }

    let user_key = ctx.accounts.user.key();
    let user_winnings = &mut ctx.accounts.user_winnings;
    if user_winnings.user == Pubkey::default() {
        user_winnings.pool_id = pool_id;
        user_winnings.user = user_key;
        user_winnings.bump = ctx.bumps.user_winnings;
        user_winnings.registry_entry_index = u32::MAX;
        user_winnings.version = 1;
    }

    let registry_loader = &ctx.accounts.ticket_registry;
    let mut user_entry_idx = user_winnings.registry_entry_index;

    let current_cycle = {
        let registry = registry_loader.load()?;
        registry.draw_cycle_id
    };

    let is_new = user_entry_idx == u32::MAX;

    if is_new {
        let mut registry = registry_loader.load_mut()?;
        require!(
            registry.user_count < registry.capacity,
            crate::error::PremiumBondsError::RegistryFull
        );
        user_entry_idx = registry.user_count;
        user_winnings.registry_entry_index = user_entry_idx;
        registry.user_count = registry
            .user_count
            .checked_add(1)
            .ok_or(crate::error::PremiumBondsError::MathOverflow)?;
        registry.total_pending_tickets = registry
            .total_pending_tickets
            .checked_add(bonds_to_buy)
            .ok_or(crate::error::PremiumBondsError::MathOverflow)?;
    } else {
        let mut registry = registry_loader.load_mut()?;
        registry.total_pending_tickets = registry
            .total_pending_tickets
            .checked_add(bonds_to_buy)
            .ok_or(crate::error::PremiumBondsError::MathOverflow)?;
    }

    // Now borrow data mutably to write/update entry
    let registry_ai = registry_loader.to_account_info();
    let mut data = registry_ai.try_borrow_mut_data()?;

    if is_new {
        let new_entry = crate::state::UserEntry {
            owner: user_key,
            active: 0,
            pending: bonds_to_buy,
            merged_through_cycle: current_cycle,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        };
        crate::utils::registry_set_entry(&mut data, user_entry_idx as usize, &new_entry);
    } else {
        let mut entry = crate::utils::registry_get_entry(&data, user_entry_idx as usize);
        require!(
            entry.owner == user_key,
            crate::error::PremiumBondsError::InvalidUserEntryHint
        );
        entry.lazy_merge(current_cycle)?;
        entry.pending = entry
            .pending
            .checked_add(bonds_to_buy)
            .ok_or(crate::error::PremiumBondsError::MathOverflow)?;
        crate::utils::registry_set_entry(&mut data, user_entry_idx as usize, &entry);
    }

    emit_cpi!(BondsPurchased {
        user: ctx.accounts.user.key(),
        pool_id,
        bonds: bonds_to_buy,
        amount,
    });

    Ok(())
}
