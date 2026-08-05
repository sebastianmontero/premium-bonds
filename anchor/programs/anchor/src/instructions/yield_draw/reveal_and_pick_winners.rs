use crate::constants::{
    DISCRIMINATOR, DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PAYOUT_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::DrawCompleted;
use crate::state::{
    DrawCycle, DrawStatus, GlobalConfig, PayoutRegistry, PoolStatus, PrizePool, TicketRegistry,
    Winner,
};
use crate::utils::{derive_random_index, registry_get_entry};
use anchor_lang::prelude::*;

/// Accounts required for the `reveal_and_pick_winners` instruction.
///
/// This instruction is executed by a authorized crank bot to consume the verified
/// randomness from Switchboard, resolve the winning ticket indices, map those indices
/// to users in the ticket registry, and initialize the payout registry for the draw cycle.
///
/// # Accounts
///
/// * `crank`: The crank signer executing the instruction. Must match the `jobs_account` specified in `global_config`.
/// * `global_config`: The global configuration account for checking authorization.
/// * `current_draw_cycle`: The draw cycle account to finalize.
/// * `pool`: The prize pool account.
/// * `ticket_registry`: The ticket registry loader.
/// * `randomness_account`: The Switchboard On-Demand randomness account containing the VRF result.
/// * `payout_registry`: The payout registry account initialized to record the winners of this draw.
/// * `system_program`: The Solana System program.
///
/// # PDA Derivations
///
/// * `global_config`: PDA derived with seeds `[GLOBAL_CONFIG_SEED]` (i.e. `b"global_config"`) and a dynamic bump.
/// * `current_draw_cycle`: PDA derived with seeds `[DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()]` (i.e. `b"draw_cycle"`) and a dynamic bump.
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and a dynamic bump.
/// * `payout_registry`: PDA initialized with seeds `[PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()]` (i.e. `b"payout"`) and a dynamic bump.
#[derive(Accounts)]
pub struct RevealAndPickWinners<'info> {
    /// The crank signer executing the instruction. Must match the jobs_account.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The global configuration account, checked to verify that the signer is the authorized jobs account.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The current draw cycle account, validated to match the randomness account.
    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
        constraint = current_draw_cycle.randomness_account == randomness_account.key() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// The prize pool state account, validated with has_one ticket_registry constraint.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        has_one = ticket_registry,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The ticket registry account loader holding all the user entries.
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// CHECK: This is the raw Switchboard On-Demand randomness account. It is unchecked because it belongs to the Switchboard program. We validate it by checking that its owner matches the Switchboard On-Demand program ID and its address matches `current_draw_cycle.randomness_account`. Additionally, in the instruction handler, the account data is parsed and validated using `RandomnessAccountData::parse` to extract the randomness value.
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,

    /// The payout registry account initialized to record the winners of this draw.
    #[account(
        init,
        payer = crank,
        space = 8 + std::mem::size_of::<PayoutRegistry>(),
        seeds = [PAYOUT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: AccountLoader<'info, PayoutRegistry>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

use switchboard_on_demand::accounts::RandomnessAccountData;

/// Resolves the randomness from Switchboard, determines winners, and initializes the payout registry.
///
/// The handler parses the Switchboard randomness account data to retrieve the verified random seed.
/// It verifies that the randomness request is fresh (i.e., not older than 1000 slots and committed after
/// the harvest slot).
///
/// Using the random seed, it derives a random index for each prize tier. It then performs binary search
/// on the ticket registry's cumulative active ticket counts to map each random index to the winning user entry.
///
/// The winners are recorded in the new `payout_registry` account, and any dust resulting from rounding in the
/// prize tiers is deducted from the pool's allocated prizes.
pub fn handle(ctx: Context<RevealAndPickWinners>) -> Result<()> {
    let pool = &mut ctx.accounts.pool.load_mut()?;
    require!(
        pool.status == (PoolStatus::Active as u8),
        PremiumBondsError::PoolNotActive
    );

    require!(
        pool.prize_tiers_count > 0,
        PremiumBondsError::PrizeTiersNotConfigured
    );

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(
        draw_cycle.status == DrawStatus::AwaitingRandomness,
        PremiumBondsError::InvalidDrawStatus
    );

    // Enforce that all user entries have been prepared.
    let user_count = {
        let registry = ctx.accounts.ticket_registry.load()?;
        require!(
            registry.draw_prepared_up_to == registry.user_count,
            PremiumBondsError::InvalidDrawStatus
        );
        registry.user_count
    };

    // ─── SWITCHBOARD ON-DEMAND RANDOMNESS EXTRACTION ────────────────────────
    let clock = Clock::get()?;

    // Parse the Switchboard account data
    let randomness_data =
        RandomnessAccountData::parse(ctx.accounts.randomness_account.data.borrow())
            .map_err(|_| PremiumBondsError::InvalidRandomnessAccount)?;

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
    let random_seed = randomness_data
        .get_value(clock.slot)
        .map_err(|_| PremiumBondsError::RandomnessNotResolved)?;

    draw_cycle.randomness_seed = random_seed;
    draw_cycle.status = DrawStatus::Complete;
    pool.is_frozen_for_draw = 0;

    // Step 2: access ticket bytes directly — no RefMut held, no borrow conflict.
    let registry_ai = ctx.accounts.ticket_registry.to_account_info();
    let data = registry_ai.try_borrow_data()?;

    require!(
        draw_cycle.locked_ticket_count > 0 && draw_cycle.prize_pot > 0,
        PremiumBondsError::InvalidDrawState
    );

    let mut payout_registry = ctx.accounts.payout_registry.load_init()?;
    payout_registry.pool_id = draw_cycle.pool_id;
    payout_registry.cycle_id = draw_cycle.cycle_id;
    payout_registry.version = 1;
    payout_registry.payouts_completed = 0;

    let mut total_distributed: u64 = 0;
    let mut winner_count: usize = 0;

    for tier_idx in 0..(pool.prize_tiers_count as usize) {
        let tier = &pool.prize_tiers[tier_idx];
        let prize_per_winner = tier.calculate_prize(draw_cycle.prize_pot)?;

        for i in 0..tier.num_winners {
            let winning_index = derive_random_index(
                &random_seed,
                tier_idx as u32,
                i,
                draw_cycle.cycle_id,
                draw_cycle.locked_ticket_count as u32,
            );

            let mut lo = 0;
            let mut hi = user_count.saturating_sub(1);
            while lo < hi {
                let mid = (lo + hi) / 2;
                let mid_entry = registry_get_entry(&data, mid as usize);
                if (mid_entry.cumulative_active as u64) <= winning_index {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }

            let winning_entry = registry_get_entry(&data, lo as usize);

            payout_registry.winners[winner_count] = Winner {
                amount_owed: prize_per_winner,
                amount_reinvested: 0,
                winner: winning_entry.owner,
                processed: 0,
                tier_index: tier_idx as u8,
                version: 1,
                _reserved: [0; 5],
            };

            winner_count += 1;

            total_distributed = total_distributed
                .checked_add(prize_per_winner)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }
    }

    payout_registry.winners_count = winner_count as u32;

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

    emit_cpi!(DrawCompleted {
        pool_id: pool.pool_id,
        cycle_id: draw_cycle.cycle_id,
        prize_pot: draw_cycle.prize_pot,
        winners_count: payout_registry.winners_count,
    });

    Ok(())
}
