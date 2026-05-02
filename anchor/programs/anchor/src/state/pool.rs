use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PoolStatus {
    Active,
    Paused,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PrizeTier {
    pub basis_points: u16, // share of yield each winner in this tier receives
    pub num_winners: u32,  // number of winners in this tier
}

impl PrizeTier {
    pub fn calculate_prize(&self, prize_pot: u64) -> u64 {
        (prize_pot as u128)
            .checked_mul(self.basis_points as u128)
            .unwrap()
            .checked_div(10_000)
            .unwrap() as u64
    }
}

#[account]
#[derive(InitSpace)]
pub struct PrizePool {
    pub vault_authority_bump: u8,
    pub pool_id: u32,
    pub token_mint: Pubkey,
    pub ticket_registry: Pubkey, // Pointer to the massive zero-copy registry
    pub fee_wallet: Pubkey,
    pub bond_price: u64,
    pub stake_cycle_duration_hrs: i64,
    pub fee_basis_points: u16,
    pub status: PoolStatus,
    pub total_deposited_principal: u64,
    pub total_fees_collected: u64,
    pub current_cycle_end_at: i64,
    pub is_frozen_for_draw: bool,
    pub current_draw_cycle_id: u32,
    pub max_withdrawal_slippage_dust: u64,
    #[max_len(10)]
    pub prize_tiers: Vec<PrizeTier>,
    pub auto_reinvest_default: bool,
}

use crate::utils::calculate_percentage_fee;
use crate::error::PremiumBondsError;

impl PrizePool {
    pub fn calculate_fee(&self, yield_amount: u64) -> u64 {
        calculate_percentage_fee(yield_amount, self.fee_basis_points)
    }

    pub fn advance_cycle_end_at(&mut self, current_time: i64) {
        self.current_cycle_end_at = current_time
            .checked_add(self.stake_cycle_duration_hrs.checked_mul(3600).unwrap())
            .unwrap();
    }

    /// Validates all pre-CPI guard checks for the `buy_bonds` instruction.
    ///
    /// These checks run before any token transfers or Kamino CPI calls.
    /// Extracted here so they can be unit-tested without a full Anchor context.
    pub fn validate_buy_bonds(
        &self,
        bonds_to_buy: u32,
        max_tickets_per_buy: u32,
    ) -> Result<u64> {
        require!(
            self.status == PoolStatus::Active,
            PremiumBondsError::PoolNotActive
        );
        require!(
            !self.is_frozen_for_draw,
            PremiumBondsError::AwaitingRandomnessFreeze
        );
        require!(bonds_to_buy > 0, PremiumBondsError::InvalidBondQuantity);
        require!(
            bonds_to_buy <= max_tickets_per_buy,
            PremiumBondsError::MaxTicketsPerBuyExceeded
        );
        let amount = (bonds_to_buy as u64)
            .checked_mul(self.bond_price)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(amount)
    }

    /// Validates that the registry has enough capacity for `bonds_to_buy` new tickets.
    ///
    /// This check runs after the CPI calls succeed, before writing ticket data.
    pub fn validate_registry_capacity(
        bonds_to_buy: u32,
        active_count: u32,
        pending_count: u32,
        capacity: u32,
    ) -> Result<()> {
        let current_total = active_count + pending_count;
        require!(
            current_total + bonds_to_buy <= capacity,
            PremiumBondsError::RegistryFull
        );
        Ok(())
    }
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn tier(basis_points: u16, num_winners: u32) -> PrizeTier {
        PrizeTier { basis_points, num_winners }
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
            fee_basis_points,
            status: PoolStatus::Active,
            total_deposited_principal: 0,
            total_fees_collected: 0,
            current_cycle_end_at: 0,
            is_frozen_for_draw: false,
            current_draw_cycle_id: 0,
            max_withdrawal_slippage_dust: 0,
            prize_tiers: vec![],
            auto_reinvest_default: false,
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizeTier::calculate_prize
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Zero edge cases ───────────────────────────────────────────────────────

    #[test]
    fn prize_zero_pot() {
        assert_eq!(tier(5_000, 1).calculate_prize(0), 0);
    }

    #[test]
    fn prize_zero_basis_points() {
        assert_eq!(tier(0, 1).calculate_prize(1_000_000), 0);
    }

    // ── Percentage correctness ────────────────────────────────────────────────

    #[test]
    fn prize_100_percent() {
        // 10 000 bps = 100 %: prize equals the full pot
        assert_eq!(tier(10_000, 1).calculate_prize(500_000), 500_000);
    }

    #[test]
    fn prize_50_percent() {
        assert_eq!(tier(5_000, 1).calculate_prize(1_000_000), 500_000);
    }

    #[test]
    fn prize_25_percent() {
        assert_eq!(tier(2_500, 1).calculate_prize(1_000_000), 250_000);
    }

    #[test]
    fn prize_10_percent() {
        assert_eq!(tier(1_000, 1).calculate_prize(1_000_000), 100_000);
    }

    #[test]
    fn prize_1_percent() {
        assert_eq!(tier(100, 1).calculate_prize(1_000_000), 10_000);
    }

    #[test]
    fn prize_1_basis_point() {
        // 1 bps of 10 000 = 1
        assert_eq!(tier(1, 1).calculate_prize(10_000), 1);
    }

    // ── Rounding (always truncates) ───────────────────────────────────────────

    #[test]
    fn prize_rounds_down_below_one() {
        // 1 bps of 9 999 = 0.9999 → 0
        assert_eq!(tier(1, 1).calculate_prize(9_999), 0);
    }

    #[test]
    fn prize_rounds_down_fractional() {
        // 1 bps of 19 999 = 1.9999 → 1
        assert_eq!(tier(1, 1).calculate_prize(19_999), 1);
    }

    // ── num_winners does not affect the per-winner prize amount ───────────────

    #[test]
    fn prize_independent_of_num_winners() {
        // calculate_prize returns the tier's total share; callers use it per winner.
        let pot = 2_000_000u64;
        assert_eq!(tier(1_000, 1).calculate_prize(pot), 200_000);
        assert_eq!(tier(1_000, 5).calculate_prize(pot), 200_000);
        assert_eq!(tier(1_000, 50).calculate_prize(pot), 200_000);
    }

    // ── Realistic scenarios ───────────────────────────────────────────────────

    #[test]
    fn prize_typical_jackpot_50_sol() {
        // Jackpot tier (50 %) of 50 SOL (50_000_000_000 lamports) = 25 SOL
        let pot: u64 = 50_000_000_000;
        assert_eq!(tier(5_000, 1).calculate_prize(pot), 25_000_000_000);
    }

    #[test]
    fn prize_consolation_tier_1pct_10_sol() {
        // 1 % of 10 SOL = 0.1 SOL = 100_000_000 lamports
        let pot: u64 = 10_000_000_000;
        assert_eq!(tier(100, 10).calculate_prize(pot), 100_000_000);
    }

    #[test]
    fn prize_no_overflow_for_large_pot() {
        // u128 intermediate must absorb the multiplication without overflow
        let pot: u64 = u64::MAX / 10_000;
        // 10 000 bps returns the full pot
        assert_eq!(tier(10_000, 1).calculate_prize(pot), pot);
    }

    #[test]
    fn prize_multiple_tiers_sum_to_full_pot() {
        // A two-tier config where bps sums to 10 000 should cover the entire pot
        let pot: u64 = 1_000_000;
        let jackpot = tier(7_000, 1).calculate_prize(pot); // 70 %
        let consolation = tier(3_000, 5).calculate_prize(pot); // 30 %
        assert_eq!(jackpot + consolation, pot);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::calculate_fee
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn fee_zero_yield() {
        assert_eq!(default_pool(500, 24).calculate_fee(0), 0);
    }

    #[test]
    fn fee_zero_bps() {
        assert_eq!(default_pool(0, 24).calculate_fee(1_000_000), 0);
    }

    #[test]
    fn fee_100_percent() {
        assert_eq!(default_pool(10_000, 24).calculate_fee(888_888), 888_888);
    }

    #[test]
    fn fee_50_percent() {
        assert_eq!(default_pool(5_000, 24).calculate_fee(1_000_000), 500_000);
    }

    #[test]
    fn fee_typical_250_bps() {
        // 2.5 % of 10 SOL (10_000_000_000 lamports) = 0.25 SOL
        assert_eq!(
            default_pool(250, 24).calculate_fee(10_000_000_000),
            250_000_000
        );
    }

    #[test]
    fn fee_rounds_down() {
        // 1 bps of 9 999 = 0.9999 → 0; 10 000 → 1
        assert_eq!(default_pool(1, 24).calculate_fee(9_999), 0);
        assert_eq!(default_pool(1, 24).calculate_fee(10_000), 1);
    }

    #[test]
    fn fee_large_yield_no_overflow() {
        // 1 % of 1 trillion lamports = 10 billion
        assert_eq!(
            default_pool(100, 24).calculate_fee(1_000_000_000_000),
            10_000_000_000
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::advance_cycle_end_at
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn advance_adds_hours_as_seconds() {
        let mut pool = default_pool(500, 24);
        pool.advance_cycle_end_at(1_000_000_000);
        // 24 h × 3 600 s = 86 400 s
        assert_eq!(pool.current_cycle_end_at, 1_000_000_000 + 86_400);
    }

    #[test]
    fn advance_from_zero_timestamp() {
        let mut pool = default_pool(500, 48);
        pool.advance_cycle_end_at(0);
        assert_eq!(pool.current_cycle_end_at, 48 * 3_600);
    }

    #[test]
    fn advance_one_hour_cycle() {
        let mut pool = default_pool(500, 1);
        let now = 1_700_000_000i64;
        pool.advance_cycle_end_at(now);
        assert_eq!(pool.current_cycle_end_at, now + 3_600);
    }

    #[test]
    fn advance_weekly_cycle() {
        let mut pool = default_pool(500, 168); // 7 days = 168 h
        let now = 1_700_000_000i64;
        pool.advance_cycle_end_at(now);
        assert_eq!(pool.current_cycle_end_at, now + 168 * 3_600);
    }

    #[test]
    fn advance_is_not_cumulative_reads_supplied_time() {
        // Each call uses the *supplied* current_time, not the stored value.
        let mut pool = default_pool(500, 24);
        let t1 = 1_000_000_000i64;
        pool.advance_cycle_end_at(t1);
        let t2 = pool.current_cycle_end_at; // t1 + 86 400
        pool.advance_cycle_end_at(t2);       // supplies t2 as current; adds another 86 400
        assert_eq!(pool.current_cycle_end_at, t1 + 2 * 86_400);
    }

    #[test]
    fn advance_far_future_timestamp_no_overflow() {
        // Year ~2100 (4 102 444 800 s) + 24 h must not overflow i64
        let far_future = 4_102_444_800i64;
        let mut pool = default_pool(500, 24);
        pool.advance_cycle_end_at(far_future);
        assert_eq!(pool.current_cycle_end_at, far_future + 86_400);
    }

    #[test]
    fn advance_does_not_mutate_other_fields() {
        let mut pool = default_pool(250, 24);
        pool.total_deposited_principal = 1_234_567;
        pool.advance_cycle_end_at(1_000_000);
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
        let amount = pool.validate_buy_bonds(5, 10).unwrap();
        assert_eq!(amount, 5 * 1_000_000);
    }

    #[test]
    fn buy_bonds_single_ticket() {
        let pool = default_pool(500, 24);
        let amount = pool.validate_buy_bonds(1, 10).unwrap();
        assert_eq!(amount, 1_000_000);
    }

    #[test]
    fn buy_bonds_at_max_boundary() {
        let pool = default_pool(500, 24);
        let amount = pool.validate_buy_bonds(10, 10).unwrap();
        assert_eq!(amount, 10 * 1_000_000);
    }

    // ── Pool status guards ──────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_pool_paused() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Paused;
        let err = pool.validate_buy_bonds(1, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::PoolNotActive.into(),
        );
    }

    #[test]
    fn buy_bonds_fails_pool_closed() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Closed;
        let err = pool.validate_buy_bonds(1, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::PoolNotActive.into(),
        );
    }

    // ── Freeze guard ────────────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_frozen_for_draw() {
        let mut pool = default_pool(500, 24);
        pool.is_frozen_for_draw = true;
        let err = pool.validate_buy_bonds(1, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::AwaitingRandomnessFreeze.into(),
        );
    }

    #[test]
    fn buy_bonds_ok_not_frozen() {
        let mut pool = default_pool(500, 24);
        pool.is_frozen_for_draw = false;
        assert!(pool.validate_buy_bonds(1, 10).is_ok());
    }

    // ── Quantity guards ─────────────────────────────────────────────────────

    #[test]
    fn buy_bonds_fails_zero_quantity() {
        let pool = default_pool(500, 24);
        let err = pool.validate_buy_bonds(0, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::InvalidBondQuantity.into(),
        );
    }

    #[test]
    fn buy_bonds_fails_exceeds_max_tickets() {
        let pool = default_pool(500, 24);
        let err = pool.validate_buy_bonds(11, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::MaxTicketsPerBuyExceeded.into(),
        );
    }

    #[test]
    fn buy_bonds_fails_way_over_max_tickets() {
        let pool = default_pool(500, 24);
        let err = pool.validate_buy_bonds(100, 5).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::MaxTicketsPerBuyExceeded.into(),
        );
    }

    // ── Amount calculation ───────────────────────────────────────────────────

    #[test]
    fn buy_bonds_amount_matches_price_times_quantity() {
        let mut pool = default_pool(500, 24);
        pool.bond_price = 2_500_000; // 2.5 USDC
        let amount = pool.validate_buy_bonds(3, 10).unwrap();
        assert_eq!(amount, 3 * 2_500_000);
    }

    #[test]
    fn buy_bonds_amount_large_price() {
        let mut pool = default_pool(500, 24);
        pool.bond_price = 1_000_000_000; // 1000 USDC
        let amount = pool.validate_buy_bonds(10, 10).unwrap();
        assert_eq!(amount, 10_000_000_000);
    }

    // ── Guard priority: status checked before freeze ─────────────────────────

    #[test]
    fn buy_bonds_paused_and_frozen_yields_pool_not_active() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Paused;
        pool.is_frozen_for_draw = true;
        let err = pool.validate_buy_bonds(1, 10).unwrap_err();
        // PoolNotActive is checked first, so that's the error we get
        assert_eq!(
            err,
            PremiumBondsError::PoolNotActive.into(),
        );
    }

    #[test]
    fn buy_bonds_active_but_frozen_yields_freeze_error() {
        let mut pool = default_pool(500, 24);
        pool.status = PoolStatus::Active;
        pool.is_frozen_for_draw = true;
        let err = pool.validate_buy_bonds(1, 10).unwrap_err();
        assert_eq!(
            err,
            PremiumBondsError::AwaitingRandomnessFreeze.into(),
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PrizePool::validate_registry_capacity
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn registry_capacity_happy_path() {
        assert!(PrizePool::validate_registry_capacity(5, 0, 0, 100).is_ok());
    }

    #[test]
    fn registry_capacity_exact_fit() {
        // 8 active + 0 pending + 2 new = 10 capacity → exact fit
        assert!(PrizePool::validate_registry_capacity(2, 8, 0, 10).is_ok());
    }

    #[test]
    fn registry_capacity_with_pending() {
        // 3 active + 4 pending + 3 new = 10 capacity → exact fit
        assert!(PrizePool::validate_registry_capacity(3, 3, 4, 10).is_ok());
    }

    #[test]
    fn registry_capacity_fails_completely_full() {
        let err = PrizePool::validate_registry_capacity(1, 10, 0, 10).unwrap_err();
        assert_eq!(err, PremiumBondsError::RegistryFull.into());
    }

    #[test]
    fn registry_capacity_fails_insufficient_slots() {
        // 8 active + 0 pending → 2 free, but requesting 3
        let err = PrizePool::validate_registry_capacity(3, 8, 0, 10).unwrap_err();
        assert_eq!(err, PremiumBondsError::RegistryFull.into());
    }

    #[test]
    fn registry_capacity_fails_pending_fills_remaining() {
        // 5 active + 5 pending → 0 free
        let err = PrizePool::validate_registry_capacity(1, 5, 5, 10).unwrap_err();
        assert_eq!(err, PremiumBondsError::RegistryFull.into());
    }

    #[test]
    fn registry_capacity_zero_bonds_always_ok() {
        // Edge case: buying 0 bonds should always pass capacity check
        // (the quantity guard catches this separately)
        assert!(PrizePool::validate_registry_capacity(0, 10, 0, 10).is_ok());
    }

    #[test]
    fn registry_capacity_large_values() {
        // Realistic large pool: 100k capacity, 90k used
        assert!(PrizePool::validate_registry_capacity(100, 50_000, 40_000, 100_000).is_ok());
        let err = PrizePool::validate_registry_capacity(10_001, 50_000, 40_000, 100_000).unwrap_err();
        assert_eq!(err, PremiumBondsError::RegistryFull.into());
    }
}
