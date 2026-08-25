use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PRIZE_TIERS, MAX_TOTAL_WINNERS, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::PrizeTiersUpdated;
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
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
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
    let pool = &mut ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;

    require!(
        pool.is_frozen_for_draw == 0,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let old_tiers_count = pool.prize_tiers_count;
    let old_total_winners: u32 = pool.prize_tiers[..old_tiers_count as usize]
        .iter()
        .try_fold(0u32, |acc, t| acc.checked_add(t.num_winners))
        .ok_or(PremiumBondsError::MathOverflow)?;

    let total_winners = pool.set_prize_tiers(&tiers)?;

    emit_cpi!(PrizeTiersUpdated {
        pool_id: pool.pool_id,
        admin: ctx.accounts.admin.key(),
        old_tiers_count,
        old_total_winners,
        new_tiers_count: pool.prize_tiers_count,
        new_total_winners: total_winners,
        tiers,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
