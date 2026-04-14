use anchor_lang::prelude::*;
use crate::state::GlobalConfig;
use crate::constants::GLOBAL_CONFIG_SEED;
use crate::error::PremiumBondsError;

#[derive(Accounts)]
pub struct UpdateGlobalConfig<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}

pub fn handle(
    ctx: Context<UpdateGlobalConfig>,
    new_admin: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
    new_max_tickets_per_buy: Option<u32>,
) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    if let Some(admin) = new_admin {
        global_config.admin = admin;
    }

    if let Some(jobs_account) = new_jobs_account {
        global_config.jobs_account = jobs_account;
    }

    if let Some(max_tickets_per_buy) = new_max_tickets_per_buy {
        global_config.max_tickets_per_buy = max_tickets_per_buy;
    }

    Ok(())
}
