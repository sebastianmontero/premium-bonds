use crate::constants::{DISCRIMINATOR, GLOBAL_CONFIG_SEED};
use crate::events::GlobalConfigUpdated;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

/// Accounts required to initialize the global configuration state.
#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    /// The global configuration state account.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + GlobalConfig::INIT_SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority initializing the global configuration.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: This account is unchecked because it represents a raw public key used
    /// exclusively as a reference address for the cranking bot. No data validation
    /// or owner checks are performed on it, and it is stored solely in the global configuration.
    pub jobs_account: UncheckedAccount<'info>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,
}

/// Initializes the global program configuration.
///
/// This instruction sets the admin address and the jobs account address (cranking bot).
/// It can only be called once, as the `global_config` account is initialized as a PDA.
///
/// # Parameters
/// * `ctx` - The context of the initialize global instruction.
pub fn handle(ctx: Context<InitializeGlobal>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    global_config.admin = ctx.accounts.admin.key();
    global_config.jobs_account = ctx.accounts.jobs_account.key();
    global_config.version = 1;

    emit!(GlobalConfigUpdated {
        admin: global_config.admin,
        jobs_account: global_config.jobs_account,
    });

    Ok(())
}
