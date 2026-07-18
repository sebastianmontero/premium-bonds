use crate::constants::{GLOBAL_CONFIG_SEED, POOL_PST_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::events::BondsPurchased;
use crate::huma;
use crate::state::{GlobalConfig, PrizePool, TicketRegistry};

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
pub struct BuyBonds<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + crate::state::UserWinnings::INIT_SPACE,
        seeds = [b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_winnings: Box<Account<'info, crate::state::UserWinnings>>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
        token::token_program = token_program
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool's $PST vault — receives minted $PST from Huma deposit.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // ── Huma Finance accounts ───────────────────────────────────────────────
    /// CHECK: Validated by address constraint
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_mode_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_authority: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<BuyBonds>, bonds_to_buy: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    let amount =
        pool.validate_buy_bonds(bonds_to_buy, ctx.accounts.global_config.max_tickets_per_buy)?;

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
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::deposit(
        ctx.accounts.huma_program.to_account_info(),
        pool.to_account_info(), // depositor (pool PDA)
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
    pool.total_deposited_principal = pool.total_deposited_principal.checked_add(amount).unwrap();

    let user_key = ctx.accounts.user.key();
    let user_winnings = &mut ctx.accounts.user_winnings;
    if user_winnings.user == Pubkey::default() {
        user_winnings.pool_id = pool.pool_id;
        user_winnings.user = user_key;
        user_winnings.bump = ctx.bumps.user_winnings;
        user_winnings.registry_entry_index = u32::MAX;
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
        registry.user_count += 1;
        registry.total_pending_tickets += bonds_to_buy;
    } else {
        let mut registry = registry_loader.load_mut()?;
        registry.total_pending_tickets += bonds_to_buy;
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
        };
        crate::utils::registry_set_entry(&mut data, user_entry_idx as usize, &new_entry);
    } else {
        let mut entry = crate::utils::registry_get_entry(&data, user_entry_idx as usize);
        require!(
            entry.owner == user_key,
            crate::error::PremiumBondsError::InvalidUserEntryHint
        );
        entry.lazy_merge(current_cycle)?;
        entry.pending += bonds_to_buy;
        crate::utils::registry_set_entry(&mut data, user_entry_idx as usize, &entry);
    }

    emit!(BondsPurchased {
        user: ctx.accounts.user.key(),
        pool_id: pool.pool_id,
        bonds: bonds_to_buy,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
