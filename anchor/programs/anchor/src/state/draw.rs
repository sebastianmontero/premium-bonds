use anchor_lang::prelude::*;

use crate::error::PremiumBondsError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum DrawStatus { AwaitingYield, AwaitingRandomness, Complete }

#[account]
#[derive(InitSpace)]
pub struct DrawCycle {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub status: DrawStatus,
    pub locked_ticket_count: u32, 
    pub randomness_seed: [u8; 32],
    pub prize_pot: u64,
    pub cycle_fee_collected: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PayoutRegistry {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub winners_count: u32,
    pub payouts_completed: u32,
    #[max_len(50)]
    pub winners: Vec<Winner>,
}

impl PayoutRegistry {
    /// Validates the winner entry at `winner_index`:
    /// - index is in bounds
    /// - pubkey matches the expected winner
    /// - not already paid out
    ///
    /// Returns a mutable reference to the validated `Winner`.
    pub fn validate_winner(
        &mut self,
        winner_index: u32,
        expected_pubkey: &Pubkey,
    ) -> Result<&mut Winner> {
        let idx = winner_index as usize;
        require!(
            idx < self.winners.len(),
            PremiumBondsError::InvalidIndices
        );
        require!(
            self.winners[idx].winner_pubkey == *expected_pubkey,
            PremiumBondsError::UnauthorizedTicket
        );
        require!(
            !self.winners[idx].paid_out,
            PremiumBondsError::AlreadyClaimed
        );
        Ok(&mut self.winners[idx])
    }

    /// Marks a winner as fully paid and increments the completed counter.
    pub fn mark_paid(&mut self, winner_index: u32) {
        let idx = winner_index as usize;
        self.winners[idx].paid_out = true;
        self.payouts_completed += 1;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Winner {
    pub winner_pubkey: Pubkey,
    pub amount_owed: u64,
    pub paid_out: bool,
    pub tier_index: u8,
    /// Tracks partial reinvestment progress across batched crank calls.
    pub amount_reinvested: u64,
}

impl Winner {
    /// Returns the un-reinvested remainder of the prize.
    pub fn claimable_amount(&self) -> u64 {
        self.amount_owed.checked_sub(self.amount_reinvested).unwrap()
    }
}

