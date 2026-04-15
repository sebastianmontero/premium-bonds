use crate::constants::{GLOBAL_CONFIG_SEED, POOL_KTOKENS_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::kamino;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PoolStatus, PrizePool, TicketRegistry};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
pub struct BuyBonds<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    // Draw cycle freezing is now validated securely on the pool state below
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
        token::token_program = token_program
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POOL_KTOKENS_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = reserve_collateral_mint,
        token::token_program = ktokens_token_program
    )]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    // Kamino Accounts
    /// CHECK: Validated by address constraint
    #[account(address = crate::constants::KAMINO_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK:
    pub reserve: UncheckedAccount<'info>,
    /// CHECK:
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK:
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK:
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(
        mut,
        mint::token_program = ktokens_token_program
    )]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub ktokens_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<BuyBonds>, bonds_to_buy: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        pool.status == PoolStatus::Active,
        PremiumBondsError::PoolNotActive
    );

    // Check freezing
    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    require!(bonds_to_buy > 0, PremiumBondsError::InvalidBondQuantity);
    require!(
        bonds_to_buy <= ctx.accounts.global_config.max_tickets_per_buy,
        PremiumBondsError::MaxTicketsPerBuyExceeded
    );
    let amount = (bonds_to_buy as u64).checked_mul(pool.bond_price).unwrap();

    // 1. Transfer to Pool Vault
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

    // 2. CPI into Kamino
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    kamino::deposit_reserve_liquidity(
        ctx.accounts.kamino_program.to_account_info(),
        pool.to_account_info(), // Pool is the owner
        ctx.accounts.reserve.to_account_info(),
        ctx.accounts.lending_market.to_account_info(),
        ctx.accounts.lending_market_authority.to_account_info(),
        ctx.accounts.reserve_liquidity_supply.to_account_info(),
        ctx.accounts.reserve_collateral_mint.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(), // Pool's Source Liquidity
        ctx.accounts.pool_ktokens_vault.to_account_info(), // Pool's Destination Collateral
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.ktokens_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        amount,
        signer_seeds,
    )?;

    // 3. Update State
    pool.total_deposited_principal = pool.total_deposited_principal.checked_add(amount).unwrap();

    let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;

    // Safety check size
    let current_total =
        ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count;
    require!(
        (current_total + bonds_to_buy) <= 327_680,
        PremiumBondsError::RegistryFull
    );

    for _ in 0..bonds_to_buy {
        let insert_idx =
            (ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count) as usize;
        ticket_registry.tickets[insert_idx] = ctx.accounts.user.key();
        ticket_registry.pending_tickets_count += 1;
    }

    Ok(())
}
