use crate::constants::{
    POOL_VAULT_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::RedemptionBatchSettled;
use crate::huma;
use crate::state::{PrizePool, RedemptionBatch, RedemptionBatchStatus};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required to settle a submitted redemption batch once Huma queue has matured.
#[derive(Accounts)]
pub struct SettleRedemptionBatch<'info> {
    /// Any caller or crank bot triggering batch settlement.
    pub caller: Signer<'info>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The submitted redemption batch account to settle.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            batch.batch_id.to_le_bytes().as_ref()
        ],
        bump = batch.bump,
        constraint = batch.pool_id == pool.load()?.pool_id @ PremiumBondsError::MismatchedPoolId,
        constraint = batch.status == RedemptionBatchStatus::Submitted @ PremiumBondsError::InvalidBatchStatus,
    )]
    pub batch: Box<Account<'info, RedemptionBatch>>,

    /// Underlying USDC token mint.
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool vault account receiving disbursed USDC from Huma.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    // ── Huma Finance CPI Accounts ───────────────────────────────────────────
    /// CHECK: Validated against HUMA_PROGRAM_ID.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_config: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_pool_config: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program owner and pinned to pool.huma_pool_state.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID @ PremiumBondsError::InvalidHumaPoolState,
        constraint = huma_pool_state.key() == pool.load()?.huma_pool_state @ PremiumBondsError::InvalidHumaPoolState
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// CHECK: Huma lender state account for pool PDA.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: Huma pool authority PDA.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: Huma pool underlying token vault.
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

    /// Token interface for USDC.
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Event authority PDA.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Settles a submitted redemption batch by invoking Huma disburse and recording exact USDC disbursed.
pub fn handle(ctx: Context<SettleRedemptionBatch>) -> Result<()> {
    let batch_id = ctx.accounts.batch.batch_id;
    let huma_request_id = ctx.accounts.batch.huma_request_id;
    let total_principal_requested = ctx.accounts.batch.total_principal_requested;

    let (pool_id, pool_id_bytes, authority_bump) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;
        require!(
            pool.submitted_batch_id() == Some(batch_id),
            PremiumBondsError::MismatchedBatchId
        );
        (pool.pool_id, pool.pool_id.to_le_bytes(), pool.vault_authority_bump)
    };

    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    // Measure vault balance pre-disburse
    ctx.accounts.pool_vault_account.reload()?;
    let vault_before = ctx.accounts.pool_vault_account.amount;

    // CPI: huma::disburse flushes owed USDC into pool_vault_account
    huma::disburse(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_underlying_token.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    // Verify Huma queue has progressed past the batch request
    let huma_snapshot = huma::read_huma_assets_and_queue(&ctx.accounts.huma_pool_state.to_account_info())?;
    require!(
        huma_snapshot.is_redemption_settled(huma_request_id),
        PremiumBondsError::HumaQueueNotSettled
    );

    // Measure vault balance post-disburse and compute delta
    ctx.accounts.pool_vault_account.reload()?;
    let vault_after = ctx.accounts.pool_vault_account.amount;
    let usdc_received = vault_after.saturating_sub(vault_before);

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Mutate batch: Submitted -> Settled
    ctx.accounts.batch.settle(usdc_received, timestamp)?;

    // Clear submitted batch in pool state, unlocking pipeline for next batch submission
    {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
        pool.clear_submitted_batch(batch_id)?;
    }

    #[cfg(feature = "debug-logs")]
    msg!(
        "SettleRedemptionBatch: pool_id={}, batch_id={}, requested={}, received={}",
        pool_id,
        batch_id,
        total_principal_requested,
        usdc_received,
    );

    emit_cpi!(RedemptionBatchSettled {
        pool_id,
        batch_id,
        huma_request_id,
        total_principal_requested,
        settled_usdc_received: usdc_received,
        timestamp,
    });

    Ok(())
}
