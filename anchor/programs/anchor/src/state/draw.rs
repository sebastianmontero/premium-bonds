use crate::error::PremiumBondsError;
use crate::state::UserWinnings;
use anchor_lang::prelude::*;

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

/// Reason why a draw cycle was skipped instead of executing.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum DrawSkipReason {
    /// Generated yield did not meet the pool's minimum yield threshold.
    InsufficientYield,
    /// There are zero mature active tickets eligible for drawing.
    ZeroActiveTickets,
}

impl TryFrom<u8> for DrawSkipReason {
    type Error = crate::error::PremiumBondsError;
    fn try_from(value: u8) -> std::result::Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::InsufficientYield),
            1 => Ok(Self::ZeroActiveTickets),
            _ => Err(crate::error::PremiumBondsError::InvalidDrawStatus),
        }
    }
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

    pub fn halt(
        &mut self,
        status: DrawStatus,
        locked_ticket_count: u32,
        current_time: i64,
    ) -> Result<()> {
        require!(
            matches!(
                status,
                DrawStatus::HaltedInsolvent | DrawStatus::HaltedYieldSpike
            ),
            PremiumBondsError::InvalidDrawStatus
        );
        self.status = status;
        self.completed_at = current_time;
        self.locked_ticket_count = locked_ticket_count;
        self.prize_pot = 0;
        self.cycle_fee_collected = 0;
        Ok(())
    }

    pub fn skip(&mut self, locked_ticket_count: u32, current_time: i64) {
        self.status = DrawStatus::Skipped;
        self.completed_at = current_time;
        self.locked_ticket_count = locked_ticket_count;
        self.prize_pot = 0;
        self.cycle_fee_collected = 0;
    }

    pub fn commit_harvest(&mut self, locked_ticket_count: u32, prize_pot: u64, fee: u64) {
        self.status = DrawStatus::AwaitingRandomness;
        self.completed_at = 0;
        self.locked_ticket_count = locked_ticket_count;
        self.prize_pot = prize_pot;
        self.cycle_fee_collected = fee;
    }

    pub fn rebind_randomness(
        &mut self,
        new_randomness_account: Pubkey,
        current_slot: u64,
    ) -> Result<()> {
        require!(
            self.status == DrawStatus::AwaitingRandomness,
            PremiumBondsError::InvalidDrawStatus
        );
        require!(
            new_randomness_account != self.randomness_account,
            PremiumBondsError::SameRandomnessAccount
        );
        self.randomness_account = new_randomness_account;
        self.harvest_slot = current_slot;
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
}

const _: () = assert!(std::mem::size_of::<PayoutRegistry>() == 96);

/// Details of an individual winner's allocation within a draw cycle.
#[repr(C)]
#[derive(
    Copy,
    Clone,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
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

    pub fn check_version(&self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        Ok(())
    }

    #[inline]
    pub fn is_processed(&self) -> bool {
        self.processed != 0
    }

    pub fn validate_eligibility(&self, expected_user: Pubkey) -> Result<()> {
        require!(self.winner == expected_user, PremiumBondsError::WinnerMismatch);
        require!(!self.is_processed(), PremiumBondsError::AlreadyClaimed);
        Ok(())
    }

    pub fn mark_processed(&mut self, bonds_bought: u32) {
        self.processed = 1;
        self.bonds_bought = bonds_bought;
    }
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

    pub fn check_version(&self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        Ok(())
    }

    /// Returns true if this PayoutRegistry is active and eligible for processing payouts.
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status == (PayoutRegistryStatus::Active as u8)
    }

    #[inline]
    pub fn is_voided(&self) -> bool {
        self.status == (PayoutRegistryStatus::Voided as u8)
    }

    #[inline]
    pub fn can_close(&self) -> bool {
        self.is_voided()
            || (self.is_active()
                && self.winners_count > 0
                && self.payouts_completed == self.winners_count)
    }
}

pub struct PayoutRegistryRef<'a> {
    pub header: &'a PayoutRegistry,
    pub winners: &'a [Winner],
}

impl<'a> PayoutRegistryRef<'a> {
    #[inline]
    pub fn active_winners(&self) -> &[Winner] {
        &self.winners[..self.header.winners_count as usize]
    }

    pub fn get_winner(&self, winner_index: u32) -> Result<&Winner> {
        let idx = winner_index as usize;
        require!(
            idx < self.header.winners_count as usize,
            PremiumBondsError::InvalidWinnerIndex
        );
        require!(
            idx < self.winners.len(),
            PremiumBondsError::InvalidRegistryState
        );
        Ok(&self.winners[idx])
    }

    pub fn validate_winner(&self, winner_index: u32, expected_user: Pubkey) -> Result<&Winner> {
        let winner = self.get_winner(winner_index)?;
        winner.validate_eligibility(expected_user)?;
        Ok(winner)
    }

    pub fn total_amount_owed(&self) -> Result<u64> {
        self.active_winners()
            .iter()
            .map(|w| w.amount_owed)
            .try_fold(0u64, |acc, amt| acc.checked_add(amt))
            .ok_or_else(|| error!(PremiumBondsError::MathOverflow))
    }
}

pub struct PayoutRegistryMut<'a> {
    pub header: &'a mut PayoutRegistry,
    pub winners: &'a mut [Winner],
}

impl<'a> PayoutRegistryMut<'a> {
    pub fn as_ref(&self) -> PayoutRegistryRef<'_> {
        PayoutRegistryRef {
            header: self.header,
            winners: self.winners,
        }
    }

    pub fn validate_winner(&self, winner_index: u32, expected_user: Pubkey) -> Result<&Winner> {
        let idx = winner_index as usize;
        require!(
            idx < self.header.winners_count as usize,
            PremiumBondsError::InvalidWinnerIndex
        );
        require!(
            idx < self.winners.len(),
            PremiumBondsError::InvalidRegistryState
        );
        let winner = &self.winners[idx];
        winner.validate_eligibility(expected_user)?;
        Ok(winner)
    }

    pub fn total_amount_owed(&self) -> Result<u64> {
        self.as_ref().total_amount_owed()
    }

    pub fn get_winner_mut(
        &mut self,
        winner_index: u32,
        expected_user: Pubkey,
    ) -> Result<&mut Winner> {
        let idx = winner_index as usize;
        require!(
            idx < self.header.winners_count as usize,
            PremiumBondsError::InvalidWinnerIndex
        );
        require!(
            idx < self.winners.len(),
            PremiumBondsError::InvalidRegistryState
        );
        let winner = &mut self.winners[idx];
        winner.validate_eligibility(expected_user)?;
        Ok(winner)
    }

    pub fn complete_payout(&mut self, winner_index: u32, bonds_bought: u32) -> Result<u64> {
        let idx = winner_index as usize;
        require!(
            idx < self.header.winners_count as usize,
            PremiumBondsError::InvalidWinnerIndex
        );
        require!(
            idx < self.winners.len(),
            PremiumBondsError::InvalidRegistryState
        );
        let winner = &mut self.winners[idx];
        require!(!winner.is_processed(), PremiumBondsError::AlreadyClaimed);
        winner.mark_processed(bonds_bought);
        self.header.payouts_completed = self
            .header
            .payouts_completed
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(winner.amount_owed)
    }

    pub fn void_draw(&mut self) -> Result<u64> {
        require!(
            self.header.payouts_completed == 0,
            PremiumBondsError::PayoutsAlreadyStarted
        );
        require!(self.header.is_active(), PremiumBondsError::DrawAlreadyVoided);
        let total_distributed = self.total_amount_owed()?;
        self.header.status = PayoutRegistryStatus::Voided as u8;
        Ok(total_distributed)
    }
}
