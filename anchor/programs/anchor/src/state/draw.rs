use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;
use crate::state::UserWinnings;

/// Status phases of an active or completed draw cycle.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub enum DrawStatus {
    /// Awaiting yield harvest and commit from the yield-bearing reserve (Huma).
    AwaitingYield,
    /// Yield harvested, awaiting oracle randomness resolution (Switchboard).
    AwaitingRandomness,
    /// Randomness resolved and winners successfully drawn/payouts registered.
    Complete,
    /// Draw was forcefully unlocked and cancelled by an admin due to stuck randomness.
    ForceUnlocked,
}

/// State tracking a specific draw cycle's yields and randomness properties.
///
/// PDA seeds: [b"draw_cycle", pool_id.to_le_bytes(), cycle_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct DrawCycle {
    /// Total prize pot (USDC lamports equivalent) generated from yield for this cycle.
    pub prize_pot: u64,
    /// Portion of the cycle yield allocated to protocol fee wallets.
    pub cycle_fee_collected: u64,
    /// The slot number when yield was frozen, preventing front-running randomness requests.
    pub harvest_slot: u64,
    /// Public key of the locked Switchboard randomness request account.
    pub randomness_account: Pubkey,
    /// Pool ID this draw cycle belongs to.
    pub pool_id: u32,
    /// Incremental ID of the draw cycle.
    pub cycle_id: u32,
    /// Total tickets locked at the time of the draw snapshot.
    pub locked_ticket_count: u32,
    /// Current phase/status of the draw cycle.
    pub status: DrawStatus,
    /// Schema version of the struct.
    pub version: u8,
    /// The resolved 32-byte randomness seed provided by Switchboard.
    pub randomness_seed: [u8; 32],
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}

/// Registry of winners and payouts computed for a completed draw cycle.
///
/// PDA seeds: [b"payout", pool_id.to_le_bytes(), cycle_id.to_le_bytes()]
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct PayoutRegistry {
    /// Pool ID this payout registry belongs to.
    pub pool_id: u32,
    /// Draw cycle ID this payout registry is for.
    pub cycle_id: u32,
    /// Number of winners drawn in this cycle.
    pub winners_count: u32,
    /// Number of payouts successfully processed (claimed or reinvested).
    pub payouts_completed: u32,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding for 8-byte boundary alignment.
    pub _padding: [u8; 7],
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
    /// List of winners and their allocation details.
    pub winners: [Winner; 50],
}

impl PayoutRegistry {
    /// Validates the winner entry at `winner_index`:
    /// - index is in bounds
    /// - user_index matches the user_winnings registry entry index
    /// - not already paid out
    ///
    /// Returns a mutable reference to the validated `Winner`.
    pub fn validate_winner(
        &mut self,
        winner_index: u32,
        user_winnings: &UserWinnings,
    ) -> Result<&mut Winner> {
        let idx = winner_index as usize;
        require!(
            idx < (self.winners_count as usize),
            PremiumBondsError::InvalidIndices
        );
        require!(
            self.winners[idx].user_index == user_winnings.registry_entry_index,
            PremiumBondsError::UnauthorizedTicket
        );
        require!(
            self.winners[idx].processed == 0,
            PremiumBondsError::AlreadyClaimed
        );
        Ok(&mut self.winners[idx])
    }

    /// Marks a winner as fully processed and increments the completed counter.
    pub fn mark_processed(&mut self, winner_index: u32) {
        let idx = winner_index as usize;
        self.winners[idx].processed = 1;
        self.payouts_completed += 1;
    }
}

/// Details of an individual winner's allocation within a draw cycle.
#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Winner {
    /// Total prize amount (USDC in lamports/base units) owed to the winner.
    pub amount_owed: u64,
    /// Tracks partial reinvestment progress across batched crank calls.
    pub amount_reinvested: u64,
    /// User index position in TicketRegistry.
    pub user_index: u32,
    /// Whether the prize has been fully disbursed or reinvested (0 for false, 1 for true).
    pub processed: u8,
    /// The index of the PrizeTier from which this prize was calculated.
    pub tier_index: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Reserved space for future upgrades (packed to 32 bytes).
    pub _reserved: [u8; 9],
}

impl Winner {
    /// Returns the un-reinvested remainder of the prize.
    pub fn claimable_amount(&self) -> u64 {
        self.amount_owed
            .checked_sub(self.amount_reinvested)
            .unwrap()
    }
}
