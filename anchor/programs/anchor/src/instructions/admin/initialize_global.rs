use anchor_lang::prelude::*;
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(
        init,
        payer = admin,
        space = GlobalConfig::INIT_SPACE,
        seeds = [b"global_config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Public key for the designated cranking bot
    pub jobs_account: AccountInfo<'info>,

    /// CHECK: Receives protocol commission fees
    pub fee_wallet: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitializeGlobal>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    global_config.admin = ctx.accounts.admin.key();
    global_config.jobs_account = ctx.accounts.jobs_account.key();
    global_config.fee_wallet = ctx.accounts.fee_wallet.key();

    Ok(())
}
