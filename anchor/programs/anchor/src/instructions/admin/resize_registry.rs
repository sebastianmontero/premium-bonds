use crate::constants::{
    GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED, REGISTRY_MAX_SIZE, REGISTRY_REALLOC_STEP,
};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PrizePool, TicketRegistry};
use crate::utils::registry_capacity_from_len;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ResizeRegistry<'info> {
    /// The authorized crank — signs to prove authorization, but does NOT pay rent.
    pub crank: Signer<'info>,

    /// Separate payer for rent so the hot crank key does not need to hold large SOL balances.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// Pool validates ticket_registry ownership and freeze state.
    #[account(
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry @ PremiumBondsError::UnauthorizedTicket,
        constraint = !pool.is_frozen_for_draw @ PremiumBondsError::AwaitingRandomnessFreeze
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(
        mut,
        // Guard: ensure we won't exceed Solana's 10 MB limit after this step.
        constraint = ticket_registry.to_account_info().data_len() + REGISTRY_REALLOC_STEP <= REGISTRY_MAX_SIZE
            @ PremiumBondsError::RegistryAtMaxSize,
        // Anchor handles the CPI rent transfer from `payer` and calls realloc for us.
        realloc = ticket_registry.to_account_info().data_len() + REGISTRY_REALLOC_STEP,
        realloc::payer = payer,
        realloc::zero = false,
    )]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<ResizeRegistry>) -> Result<()> {
    // The `realloc` constraint has already grown the account and topped up rent.
    // All we need to do is sync the cached `capacity` field in the zero-copy header.
    let new_len = ctx.accounts.ticket_registry.to_account_info().data_len();
    let new_capacity = registry_capacity_from_len(new_len);

    let mut registry = ctx.accounts.ticket_registry.load_mut()?;
    registry.capacity = new_capacity;

    Ok(())
}
