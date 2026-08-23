use anchor_lang::prelude::*;

/// Represents the administrative and lifecycle state of a liquidity pool.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum PoolStatus {
    /// Active and accepting deposits, withdrawals, and draws.
    Active,
    /// Paused; deposits and sales are temporarily suspended.
    Paused,
    /// Closed permanently; only withdrawals and redemptions allowed.
    Closed,
}

impl TryFrom<u8> for PoolStatus {
    type Error = PremiumBondsError;

    fn try_from(value: u8) -> std::result::Result<Self, Self::Error> {
        match value {
            0 => Ok(PoolStatus::Active),
            1 => Ok(PoolStatus::Paused),
            2 => Ok(PoolStatus::Closed),
            _ => Err(PremiumBondsError::InvalidPoolStatus),
        }
    }
}

/// Defines the configuration for a single prize tier within a pool.
#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct PrizeTier {
    /// Number of winners that can be selected for this tier in a single draw.
    pub num_winners: u32,
    /// Share of the yield (in basis points) each winner in this tier receives.
    pub basis_points: u16,
    /// Explicit padding to ensure 8-byte alignment.
    pub _padding: [u8; 2],
}

impl PrizeTier {
    /// Constructs a new `PrizeTier` with explicit 2-byte zero padding.
    pub const fn new(num_winners: u32, basis_points: u16) -> Self {
        Self {
            num_winners,
            basis_points,
            _padding: [0; 2],
        }
    }

    /// Default tier configuration with a single winner receiving 100% (10,000 bps) of the prize pot.
    pub const fn default_single_winner() -> Self {
        Self::new(1, 10_000)
    }

    /// Calculates the prize amount based on the pool's total prize pot and basis points.
    pub fn calculate_prize(&self, prize_pot: u64) -> Result<u64> {
        let prize = (prize_pot as u128)
            .checked_mul(self.basis_points as u128)
            .ok_or(PremiumBondsError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(PremiumBondsError::MathOverflow)?;
        prize.try_into().map_err(|_| PremiumBondsError::MathOverflow.into())
    }
}

/// The main state account tracking a specific prize bond pool.
///
/// PDA seeds: [b"prize_pool", pool_id.to_le_bytes()]
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct PrizePool {
    /// Price of a single bond/ticket in underlying token base units.
    pub bond_price: u64,
    /// Duration of each stake/yield cycle in hours.
    pub stake_cycle_duration_hrs: i64,
    /// Minimum yield required (in USDC lamports) to trigger a draw. If not met, the draw is skipped and yield rolls over.
    pub min_yield_threshold: u64,
    /// Total principal deposited by all users in this pool.
    pub total_deposited_principal: u64,
    /// Unix timestamp when the current yield cycle is scheduled to end.
    pub current_cycle_end_at: i64,
    /// Auto-incrementing counter for PendingRedemption PDA derivation.
    pub next_redemption_id: u64,
    /// Lifetime fees accrued from yield harvests (accounting-only, not yet withdrawn).
    pub total_fees_accrued: u64,
    /// Fees already withdrawn by admin via withdraw_fees instruction.
    pub total_fees_withdrawn: u64,
    /// Total prizes currently allocated/committed.
    pub total_prizes_allocated: u64,
    /// Total outstanding pending redemptions.
    pub total_pending_redemptions: u64,
    /// Lifetime prizes awarded to winning tickets across all completed draws (net of dust).
    pub total_prizes_distributed: u64,

    /// Unique identifier for this prize pool.
    pub pool_id: u32,
    /// The ID of the draw cycle currently being processed or the last completed cycle.
    pub current_draw_cycle_id: u32,

    /// Protocol fee rate in basis points (e.g. 250 = 2.5%).
    pub fee_basis_points: u16,
    /// Maximum allowable yield basis points per single cycle (e.g. 500 = 5.0%, 0 = uncapped).
    pub max_yield_basis_points: u16,
    /// Timelock buffer in seconds before winner payouts can be cranked (default: 300s).
    pub payout_timelock_seconds: u32,

    /// Bump seed for the vault authority.
    pub vault_authority_bump: u8,
    /// Administrative lifecycle status of the pool (u8 representation of PoolStatus).
    pub status: u8,
    /// Flag indicating whether deposit/withdraw/sale actions are frozen for draw calculation (0 for false, 1 for true).
    pub is_frozen_for_draw: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Active prize tiers count in prize_tiers array.
    pub prize_tiers_count: u8,
    /// Explicit padding to maintain 8-byte boundary alignment.
    pub _padding: [u8; 3],

    /// The mint of the underlying USDC token used for purchasing bonds.
    pub token_mint: Pubkey,
    /// Pointer to the massive zero-copy TicketRegistry account.
    pub ticket_registry: Pubkey,
    /// Public key of the token account that collects protocol fees.
    pub fee_wallet: Pubkey,

    /// Configured prize tiers for this pool.
    pub prize_tiers: [PrizeTier; 10],
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 128],
}

use crate::error::PremiumBondsError;
use crate::utils::calculate_percentage_fee;

impl PrizePool {
    /// Current schema version of the PrizePool account.
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

    /// Gets the strongly-typed PoolStatus enum.
    pub fn status(&self) -> PoolStatus {
        PoolStatus::try_from(self.status).unwrap_or(PoolStatus::Closed)
    }

    /// Sets the PoolStatus enum safely.
    pub fn set_status(&mut self, status: PoolStatus) {
        self.status = status as u8;
    }

    /// Returns true if frozen for draw.
    pub fn is_frozen(&self) -> bool {
        self.is_frozen_for_draw != 0
    }

    /// Sets frozen status.
    pub fn set_frozen(&mut self, frozen: bool) {
        self.is_frozen_for_draw = if frozen { 1 } else { 0 };
    }

    /// Calculates the protocol fee from a yield harvest.
    pub fn calculate_fee(&self, yield_amount: u64) -> Result<u64> {
        calculate_percentage_fee(yield_amount, self.fee_basis_points)
    }

    /// Advances the current cycle end timestamp.
    pub fn advance_cycle_end_at(&mut self, current_time: i64) -> Result<()> {
        let added_seconds = self
            .stake_cycle_duration_hrs
            .checked_mul(3600)
            .ok_or(PremiumBondsError::MathOverflow)?;
        self.current_cycle_end_at = current_time
            .checked_add(added_seconds)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }

    /// Records prizes awarded to winners upon reveal, adjusting active liabilities and updating lifetime metrics.
    pub fn record_prize_distribution(&mut self, total_distributed: u64, dust: u64) -> Result<()> {
        if dust > 0 {
            self.total_prizes_allocated = self
                .total_prizes_allocated
                .checked_sub(dust)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }
        self.total_prizes_distributed = self
            .total_prizes_distributed
            .checked_add(total_distributed)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }

    /// Rolls back prize distribution accounting when an admin voids a completed draw before payouts start.
    pub fn rollback_prize_distribution(&mut self, total_distributed: u64) -> Result<()> {
        self.total_prizes_allocated = self
            .total_prizes_allocated
            .checked_sub(total_distributed)
            .ok_or(PremiumBondsError::MathOverflow)?;
        self.total_prizes_distributed = self
            .total_prizes_distributed
            .checked_sub(total_distributed)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }

    /// Validates all pre-CPI guard checks for the `buy_bonds` instruction.
    ///
    /// These checks run before any token transfers or Huma CPI calls.
    /// Extracted here so they can be unit-tested without a full Anchor context.
    pub fn validate_buy_bonds(&self, bonds_to_buy: u32) -> Result<u64> {
        require!(
            self.status == (PoolStatus::Active as u8),
            PremiumBondsError::PoolNotActive
        );
        require!(
            self.is_frozen_for_draw == 0,
            PremiumBondsError::AwaitingRandomnessFreeze
        );
        require!(bonds_to_buy > 0, PremiumBondsError::InvalidBondQuantity);
        let amount = (bonds_to_buy as u64)
            .checked_mul(self.bond_price)
            .ok_or(PremiumBondsError::MathOverflow)?;
        // Defense-in-depth: pre-check principal overflow before CPIs.
        self.total_deposited_principal
            .checked_add(amount)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(amount)
    }

    /// Validates bond price.
    pub fn validate_bond_price(bond_price: u64) -> Result<()> {
        require!(bond_price > 0, PremiumBondsError::InvalidBondPrice);
        Ok(())
    }

    /// Validates stake cycle duration in hours.
    pub fn validate_stake_cycle_duration(stake_cycle_duration_hrs: i64) -> Result<()> {
        require!(
            (crate::constants::MIN_STAKE_CYCLE_DURATION_HRS
                ..=crate::constants::MAX_STAKE_CYCLE_DURATION_HRS)
                .contains(&stake_cycle_duration_hrs),
            PremiumBondsError::InvalidStakeCycleDuration
        );
        Ok(())
    }

    /// Validates fee rate in basis points.
    pub fn validate_fee_basis_points(fee_basis_points: u16) -> Result<()> {
        require!(
            fee_basis_points <= crate::constants::MAX_BASIS_POINTS,
            PremiumBondsError::InvalidFeeConfig
        );
        Ok(())
    }

    /// Validates maximum allowable yield velocity basis points.
    pub fn validate_max_yield_basis_points(max_yield_basis_points: u16) -> Result<()> {
        require!(
            max_yield_basis_points <= crate::constants::MAX_BASIS_POINTS,
            PremiumBondsError::InvalidMaxYieldBasisPoints
        );
        Ok(())
    }

    /// Validates payout settlement timelock delay in seconds.
    pub fn validate_payout_timelock_seconds(payout_timelock_seconds: u32) -> Result<()> {
        require!(
            payout_timelock_seconds <= crate::constants::MAX_PAYOUT_TIMELOCK_SECONDS,
            PremiumBondsError::InvalidPayoutTimelock
        );
        Ok(())
    }

    /// Validates all prize tiers configuration constraints.
    ///
    /// Validates that:
    /// - The number of tiers is between 1 and `MAX_PRIZE_TIERS`.
    /// - Each tier specifies positive basis points and winner counts.
    /// - The sum of basis points multiplied by the number of winners in each tier equals exactly 10,000.
    /// - The total number of winners does not exceed `MAX_TOTAL_WINNERS`.
    ///
    /// Returns the total number of winners across all tiers on success.
    pub fn validate_prize_tiers(tiers: &[PrizeTier]) -> Result<u32> {
        require!(
            !tiers.is_empty() && tiers.len() <= crate::constants::MAX_PRIZE_TIERS,
            PremiumBondsError::InvalidPrizeTierConfig
        );

        let mut total_winners: u32 = 0;
        let mut total_basis_points: u32 = 0;

        for tier in tiers.iter() {
            require!(
                tier.basis_points > 0 && tier.num_winners > 0,
                PremiumBondsError::InvalidPrizeTierConfig
            );

            total_winners = total_winners
                .checked_add(tier.num_winners)
                .ok_or(PremiumBondsError::MathOverflow)?;

            total_basis_points = total_basis_points
                .checked_add(
                    (tier.basis_points as u32)
                        .checked_mul(tier.num_winners)
                        .ok_or(PremiumBondsError::MathOverflow)?,
                )
                .ok_or(PremiumBondsError::MathOverflow)?;
        }

        require!(
            total_winners as usize <= crate::constants::MAX_TOTAL_WINNERS,
            PremiumBondsError::InvalidPrizeTierConfig
        );

        require!(
            total_basis_points == 10_000,
            PremiumBondsError::BasisPointsMustEqual10000
        );

        Ok(total_winners)
    }

    /// Validates and applies prize tiers to the pool state.
    ///
    /// Sets `prize_tiers_count`, copies the configured tiers, and zero-fills all remaining
    /// unused slots up to `MAX_PRIZE_TIERS` (10).
    ///
    /// Returns the total number of winners across all tiers on success.
    pub fn set_prize_tiers(&mut self, tiers: &[PrizeTier]) -> Result<u32> {
        let total_winners = Self::validate_prize_tiers(tiers)?;
        self.prize_tiers_count = tiers.len() as u8;
        for (i, tier) in tiers.iter().enumerate() {
            self.prize_tiers[i] = *tier;
        }
        for i in tiers.len()..crate::constants::MAX_PRIZE_TIERS {
            self.prize_tiers[i] = PrizeTier {
                num_winners: 0,
                basis_points: 0,
                _padding: [0; 2],
            };
        }
        Ok(total_winners)
    }

    /// Validates all initial configuration parameters for creating a new pool.
    pub fn validate_pool_creation_params(
        bond_price: u64,
        stake_cycle_duration_hrs: i64,
        fee_basis_points: u16,
        max_yield_basis_points: u16,
        payout_timelock_seconds: u32,
        prize_tiers: &[PrizeTier],
    ) -> Result<u32> {
        Self::validate_bond_price(bond_price)?;
        Self::validate_stake_cycle_duration(stake_cycle_duration_hrs)?;
        Self::validate_fee_basis_points(fee_basis_points)?;
        Self::validate_max_yield_basis_points(max_yield_basis_points)?;
        Self::validate_payout_timelock_seconds(payout_timelock_seconds)?;
        Self::validate_prize_tiers(prize_tiers)
    }
}

/// Tracks the winnings balance and claims for an individual user.
///
/// PDA seeds: [b"user_winnings", pool_id.to_le_bytes(), user.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct UserWinnings {
    /// Unclaimed non-reinvested cash-out winnings (in lamports).
    pub unclaimed_non_reinvested_winnings: u64,
    /// Total winnings claimed and disbursed to the user's wallet.
    pub total_claimed: u64,
    /// Total winnings auto-reinvested back into bonds.
    pub total_reinvested: u64,
    /// Pool ID this winnings account belongs to.
    pub pool_id: u32,
    /// User's index position in the pool's TicketRegistry.
    pub registry_entry_index: u32,
    /// Public key of the user who owns these winnings.
    pub user: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}

impl UserWinnings {
    /// Current schema version of the UserWinnings account.
    pub const CURRENT_VERSION: u8 = 1;
    /// Sentinel value indicating the user has no active slot in the TicketRegistry.
    pub const UNASSIGNED_ENTRY_INDEX: u32 = u32::MAX;

    /// Returns true if this account was just created via `init_if_needed`
    /// and has never been populated with user data.
    #[inline]
    pub fn is_uninitialized(&self) -> bool {
        self.user == Pubkey::default()
    }

    /// Returns true if this user has no active slot in the TicketRegistry.
    /// Covers both brand-new users and re-entering users who previously
    /// sold all their bonds (registry_entry_index reset to UNASSIGNED_ENTRY_INDEX).
    #[inline]
    pub fn needs_registry_slot(&self) -> bool {
        self.is_uninitialized() || self.registry_entry_index == Self::UNASSIGNED_ENTRY_INDEX
    }

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

// ─── Unit Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn tier(basis_points: u16, num_winners: u32) -> PrizeTier {
        PrizeTier {
            basis_points,
            num_winners,
            _padding: [0; 2],
        }
    }

    fn default_pool(fee_basis_points: u16, stake_cycle_duration_hrs: i64) -> PrizePool {
        PrizePool {
            vault_authority_bump: 0,
            pool_id: 1,
            token_mint: Pubkey::default(),
            ticket_registry: Pubkey::default(),
            fee_wallet: Pubkey::default(),
            bond_price: 1_000_000,
            stake_cycle_duration_hrs,
            min_yield_threshold: 0,
            fee_basis_points,
            max_yield_basis_points: 0,
            payout_timelock_seconds: 300,
            status: PoolStatus::Active as u8,
            total_deposited_principal: 0,
            current_cycle_end_at: 0,
            is_frozen_for_draw: 0,
            current_draw_cycle_id: 0,
            prize_tiers_count: 0,
            _padding: [0; 3],
            prize_tiers: [PrizeTier { num_winners: 0, basis_points: 0, _padding: [0; 2] }; 10],
            next_redemption_id: 0,
            total_fees_accrued: 0,
            total_fees_withdrawn: 0,
            total_prizes_allocated: 0,
            total_pending_redemptions: 0,
            total_prizes_distributed: 0,
            version: PrizePool::CURRENT_VERSION,
            _reserved: [0; 128],
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizeTier::calculate_prize
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Zero edge cases ───────────────────────────────────────────────────────

    #[test]
    fn prize_zero_pot() {
        assert_eq!(tier(5_000, 1).calculate_prize(0).unwrap(), 0);
    }

    #[test]
    fn prize_zero_basis_points() {
        assert_eq!(tier(0, 1).calculate_prize(1_000_000).unwrap(), 0);
    }

    // ── Percentage correctness ────────────────────────────────────────────────

    #[test]
    fn prize_100_percent() {
        // 10 000 bps = 100 %: prize equals the full pot
        assert_eq!(tier(10_000, 1).calculate_prize(500_000).unwrap(), 500_000);
    }

    #[test]
    fn prize_50_percent() {
        assert_eq!(tier(5_000, 1).calculate_prize(1_000_000).unwrap(), 500_000);
    }

    #[test]
    fn prize_25_percent() {
        assert_eq!(tier(2_500, 1).calculate_prize(1_000_000).unwrap(), 250_000);
    }

    #[test]
    fn prize_10_percent() {
        assert_eq!(tier(1_000, 1).calculate_prize(1_000_000).unwrap(), 100_000);
    }

    #[test]
    fn prize_1_percent() {
        assert_eq!(tier(100, 1).calculate_prize(1_000_000).unwrap(), 10_000);
    }

    #[test]
    fn prize_1_basis_point() {
        // 1 bps of 10 000 = 1
        assert_eq!(tier(1, 1).calculate_prize(10_000).unwrap(), 1);
    }

    // ── Rounding (always truncates) ───────────────────────────────────────────

    #[test]
    fn prize_rounds_down_below_one() {
        // 1 bps of 9 999 = 0.9999 → 0
        assert_eq!(tier(1, 1).calculate_prize(9_999).unwrap(), 0);
    }

    #[test]
    fn prize_rounds_down_fractional() {
        // 1 bps of 19 999 = 1.9999 → 1
        assert_eq!(tier(1, 1).calculate_prize(19_999).unwrap(), 1);
    }

    // ── num_winners does not affect the per-winner prize amount ───────────────

    #[test]
    fn prize_independent_of_num_winners() {
        // calculate_prize returns the tier's total share; callers use it per winner.
        let pot = 2_000_000u64;
        assert_eq!(tier(1_000, 1).calculate_prize(pot).unwrap(), 200_000);
        assert_eq!(tier(1_000, 5).calculate_prize(pot).unwrap(), 200_000);
        assert_eq!(tier(1_000, 50).calculate_prize(pot).unwrap(), 200_000);
    }

    // ── Realistic scenarios ───────────────────────────────────────────────────

    #[test]
    fn prize_typical_jackpot_50_sol() {
        // Jackpot tier (50 %) of 50 SOL (50_000_000_000 lamports) = 25 SOL
        let pot: u64 = 50_000_000_000;
        assert_eq!(tier(5_000, 1).calculate_prize(pot).unwrap(), 25_000_000_000);
    }

    #[test]
    fn prize_consolation_tier_1pct_10_sol() {
        // 1 % of 10 SOL = 0.1 SOL = 100_000_000 lamports
        let pot: u64 = 10_000_000_000;
        assert_eq!(tier(100, 10).calculate_prize(pot).unwrap(), 100_000_000);
    }

    #[test]
    fn prize_no_overflow_for_large_pot() {
        // u128 intermediate must absorb the multiplication without overflow
        let pot: u64 = u64::MAX / 10_000;
        // 10 000 bps returns the full pot
        assert_eq!(tier(10_000, 1).calculate_prize(pot).unwrap(), pot);
    }

    #[test]
    fn prize_multiple_tiers_sum_to_full_pot() {
        // A two-tier config where bps sums to 10 000 should cover the entire pot
        let pot: u64 = 1_000_000;
        let jackpot = tier(7_000, 1).calculate_prize(pot).unwrap(); // 70 %
        let consolation = tier(3_000, 5).calculate_prize(pot).unwrap(); // 30 %
        assert_eq!(jackpot + consolation, pot);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::calculate_fee
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn fee_zero_yield() {
        assert_eq!(default_pool(500, 24).calculate_fee(0).unwrap(), 0);
    }

    #[test]
    fn fee_zero_bps() {
        assert_eq!(default_pool(0, 24).calculate_fee(1_000_000).unwrap(), 0);
    }

    #[test]
    fn fee_100_percent() {
        assert_eq!(default_pool(10_000, 24).calculate_fee(888_888).unwrap(), 888_888);
    }

    #[test]
    fn fee_50_percent() {
        assert_eq!(default_pool(5_000, 24).calculate_fee(1_000_000).unwrap(), 500_000);
    }

    #[test]
    fn fee_typical_250_bps() {
        // 2.5 % of 10 SOL (10_000_000_000 lamports) = 0.25 SOL
        assert_eq!(
            default_pool(250, 24).calculate_fee(10_000_000_000).unwrap(),
            250_000_000
        );
    }

    #[test]
    fn fee_rounds_down() {
        // 1 bps of 9 999 = 0.9999 → 0; 10 000 → 1
        assert_eq!(default_pool(1, 24).calculate_fee(9_999).unwrap(), 0);
        assert_eq!(default_pool(1, 24).calculate_fee(10_000).unwrap(), 1);
    }

    #[test]
    fn fee_large_yield_no_overflow() {
        // 1 % of 1 trillion lamports = 10 billion
        assert_eq!(
            default_pool(100, 24).calculate_fee(1_000_000_000_000).unwrap(),
            10_000_000_000
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::advance_cycle_end_at
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn advance_adds_hours_as_seconds() {
        let mut pool = default_pool(500, 24);
        pool.advance_cycle_end_at(1_000_000_000).unwrap();
        // 24 h × 3 600 s = 86 400 s
        assert_eq!(pool.current_cycle_end_at, 1_000_000_000 + 86_400);
    }

    #[test]
    fn advance_from_zero_timestamp() {
        let mut pool = default_pool(500, 48);
        pool.advance_cycle_end_at(0).unwrap();
        assert_eq!(pool.current_cycle_end_at, 48 * 3_600);
    }

    #[test]
    fn advance_one_hour_cycle() {
        let mut pool = default_pool(500, 1);
        let now = 1_700_000_000i64;
        pool.advance_cycle_end_at(now).unwrap();
        assert_eq!(pool.current_cycle_end_at, now + 3_600);
    }

    #[test]
    fn advance_weekly_cycle() {
        let mut pool = default_pool(500, 168); // 7 days = 168 h
        let now = 1_700_000_000i64;
        pool.advance_cycle_end_at(now).unwrap();
        assert_eq!(pool.current_cycle_end_at, now + 168 * 3_600);
    }

    #[test]
    fn advance_is_not_cumulative_reads_supplied_time() {
        // Each call uses the *supplied* current_time, not the stored value.
        let mut pool = default_pool(500, 24);
        let t1 = 1_000_000_000i64;
        pool.advance_cycle_end_at(t1).unwrap();
        let t2 = pool.current_cycle_end_at; // t1 + 86 400
        pool.advance_cycle_end_at(t2).unwrap(); // supplies t2 as current; adds another 86 400
        assert_eq!(pool.current_cycle_end_at, t1 + 2 * 86_400);
    }

    #[test]
    fn advance_far_future_timestamp_no_overflow() {
        // Year ~2100 (4 102 444 800 s) + 24 h must not overflow i64
        let far_future = 4_102_444_800i64;
        let mut pool = default_pool(500, 24);
        pool.advance_cycle_end_at(far_future).unwrap();
        assert_eq!(pool.current_cycle_end_at, far_future + 86_400);
    }

    #[test]
    fn advance_does_not_mutate_other_fields() {
        let mut pool = default_pool(250, 24);
        pool.total_deposited_principal = 1_234_567;
        pool.advance_cycle_end_at(1_000_000).unwrap();
        assert_eq!(pool.total_deposited_principal, 1_234_567);
        assert_eq!(pool.fee_basis_points, 250);
        assert_eq!(pool.stake_cycle_duration_hrs, 24);
        assert_eq!(pool.pool_id, 1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::validate_buy_bonds
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn buy_bonds_happy_path() {
        let pool = default_pool(500, 24);
        let amount = pool.validate_buy_bonds(5).unwrap();
        assert_eq!(amount, 5 * 1_000_000);
    }

    #[test]
    fn buy_bonds_single_ticket() {
        let pool = default_pool(500, 24);
        let amount = pool.validate_buy_bonds(1).unwrap();
        assert_eq!(amount, 1_000_000);
    }

    #[test]
    fn buy_bonds_at_max_boundary() {
        let pool = default_pool(500, 24);
        let amount = pool.validate_buy_bonds(10).unwrap();
        assert_eq!(amount, 10 * 1_000_000);
    }

    // ── Pool status guards ──────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_pool_paused() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Paused as u8;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        assert_eq!(err, PremiumBondsError::PoolNotActive.into(),);
    }

    #[test]
    fn buy_bonds_fails_pool_closed() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Closed as u8;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        assert_eq!(err, PremiumBondsError::PoolNotActive.into(),);
    }

    // ── Freeze guard ────────────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_frozen_for_draw() {
        let mut pool = default_pool(500, 24);
        pool.is_frozen_for_draw = 1;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        assert_eq!(err, PremiumBondsError::AwaitingRandomnessFreeze.into(),);
    }

    #[test]
    fn buy_bonds_ok_not_frozen() {
        let mut pool = default_pool(500, 24);
        pool.is_frozen_for_draw = 0;
        assert!(pool.validate_buy_bonds(1).is_ok());
    }

    // ── Quantity guards ─────────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_zero_quantity() {
        let pool = default_pool(500, 24);
        let err = pool.validate_buy_bonds(0).unwrap_err();
        assert_eq!(err, PremiumBondsError::InvalidBondQuantity.into(),);
    }

    // ── Amount calculation ───────────────────────────────────────────────────

    #[test]
    fn buy_bonds_amount_matches_price_times_quantity() {
        let mut pool = default_pool(500, 24);
        pool.bond_price = 2_500_000; // 2.5 USDC
        let amount = pool.validate_buy_bonds(3).unwrap();
        assert_eq!(amount, 3 * 2_500_000);
    }

    #[test]
    fn buy_bonds_amount_large_price() {
        let mut pool = default_pool(500, 24);
        pool.bond_price = 1_000_000_000; // 1000 USDC
        let amount = pool.validate_buy_bonds(10).unwrap();
        assert_eq!(amount, 10_000_000_000);
    }

    // ── Guard priority: status checked before freeze ─────────────────────────

    #[test]
    fn buy_bonds_paused_and_frozen_yields_pool_not_active() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Paused as u8;
        pool.is_frozen_for_draw = 1;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        // PoolNotActive is checked first, so that's the error we get
        assert_eq!(err, PremiumBondsError::PoolNotActive.into(),);
    }

    #[test]
    fn buy_bonds_active_but_frozen_yields_freeze_error() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Active as u8;
        pool.is_frozen_for_draw = 1;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        assert_eq!(err, PremiumBondsError::AwaitingRandomnessFreeze.into(),);
    }

    #[test]
    fn buy_bonds_fails_principal_overflow() {
        let mut pool = default_pool(500, 24);
        pool.bond_price = 10;
        pool.total_deposited_principal = u64::MAX - 5;
        let err = pool.validate_buy_bonds(1).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UserWinnings Predicate Tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_user_winnings_uninitialized_predicates() {
        let winnings = UserWinnings {
            unclaimed_non_reinvested_winnings: 0,
            total_claimed: 0,
            total_reinvested: 0,
            pool_id: 1,
            registry_entry_index: UserWinnings::UNASSIGNED_ENTRY_INDEX,
            user: Pubkey::default(),
            bump: 254,
            version: UserWinnings::CURRENT_VERSION,
            _reserved: [0; 64],
        };
        assert!(winnings.is_uninitialized());
        assert!(winnings.needs_registry_slot());
    }

    #[test]
    fn test_user_winnings_active_user_predicates() {
        let winnings = UserWinnings {
            unclaimed_non_reinvested_winnings: 0,
            total_claimed: 0,
            total_reinvested: 0,
            pool_id: 1,
            registry_entry_index: 42,
            user: Pubkey::new_unique(),
            bump: 254,
            version: UserWinnings::CURRENT_VERSION,
            _reserved: [0; 64],
        };
        assert!(!winnings.is_uninitialized());
        assert!(!winnings.needs_registry_slot());
    }

    #[test]
    fn test_user_winnings_reentering_user_predicates() {
        let winnings = UserWinnings {
            unclaimed_non_reinvested_winnings: 100,
            total_claimed: 500,
            total_reinvested: 200,
            pool_id: 1,
            registry_entry_index: UserWinnings::UNASSIGNED_ENTRY_INDEX,
            user: Pubkey::new_unique(),
            bump: 254,
            version: UserWinnings::CURRENT_VERSION,
            _reserved: [0; 64],
        };
        assert!(!winnings.is_uninitialized());
        assert!(winnings.needs_registry_slot());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Parameter Validation Tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_validate_bond_price() {
        assert!(PrizePool::validate_bond_price(1).is_ok());
        assert!(PrizePool::validate_bond_price(1_000_000).is_ok());
        assert_eq!(
            PrizePool::validate_bond_price(0).unwrap_err(),
            PremiumBondsError::InvalidBondPrice.into()
        );
    }

    #[test]
    fn test_validate_stake_cycle_duration() {
        assert!(PrizePool::validate_stake_cycle_duration(1).is_ok());
        assert!(PrizePool::validate_stake_cycle_duration(24).is_ok());
        assert!(PrizePool::validate_stake_cycle_duration(8760).is_ok());
        assert_eq!(
            PrizePool::validate_stake_cycle_duration(0).unwrap_err(),
            PremiumBondsError::InvalidStakeCycleDuration.into()
        );
        assert_eq!(
            PrizePool::validate_stake_cycle_duration(-1).unwrap_err(),
            PremiumBondsError::InvalidStakeCycleDuration.into()
        );
        assert_eq!(
            PrizePool::validate_stake_cycle_duration(8761).unwrap_err(),
            PremiumBondsError::InvalidStakeCycleDuration.into()
        );
    }

    #[test]
    fn test_validate_fee_basis_points() {
        assert!(PrizePool::validate_fee_basis_points(0).is_ok());
        assert!(PrizePool::validate_fee_basis_points(100).is_ok());
        assert!(PrizePool::validate_fee_basis_points(10_000).is_ok());
        assert_eq!(
            PrizePool::validate_fee_basis_points(10_001).unwrap_err(),
            PremiumBondsError::InvalidFeeConfig.into()
        );
    }

    #[test]
    fn test_validate_max_yield_basis_points() {
        assert!(PrizePool::validate_max_yield_basis_points(0).is_ok());
        assert!(PrizePool::validate_max_yield_basis_points(500).is_ok());
        assert!(PrizePool::validate_max_yield_basis_points(10_000).is_ok());
        assert_eq!(
            PrizePool::validate_max_yield_basis_points(10_001).unwrap_err(),
            PremiumBondsError::InvalidMaxYieldBasisPoints.into()
        );
    }

    #[test]
    fn test_validate_payout_timelock_seconds() {
        assert!(PrizePool::validate_payout_timelock_seconds(0).is_ok());
        assert!(PrizePool::validate_payout_timelock_seconds(300).is_ok());
        assert!(PrizePool::validate_payout_timelock_seconds(86_400).is_ok());
        assert_eq!(
            PrizePool::validate_payout_timelock_seconds(86_401).unwrap_err(),
            PremiumBondsError::InvalidPayoutTimelock.into()
        );
    }

    #[test]
    fn test_validate_pool_creation_params() {
        let valid_tiers = [PrizeTier::default_single_winner()];
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 24, 100, 500, 300, &valid_tiers).unwrap(),
            1
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(0, 24, 100, 500, 300, &valid_tiers).unwrap_err(),
            PremiumBondsError::InvalidBondPrice.into()
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 0, 100, 500, 300, &valid_tiers).unwrap_err(),
            PremiumBondsError::InvalidStakeCycleDuration.into()
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 24, 10_001, 500, 300, &valid_tiers).unwrap_err(),
            PremiumBondsError::InvalidFeeConfig.into()
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 24, 100, 10_001, 300, &valid_tiers).unwrap_err(),
            PremiumBondsError::InvalidMaxYieldBasisPoints.into()
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 24, 100, 500, 86_401, &valid_tiers).unwrap_err(),
            PremiumBondsError::InvalidPayoutTimelock.into()
        );
        assert_eq!(
            PrizePool::validate_pool_creation_params(1_000_000, 24, 100, 500, 300, &[]).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );
    }

    #[test]
    fn test_validate_prize_tiers_success() {
        let single_tier = [PrizeTier::default_single_winner()];
        assert_eq!(PrizePool::validate_prize_tiers(&single_tier).unwrap(), 1);

        let multi_tier = [
            PrizeTier::new(1, 5000),
            PrizeTier::new(5, 1000),
        ];
        assert_eq!(PrizePool::validate_prize_tiers(&multi_tier).unwrap(), 6);
    }

    #[test]
    fn test_validate_prize_tiers_failures() {
        // Empty tiers
        assert_eq!(
            PrizePool::validate_prize_tiers(&[]).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );

        // Exceeding 10 tiers
        let eleven_tiers = vec![PrizeTier::new(1, 909); 11];
        assert_eq!(
            PrizePool::validate_prize_tiers(&eleven_tiers).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );

        // Zero winners in tier
        let zero_winners = [PrizeTier::new(0, 10_000)];
        assert_eq!(
            PrizePool::validate_prize_tiers(&zero_winners).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );

        // Zero basis points in tier
        let zero_bps = [PrizeTier::new(1, 0)];
        assert_eq!(
            PrizePool::validate_prize_tiers(&zero_bps).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );

        // Total basis points != 10000
        let bad_bps = [PrizeTier::new(1, 9999)];
        assert_eq!(
            PrizePool::validate_prize_tiers(&bad_bps).unwrap_err(),
            PremiumBondsError::BasisPointsMustEqual10000.into()
        );

        // Exceeding max winners (> 50)
        let too_many_winners = [PrizeTier::new(51, 10_000)];
        assert_eq!(
            PrizePool::validate_prize_tiers(&too_many_winners).unwrap_err(),
            PremiumBondsError::InvalidPrizeTierConfig.into()
        );
    }

    #[test]
    fn test_set_prize_tiers_state_mutation() {
        let mut pool = PrizePool {
            vault_authority_bump: 0,
            pool_id: 1,
            token_mint: Pubkey::default(),
            ticket_registry: Pubkey::default(),
            fee_wallet: Pubkey::default(),
            bond_price: 1_000_000,
            stake_cycle_duration_hrs: 24,
            current_cycle_end_at: 0,
            fee_basis_points: 100,
            min_yield_threshold: 0,
            max_yield_basis_points: 0,
            payout_timelock_seconds: 300,
            status: PoolStatus::Active as u8,
            total_deposited_principal: 0,
            is_frozen_for_draw: 0,
            current_draw_cycle_id: 0,
            prize_tiers_count: 0,
            _padding: [0; 3],
            prize_tiers: [PrizeTier { num_winners: 99, basis_points: 99, _padding: [0; 2] }; 10],
            next_redemption_id: 0,
            total_fees_accrued: 0,
            total_fees_withdrawn: 0,
            total_prizes_allocated: 0,
            total_pending_redemptions: 0,
            total_prizes_distributed: 0,
            version: PrizePool::CURRENT_VERSION,
            _reserved: [0; 128],
        };

        let tiers = [
            PrizeTier::new(1, 6000),
            PrizeTier::new(4, 1000),
        ];
        let total_winners = pool.set_prize_tiers(&tiers).unwrap();
        assert_eq!(total_winners, 5);
        assert_eq!(pool.prize_tiers_count, 2);
        assert_eq!(pool.prize_tiers[0], PrizeTier::new(1, 6000));
        assert_eq!(pool.prize_tiers[1], PrizeTier::new(4, 1000));
        // Remaining slots are zeroed
        for i in 2..10 {
            assert_eq!(pool.prize_tiers[i], PrizeTier { num_winners: 0, basis_points: 0, _padding: [0; 2] });
        }
    }

    #[test]
    fn test_record_and_rollback_prize_distribution() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 1_000_000; // committed from harvest

        // Distribution of 999_990 with 10 dust
        pool.record_prize_distribution(999_990, 10).unwrap();
        assert_eq!(pool.total_prizes_allocated, 999_990); // dust deducted
        assert_eq!(pool.total_prizes_distributed, 999_990);

        // Next cycle distribution of 500_000 with 0 dust
        pool.total_prizes_allocated += 500_000;
        pool.record_prize_distribution(500_000, 0).unwrap();
        assert_eq!(pool.total_prizes_allocated, 1_499_990);
        assert_eq!(pool.total_prizes_distributed, 1_499_990); // accumulated

        // Admin voids the last draw (reverses 500_000)
        pool.rollback_prize_distribution(500_000).unwrap();
        assert_eq!(pool.total_prizes_allocated, 999_990);
        assert_eq!(pool.total_prizes_distributed, 999_990); // decremented
    }

    #[test]
    fn test_record_prize_distribution_overflow() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 1_000_000;
        pool.total_prizes_distributed = u64::MAX - 100;

        // Distributing 101 must fail on math overflow
        let err = pool.record_prize_distribution(101, 0).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    #[test]
    fn test_record_prize_distribution_dust_exceeds_allocated_fails() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 50;

        // Dust of 51 exceeds allocated 50
        let err = pool.record_prize_distribution(100, 51).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    #[test]
    fn test_record_prize_distribution_dust_exact_match() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 50;

        // Dust exactly matches allocated
        pool.record_prize_distribution(100, 50).unwrap();
        assert_eq!(pool.total_prizes_allocated, 0);
        assert_eq!(pool.total_prizes_distributed, 100);
    }

    #[test]
    fn test_rollback_prize_distribution_underflow() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 100;
        pool.total_prizes_distributed = 50;

        // Rolling back 51 when distributed is 50 must fail
        let err = pool.rollback_prize_distribution(51).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    #[test]
    fn test_rollback_prize_distribution_exceeds_allocated_fails() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 50;
        pool.total_prizes_distributed = 100;

        // Rolling back 51 when allocated is 50 must fail
        let err = pool.rollback_prize_distribution(51).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    #[test]
    fn test_rollback_prize_distribution_exact_zero_reset() {
        let mut pool = default_pool(250, 24);
        pool.total_prizes_allocated = 100;
        pool.total_prizes_distributed = 100;

        // Rolling back exact amount resets both to 0
        pool.rollback_prize_distribution(100).unwrap();
        assert_eq!(pool.total_prizes_allocated, 0);
        assert_eq!(pool.total_prizes_distributed, 0);
    }
}
