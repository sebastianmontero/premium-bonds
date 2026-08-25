use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;
use crate::state::UserWinnings;

/// Status phases of an active or completed draw cycle.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum DrawStatus {
    /// Awaiting yield harvest and commit from the yield-bearing reserve (Huma).
    AwaitingYield,
    /// Yield harvested, awaiting oracle randomness resolution (Switchboard).
    AwaitingRandomness,
    /// Randomness resolved and winners successfully drawn/payouts registered.
    Complete,
    /// Draw was forcefully unlocked and cancelled by an admin due to stuck randomness.
    ForceUnlocked,
    /// Draw was skipped because the generated yield was below the pool's min_yield_threshold or there were no active tickets.
    Skipped,
    /// Draw was voided and rolled back by an admin.
    Voided,
    /// Circuit breaker: Venue balance dropped below book value (insolvent/bad debt).
    HaltedInsolvent,
    /// Circuit breaker: Single-cycle yield exceeded configured velocity ceiling.
    HaltedYieldSpike,
}

/// Lifecycle status of a PayoutRegistry.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum PayoutRegistryStatus {
    Active,
    Voided,
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
    /// Unix timestamp (seconds) when harvest_yield_and_commit was executed.
    pub initiated_at: i64,
    /// Unix timestamp (seconds) when draw was finalized/revealed (0 if in-flight).
    pub completed_at: i64,
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

impl DrawCycle {
    /// Current schema version of the DrawCycle account.
    pub const CURRENT_VERSION: u8 = 1;

    /// Lazily migrates this account to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }
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
    /// Timestamp when reveal_and_pick_winners was executed.
    pub revealed_at: i64,
    /// Backed by PayoutRegistryStatus (0 = Active, 1 = Voided).
    pub status: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding for 8-byte boundary alignment (4+4+4+4+8+1+1+6 = 32 bytes).
    pub _padding: [u8; 6],
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
    /// List of winners and their allocation details.
    pub winners: [Winner; 50],
}

impl PayoutRegistry {
    /// Current schema version of the PayoutRegistry account.
    pub const CURRENT_VERSION: u8 = 1;

    /// Lazily migrates this account to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }

    /// Returns true if this PayoutRegistry is active and eligible for processing payouts.
    pub fn is_active(&self) -> bool {
        self.status == (PayoutRegistryStatus::Active as u8)
    }

    /// Validates the winner entry at `winner_index`:
    /// - index is in bounds
    /// - winner pubkey matches the user_winnings user key
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
            PremiumBondsError::InvalidWinnerIndex
        );
        require!(
            self.winners[idx].winner == user_winnings.user,
            PremiumBondsError::WinnerMismatch
        );
        require!(
            self.winners[idx].processed == 0,
            PremiumBondsError::AlreadyClaimed
        );
        Ok(&mut self.winners[idx])
    }

    /// Marks a winner as fully processed and increments the completed counter.
    pub fn mark_processed(&mut self, winner_index: u32) -> Result<()> {
        let idx = winner_index as usize;
        self.winners[idx].processed = 1;
        self.payouts_completed = self
            .payouts_completed
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }
}

/// Details of an individual winner's allocation within a draw cycle.
#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Winner {
    /// Public key of the winning user.
    pub winner: Pubkey,
    /// Total prize amount (USDC in lamports/base units) owed to the winner.
    pub amount_owed: u64,
    /// Exact count of bonds purchased via reinvestment.
    pub bonds_bought: u32,
    /// Whether the prize has been fully disbursed or reinvested (0 for false, 1 for true).
    pub processed: u8,
    /// The index of the PrizeTier from which this prize was calculated.
    pub tier_index: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding to ensure 8-byte alignment for reserved space (1 byte: offset 47..48).
    pub _padding: [u8; 1],
    /// Reserved space for future upgrades (8 bytes: offset 48..56, 56 bytes struct size total).
    pub _reserved: [u8; 8],
}

impl Winner {
    /// Current schema version of the Winner struct.
    pub const CURRENT_VERSION: u8 = 1;

    /// Lazily migrates this winner entry to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }
}
