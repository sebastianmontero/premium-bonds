use crate::constants::{DISCRIMINATOR, GLOBAL_CONFIG_SEED};
use crate::error::PremiumBondsError;
use crate::events::GlobalConfigInitialized;
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
        payer = authority,
        space = DISCRIMINATOR + GlobalConfig::INIT_SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The program's upgrade authority authorizing this one-time initialization.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The initial admin authority to set in GlobalConfig.
    /// Can be the authority itself, a warm operational key, or a Squads multisig.
    pub admin: UncheckedAccount<'info>,

    /// CHECK: The emergency guardian key authorized to trigger panic pauses.
    pub guardian: UncheckedAccount<'info>,

    /// CHECK: This account is unchecked because it represents a raw public key used
    /// exclusively as a reference address for the cranking bot. No data validation
    /// or owner checks are performed on it, and it is stored solely in the global configuration.
    pub jobs_account: UncheckedAccount<'info>,

    /// The program's ProgramData account containing the upgrade authority.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    /// The deployed program itself.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Anchor>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,
}

/// Initializes the global program configuration.
///
/// This instruction sets the admin address, the guardian address, and the jobs account address (cranking bot).
/// It can only be called once, as the `global_config` account is initialized as a PDA.
///
/// # Parameters
/// * `ctx` - The context of the initialize global instruction.
pub fn handle(ctx: Context<InitializeGlobal>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;

    global_config.init(
        ctx.accounts.admin.key(),
        ctx.accounts.guardian.key(),
        ctx.accounts.jobs_account.key(),
    );

    emit!(GlobalConfigInitialized {
        admin: global_config.admin,
        guardian: global_config.guardian,
        jobs_account: global_config.jobs_account,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

