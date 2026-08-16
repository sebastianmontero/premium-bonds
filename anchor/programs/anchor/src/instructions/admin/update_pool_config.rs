use crate::constants::{GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::PoolConfigUpdated;
use crate::state::{GlobalConfig, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

/// Accounts required to update a prize pool's configuration.
#[derive(Accounts)]
pub struct UpdatePoolConfig<'info> {
    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority.
    pub admin: Signer<'info>,

    /// The prize pool state account to update.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,
}

/// Updates a prize pool's configuration parameters.
///
/// Allows modifying the fee rate (basis points), the bond price, the fee wallet address, the minimum yield threshold,
/// the stake cycle duration, the max yield velocity limit, and the payout settlement timelock buffer.
///
/// # Parameters
/// * `ctx` - The context of the update pool config instruction.
/// * `new_fee_basis_points` - Optional new fee rate in basis points.
/// * `new_bond_price` - Optional new price of a single bond.
/// * `new_fee_wallet` - Optional new fee wallet address.
/// * `new_min_yield_threshold` - Optional new minimum yield threshold.
/// * `new_stake_cycle_duration_hrs` - Optional new stake cycle duration in hours.
/// * `new_max_yield_basis_points` - Optional maximum allowable yield basis points per single cycle (0 = uncapped).
/// * `new_payout_timelock_seconds` - Optional timelock delay in seconds before payouts can be cranked.
pub fn handle(
    ctx: Context<UpdatePoolConfig>,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
    new_min_yield_threshold: Option<u64>,
    new_stake_cycle_duration_hrs: Option<i64>,
    new_max_yield_basis_points: Option<u16>,
    new_payout_timelock_seconds: Option<u32>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool.load_mut()?;

    require!(
        pool.is_frozen_for_draw == 0,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    if let Some(v) = new_stake_cycle_duration_hrs {
        require!(
            v >= crate::constants::MIN_STAKE_CYCLE_DURATION_HRS
                && v <= crate::constants::MAX_STAKE_CYCLE_DURATION_HRS,
            PremiumBondsError::InvalidStakeCycleDuration
        );
        pool.stake_cycle_duration_hrs = v;
    }
    if let Some(v) = new_fee_basis_points {
        require!(v <= 10000, PremiumBondsError::InvalidFeeConfig);
        pool.fee_basis_points = v;
    }
    if let Some(v) = new_bond_price {
        require!(v > 0, PremiumBondsError::InvalidBondPrice);
        if v != pool.bond_price {
            require!(
                pool.total_deposited_principal == 0
                    && pool.total_prizes_allocated == 0
                    && pool.total_pending_redemptions == 0,
                PremiumBondsError::CannotModifyBondPriceWithActiveDeposits
            );
            pool.bond_price = v;
        }
    }
    if let Some(v) = new_fee_wallet {
        if v != pool.fee_wallet {
            let fee_wallet_account_info = ctx
                .remaining_accounts
                .iter()
                .find(|acc| acc.key() == v)
                .ok_or(PremiumBondsError::InvalidFeeWallet)?;

            let fee_token_account =
                InterfaceAccount::<TokenAccount>::try_from(fee_wallet_account_info)
                    .map_err(|_| PremiumBondsError::InvalidFeeWallet)?;

            require!(
                fee_token_account.mint == pool.token_mint,
                PremiumBondsError::InvalidFeeWallet
            );

            pool.fee_wallet = v;
        }
    }
    if let Some(v) = new_min_yield_threshold {
        pool.min_yield_threshold = v;
    }
    if let Some(v) = new_max_yield_basis_points {
        pool.max_yield_basis_points = v;
    }
    if let Some(v) = new_payout_timelock_seconds {
        require!(v <= 86400, PremiumBondsError::MathOverflow);
        pool.payout_timelock_seconds = v;
    }

    emit!(PoolConfigUpdated {
        pool_id: pool.pool_id,
        admin: ctx.accounts.admin.key(),
        fee_basis_points: pool.fee_basis_points,
        bond_price: pool.bond_price,
        fee_wallet: pool.fee_wallet,
        min_yield_threshold: pool.min_yield_threshold,
        stake_cycle_duration_hrs: pool.stake_cycle_duration_hrs,
        max_yield_basis_points: pool.max_yield_basis_points,
        payout_timelock_seconds: pool.payout_timelock_seconds,
    });

    Ok(())
}
