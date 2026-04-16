use crate::constants::{POOL_KTOKENS_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::kamino;
use crate::state::{PrizePool, TicketRegistry};
use crate::utils::{swap_and_pop_active, swap_and_pop_pending};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
pub struct SellBonds<'info> {
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

    // Draw cycle freezing is now validated securely on the pool state below
    #[account(
        mut,
        associated_token::mint = pool.token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
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

    // Kamino CPI Accounts
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

    /// CHECK: Solana instructions sysvar required by Kamino as a flash-loan guard.
    #[account(address = crate::constants::INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar_account: UncheckedAccount<'info>,
}

pub fn handle(
    ctx: Context<SellBonds>,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
    ktokens_to_burn: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let bonds_to_sell = active_indices.len() as u32 + pending_indices.len() as u32;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondQuantity);

    // Note: A strict "max_tickets_per_sell" limit is not required for security here because
    // the Solana transaction size limit (~1232 bytes) naturally restricts the number of
    // indices that can be passed in a single Vec<u32>, preventing CU exhaustion.
    let expected_principal = (bonds_to_sell as u64)
        .checked_mul(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Phase 1: load counts via zero-copy (read-only borrow)
    let (active_count, pending_count);
    {
        let registry = ctx.accounts.ticket_registry.load()?;
        active_count = registry.active_tickets_count;
        pending_count = registry.pending_tickets_count;
    } // Ref released

    // Phase 2: swap-and-pop via raw bytes using utils helpers
    let new_pending;
    let new_active;
    {
        let registry_ai = ctx.accounts.ticket_registry.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;
        let user_key = ctx.accounts.user.key();

        // Pending removals first; returns updated pending count
        new_pending = swap_and_pop_pending(
            &mut data,
            active_count,
            pending_count,
            &pending_indices,
            &user_key,
        )?;

        // Active removals using the already-updated pending count
        (new_active, _) = swap_and_pop_active(
            &mut data,
            active_count,
            new_pending,
            &active_indices,
            &user_key,
        )?;
    } // data borrow released

    // Phase 3: commit updated counts only after successful byte operations
    {
        let mut registry = ctx.accounts.ticket_registry.load_mut()?;
        registry.active_tickets_count = new_active;
        registry.pending_tickets_count = new_pending;
    }

    // Update pool state
    pool.total_deposited_principal = pool
        .total_deposited_principal
        .checked_sub(expected_principal)
        .unwrap();

    let balance_before = ctx.accounts.pool_vault_account.amount;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    kamino::redeem_reserve_collateral(
        ctx.accounts.kamino_program.to_account_info(),
        pool.to_account_info(),                                      // owner (pool PDA)
        ctx.accounts.lending_market.to_account_info(),               // lending_market comes BEFORE reserve for redeem
        ctx.accounts.reserve.to_account_info(),
        ctx.accounts.lending_market_authority.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),                   // reserve_liquidity_mint
        ctx.accounts.reserve_collateral_mint.to_account_info(),
        ctx.accounts.reserve_liquidity_supply.to_account_info(),
        ctx.accounts.pool_ktokens_vault.to_account_info(),           // user_source_collateral (cTokens burned)
        ctx.accounts.pool_vault_account.to_account_info(),           // user_destination_liquidity (underlying received)
        ctx.accounts.ktokens_token_program.to_account_info(),        // collateral_token_program (cToken = SPL Token)
        ctx.accounts.token_program.to_account_info(),                // liquidity_token_program (underlying, may be Token-2022)
        ctx.accounts.instruction_sysvar_account.to_account_info(),
        ktokens_to_burn,
        signer_seeds,
    )?;

    // Anchor updates loaded accounts on the next cycle, so we force a manual token reload from DB
    ctx.accounts.pool_vault_account.reload()?;
    let balance_after = ctx.accounts.pool_vault_account.amount;

    let received_liquidity = balance_after.checked_sub(balance_before).unwrap();

    // The client calculated enough kTokens to exactly cover principal (plus Kamino trunc/dust slip).
    // If it produced slightly less than target principal, we fail fast.
    require!(
        received_liquidity >= expected_principal,
        PremiumBondsError::InvalidCollateralAmount
    );

    let max_allowed_liquidity = expected_principal
        .checked_add(pool.max_withdrawal_slippage_dust)
        .unwrap();
    require!(
        received_liquidity <= max_allowed_liquidity,
        PremiumBondsError::ExcessiveKtokensBurned
    );

    // Transfer ONLY the base principal back to User!
    // The excess purely acts as harvested yield.
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.pool_vault_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: pool.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        expected_principal,
        ctx.accounts.token_mint.decimals,
    )?;

    Ok(())
}
