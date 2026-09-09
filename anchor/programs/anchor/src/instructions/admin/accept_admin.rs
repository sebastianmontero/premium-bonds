use crate::constants::GLOBAL_CONFIG_SEED;
use crate::error::PremiumBondsError;
use crate::events::AdminTransferred;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

/// Accounts required for the nominated pending admin to accept the admin role.
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    /// The global configuration account to update.
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.pending_admin != Pubkey::default() @ PremiumBondsError::NoPendingAdmin,
        constraint = global_config.pending_admin == new_admin.key() @ PremiumBondsError::NotPendingAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The nominated pending admin accepting the role.
    pub new_admin: Signer<'info>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Finalizes the two-step admin transfer by having the pending admin accept the role.
///
/// # Parameters
/// * `ctx` - The context of the accept admin instruction.
pub fn handle(ctx: Context<AcceptAdmin>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;
    global_config.ensure_current_version()?;

    let old_admin = global_config.admin;
    let new_admin = ctx.accounts.new_admin.key();

    global_config.admin = new_admin;
    global_config.pending_admin = Pubkey::default();

    emit_cpi!(AdminTransferred {
        old_admin,
        new_admin,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
