use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, TransferChecked, transfer_checked, Mint};
use crate::state::{DrawCycle, DrawStatus, PoolStatus, PrizePool, TicketRegistry};
use crate::kamino;
use crate::error::PremiumBondsError;
use crate::constants::{PRIZE_POOL_SEED, POOL_VAULT_SEED, POOL_KTOKENS_SEED};

#[derive(Accounts)]
pub struct BuyBonds<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    // Draw cycle for locking validation (optional check if provided)
    // In our plan: "Requires DrawCycle.status != AwaitingRandomness."
    /// CHECK: validated manually in logic if present
    pub current_draw_cycle: Option<Account<'info, DrawCycle>>,

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
        token::token_program = token_program
    )]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POOL_KTOKENS_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = ktokens_token_program
    )]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    // Kamino Accounts
    /// CHECK: CPI Target
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
    #[account(mut)]
    /// CHECK: 
    pub reserve_collateral_mint: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub ktokens_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<BuyBonds>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(pool.status == PoolStatus::Active, PremiumBondsError::PoolNotActive);
    
    // Check freezing
    if let Some(ref draw_cycle) = ctx.accounts.current_draw_cycle {
        require!(
            draw_cycle.status != DrawStatus::AwaitingRandomness,
            PremiumBondsError::AwaitingRandomnessFreeze
        );
    }

    require!(amount % pool.bond_price == 0, PremiumBondsError::InvalidBondAmount);
    let tickets_to_buy = (amount / pool.bond_price) as u32;
    require!(tickets_to_buy > 0, PremiumBondsError::InvalidBondAmount);

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
    let signer_seeds: &[&[&[u8]]] = &[&[
        PRIZE_POOL_SEED,
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

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
    let current_total = ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count;
    require!((current_total + tickets_to_buy) <= 327_680, PremiumBondsError::RegistryFull);

    for _ in 0..tickets_to_buy {
        let insert_idx = (ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count) as usize;
        ticket_registry.tickets[insert_idx] = ctx.accounts.user.key();
        ticket_registry.pending_tickets_count += 1;
    }

    Ok(())
}
