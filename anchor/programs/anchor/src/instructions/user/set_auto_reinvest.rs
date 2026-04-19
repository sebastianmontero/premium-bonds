use anchor_lang::prelude::*;
use crate::constants::{PRIZE_POOL_SEED, USER_PREF_SEED};
use crate::state::{PrizePool, UserPreference};

#[derive(Accounts)]
pub struct SetAutoReinvest<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPreference::INIT_SPACE,
        seeds = [USER_PREF_SEED, pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_preference: Account<'info, UserPreference>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<SetAutoReinvest>, enabled: bool) -> Result<()> {
    let user_preference = &mut ctx.accounts.user_preference;
    user_preference.pool_id = ctx.accounts.pool.pool_id;
    user_preference.user = ctx.accounts.user.key();
    user_preference.auto_reinvest = enabled;

    Ok(())
}
