use {
    crate::common::{pda::*, readers::*},
    anchor_lang::{AccountSerialize, Discriminator, Space},
    litesvm::LiteSVM,
    solana_program::pubkey::Pubkey,
    solana_sdk::account::Account,
};

// ─── WinnerTestBuilder ───────────────────────────────────────────────────────

pub struct WinnerTestBuilder {
    winner: anchor::Winner,
}

impl WinnerTestBuilder {
    pub fn new() -> Self {
        Self {
            winner: anchor::Winner {
                winner: Pubkey::default(),
                amount_owed: 0,
                bonds_bought: 0,
                processed: 0,
                tier_index: 0,
                version: anchor::Winner::CURRENT_VERSION,
                _padding: [0; 1],
                _reserved: [0; 8],
            },
        }
    }

    pub fn with_winner(mut self, winner: Pubkey) -> Self {
        self.winner.winner = winner;
        self
    }

    pub fn with_amount_owed(mut self, amount_owed: u64) -> Self {
        self.winner.amount_owed = amount_owed;
        self
    }

    pub fn with_bonds_bought(mut self, bonds_bought: u32) -> Self {
        self.winner.bonds_bought = bonds_bought;
        self
    }

    pub fn with_processed(mut self, processed: bool) -> Self {
        self.winner.processed = if processed { 1 } else { 0 };
        self
    }

    pub fn with_tier_index(mut self, tier_index: u8) -> Self {
        self.winner.tier_index = tier_index;
        self
    }

    pub fn with_version(mut self, version: u8) -> Self {
        self.winner.version = version;
        self
    }

    pub fn build(self) -> anchor::Winner {
        self.winner
    }

    pub fn default_winner(winner: Pubkey, amount_owed: u64, tier_index: u8) -> anchor::Winner {
        Self::new()
            .with_winner(winner)
            .with_amount_owed(amount_owed)
            .with_tier_index(tier_index)
            .build()
    }
}

// ─── UserEntryTestBuilder ───────────────────────────────────────────────────

pub struct UserEntryTestBuilder {
    entry: anchor::state::UserEntry,
}

impl UserEntryTestBuilder {
    pub fn new() -> Self {
        Self {
            entry: anchor::state::UserEntry {
                owner: Pubkey::default(),
                active: 0,
                pending: 0,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: anchor::state::UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
        }
    }

    pub fn with_owner(mut self, owner: Pubkey) -> Self {
        self.entry.owner = owner;
        self
    }

    pub fn with_active(mut self, active: u32) -> Self {
        self.entry.active = active;
        self
    }

    pub fn with_pending(mut self, pending: u32) -> Self {
        self.entry.pending = pending;
        self
    }

    pub fn with_cumulative_active(mut self, cumulative_active: u32) -> Self {
        self.entry.cumulative_active = cumulative_active;
        self
    }

    pub fn with_merged_through_cycle(mut self, merged_through_cycle: u32) -> Self {
        self.entry.merged_through_cycle = merged_through_cycle;
        self
    }

    pub fn with_version(mut self, version: u8) -> Self {
        self.entry.version = version;
        self
    }

    pub fn build(self) -> anchor::state::UserEntry {
        self.entry
    }
}

// ─── PrizePoolTestBuilder ───────────────────────────────────────────────────

pub struct PrizePoolTestBuilder {
    pool: anchor::PrizePool,
}

impl PrizePoolTestBuilder {
    /// Initialize builder populated with existing on-chain pool state
    pub fn from_state(svm: &LiteSVM, pool_id: u32) -> Self {
        let pool = read_pool_state(svm, pool_id);
        Self { pool }
    }

    pub fn from_pool(pool: anchor::PrizePool) -> Self {
        Self { pool }
    }

    pub fn new(pool_id: u32) -> Self {
        let (_, bump) = pool_pda(pool_id);
        Self {
            pool: anchor::PrizePool {
                bond_price: 1_000_000,
                stake_cycle_duration_hrs: 24,
                min_yield_threshold: 0,
                total_deposited_principal: 0,
                current_cycle_end_at: 0,
                next_redemption_id: 0,
                total_fees_accrued: 0,
                total_fees_withdrawn: 0,
                total_prizes_allocated: 0,
                total_pending_redemptions: 0,
                pool_id,
                current_draw_cycle_id: 0,
                fee_basis_points: 100,
                max_yield_basis_points: 0,
                payout_timelock_seconds: 0,
                vault_authority_bump: bump,
                status: anchor::PoolStatus::Active as u8,
                is_frozen_for_draw: 0,
                version: anchor::PrizePool::CURRENT_VERSION,
                prize_tiers_count: 0,
                _padding: [0; 3],
                token_mint: Pubkey::default(),
                ticket_registry: Pubkey::default(),
                fee_wallet: Pubkey::default(),
                huma_pool_state: Pubkey::default(),
                prize_tiers: [anchor::PrizeTier {
                    num_winners: 0,
                    basis_points: 0,
                    _padding: [0, 0],
                }; 10],
                _reserved: [0; 128],
            },
        }
    }

    pub fn with_payout_timelock_seconds(mut self, secs: u32) -> Self {
        self.pool.payout_timelock_seconds = secs;
        self
    }

    pub fn with_min_yield_threshold(mut self, min: u64) -> Self {
        self.pool.min_yield_threshold = min;
        self
    }

    pub fn with_stake_cycle_duration_hrs(mut self, hrs: i64) -> Self {
        self.pool.stake_cycle_duration_hrs = hrs;
        self
    }

    pub fn with_max_yield_basis_points(mut self, max: u16) -> Self {
        self.pool.max_yield_basis_points = max;
        self
    }

    pub fn with_pool_id(mut self, pool_id: u32) -> Self {
        self.pool.pool_id = pool_id;
        let (_, bump) = pool_pda(pool_id);
        self.pool.vault_authority_bump = bump;
        self
    }

    pub fn with_status(mut self, status: anchor::PoolStatus) -> Self {
        self.pool.status = status as u8;
        self
    }

    pub fn with_principal(mut self, principal: u64) -> Self {
        self.pool.total_deposited_principal = principal;
        self
    }

    pub fn with_bond_price(mut self, bond_price: u64) -> Self {
        self.pool.bond_price = bond_price;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.pool.ticket_registry = ticket_registry;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.pool.token_mint = token_mint;
        self
    }

    pub fn with_fee_basis_points(mut self, fee_basis_points: u16) -> Self {
        self.pool.fee_basis_points = fee_basis_points;
        self
    }

    pub fn with_prize_tiers(mut self, prize_tiers: Vec<anchor::PrizeTier>) -> Self {
        let count = prize_tiers.len().min(10);
        self.pool.prize_tiers = [anchor::PrizeTier {
            num_winners: 0,
            basis_points: 0,
            _padding: [0, 0],
        }; 10];
        self.pool.prize_tiers[..count].copy_from_slice(&prize_tiers[..count]);
        self.pool.prize_tiers_count = count as u8;
        self
    }

    pub fn with_prizes_allocated(mut self, total_prizes_allocated: u64) -> Self {
        self.pool.total_prizes_allocated = total_prizes_allocated;
        self
    }

    pub fn with_current_draw_cycle_id(mut self, cycle_id: u32) -> Self {
        self.pool.current_draw_cycle_id = cycle_id;
        self
    }

    pub fn with_version(mut self, version: u8) -> Self {
        self.pool.version = version;
        self
    }

    pub fn with_frozen(mut self, frozen: bool) -> Self {
        self.pool.is_frozen_for_draw = if frozen { 1 } else { 0 };
        self
    }

    pub fn with_fees_accrued(mut self, fees: u64) -> Self {
        self.pool.total_fees_accrued = fees;
        self
    }

    pub fn with_fees_withdrawn(mut self, fees: u64) -> Self {
        self.pool.total_fees_withdrawn = fees;
        self
    }

    pub fn with_next_redemption_id(mut self, next_id: u64) -> Self {
        self.pool.next_redemption_id = next_id;
        self
    }

    pub fn with_pending_redemptions(mut self, pending: u64) -> Self {
        self.pool.total_pending_redemptions = pending;
        self
    }

    pub fn with_fee_wallet(mut self, fee_wallet: Pubkey) -> Self {
        self.pool.fee_wallet = fee_wallet;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.pool.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_cycle_end_at(mut self, current_cycle_end_at: i64) -> Self {
        self.pool.current_cycle_end_at = current_cycle_end_at;
        self
    }

    pub fn with_solvency_state(
        mut self,
        principal: u64,
        allocated_prizes: u64,
        accrued_fees: u64,
    ) -> Self {
        self.pool.total_deposited_principal = principal;
        self.pool.total_prizes_allocated = allocated_prizes;
        self.pool.total_fees_accrued = accrued_fees;
        self
    }

    pub fn build(self) -> anchor::PrizePool {
        self.pool
    }

    pub fn inject(self, svm: &mut LiteSVM) -> (Pubkey, anchor::PrizePool) {
        let pool = self.pool;
        let (pda, _) = pool_pda(pool.pool_id);
        let mut data = Vec::with_capacity(8 + std::mem::size_of::<anchor::PrizePool>());
        data.extend_from_slice(anchor::PrizePool::DISCRIMINATOR);
        data.extend_from_slice(bytemuck::bytes_of(&pool));

        let lamports = svm.minimum_balance_for_rent_exemption(data.len());
        svm.set_account(
            pda,
            Account {
                lamports,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("Injecting PrizePool account into LiteSVM must succeed");

        (pda, pool)
    }
}

// ─── DrawCycleTestBuilder (Borsh Serialized) ────────────────────────────────

pub struct DrawCycleTestBuilder {
    cycle: anchor::DrawCycle,
}

impl DrawCycleTestBuilder {
    pub fn new(pool_id: u32, cycle_id: u32) -> Self {
        Self {
            cycle: anchor::DrawCycle {
                prize_pot: 0,
                cycle_fee_collected: 0,
                harvest_slot: 0,
                initiated_at: 1_700_000_000,
                completed_at: 0,
                randomness_account: Pubkey::default(),
                pool_id,
                cycle_id,
                locked_ticket_count: 0,
                status: anchor::DrawStatus::AwaitingYield,
                version: anchor::DrawCycle::CURRENT_VERSION,
                randomness_seed: [0u8; 32],
                _reserved: [0; 64],
            },
        }
    }

    pub fn with_status(mut self, status: anchor::DrawStatus) -> Self {
        self.cycle.status = status;
        self
    }

    pub fn with_prize_pot(mut self, prize_pot: u64) -> Self {
        self.cycle.prize_pot = prize_pot;
        self
    }

    pub fn with_cycle_fee(mut self, fee: u64) -> Self {
        self.cycle.cycle_fee_collected = fee;
        self
    }

    pub fn with_locked_tickets(mut self, count: u32) -> Self {
        self.cycle.locked_ticket_count = count;
        self
    }

    pub fn with_randomness_seed(mut self, seed: [u8; 32]) -> Self {
        self.cycle.randomness_seed = seed;
        self
    }

    pub fn with_randomness_account(mut self, randomness_account: Pubkey) -> Self {
        self.cycle.randomness_account = randomness_account;
        self
    }

    pub fn with_mock_randomness(mut self, svm: &mut LiteSVM) -> Self {
        let rand_pk = Pubkey::new_unique();
        let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
        let owner_pubkey = Pubkey::new_from_array(owner_bytes);
        svm.set_account(
            rand_pk,
            Account {
                lamports: 1_000_000_000,
                data: vec![0u8; 1000],
                owner: owner_pubkey,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        self.cycle.randomness_account = rand_pk;
        self
    }

    pub fn with_initiated_at(mut self, initiated_at: i64) -> Self {
        self.cycle.initiated_at = initiated_at;
        self
    }

    pub fn with_harvest_slot(mut self, slot: u64) -> Self {
        self.cycle.harvest_slot = slot;
        self
    }

    pub fn build(self) -> anchor::DrawCycle {
        self.cycle
    }

    pub fn inject(self, svm: &mut LiteSVM) -> (Pubkey, anchor::DrawCycle) {
        let cycle = self.cycle;
        let (pda, _) = draw_cycle_pda(cycle.pool_id, cycle.cycle_id);
        let mut data = Vec::new();
        cycle
            .try_serialize(&mut data)
            .expect("DrawCycle serialization must succeed");
        data.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);

        let lamports = svm.minimum_balance_for_rent_exemption(data.len());
        svm.set_account(
            pda,
            Account {
                lamports,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("Injecting DrawCycle account into LiteSVM must succeed");

        (pda, cycle)
    }
}

// ─── PayoutRegistryTestBuilder (Zero-Copy) ──────────────────────────────────

pub struct PayoutRegistryTestBuilder {
    pool_id: u32,
    cycle_id: u32,
    winners: Vec<anchor::Winner>,
    payouts_completed: u32,
    revealed_at: i64,
    status: anchor::state::PayoutRegistryStatus,
    version: u8,
}

impl PayoutRegistryTestBuilder {
    pub fn from_state(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> Self {
        let header = read_payout_registry(svm, pool_id, cycle_id);
        let winners = read_payout_winners(svm, pool_id, cycle_id);
        Self {
            pool_id,
            cycle_id,
            winners,
            payouts_completed: header.payouts_completed,
            revealed_at: header.revealed_at,
            status: match header.status {
                1 => anchor::state::PayoutRegistryStatus::Voided,
                _ => anchor::state::PayoutRegistryStatus::Active,
            },
            version: header.version,
        }
    }

    pub fn new(pool_id: u32, cycle_id: u32) -> Self {
        Self {
            pool_id,
            cycle_id,
            winners: Vec::new(),
            payouts_completed: 0,
            revealed_at: 1_700_000_000,
            status: anchor::state::PayoutRegistryStatus::Active,
            version: anchor::PayoutRegistry::CURRENT_VERSION,
        }
    }

    pub fn with_version(mut self, version: u8) -> Self {
        self.version = version;
        self
    }

    pub fn with_winners(mut self, winners: Vec<anchor::Winner>) -> Self {
        self.winners = winners;
        self
    }

    pub fn with_payouts_completed(mut self, completed: u32) -> Self {
        self.payouts_completed = completed;
        self
    }

    pub fn with_status(mut self, status: anchor::state::PayoutRegistryStatus) -> Self {
        self.status = status;
        self
    }

    pub fn with_revealed_at(mut self, revealed_at: i64) -> Self {
        self.revealed_at = revealed_at;
        self
    }

    pub fn inject(self, svm: &mut LiteSVM) -> (Pubkey, anchor::PayoutRegistry) {
        let (pda, _) = payout_pda(self.pool_id, self.cycle_id);
        let header = anchor::PayoutRegistry {
            pool_id: self.pool_id,
            cycle_id: self.cycle_id,
            winners_count: self.winners.len() as u32,
            payouts_completed: self.payouts_completed,
            revealed_at: self.revealed_at,
            status: self.status as u8,
            version: self.version,
            _padding: [0; 6],
            _reserved: [0; 64],
        };

        let mut data = Vec::with_capacity(
            8 + std::mem::size_of::<anchor::PayoutRegistry>()
                + (self.winners.len() * std::mem::size_of::<anchor::Winner>()),
        );
        data.extend_from_slice(anchor::PayoutRegistry::DISCRIMINATOR);
        data.extend_from_slice(bytemuck::bytes_of(&header));
        data.extend_from_slice(bytemuck::cast_slice(&self.winners));

        let lamports = svm.minimum_balance_for_rent_exemption(data.len());
        svm.set_account(
            pda,
            Account {
                lamports,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("Injecting PayoutRegistry into LiteSVM must succeed");

        (pda, header)
    }
}

// ─── UserWinningsTestBuilder (Borsh Serialized) ─────────────────────────────

pub struct UserWinningsTestBuilder {
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    claimed: u64,
    reinvested: u64,
    registry_entry_index: u32,
    custom_bump: Option<u8>,
}

impl UserWinningsTestBuilder {
    pub fn new(pool_id: u32, user: Pubkey) -> Self {
        Self {
            pool_id,
            user,
            unclaimed: 0,
            claimed: 0,
            reinvested: 0,
            registry_entry_index: anchor::UserWinnings::UNASSIGNED_ENTRY_INDEX,
            custom_bump: None,
        }
    }

    pub fn with_bump(mut self, bump: u8) -> Self {
        self.custom_bump = Some(bump);
        self
    }

    pub fn with_unclaimed(mut self, unclaimed: u64) -> Self {
        self.unclaimed = unclaimed;
        self
    }

    pub fn with_claimed(mut self, claimed: u64) -> Self {
        self.claimed = claimed;
        self
    }

    pub fn with_reinvested(mut self, reinvested: u64) -> Self {
        self.reinvested = reinvested;
        self
    }

    pub fn with_registry_entry_index(mut self, index: u32) -> Self {
        self.registry_entry_index = index;
        self
    }

    pub fn build(self) -> anchor::UserWinnings {
        let bump = self
            .custom_bump
            .unwrap_or_else(|| user_winnings_pda(self.pool_id, &self.user).1);
        anchor::UserWinnings {
            unclaimed_non_reinvested_winnings: self.unclaimed,
            total_claimed: self.claimed,
            total_reinvested: self.reinvested,
            pool_id: self.pool_id,
            registry_entry_index: self.registry_entry_index,
            user: self.user,
            bump,
            version: anchor::UserWinnings::CURRENT_VERSION,
            _reserved: [0; 64],
        }
    }

    pub fn inject_at(self, svm: &mut LiteSVM, address: Pubkey) -> (Pubkey, anchor::UserWinnings) {
        let bump = self
            .custom_bump
            .unwrap_or_else(|| user_winnings_pda(self.pool_id, &self.user).1);
        let winnings = anchor::UserWinnings {
            unclaimed_non_reinvested_winnings: self.unclaimed,
            total_claimed: self.claimed,
            total_reinvested: self.reinvested,
            pool_id: self.pool_id,
            registry_entry_index: self.registry_entry_index,
            user: self.user,
            bump,
            version: anchor::UserWinnings::CURRENT_VERSION,
            _reserved: [0; 64],
        };
        let mut data = Vec::new();
        winnings
            .try_serialize(&mut data)
            .expect("UserWinnings serialization must succeed");
        data.resize(8 + anchor::UserWinnings::INIT_SPACE, 0);

        let lamports = svm.minimum_balance_for_rent_exemption(data.len());
        svm.set_account(
            address,
            Account {
                lamports,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("Injecting UserWinnings account into LiteSVM must succeed");

        (address, winnings)
    }

    pub fn inject(self, svm: &mut LiteSVM) -> (Pubkey, anchor::UserWinnings) {
        let (pda, _) = user_winnings_pda(self.pool_id, &self.user);
        self.inject_at(svm, pda)
    }
}
