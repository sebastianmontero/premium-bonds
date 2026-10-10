use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED};
use crate::error::PremiumBondsError;
use crate::events::WinningsClaimed;
use crate::state::{
    InitPendingRedemptionParams, PendingRedemption, PoolStatus, PrizePool, RedemptionBatch,
    RedemptionType, UserWinnings,
};
use anchor_lang::prelude::*;

/// Accounts required for the `claim_non_reinvested_winnings` instruction.
///
/// Notice: Decoupled from immediate Huma CPIs; accumulates into the active RedemptionBatch.
#[derive(Accounts)]
pub struct ClaimNonReinvestedWinnings<'info> {
    /// The user claiming their non-reinvested winnings. Must be signer and payer.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The prize pool state account, validated to match the vault authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The user's winnings metadata account.
    #[account(
        mut,
        seeds = [b"user_winnings", pool.load()?.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = user_winnings.bump,
        constraint = user_winnings.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

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

    /// PendingRedemption PDA created for this async batch claim receipt.
    #[account(
        init,
        payer = user,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Initiates an asynchronous redemption of non-reinvested winnings into the active batch.
pub fn handle(ctx: Context<ClaimNonReinvestedWinnings>) -> Result<()> {
    ctx.accounts.user_winnings.ensure_current_version()?;
    let claimable = ctx.accounts.user_winnings.unclaimed_non_reinvested_winnings;
    require!(claimable > 0, PremiumBondsError::NoWinningsToClaim);

    {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;
        require!(
            pool.status() != PoolStatus::Paused,
            PremiumBondsError::PoolPaused
        );
        require!(
            !pool.is_frozen(),
            PremiumBondsError::AwaitingRandomnessFreeze
        );
    }

    {
        let user_winnings_mut = &mut ctx.accounts.user_winnings;
        user_winnings_mut.unclaimed_non_reinvested_winnings = 0;
        user_winnings_mut.total_claimed = user_winnings_mut
            .total_claimed
            .checked_add(claimable)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    let clock = Clock::get()?;

    let (pool_id, batch_id, current_redemption_id) = {
        let mut pool_mut = ctx.accounts.pool.load_mut()?;
        pool_mut.ensure_current_version()?;
        let current_redemption_id = pool_mut.queue_prize_redemption(
            &mut ctx.accounts.redemption_batch,
            claimable,
        )?;
        (
            pool_mut.pool_id,
            ctx.accounts.redemption_batch.batch_id,
            current_redemption_id,
        )
    };

    ctx.accounts
        .pending_redemption
        .init(InitPendingRedemptionParams {
            pool_id,
            redemption_id: current_redemption_id,
            batch_id,
            bump: ctx.bumps.pending_redemption,
            user: ctx.accounts.user.key(),
            amount: claimable,
            requested_at: clock.unix_timestamp,
            redemption_type: RedemptionType::PrizeClaim,
        });

    #[cfg(feature = "debug-logs")]
    msg!(
        "ClaimNonReinvestedWinnings: user={}, claimable={}, batch_id={}, redemption_id={}",
        ctx.accounts.user.key(),
        claimable,
        batch_id,
        current_redemption_id,
    );

    emit_cpi!(WinningsClaimed {
        user: ctx.accounts.user.key(),
        pool_id,
        batch_id,
        amount: claimable,
        redemption_id: current_redemption_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
