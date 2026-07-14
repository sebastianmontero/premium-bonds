use crate::constants::{
    DISCRIMINATOR, DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PAYOUT_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::DrawCompleted;
use crate::state::{
    DrawCycle, DrawStatus, GlobalConfig, PayoutRegistry, PoolStatus, PrizePool, TicketRegistry,
    Winner,
};
use crate::utils::{derive_random_index, registry_get_ticket};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RevealAndPickWinners<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
        constraint = current_draw_cycle.randomness_account == randomness_account.key() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        has_one = ticket_registry,
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// CHECK: Checked by owner constraint and verified against current_draw_cycle above
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,

    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + PayoutRegistry::INIT_SPACE,
        seeds = [PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Box<Account<'info, PayoutRegistry>>,

    pub system_program: Program<'info, System>,
}

use switchboard_on_demand::accounts::RandomnessAccountData;

pub fn handle(ctx: Context<RevealAndPickWinners>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    require!(
        pool.status == PoolStatus::Active,
        PremiumBondsError::PoolNotActive
    );

    require!(
        !pool.prize_tiers.is_empty(),
        PremiumBondsError::PrizeTiersNotConfigured
    );

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(
        draw_cycle.status == DrawStatus::AwaitingRandomness,
        PremiumBondsError::InvalidDrawStatus
    );

    // ─── SWITCHBOARD ON-DEMAND RANDOMNESS EXTRACTION ────────────────────────
    let clock = Clock::get()?;
    
    // Parse the Switchboard account data
    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.randomness_account.data.borrow()
    ).map_err(|_| PremiumBondsError::InvalidRandomnessAccount)?;

    // Ensure the randomness request was committed AFTER or AT the harvest block
    require!(
        randomness_data.seed_slot >= draw_cycle.harvest_slot,
        PremiumBondsError::StaleRandomnessRequest
    );

    // Enforce freshness (must be resolved and consumed within 1000 slots)
    require!(
        clock.slot.saturating_sub(randomness_data.seed_slot) <= 1000,
        PremiumBondsError::StaleRandomnessRequest
    );

    // Retrieve the verified 32-byte VRF output
    let random_seed = randomness_data.get_value(clock.slot)
        .map_err(|_| PremiumBondsError::RandomnessNotResolved)?;

    draw_cycle.randomness_seed = random_seed;
    draw_cycle.status = DrawStatus::Complete;
    pool.is_frozen_for_draw = false;

    // Step 1: call load() to validate discriminator + program ownership, then drop immediately.
    // This preserves Anchor's account validation without holding the RefMut during raw byte access.
    {
        ctx.accounts.ticket_registry.load()?;
    }

    // Step 2: access ticket bytes directly — no RefMut held, no borrow conflict.
    let registry_ai = ctx.accounts.ticket_registry.to_account_info();
    let data = registry_ai.try_borrow_data()?;

    require!(
        draw_cycle.locked_ticket_count > 0 && draw_cycle.prize_pot > 0,
        PremiumBondsError::InvalidDrawState
    );

    let mut winners_vec = Vec::new();
    let mut total_distributed: u64 = 0;

    for (tier_idx, tier) in pool.prize_tiers.iter().enumerate() {
        let prize_per_winner = tier.calculate_prize(draw_cycle.prize_pot);

        for i in 0..tier.num_winners {
            let winning_index = derive_random_index(
                &random_seed,
                tier_idx as u32,
                i,
                draw_cycle.cycle_id,
                draw_cycle.locked_ticket_count,
            );
            let winner_pubkey = registry_get_ticket(&data, winning_index as usize);

            winners_vec.push(Winner {
                winner_pubkey,
                amount_owed: prize_per_winner,
                processed: false,
                tier_index: tier_idx as u8,
                amount_reinvested: 0,
            });

            total_distributed = total_distributed
                .checked_add(prize_per_winner)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }
    }

    let dust = draw_cycle
        .prize_pot
        .checked_sub(total_distributed)
        .ok_or(PremiumBondsError::MathOverflow)?;
    if dust > 0 {
        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_sub(dust)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    let payout_registry = &mut ctx.accounts.payout_registry;
    payout_registry.pool_id = draw_cycle.pool_id;
    payout_registry.cycle_id = draw_cycle.cycle_id;
    payout_registry.winners_count = winners_vec.len() as u32;
    payout_registry.payouts_completed = 0;
    payout_registry.winners = winners_vec;

    emit!(DrawCompleted {
        pool_id: pool.pool_id,
        cycle_id: draw_cycle.cycle_id,
        prize_pot: draw_cycle.prize_pot,
        winners_count: payout_registry.winners_count,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
