use crate::constants::{PENDING_REDEMPTION_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Claims settled USDC from a completed Huma redemption request.
///
/// Flow:
/// 1. CPI → Huma `disburse` to pull settled USDC into pool vault.
/// 2. Transfer the owed amount from pool vault to the user.
/// 3. Close the PendingRedemption PDA, returning rent to user.
#[derive(Accounts)]
pub struct ClaimRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(
        mut,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pending_redemption.pool_id.to_le_bytes().as_ref(),
            pending_redemption.redemption_id.to_le_bytes().as_ref()
        ],
        bump = pending_redemption.bump,
        constraint = pending_redemption.pool_id == pool.pool_id,
        constraint = pending_redemption.user == user.key() @ PremiumBondsError::InvalidRedemptionOwner,
        close = user
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

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

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
        token::token_program = token_program
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub huma_lender_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_authority: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<ClaimRedemption>) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let pending = &ctx.accounts.pending_redemption;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    // CPI → Huma disburse: pull settled USDC into pool vault
    huma::disburse(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.pool.to_account_info(), // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.token_mint.to_account_info(), // underlying_mint
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_underlying_token.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(), // lender_underlying_token
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    // Read updated next_request_id from the queue after Huma disburse
    let (next_request_id, _) = huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // Verify Huma queue has progressed past our request ID (meaning ours is settled/disbursed)
    require!(
        next_request_id > pending.huma_request_id,
        PremiumBondsError::HumaRedemptionNotSettled
    );

    // Transfer owed USDC to user
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.pool_vault_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        pending.amount,
        ctx.accounts.token_mint.decimals,
    )?;

    msg!(
        "ClaimRedemption: user={}, amount={}, redemption_id={}, huma_request_id={}",
        ctx.accounts.user.key(),
        pending.amount,
        pending.redemption_id,
        pending.huma_request_id,
    );

    // PendingRedemption is closed automatically via `close = user` constraint

    Ok(())
}
