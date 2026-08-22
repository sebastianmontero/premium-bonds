use crate::constants::{GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::PoolStatusChanged;
use crate::state::{GlobalConfig, PoolStatus, PrizePool};
use anchor_lang::prelude::*;

/// Accounts required to pause a prize pool in an emergency.
///
/// Can be signed by either the hot `guardian` bot or the cold `admin` multisig.
#[derive(Accounts)]
pub struct PausePool<'info> {
    /// The global configuration state, used to verify guardian or admin authority.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = signer.key() == global_config.guardian || signer.key() == global_config.admin @ PremiumBondsError::Unauthorized
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The guardian or admin authority executing the panic pause.
    pub signer: Signer<'info>,

    /// The prize pool state account to pause.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,
}

/// Immediately transitions a pool to `PoolStatus::Paused`.
pub fn handle_pause_pool(ctx: Context<PausePool>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;
    require!(
        pool.status != (PoolStatus::Closed as u8),
        PremiumBondsError::PoolClosed
    );
    let previous_status = pool.status;
    pool.status = PoolStatus::Paused as u8;

    emit!(PoolStatusChanged {
        pool_id: pool.pool_id,
        previous_status,
        new_status: pool.status,
        authority: ctx.accounts.signer.key(),
    });
    Ok(())
}

/// Accounts required to unpause a prize pool.
///
/// Restricted strictly to the cold `admin` multisig.
#[derive(Accounts)]
pub struct UnpausePool<'info> {
    /// The global configuration state, used to verify the admin signature.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority.
    pub admin: Signer<'info>,

    /// The prize pool state account to unpause.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,
}

/// Transitions a paused pool back to `PoolStatus::Active`.
pub fn handle_unpause_pool(ctx: Context<UnpausePool>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;
    require!(
        pool.status == (PoolStatus::Paused as u8),
        PremiumBondsError::PoolNotActive
    );
    let previous_status = pool.status;
    pool.status = PoolStatus::Active as u8;

    emit!(PoolStatusChanged {
        pool_id: pool.pool_id,
        previous_status,
        new_status: pool.status,
        authority: ctx.accounts.admin.key(),
    });
    Ok(())
}

/// Accounts required to permanently close a prize pool for orderly sunset.
///
/// Restricted strictly to the cold `admin` multisig.
#[derive(Accounts)]
pub struct ClosePool<'info> {
    /// The global configuration state, used to verify the admin signature.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority.
    pub admin: Signer<'info>,

    /// The prize pool state account to close.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,
}

/// Permanently transitions a pool to `PoolStatus::Closed`.
pub fn handle_close_pool(ctx: Context<ClosePool>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;
    require!(
        pool.status != (PoolStatus::Closed as u8),
        PremiumBondsError::PoolClosed
    );
    require!(
        pool.is_frozen_for_draw == 0,
        PremiumBondsError::AwaitingRandomnessFreeze
    );
    let previous_status = pool.status;
    pool.status = PoolStatus::Closed as u8;

    emit!(PoolStatusChanged {
        pool_id: pool.pool_id,
        previous_status,
        new_status: pool.status,
        authority: ctx.accounts.admin.key(),
    });
    Ok(())
}
