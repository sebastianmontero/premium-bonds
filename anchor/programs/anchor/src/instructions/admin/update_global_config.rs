use crate::constants::GLOBAL_CONFIG_SEED;
use crate::error::PremiumBondsError;
use crate::events::GlobalConfigUpdated;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

/// Accounts required to update the global configuration state.
#[derive(Accounts)]
pub struct UpdateGlobalConfig<'info> {
    /// The global configuration state account to update.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority.
    pub admin: Signer<'info>,
}

/// Updates the global program configuration parameters.
///
/// Allows modifying the admin address, the guardian address, and the jobs account address (cranking bot).
///
/// # Parameters
/// * `ctx` - The context of the update global config instruction.
/// * `new_admin` - Optional new admin authority public key.
/// * `new_guardian` - Optional new emergency guardian public key.
/// * `new_jobs_account` - Optional new cranking bot public key.
pub fn handle(
    ctx: Context<UpdateGlobalConfig>,
    new_admin: Option<Pubkey>,
    new_guardian: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    if let Some(admin) = new_admin {
        global_config.admin = admin;
    }

    if let Some(guardian) = new_guardian {
        global_config.guardian = guardian;
    }

    if let Some(jobs_account) = new_jobs_account {
        global_config.jobs_account = jobs_account;
    }

    emit!(GlobalConfigUpdated {
        admin: global_config.admin,
        guardian: global_config.guardian,
        jobs_account: global_config.jobs_account,
    });

    Ok(())
}
