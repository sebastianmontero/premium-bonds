use crate::constants::{GLOBAL_CONFIG_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::HumaLenderInitialized;
use crate::huma;
use crate::state::{GlobalConfig, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

/// Accounts required to initialize Huma lender state for a pool.
#[derive(Accounts)]
pub struct InitializeHumaLender<'info> {
    /// The admin authority who signs and pays for initializing the Huma lender state.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// Pool's $PST vault — used as the lender's mode token account.
    ///
    /// PDA seeds: `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_pst"` + pool_id).
    #[account(
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // ── Huma Finance accounts ───────────────────────────────────────────────
    /// CHECK: This is the Huma Finance program account. It is validated via the address constraint
    /// to ensure it matches the hardcoded `HUMA_PROGRAM_ID`. It is used to target the CPI call.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,

    /// CHECK: This is the Huma global configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_pool_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool state account. It is unchecked here because its structure
    /// and validity are fully validated by the Huma program during the CPI call.
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode mint account. It is unchecked here because its structure
    /// and validity are fully validated by the Huma program during the CPI call.
    pub huma_mode_mint: UncheckedAccount<'info>,

    /// CHECK: This is the Huma lender state account to be initialized. It is unchecked here because
    /// its initialization and ownership are fully managed and validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: This is the ATA for the Huma mode mint owned by the pool. It is unchecked here because
    /// its initialization and ownership are fully managed and validated by the Huma/Associated Token program during the CPI call.
    #[account(mut)]
    pub huma_lender_mode_token: UncheckedAccount<'info>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// The SPL Token program interface for $PST tokens.
    pub pst_token_program: Interface<'info, TokenInterface>,

    /// The SPL Associated Token program.
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,
}

/// One-time admin instruction to create the Huma lender accounts for a pool.
///
/// Must be called before the pool can accept deposits (buy_bonds).
/// This CPI creates the pool PDA's lender state and $PST ATA on the Huma side.
///
/// # Parameters
/// * `ctx` - The context of the initialize Huma lender instruction.
pub fn handle(ctx: Context<InitializeHumaLender>) -> Result<()> {
    let pool = ctx.accounts.pool.load()?;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::create_lender_accounts(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.admin.to_account_info(), // payer
        ctx.accounts.pool.to_account_info(),  // lender (pool PDA)
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
        ctx.accounts.pool.key(),
    );

    emit!(HumaLenderInitialized {
        pool_id: pool.pool_id,
        admin: ctx.accounts.admin.key(),
    });

    Ok(())
}
