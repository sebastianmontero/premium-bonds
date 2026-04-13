use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer, transfer};
use crate::state::{PrizePool, PayoutRegistry};
use crate::error::PremiumBondsError;

#[derive(Accounts)]
#[instruction(cycle_id: u32)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"payout", pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    #[account(
        seeds = [b"prize_pool", pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(
        mut,
        associated_token::mint = pool.token_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"pool_vault", pool.pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool_vault_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle(ctx: Context<ClaimPrize>, _cycle_id: u32, winner_index: u32) -> Result<()> {
    let payout_registry = &mut ctx.accounts.payout_registry;
    let idx = winner_index as usize;

    require!(idx < payout_registry.winners.len(), PremiumBondsError::InvalidIndices);
    
    let amount_owed = payout_registry.winners[idx].amount_owed;
    require!(payout_registry.winners[idx].winner_pubkey == ctx.accounts.user.key(), PremiumBondsError::UnauthorizedTicket);
    require!(!payout_registry.winners[idx].paid_out, PremiumBondsError::UnauthorizedTicket); 

    payout_registry.winners[idx].paid_out = true;
    payout_registry.payouts_completed += 1;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let authority_bump = ctx.accounts.pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"prize_pool",
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.pool_vault_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    transfer(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        amount_owed,
    )?;

    Ok(())
}
