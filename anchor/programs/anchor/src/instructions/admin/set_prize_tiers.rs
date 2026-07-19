use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PRIZE_TIERS, MAX_TOTAL_WINNERS, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PrizePool, PrizeTier};
use anchor_lang::prelude::*;

/// Accounts required to update the prize tiers for a pool.
#[derive(Accounts)]
pub struct SetPrizeTiers<'info> {
    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority signature authorizing the configuration update.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The prize pool state account to update.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Box<Account<'info, PrizePool>>,
}

/// Sets the prize tiers distribution config for a prize pool.
///
/// Validates that:
/// - The pool is not currently frozen for drawing.
/// - The number of tiers does not exceed `MAX_PRIZE_TIERS`.
/// - Each tier specifies positive prize share (basis_points) and winner counts (num_winners).
/// - The sum of basis points multiplied by the number of winners in each tier equals exactly 10,000.
/// - The total number of winners does not exceed `MAX_TOTAL_WINNERS`.
///
/// # Parameters
/// * `ctx` - The context of the set prize tiers instruction.
/// * `tiers` - The list of prize tiers to configure.
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
            .checked_add(
                (tier.basis_points as u32)
                    .checked_mul(tier.num_winners)
                    .ok_or(PremiumBondsError::MathOverflow)?,
            )
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
