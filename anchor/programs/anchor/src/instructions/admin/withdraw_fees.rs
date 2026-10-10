use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, PENDING_REDEMPTION_SEED, PRIZE_POOL_SEED,
    REDEMPTION_BATCH_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::FeesWithdrawn;
use crate::state::{
    GlobalConfig, InitPendingRedemptionParams, PendingRedemption, PrizePool, RedemptionBatch,
    RedemptionType,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

/// Accounts required to withdraw accrued protocol fees into the active redemption batch.
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// The admin authority executing the fee withdrawal.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]`.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// Active accumulating redemption batch account.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.accumulating_redemption_batch_id.to_le_bytes().as_ref()
        ],
        bump = redemption_batch.bump
    )]
    pub redemption_batch: Box<Account<'info, RedemptionBatch>>,

    /// PendingRedemption PDA created to track this async fee withdrawal.
    ///
    /// PDA seeds: `[PENDING_REDEMPTION_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.next_redemption_id.to_le_bytes().as_ref()]`.
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// The designated fee wallet. Verified to match the fee wallet configured on the prize pool.
    #[account(
        constraint = fee_wallet.key() == pool.load()?.fee_wallet @ PremiumBondsError::InvalidFeeWallet
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Admin instruction to withdraw accrued protocol fees into the active redemption batch.
pub fn handle(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    require!(amount > 0, PremiumBondsError::InsufficientFeeBalance);

    let (pool_id, fee_wallet) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;

        require!(
            pool.status != (crate::state::PoolStatus::Paused as u8),
            PremiumBondsError::PoolPaused
        );

        require!(
            pool.is_frozen_for_draw == 0,
            PremiumBondsError::AwaitingRandomnessFreeze
        );

        let available_fees = pool.unwithdrawn_fees()?;
        require!(
            amount <= available_fees,
            PremiumBondsError::InsufficientFeeBalance
        );

        (pool.pool_id, pool.fee_wallet)
    };

    let (batch_id, current_redemption_id) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
        let current_redemption_id = pool.queue_fee_redemption(
            &mut ctx.accounts.redemption_batch,
            amount,
        )?;
        (ctx.accounts.redemption_batch.batch_id, current_redemption_id)
    };

    // Create PendingRedemption receipt — fee_wallet.owner is the beneficiary
    ctx.accounts
        .pending_redemption
        .init(InitPendingRedemptionParams {
            pool_id,
            redemption_id: current_redemption_id,
            batch_id,
            bump: ctx.bumps.pending_redemption,
            user: ctx.accounts.fee_wallet.owner,
            amount,
            requested_at: Clock::get()?.unix_timestamp,
            redemption_type: RedemptionType::FeeWithdrawal,
        });

    #[cfg(feature = "debug-logs")]
    msg!(
        "WithdrawFees: amount={}, batch_id={}, redemption_id={}, fee_wallet={}",
        amount,
        batch_id,
        current_redemption_id,
        ctx.accounts.fee_wallet.key(),
    );

    emit_cpi!(FeesWithdrawn {
        pool_id,
        admin: ctx.accounts.admin.key(),
        fee_wallet,
        batch_id,
        amount,
        redemption_id: current_redemption_id,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
