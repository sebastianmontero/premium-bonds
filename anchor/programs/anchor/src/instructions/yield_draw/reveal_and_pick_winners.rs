use crate::constants::{DISCRIMINATOR, DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, PAYOUT_SEED};
use crate::error::PremiumBondsError;
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
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_draw_cycle: Account<'info, DrawCycle>,

    #[account(mut)]
    pub pool: Account<'info, PrizePool>,

    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + PayoutRegistry::INIT_SPACE,
        seeds = [PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<RevealAndPickWinners>, random_seed: [u8; 32]) -> Result<()> {
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

    draw_cycle.randomness_seed = random_seed;
    draw_cycle.status = DrawStatus::Complete;
    pool.is_frozen_for_draw = false;

    // Step 1: call load() to validate discriminator + program ownership, then drop immediately.
    // This preserves Anchor's account validation without holding the RefMut during raw byte access.
    { ctx.accounts.ticket_registry.load()?; }

    // Step 2: access ticket bytes directly — no RefMut held, no borrow conflict.
    let registry_ai = ctx.accounts.ticket_registry.to_account_info();
    let data = registry_ai.try_borrow_data()?;

    require!(
        draw_cycle.locked_ticket_count > 0 && draw_cycle.prize_pot > 0,
        PremiumBondsError::InvalidDrawState
    );

    let mut winners_vec = Vec::new();

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
                paid_out: false,
                tier_index: tier_idx as u8,
            });
        }
    }

    let payout_registry = &mut ctx.accounts.payout_registry;
    payout_registry.pool_id = draw_cycle.pool_id;
    payout_registry.cycle_id = draw_cycle.cycle_id;
    payout_registry.winners_count = winners_vec.len() as u32;
    payout_registry.payouts_completed = 0;
    payout_registry.winners = winners_vec;

    Ok(())
}
