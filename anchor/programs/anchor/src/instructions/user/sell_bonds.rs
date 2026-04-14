use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, TransferChecked, transfer_checked, Mint};
use crate::state::{DrawCycle, DrawStatus, PoolStatus, PrizePool, TicketRegistry};
use crate::kamino;
use crate::error::PremiumBondsError;
use crate::constants::{PRIZE_POOL_SEED, POOL_VAULT_SEED, POOL_KTOKENS_SEED};

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

    /// CHECK: validated manually inside if provided
    pub current_draw_cycle: Option<Account<'info, DrawCycle>>,

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

    // Kamino CPI Accounts
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

pub fn handle(
    ctx: Context<SellBonds>, 
    active_indices: Vec<u32>, 
    pending_indices: Vec<u32>, 
    ktokens_to_burn: u64
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    if let Some(ref draw_cycle) = ctx.accounts.current_draw_cycle {
        require!(
            draw_cycle.status != DrawStatus::AwaitingRandomness,
            PremiumBondsError::AwaitingRandomnessFreeze
        );
    }

    let bonds_to_sell = active_indices.len() as u32 + pending_indices.len() as u32;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondAmount);
    
    let expected_principal = (bonds_to_sell as u64).checked_mul(pool.bond_price).ok_or(PremiumBondsError::MathOverflow)?;

    let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;

    // O(1) Swap and Pop for Pending Region - STRICT DESCENDING INDICES REQUIRED
    let mut last_pending_idx = ticket_registry.pending_tickets_count;
    for &idx_raw in pending_indices.iter() {
        require!(idx_raw < last_pending_idx, PremiumBondsError::InvalidIndices); 
        let real_idx = (ticket_registry.active_tickets_count + idx_raw) as usize;
        require!(ticket_registry.tickets[real_idx] == ctx.accounts.user.key(), PremiumBondsError::UnauthorizedTicket);
        
        let absolute_last_idx = (ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count - 1) as usize;
        
        if real_idx != absolute_last_idx {
            ticket_registry.tickets[real_idx] = ticket_registry.tickets[absolute_last_idx];
        }
        ticket_registry.tickets[absolute_last_idx] = Pubkey::default();
        
        ticket_registry.pending_tickets_count -= 1;
        last_pending_idx = idx_raw; 
    }

    // O(1) Swap and Pop for Active Region - STRICT DESCENDING INDICES REQUIRED
    let mut last_active_idx = ticket_registry.active_tickets_count;
    for &idx in active_indices.iter() {
        require!(idx < last_active_idx, PremiumBondsError::InvalidIndices); 
        let real_idx = idx as usize;
        require!(ticket_registry.tickets[real_idx] == ctx.accounts.user.key(), PremiumBondsError::UnauthorizedTicket);

        let tail_active_idx = (ticket_registry.active_tickets_count - 1) as usize;
        let absolute_last_idx = (ticket_registry.active_tickets_count + ticket_registry.pending_tickets_count - 1) as usize;

        // Move tail Active ticket into deleted spot
        if real_idx != tail_active_idx {
            ticket_registry.tickets[real_idx] = ticket_registry.tickets[tail_active_idx];
        }

        // Shift last Pending ticket into the former tail_active_idx to keep logic tight
        if ticket_registry.pending_tickets_count > 0 {
            ticket_registry.tickets[tail_active_idx] = ticket_registry.tickets[absolute_last_idx];
        }
        
        ticket_registry.tickets[absolute_last_idx] = Pubkey::default();

        ticket_registry.active_tickets_count -= 1;
        last_active_idx = idx; 
    }
    
    // Release the Ticket Registry mapping early to avoid borrow limits over CPI
    drop(ticket_registry);

    // Update pool state
    pool.total_deposited_principal = pool.total_deposited_principal.checked_sub(expected_principal).unwrap();

    let balance_before = ctx.accounts.pool_vault_account.amount;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        PRIZE_POOL_SEED,
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

    kamino::redeem_reserve_collateral(
        ctx.accounts.kamino_program.to_account_info(),
        pool.to_account_info(), 
        ctx.accounts.reserve.to_account_info(),
        ctx.accounts.lending_market.to_account_info(),
        ctx.accounts.lending_market_authority.to_account_info(),
        ctx.accounts.reserve_liquidity_supply.to_account_info(),
        ctx.accounts.reserve_collateral_mint.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(), 
        ctx.accounts.pool_ktokens_vault.to_account_info(), 
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.ktokens_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ktokens_to_burn,
        signer_seeds,
    )?;

    // Anchor updates loaded accounts on the next cycle, so we force a manual token reload from DB
    ctx.accounts.pool_vault_account.reload()?;
    let balance_after = ctx.accounts.pool_vault_account.amount;
    
    let received_liquidity = balance_after.checked_sub(balance_before).unwrap();

    // The client calculated enough kTokens to exactly cover principal (plus Kamino trunc/dust slip). 
    // If it produced slightly less than target principal, we fail fast. 
    require!(received_liquidity >= expected_principal, PremiumBondsError::InvalidBondAmount);

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
