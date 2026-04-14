use anchor_lang::prelude::*;
use crate::state::GlobalConfig;
use crate::constants::{DISCRIMINATOR, GLOBAL_CONFIG_SEED};

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + GlobalConfig::INIT_SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Public key for the designated cranking bot
    pub jobs_account: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitializeGlobal>, max_tickets_per_buy: u32) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    global_config.admin = ctx.accounts.admin.key();
    global_config.jobs_account = ctx.accounts.jobs_account.key();
    global_config.max_tickets_per_buy = max_tickets_per_buy;

    Ok(())
}
