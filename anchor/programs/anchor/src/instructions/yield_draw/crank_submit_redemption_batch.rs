use crate::constants::{
    GLOBAL_CONFIG_SEED, POOL_PST_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::RedemptionBatchSubmitted;
use crate::huma;
use crate::state::{GlobalConfig, PrizePool, RedemptionBatch, RedemptionBatchStatus};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required to submit an accumulating redemption batch to Huma Finance.
#[derive(Accounts)]
pub struct CrankSubmitRedemptionBatch<'info> {
    /// The crank bot or admin executing the batch submission.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The global configuration state, verifying crank authorization (jobs_account or admin).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        constraint = (crank.key() == global_config.jobs_account || crank.key() == global_config.admin) @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The current accumulating redemption batch account to submit.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            batch.batch_id.to_le_bytes().as_ref()
        ],
        bump = batch.bump,
        constraint = batch.pool_id == pool.load()?.pool_id @ PremiumBondsError::MismatchedPoolId,
        constraint = batch.batch_id == pool.load()?.accumulating_redemption_batch_id @ PremiumBondsError::MismatchedBatchId,
        constraint = batch.status == RedemptionBatchStatus::Accumulating @ PremiumBondsError::InvalidBatchStatus,
    )]
    pub batch: Box<Account<'info, RedemptionBatch>>,

    /// The new accumulating batch account initialized to replace the submitted batch in the pipeline.
    #[account(
        init,
        payer = crank,
        space = 8 + std::mem::size_of::<RedemptionBatch>(),
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.next_redemption_batch_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub next_batch: Box<Account<'info, RedemptionBatch>>,

    /// Pool's $PST vault holding Huma shares. Shares are redeemed from here.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

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

    /// The Huma mode token mint ($PST token mint).
    #[account(
        address = pool_pst_vault.mint @ PremiumBondsError::InvalidModeMint,
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Huma redemption request PDA initialized by Huma program during CPI.
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,

    /// CHECK: Huma lender state account for pool PDA.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: Huma pool authority PDA.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: Huma pool mode token vault.
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    /// Token interface for $PST mint/vault.
    pub pst_token_program: Interface<'info, TokenInterface>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: Event authority PDA.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Aggregates all pending redemptions in the active batch and submits a single Huma CPI request.
pub fn handle(ctx: Context<CrankSubmitRedemptionBatch>) -> Result<()> {
    let principal_requested = ctx.accounts.batch.total_principal_requested;
    require!(principal_requested > 0, PremiumBondsError::EmptyRedemptionBatch);

    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let pool_pst_vault_amount = ctx.accounts.pool_pst_vault.amount;

    let (pool_id, pool_id_bytes, authority_bump, pst_shares, huma_request_id) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;

        require!(!pool.has_submitted_batch(), PremiumBondsError::SubmittedBatchInFlight);
        require!(pool.is_frozen_for_draw == 0, PremiumBondsError::AwaitingRandomnessFreeze);

        // Solvency check: assert live solvency unless impaired
        let huma_snapshot = if pool.is_impaired() {
            crate::huma::read_huma_assets_and_queue(&ctx.accounts.huma_pool_state.to_account_info())?
        } else {
            pool.assert_huma_solvency(
                &ctx.accounts.huma_pool_state.to_account_info(),
                pool_pst_vault_amount,
                pst_supply,
            )?
        };

        let shares = pool.calculate_batch_submission_shares(
            principal_requested,
            &huma_snapshot,
            pool_pst_vault_amount,
            pst_supply,
        )?;

        let request_id = huma_snapshot.pending_request_id();

        (
            pool.pool_id,
            pool.pool_id.to_le_bytes(),
            pool.vault_authority_bump,
            shares,
            request_id,
        )
    };

    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    // CPI: single aggregated add_redemption_request to Huma
    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.crank.to_account_info(), // payer
        ctx.accounts.pool.to_account_info(),  // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_redemption_request.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_mode_token.to_account_info(),
        ctx.accounts.pool_pst_vault.to_account_info(),
        ctx.accounts.pst_token_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        pst_shares,
        signer_seeds,
    )?;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Mutate batch: Accumulating -> Submitted
    ctx.accounts.batch.submit(huma_request_id, pst_shares, timestamp)?;

    // Advance pool pipeline and initialize next accumulating batch
    let batch_id = ctx.accounts.batch.batch_id;
    let next_batch_id = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
        pool.advance_submitted_batch(batch_id, principal_requested)?
    };

    ctx.accounts.next_batch.init_accumulating(
        pool_id,
        next_batch_id,
        ctx.bumps.next_batch,
        timestamp,
    );

    #[cfg(feature = "debug-logs")]
    msg!(
        "CrankSubmitRedemptionBatch: pool_id={}, batch_id={}, principal={}, pst_shares={}, huma_request_id={}",
        pool_id,
        batch_id,
        principal_requested,
        pst_shares,
        huma_request_id,
    );

    emit_cpi!(RedemptionBatchSubmitted {
        pool_id,
        batch_id,
        huma_request_id,
        total_principal_requested: principal_requested,
        pst_shares_locked: pst_shares,
        next_batch_id,
        timestamp,
    });

    Ok(())
}
