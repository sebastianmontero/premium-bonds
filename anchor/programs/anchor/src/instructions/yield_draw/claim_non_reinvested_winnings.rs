use crate::constants::{
    DISCRIMINATOR, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool, UserWinnings};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

/// Async claim_non_reinvested_winnings: instead of instant USDC transfer, creates a PendingRedemption
/// and submits a Huma redemption request. The user calls `claim_redemption` after settlement.
#[derive(Accounts)]
pub struct ClaimNonReinvestedWinnings<'info> {
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
        seeds = [b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = user_winnings.bump,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    /// Pool's $PST vault — shares are redeemed from here.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PendingRedemption PDA created for this async withdrawal.
    #[account(
        init,
        payer = user,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.pool_id.to_le_bytes().as_ref(),
            pool.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

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
    pub huma_mode_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_authority: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<ClaimNonReinvestedWinnings>) -> Result<()> {
    let user_winnings = &mut ctx.accounts.user_winnings;
    let claimable = user_winnings.unclaimed_non_reinvested_winnings;

    require!(claimable > 0, PremiumBondsError::NoWinningsToClaim);

    // Reset unclaimed winnings and increase total claimed
    user_winnings.unclaimed_non_reinvested_winnings = 0;
    user_winnings.total_claimed = user_winnings.total_claimed.checked_add(claimable).ok_or(PremiumBondsError::MathOverflow)?;

    let pool = &mut ctx.accounts.pool;
    pool.total_prizes_allocated = pool
        .total_prizes_allocated
        .checked_sub(claimable)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Calculate $PST shares for the claimable USDC amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = {
        let mint_info = ctx.accounts.huma_mode_mint.to_account_info();
        let mint_data = mint_info.try_borrow_data()?;
        let supply_bytes: [u8; 8] = mint_data[36..44].try_into().unwrap();
        u64::from_le_bytes(supply_bytes)
    };
    let pst_shares = huma::usdc_to_pst_shares(claimable, pst_supply, total_assets);

    // Read current last_request_id from the queue before Huma increments it
    let (_, huma_request_id) = huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // CPI: request async redemption from Huma
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.user.to_account_info(), // payer
        pool.to_account_info(),              // lender (pool PDA)
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

    // Create PendingRedemption receipt
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool.pool_id;
    pending.redemption_id = pool.next_redemption_id;
    pending.user = ctx.accounts.user.key();
    pending.amount = claimable;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = Clock::get()?.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;

    pool.next_redemption_id = pool.next_redemption_id.checked_add(1).ok_or(PremiumBondsError::MathOverflow)?;

    pool.total_pending_redemptions = pool
        .total_pending_redemptions
        .checked_add(claimable)
        .ok_or(PremiumBondsError::MathOverflow)?;

    msg!(
        "ClaimNonReinvestedWinnings: user={}, claimable={}, pst_shares={}, redemption_id={}",
        ctx.accounts.user.key(),
        claimable,
        pst_shares,
        pending.redemption_id,
    );

    Ok(())
}
