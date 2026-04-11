use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, PrizePool, DrawCycle, DrawStatus, PayoutRegistry, TicketRegistry, Winner};
use crate::error::PremiumBondsError;

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
    pub jobs_account: AccountInfo<'info>,

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
        space = 8 + 4 + 4 + 4 + 4 + 4 + (32 + 8 + 1) * 10, // Assuming 10 winners max
        seeds = [b"payout", pool.pool_id.to_le_bytes().as_ref(), current_draw_cycle.cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<RevealAndPickWinners>, random_seed: [u8; 32], num_winners: u32) -> Result<()> {
    require!(ctx.accounts.crank.key() == ctx.accounts.global_config.jobs_account, PremiumBondsError::UnauthorizedTicket);
    require!(num_winners > 0 && num_winners <= 10, PremiumBondsError::InvalidBondAmount);

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    require!(draw_cycle.status == DrawStatus::AwaitingRandomness, PremiumBondsError::InvalidBondAmount);

    draw_cycle.randomness_seed = random_seed;
    draw_cycle.status = DrawStatus::Complete;

    let ticket_registry = ctx.accounts.ticket_registry.load()?;

    let mut winners_vec = Vec::new();

    if draw_cycle.locked_ticket_count > 0 && draw_cycle.prize_pot > 0 {
        let actual_winners = std::cmp::min(draw_cycle.locked_ticket_count, num_winners);
        let prize_per_winner = draw_cycle.prize_pot / actual_winners as u64;

        for i in 0..actual_winners {
            let offset = (i as usize) * 4;
            let mut buf = [0u8; 4];
            buf.copy_from_slice(&random_seed[offset % 32 .. (offset % 32) + 4]);
            let random_val = u32::from_le_bytes(buf);
            
            let winning_index = random_val % draw_cycle.locked_ticket_count;
            let winner_pubkey = ticket_registry.tickets[winning_index as usize];

            winners_vec.push(Winner {
                winner_pubkey,
                amount_owed: prize_per_winner,
                paid_out: false,
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
