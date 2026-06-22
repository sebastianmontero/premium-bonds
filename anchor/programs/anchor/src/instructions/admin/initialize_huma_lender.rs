use crate::constants::{GLOBAL_CONFIG_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::huma;
use crate::state::{GlobalConfig, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

/// One-time admin instruction to create the Huma lender accounts for a pool.
///
/// Must be called before the pool can accept deposits (buy_bonds).
/// This CPI creates the pool PDA's lender state and $PST ATA on the Huma side.
#[derive(Accounts)]
pub struct InitializeHumaLender<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    /// Pool's $PST vault — used as the lender's mode token account.
    #[account(
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
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI — will be initialized by this CPI
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI — the pool PDA's ATA for mode mint
    #[account(mut)]
    pub huma_lender_mode_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitializeHumaLender>) -> Result<()> {
    let pool = &ctx.accounts.pool;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::create_lender_accounts(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.admin.to_account_info(), // payer
        pool.to_account_info(),               // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.huma_lender_mode_token.to_account_info(),
        ctx.accounts.pst_token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        signer_seeds,
    )?;

    msg!(
        "InitializeHumaLender: pool={}, pool_pda={}",
        pool.pool_id,
        pool.key(),
    );

    Ok(())
}
