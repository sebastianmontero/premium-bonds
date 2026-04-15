use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PRIZE_TIERS, MAX_TOTAL_WINNERS, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PrizeTier, PrizePool};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetPrizeTiers<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,
}

pub fn handle(ctx: Context<SetPrizeTiers>, tiers: Vec<PrizeTier>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    require!(
        !tiers.is_empty() && tiers.len() <= MAX_PRIZE_TIERS,
        PremiumBondsError::InvalidPrizeTierConfig
    );

    let mut total_winners: u32 = 0;
    let mut total_basis_points: u32 = 0;

    for tier in tiers.iter() {
        require!(
            tier.basis_points > 0 && tier.num_winners > 0,
            PremiumBondsError::InvalidPrizeTierConfig
        );

        total_winners = total_winners
            .checked_add(tier.num_winners)
            .ok_or(PremiumBondsError::MathOverflow)?;

        total_basis_points = total_basis_points
            .checked_add((tier.basis_points as u32).checked_mul(tier.num_winners).ok_or(PremiumBondsError::MathOverflow)?)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    require!(
        total_winners as usize <= MAX_TOTAL_WINNERS,
        PremiumBondsError::InvalidPrizeTierConfig
    );

    require!(
        total_basis_points == 10_000,
        PremiumBondsError::BasisPointsMustEqual10000
    );

    pool.prize_tiers = tiers;

    Ok(())
}
