use crate::constants::{PAYOUT_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{PayoutRegistry, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
#[instruction(cycle_id: u32)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    #[account(
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,

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

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle(ctx: Context<ClaimPrize>, _cycle_id: u32, winner_index: u32) -> Result<()> {
    let payout_registry = &mut ctx.accounts.payout_registry;
    let idx = winner_index as usize;

    require!(
        idx < payout_registry.winners.len(),
        PremiumBondsError::InvalidIndices
    );

    let amount_owed = payout_registry.winners[idx].amount_owed;
    require!(
        payout_registry.winners[idx].winner_pubkey == ctx.accounts.user.key(),
        PremiumBondsError::UnauthorizedTicket
    );
    require!(
        !payout_registry.winners[idx].paid_out,
        PremiumBondsError::AlreadyClaimed
    );

    payout_registry.winners[idx].paid_out = true;
    payout_registry.payouts_completed += 1;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let authority_bump = ctx.accounts.pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.pool_vault_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        amount_owed,
        ctx.accounts.token_mint.decimals,
    )?;

    Ok(())
}
