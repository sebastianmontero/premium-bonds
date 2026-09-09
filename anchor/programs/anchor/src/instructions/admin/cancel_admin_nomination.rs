use crate::constants::GLOBAL_CONFIG_SEED;
use crate::error::PremiumBondsError;
use crate::events::AdminNominationCancelled;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

/// Accounts required to cancel an existing pending admin nomination.
#[derive(Accounts)]
pub struct CancelAdminNomination<'info> {
    /// The global configuration account.
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin,
        constraint = global_config.pending_admin != Pubkey::default() @ PremiumBondsError::NoPendingAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The current admin authority.
    pub admin: Signer<'info>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Cancels an active pending admin nomination.
///
/// # Parameters
/// * `ctx` - The context of the cancel admin nomination instruction.
pub fn handle(ctx: Context<CancelAdminNomination>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;
    global_config.ensure_current_version()?;
    let cancelled_pending_admin = global_config.pending_admin;
    global_config.pending_admin = Pubkey::default();

    emit_cpi!(AdminNominationCancelled {
        current_admin: global_config.admin,
        cancelled_pending_admin,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
