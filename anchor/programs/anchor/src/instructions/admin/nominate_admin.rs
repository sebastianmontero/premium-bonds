use crate::constants::GLOBAL_CONFIG_SEED;
use crate::error::PremiumBondsError;
use crate::events::AdminNominated;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

/// Accounts required to nominate a new pending admin.
#[derive(Accounts)]
pub struct NominateAdmin<'info> {
    /// The global configuration account to update.
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
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

/// Nominates a new pending admin awaiting role acceptance via two-step transfer.
/// Overwriting a prior pending nomination is explicitly permitted so the current admin can revise nominees.
///
/// # Parameters
/// * `ctx` - The context of the nominate admin instruction.
/// * `pending_admin` - The address of the nominated pending admin.
pub fn handle(ctx: Context<NominateAdmin>, pending_admin: Pubkey) -> Result<()> {
    require!(
        pending_admin != Pubkey::default(),
        PremiumBondsError::InvalidAdminAddress
    );
    let global_config = &mut ctx.accounts.global_config;
    global_config.ensure_current_version()?;
    require!(
        pending_admin != global_config.admin,
        PremiumBondsError::CannotNominateSelf
    );

    global_config.pending_admin = pending_admin;

    emit_cpi!(AdminNominated {
        current_admin: global_config.admin,
        pending_admin,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
