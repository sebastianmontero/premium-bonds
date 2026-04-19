use anchor_lang::prelude::*;
use crate::constants::{GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PrizePool};

#[derive(Accounts)]
pub struct UpdatePoolConfig<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,
}

pub fn handle(
    ctx: Context<UpdatePoolConfig>,
    new_auto_reinvest_default: Option<bool>,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_max_withdrawal_slippage_dust: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    if let Some(v) = new_auto_reinvest_default {
        pool.auto_reinvest_default = v;
    }
    if let Some(v) = new_fee_basis_points {
        pool.fee_basis_points = v;
    }
    if let Some(v) = new_bond_price {
        require!(v > 0, PremiumBondsError::InvalidBondPrice);
        pool.bond_price = v;
    }
    if let Some(v) = new_max_withdrawal_slippage_dust {
        pool.max_withdrawal_slippage_dust = v;
    }
    if let Some(v) = new_fee_wallet {
        pool.fee_wallet = v;
    }

    Ok(())
}
