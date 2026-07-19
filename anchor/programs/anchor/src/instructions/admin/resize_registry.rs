use crate::constants::{
    GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED, REGISTRY_MAX_SIZE, REGISTRY_REALLOC_STEP,
};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PrizePool, TicketRegistry};
use crate::utils::registry_capacity_from_len;
use anchor_lang::prelude::*;

/// Accounts required to resize the ticket registry.
#[derive(Accounts)]
pub struct ResizeRegistry<'info> {
    /// The authorized crank bot key that signs to initiate the resize.
    pub crank: Signer<'info>,

    /// Separate payer that pays for the rent increase.
    /// This allows the crank key to stay relatively low-funded.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The global configuration state, used to verify the crank bot authority.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account, used to verify that the ticket registry belongs
    /// to this pool and that the pool is not currently frozen for drawing.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry @ PremiumBondsError::UnauthorizedTicket,
        constraint = !pool.is_frozen_for_draw @ PremiumBondsError::AwaitingRandomnessFreeze
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    /// The zero-copy ticket registry account to be resized.
    /// Verified against the prize pool's registry reference.
    /// Reallocates additional space (`REGISTRY_REALLOC_STEP`) and charges rent to `payer`.
    #[account(
        mut,
        // Guard: ensure we won't exceed Solana's 10 MB limit after this step.
        constraint = ticket_registry.to_account_info().data_len() + REGISTRY_REALLOC_STEP <= REGISTRY_MAX_SIZE
            @ PremiumBondsError::RegistryAtMaxSize,
        // Anchor handles the CPI rent transfer from `payer` and calls realloc for us.
        realloc = ticket_registry.to_account_info().data_len() + REGISTRY_REALLOC_STEP,
        realloc::payer = payer,
        realloc::zero = true,
    )]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,
}

/// Resizes the zero-copy ticket registry to allocate more space for user entries.
///
/// This increases the capacity of the raffle ticket registry by `REGISTRY_REALLOC_STEP` bytes,
/// recalculating the cached `capacity` field in the zero-copy header.
///
/// # Parameters
/// * `ctx` - The context of the resize registry instruction.
pub fn handle(ctx: Context<ResizeRegistry>) -> Result<()> {
    // The `realloc` constraint has already grown the account and topped up rent.
    // All we need to do is sync the cached `capacity` field in the zero-copy header.
    let new_len = ctx.accounts.ticket_registry.to_account_info().data_len();
    let new_capacity = registry_capacity_from_len(new_len);

    let mut registry = ctx.accounts.ticket_registry.load_mut()?;
    registry.capacity = new_capacity;

    Ok(())
}
