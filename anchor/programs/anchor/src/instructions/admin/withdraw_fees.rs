use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::huma;
use crate::state::{GlobalConfig, PendingRedemption, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Admin instruction to withdraw accrued protocol fees via Huma async redemption.
///
/// Creates a PendingRedemption PDA for the fee amount, which the fee wallet
/// owner later claims via `claim_redemption`.
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    /// Pool's $PST vault — shares are redeemed from here.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PendingRedemption PDA created for this fee withdrawal.
    #[account(
        init,
        payer = admin,
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
    /// CHECK: Validated by Huma CPI and owner check
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_config: UncheckedAccount<'info>,
    #[account(
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,
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

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        token::mint = token_mint,
        token::token_program = token_program,
        constraint = fee_wallet.key() == pool.fee_wallet @ PremiumBondsError::InvalidFeeWallet
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Validate there are enough accrued fees to withdraw
    let available_fees = pool
        .total_fees_accrued
        .saturating_sub(pool.total_fees_withdrawn);
    require!(
        amount > 0 && amount <= available_fees,
        PremiumBondsError::InsufficientFeeBalance
    );

    // Verify that the huma_mode_mint matches the pool_pst_vault mint
    require!(
        ctx.accounts.pool_pst_vault.mint == ctx.accounts.huma_mode_mint.key(),
        PremiumBondsError::InvalidModeMint
    );

    // Calculate $PST shares for the fee amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let pst_shares = huma::usdc_to_pst_shares(amount, pst_supply, total_assets);

    // Read current last_request_id from the queue before Huma increments it
    let (_, huma_request_id) =
        huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // CPI: request async redemption from Huma
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.admin.to_account_info(), // payer
        pool.to_account_info(),               // lender (pool PDA)
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

    // Create PendingRedemption receipt — fee_wallet is the beneficiary
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool.pool_id;
    pending.redemption_id = pool.next_redemption_id;
    pending.user = ctx.accounts.fee_wallet.owner; // Fee wallet owner receives the USDC on disburse
    pending.amount = amount;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = Clock::get()?.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;

    // Update accounting
    pool.total_fees_withdrawn = pool.total_fees_withdrawn.checked_add(amount).unwrap();
    pool.next_redemption_id = pool.next_redemption_id.checked_add(1).unwrap();
    pool.total_pending_redemptions = pool.total_pending_redemptions.checked_add(amount).unwrap();

    msg!(
        "WithdrawFees: amount={}, pst_shares={}, redemption_id={}, fee_wallet={}",
        amount,
        pst_shares,
        pending.redemption_id,
        pool.fee_wallet,
    );

    Ok(())
}
