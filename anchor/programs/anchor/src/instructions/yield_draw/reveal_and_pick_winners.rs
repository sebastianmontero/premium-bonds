use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, PrizePool, DrawCycle, DrawStatus, PayoutRegistry, TicketRegistry, Winner};
use crate::error::PremiumBondsError;
use crate::constants::DISCRIMINATOR;

#[derive(Accounts)]
pub struct RevealAndPickWinners<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"global_config"],
        bump,
        has_one = jobs_account 
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// CHECK: Target matching 
    pub jobs_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"draw_cycle", pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub current_draw_cycle: Account<'info, DrawCycle>,

    pub pool: Account<'info, PrizePool>,

    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + PayoutRegistry::INIT_SPACE,
        seeds = [b"payout", pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<RevealAndPickWinners>, random_seed: [u8; 32], num_winners: u32) -> Result<()> {
    require!(ctx.accounts.crank.key() == ctx.accounts.global_config.jobs_account, PremiumBondsError::UnauthorizedCrank);
    require!(num_winners > 0 && num_winners <= 10, PremiumBondsError::InvalidNumWinners);

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(draw_cycle.status == DrawStatus::AwaitingRandomness, PremiumBondsError::InvalidDrawStatus);

    draw_cycle.randomness_seed = random_seed;
    draw_cycle.status = DrawStatus::Complete;

    let ticket_registry = ctx.accounts.ticket_registry.load()?;

    require!(draw_cycle.locked_ticket_count > 0 && draw_cycle.prize_pot > 0, PremiumBondsError::InvalidDrawState);

    let mut winners_vec = Vec::new();
    let actual_winners = std::cmp::min(draw_cycle.locked_ticket_count, num_winners);
    let prize_per_winner = draw_cycle.prize_pot / actual_winners as u64;

    for i in 0..actual_winners {
        // Iteratively hash the initial seed combined with the winner index to generate 
        // a distinct, uniform block of 32 bytes of entropy for EVERY winner independently!
        let hashed_entropy = solana_program::hash::hashv(&[
            &random_seed,
            i.to_le_bytes().as_ref(),
            &draw_cycle.cycle_id.to_le_bytes()
        ]).to_bytes();
        
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&hashed_entropy[0..8]);
        let random_val = u64::from_le_bytes(buf);
        
        let winning_index = random_val % (draw_cycle.locked_ticket_count as u64);
        let winner_pubkey = ticket_registry.tickets[winning_index as usize];

        winners_vec.push(Winner {
            winner_pubkey,
            amount_owed: prize_per_winner,
            paid_out: false,
        });
    }

    let payout_registry = &mut ctx.accounts.payout_registry;
    payout_registry.pool_id = draw_cycle.pool_id;
    payout_registry.cycle_id = draw_cycle.cycle_id;
    payout_registry.winners_count = winners_vec.len() as u32;
    payout_registry.payouts_completed = 0;
    payout_registry.winners = winners_vec;

    Ok(())
}
