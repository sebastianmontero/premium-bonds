TicketRegistry Redesign — Weighted User Entries

## Motivation

The current registry stores one Pubkey per ticket in a flat array. For a user with 50 bonds, that's the same Pubkey repeated 50 times (50 × 32 = 1,600 bytes). Selling requires the  
 client to scan the entire registry off-chain, compute exact slot indices, and hope they don't go stale before the TX lands. This creates a fragile, concurrency-prone sell flow.

The redesign stores one entry per user with ticket counts, eliminating the stale-index problem entirely while shrinking account size 7-13x.  
 ──────

## Data Structures

    #[account(zero_copy(unsafe))]
    #[repr(C)]
    pub struct TicketRegistry {
        pub pool_id: u32,
        pub capacity: u32,              // max user entries (not tickets)
        pub user_count: u32,
        pub total_active_tickets: u32,
        pub total_pending_tickets: u32,
        pub draw_cycle_id: u32,         // current draw cycle — drives lazy merge
        pub draw_prepared_up_to: u32,   // progress cursor for prepare_draw batching
        // Raw bytes: UserEntry[] follows
    }

    #[repr(C)]
    struct UserEntry {                  // 48 bytes
        pub owner: Pubkey,              // 32
        pub active: u32,                // 4
        pub pending: u32,               // 4
        pub merged_through_cycle: u32,  // 4 — lazy merge marker
        pub cumulative_active: u32,     // 4 — prefix sum, built by prepare_draw
    }

    /// Updated UserWinnings PDA (seeds: [b"user_winnings", pool_id, user_pubkey])
    #[account]
    #[derive(InitSpace)]
    pub struct UserWinnings {
        pub pool_id: u32,
        pub user: Pubkey,
        pub unclaimed_non_reinvested_winnings: u64,
        pub total_claimed: u64,
        pub total_reinvested: u64,
        pub bump: u8,
        pub registry_entry_index: u32,  // NEW: u32::MAX (4,294,967,295) = no entry
    }
    ──────

## Instruction Changes

### Buy Bonds

    1. Load user_winnings (initialized via init_if_needed).
    2. If user_winnings.registry_entry_index == u32::MAX:
       a. Append new UserEntry at registry.user_count, set owner = signer.
       b. Set user_winnings.registry_entry_index = registry.user_count.
       c. registry.user_count += 1.
    3. Else:
       a. Use user_entry_index = user_winnings.registry_entry_index.
       b. Verify entries[user_entry_index].owner == signer.
    4. Lazy-merge the entry if stale (see Lazy Merge below).
    5. Increment entry.pending += bonds_to_buy.
    6. total_pending_tickets += bonds_to_buy.

• Accounts: Signer (User), UserWinnings (PDA, mut), TicketRegistry (mut)  
 • Client passes: bonds_to_buy  
 • Duplicate Prevention: Since the UserWinnings PDA is unique to the (pool_id, user) combination, using it to track the registry index ensures a user can never have more than one entry  
 in the registry.

### Sell Bonds

    1. Load user_winnings (PDA, mut).
    2. Retrieve user_entry_index = user_winnings.registry_entry_index.
    3. Verify entries[user_entry_index].owner == signer.
    4. Lazy-merge the entry if stale.
    5. Decrement entry.active / entry.pending by requested amounts.
    6. If entry.active == 0 and entry.pending == 0:
       a. Set user_winnings.registry_entry_index = u32::MAX.
       b. If user_entry_index != registry.user_count - 1 (not the last entry):
          i. Move the last UserEntry (at registry.user_count - 1) to user_entry_index.
          ii. Load the UserWinnings account of the swapped user (passed as a remaining account).
          iii. Update swapped_user_winnings.registry_entry_index = user_entry_index.
       c. Clear slot registry.user_count - 1 to default/zero.
       d. registry.user_count -= 1.
    7. total_active/pending -= amounts.

• Accounts: Signer (User), UserWinnings (PDA, mut), TicketRegistry (mut), Optional remaining account: swapped_user_winnings (mut).  
 • Client passes: active_to_sell: u32, pending_to_sell: u32.  
 • UX Improvement: Index-free parameters from the client. No stale client hints. If a swap-and-pop occurs, the client resolves the swapped user's pubkey from the last index of the  
 registry and passes their UserWinnings PDA as a remaining account. If the client fails to pass it, the transaction fails with a clear, handled error.

### Harvest (merge pending→active) — O(1) via Lazy Merge

    registry.draw_cycle_id += 1
    registry.total_active_tickets += registry.total_pending_tickets
    registry.total_pending_tickets = 0
    registry.draw_prepared_up_to = 0    // reset prepare_draw cursor

The harvest is O(1) — it only touches global counters. Per-user entry merging is deferred (see Lazy Merge below).

### Prepare Draw — Batched Prefix Sum Computation (NEW instruction)

After harvest freezes the pool, a new prepare_draw crank instruction processes user entries in batches to build cumulative prefix sums for the draw:

    prepare_draw(batch_size: u32):
      start = registry.draw_prepared_up_to
      end = min(start + batch_size, registry.user_count)

      cumulative = if start == 0 { 0 } else { entries[start - 1].cumulative_active }

      for i in start..end:
          // Lazy-merge if needed
          if entries[i].merged_through_cycle < registry.draw_cycle_id:
              entries[i].active += entries[i].pending
              entries[i].pending = 0
              entries[i].merged_through_cycle = registry.draw_cycle_id

          cumulative += entries[i].active
          entries[i].cumulative_active = cumulative

      registry.draw_prepared_up_to = end

#### Account Constraints & Safety Guards

    #[derive(Accounts)]
    pub struct PrepareDraw<'info> {
        #[account(mut)]
        pub crank: Signer<'info>,
        #[account(
            mut,
            seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
            bump = pool.vault_authority_bump,
            has_one = ticket_registry,
            constraint = pool.is_frozen_for_draw @ PremiumBondsError::PoolNotFrozen,
        )]
        pub pool: Box<Account<'info, PrizePool>>,
        #[account(
            mut,
            seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.current_draw_cycle_id.to_le_bytes().as_ref()],
            bump,
            constraint = draw_cycle.status == DrawStatus::AwaitingRandomness @ PremiumBondsError::InvalidDrawStatus
        )]
        pub draw_cycle: Box<Account<'info, DrawCycle>>,
        #[account(mut)]
        pub ticket_registry: AccountLoader<'info, TicketRegistry>,
    }

Compute budget per batch:

• Per entry: ~600 CU (read + merge check + prefix sum + write back)  
 • Solana max compute: 1,400,000 CU (with budget instruction)  
 • Overhead (deserialization, etc.): ~100,000 CU  
 • Entries per TX: ~2,100

Users │ prepare_draw TXs needed │ Total crank cost
─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────
1,000 │ 1 │ Trivial
5,000 │ 3 │ ~0.015 SOL
10,000 │ 5 │ ~0.025 SOL
50,000 │ 24 │ ~0.12 SOL

The crank loops prepare_draw until draw_prepared_up_to == user_count, then calls reveal_and_pick_winners.

### Draw (reveal_and_pick_winners) — O(W × log N)

With prefix sums precomputed by prepare_draw, the draw uses binary search:

    // Guard: all entries must be prepared
    require!(registry.draw_prepared_up_to == registry.user_count)

    for each (tier, winner_slot):
        random_index = derive_random_index(seed, tier, slot, cycle, total_active)

        // Binary search: find first entry where cumulative_active > random_index
        lo = 0, hi = user_count - 1
        while lo < hi:
            mid = (lo + hi) / 2
            if entries[mid].cumulative_active <= random_index:
                lo = mid + 1
            else:
                hi = mid
        winner = entries[lo].owner

Compute budget:

• SHA-256 hash per pick: ~5,000 CU  
 • Binary search (log₂ N iterations × ~300 CU): log₂(10,000) × 300 ≈ 4,000 CU  
 • Per winner: ~9,000 CU  
 • For MAX_TOTAL_WINNERS (50): 50 × 9,000 = 450,000 CU — fits comfortably in 1.4M

Users │ CU per winner │ 50 winners total │ Fits in 1 TX?
──────────────────────────────────────────────┼──────────────────────────────────────────────┼─────────────────────────────────────────────┼─────────────────────────────────────────────
1,000 │ ~8,000 │ 400K │ ✅
10,000 │ ~9,000 │ 450K │ ✅
100,000 │ ~10,500 │ 525K │ ✅
218,000 (max) │ ~11,400 │ 570K │ ✅

│ [!NOTE]  
 │ Binary search on prefix sums means the draw fits in a single TX regardless of user count, up to the 10 MB account limit (~218K users).

Fairness: contiguous tickets vs scattered tickets. In this design each user's tickets occupy a contiguous range in the prefix-sum space (e.g. Alice owns indices [0..9], Bob owns  
 [10..14]). This has zero impact on winning probability — the VRF produces a uniform random number mod total_active, so the probability of landing in any user's range is exactly  
 user_active / total_active regardless of whether tickets are contiguous or scattered. The math is identical to the current flat-array design. In fact, even in the current design tickets
are mostly contiguous — when you buy 10 bonds, all 10 pubkeys are written consecutively in the pending region and only get partially scattered over time through swap-and-pop operations
during sells.

Safety Invariants & Limits:

• cumulative_active Overflow: The cumulative_active prefix sum is tracked as a u32 (limit of ~4.29B total tickets). Even at max registry capacity (218K users), this allows an average of
~19,000 tickets per user before overflow, which is far beyond the pool's realistic limits.  
 • Swap-and-Pop Sum Invalidation: Sells modify entry positions and counts, which invalidates the precalculated cumulative_active prefix sums. This is completely safe because buy/sell  
 operations are blocked (pool.is_frozen_for_draw is enforced) throughout the draw window when prepare_draw and reveal_and_pick_winners are active. Prefix sums are built fresh in every  
 draw cycle.

### Reinvest Winnings

    1. Load winner's UserWinnings PDA.
    2. Retrieve user_entry_index = user_winnings.registry_entry_index.
    3. Lazy-merge the entry if stale.
    4. Increment entry.active += reinvested_bonds.

• Accounts: Signer (Crank), UserWinnings (PDA, mut), TicketRegistry (mut)  
 • Uses the winner's UserWinnings.registry_entry_index to find the user entry in O(1). No linear scan or client-side index hint needed.

### Resize

• Same as today but grows by user entries (48 bytes) instead of ticket slots (32 bytes). Much slower growth needed since there are far fewer entries.  
 ──────

## Lazy Merge Mechanism

Each UserEntry has a merged_through_cycle field that tracks the last cycle where its pending tickets were merged into active. The global draw_cycle_id increments at every harvest.

Whenever an instruction touches a user entry (buy, sell, prepare_draw), it first checks:

    if entry.merged_through_cycle < registry.draw_cycle_id {
        entry.active += entry.pending;
        entry.pending = 0;
        entry.merged_through_cycle = registry.draw_cycle_id;
    }

### Edge Case: Sell-After-Harvest Race Condition

If a user buys tickets in cycle N (pending = 5) and prepares a transaction to sell pending tickets (pending_to_sell = 3), but a harvest fires before their transaction lands, the lazy  
 merge will fire on-chain: active += 5, pending = 0. The transaction attempting to sell pending tickets will fail.

• Handling: Ensure the program yields a distinct error code (InsufficientPendingTickets).  
 • Client Mitigation: Upon receiving this error, the client should query the registry, observe that the pending tickets have matured to active, and automatically resubmit with  
 active_to_sell = 3, pending_to_sell = 0.  
 ──────

## User Entry Lookup

All lookup operations are performed on-chain using the registry_entry_index stored inside the user's UserWinnings PDA.

Because indices are stored in user-specific state, clients never need to provide fragile index hints. If a user fully exits the pool, their entry index is reset to u32::MAX, and the  
 swapped entry's owner is updated.  
 ──────

## Storage Comparison

Scenario │ Current (flat array) │ Weighted entries
─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────
1,000 users × 10 tickets avg │ 320 KB │ 48 KB (7x smaller)
5,000 users × 20 tickets avg │ 3.2 MB │ 240 KB (13x smaller)
10,000 users × 30 tickets avg │ 9.6 MB (near limit!) │ 480 KB
Max capacity at 10 MB │ ~327K tickets │ ~218K users
──────

## Sell UX Comparison

                                                               │ Current (flat array)                                        │ Weighted entries

─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────
Client must compute │ Exact slot indices (fragile) │ Just active_to_sell, pending_to_sell (stable)
Stale data risk │ 🔴 Indices go stale on any buy/sell │ 🟢 Safe from stale indices (stored on-chain)
TX fails on concurrency │ Opaque UnauthorizedTicket │ Only if user oversells (clear error)
Retry needed │ Yes, with full re-scan │ Only on rare sell-after-harvest races
──────

## Trade-off Summary

Dimension │ Current (flat) │ Weighted entries
─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────
Sell complexity │ 🔴 Index-dependent │ 🟢 Index-free
Draw speed │ 🟢 O(1) │ 🟢 O(log N) with prefix sums
Merge speed │ 🟢 O(1) │ 🟢 O(1) with lazy merge
Prefix sum build │ 🟢 Not needed │ 🟡 Batched prepare_draw crank
Storage │ 🔴 32 bytes/ticket │ 🟢 48 bytes/user
Client complexity │ 🔴 Full registry scan + index math │ 🟢 Simple count-based params
──────

## Draw Cycle Flow

    graph TD
        A["harvest_yield_and_commit<br/>O(1): bump cycle, freeze pool"] --> B["prepare_draw × N batches<br/>~2,100 entries per TX<br/>lazy merge + prefix sums"]
        B --> C{"All entries<br/>prepared?"}
        C -->|No| B
        C -->|Yes| D["reveal_and_pick_winners<br/>O(W × log N): binary search"]
        D --> E["Pool unfrozen"]
    ──────

## Migration Strategy

Because this redesign breaks the data layout of the TicketRegistry account and adds fields to the UserWinnings PDA, a Pointer-Swap Migration is recommended:

1. Deploy Upgraded Program: Deploy the version containing the weighted entries logic.
2. Initialize New Registry: Deploy a fresh TicketRegistry account matching the new format.
3. Crank State Migration: Run a temporary migration crank script that:
   • Reads chunks of the old flat registry.
   • Aggregates the ticket counts by user pubkey.
   • Populates the new registry entries.
   • Updates each user's UserWinnings.registry_entry_index to point to their new slot.
4. Swap Pool Pointers: Execute an administrative transaction to update PrizePool.ticket_registry to the new account's address, and close the old registry account to reclaim rent.  
   ──────

## Instruction Summary

Instruction │ Existing? │ Changes
───────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────
buy_bonds │ ✅ │ Read/initialize UserWinnings PDA, set or update user entry
sell_bonds │ ✅ │ Load UserWinnings index, decrement counts, execute swap-and-pop
harvest_yield_and_commit │ ✅ │ O(1) — bump cycle counter only
prepare_draw │ 🆕 │ Batched lazy merge + prefix sum computation
reveal_and_pick_winners │ ✅ │ Binary search on prefix sums instead of direct index
reinvest_winnings │ ✅ │ Read winner's entry index from UserWinnings, increment active
resize_registry │ ✅ │ Same logic, grows by 48-byte entries

TicketRegistry Redesign: Weighted User Entries Technical Specification

This document details the architectural and code modifications required to migrate the TicketRegistry from a flat Pubkey list to a Weighted User Entries format.  
 ──────

## 📂 Target Files

The implementation will modify or create the following files:

• State Layouts:  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/registry.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/pool.rs  
 • Helper Utilities:  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/utils.rs  
 • Instruction Handlers:  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/buy_bonds.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/sell_bonds.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/harvest_yield_and_commit.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/prepare_draw.rs (NEW)  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reveal_and_pick_winners.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/resize_registry.rs  
 • Errors:  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/error.rs  
 • Constants:  
 • /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/constants.rs

──────

## 1. Constants Update

Modify /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/constants.rs:

    // Replace old registry constants
    pub const REGISTRY_REALLOC_STEP: usize = 12_288; // 256 UserEntry slots (256 * 48)
    pub const REGISTRY_MAX_SIZE: usize = 10_485_760; // Keep Solana's 10 MB limit
    pub const REGISTRY_INITIAL_SIZE: usize = 196_644; // 36 byte header + 4096 initial user entries * 48 bytes
    ──────

## 2. State Modifications

### registry.rs

Replace /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/registry.rs with:

    use anchor_lang::prelude::*;

    #[account(zero_copy(unsafe))]
    #[repr(C)]
    pub struct TicketRegistry {
        pub pool_id: u32,
        pub capacity: u32,              // max user entries (not tickets)
        pub user_count: u32,            // current active entries in the array
        pub total_active_tickets: u32,  // sum of active tickets across all entries
        pub total_pending_tickets: u32, // sum of pending tickets across all entries
        pub draw_cycle_id: u32,         // tracks current cycle to trigger lazy merges
        pub draw_prepared_up_to: u32,   // cursor for prepare_draw batch processing
    }

    #[zero_copy(unsafe)]
    #[repr(C)]
    #[derive(Default)]
    pub struct UserEntry {
        pub owner: Pubkey,              // 32 bytes
        pub active: u32,                // 4 bytes
        pub pending: u32,               // 4 bytes
        pub merged_through_cycle: u32,  // 4 bytes — cycle ID when pending was merged
        pub cumulative_active: u32,     // 4 bytes — prefix sum built during prepare_draw
    }

    impl UserEntry {
        pub fn lazy_merge(&mut self, current_cycle_id: u32) -> Result<()> {
            if self.merged_through_cycle < current_cycle_id {
                self.active = self.active.checked_add(self.pending)
                    .ok_or(error!(crate::error::PremiumBondsError::MathOverflow))?;
                self.pending = 0;
                self.merged_through_cycle = current_cycle_id;
            }
            Ok(())
        }
    }

### pool.rs

Update /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/pool.rs to add registry_entry_index to UserWinnings:

    #[account]
    #[derive(InitSpace)]
    pub struct UserWinnings {
        pub pool_id: u32,
        pub user: Pubkey,
        pub unclaimed_non_reinvested_winnings: u64,
        pub total_claimed: u64,
        pub total_reinvested: u64,
        pub bump: u8,
        pub registry_entry_index: u32,  // Set to u32::MAX (4,294,967,295) if user has no entry
    }
    ──────

## 3. Error Code Additions

Append these errors to /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/error.rs:

    #[error_code]
    pub enum PremiumBondsError {
        // ... existing errors
        #[msg("Invalid registry user entry hint provided")]
        InvalidUserEntryHint,
        #[msg("Insufficient pending tickets for this transaction")]
        InsufficientPendingTickets,
        #[msg("Insufficient active tickets for this transaction")]
        InsufficientActiveTickets,
        #[msg("The prize pool must be frozen for draw preparation")]
        PoolNotFrozen,
        #[msg("The draw cycle is in an invalid phase for this operation")]
        InvalidDrawStatus,
        #[msg("Required remaining account for swapped user's UserWinnings is missing")]
        MissingSwappedUserWinnings,
    }
    ──────

## 4. Helper Utilities (utils.rs)

Replace the registry raw-byte helpers in /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/utils.rs with the following implementation:

    pub const USER_ENTRY_REGISTRY_HEADER_SIZE: usize =
        8 + std::mem::size_of::<crate::state::TicketRegistry>();
    pub const USER_ENTRY_SIZE: usize = std::mem::size_of::<crate::state::UserEntry>();

    #[inline]
    fn get_user_entry_start_offset(data_len: usize, idx: usize) -> Option<usize> {
        idx.checked_mul(USER_ENTRY_SIZE)
            .and_then(|val| val.checked_add(USER_ENTRY_REGISTRY_HEADER_SIZE))
            .filter(|&s| s.checked_add(USER_ENTRY_SIZE).map_or(false, |end| end <= data_len))
    }

    /// Read the user entry at `idx` from raw account data.
    pub fn registry_get_entry(data: &[u8], idx: usize) -> crate::state::UserEntry {
        let start = get_user_entry_start_offset(data.len(), idx)
            .expect("Out of bounds read in registry_get_entry");
        unsafe {
            let ptr = data.as_ptr().add(start) as *const crate::state::UserEntry;
            std::ptr::read_unaligned(ptr)
        }
    }

    /// Write `entry` into the user entry slot at `idx` in raw account data.
    pub fn registry_set_entry(data: &mut [u8], idx: usize, entry: &crate::state::UserEntry) {
        let start = get_user_entry_start_offset(data.len(), idx)
            .expect("Out of bounds write in registry_set_entry");
        unsafe {
            let ptr = data.as_mut_ptr().add(start) as *mut crate::state::UserEntry;
            std::ptr::write_unaligned(ptr, *entry);
        }
    }

    /// Derive the maximum user entry capacity from the raw account data length.
    pub fn registry_capacity_from_len(data_len: usize) -> u32 {
        ((data_len.saturating_sub(USER_ENTRY_REGISTRY_HEADER_SIZE)) / USER_ENTRY_SIZE) as u32
    }

Note: Delete the old registry_add_tickets, swap_and_pop_pending, and swap_and_pop_active functions.  
 ──────

## 5. Detailed Instruction Modifications

### A. buy_bonds.rs

Update BuyBonds to load UserWinnings as mutable and execute index assignment:

• Validation: Ensure user_count + 1 <= capacity if the user is new.  
 • Logic:  
 let user_key = ctx.accounts.user.key();  
 let user_winnings = &mut ctx.accounts.user_winnings;  
 let registry_loader = &ctx.accounts.ticket_registry;  
 let mut user_entry_idx = user_winnings.registry_entry_index;

    let current_cycle = {
        let registry = registry_loader.load()?;
        registry.draw_cycle_id
    };

    let registry_ai = registry_loader.to_account_info();
    let mut data = registry_ai.try_borrow_mut_data()?;

    if user_entry_idx == u32::MAX {
        // New user registration
        let mut registry = registry_loader.load_mut()?;
        require!(registry.user_count < registry.capacity, PremiumBondsError::RegistryFull);

        user_entry_idx = registry.user_count;
        user_winnings.registry_entry_index = user_entry_idx;
        registry.user_count += 1;

        let new_entry = crate::state::UserEntry {
            owner: user_key,
            active: 0,
            pending: bonds_to_buy,
            merged_through_cycle: current_cycle,
            cumulative_active: 0,
        };
        registry_set_entry(&mut data, user_entry_idx as usize, &new_entry);
    } else {
        // Existing user update
        let mut entry = registry_get_entry(&data, user_entry_idx as usize);
        require!(entry.owner == user_key, PremiumBondsError::InvalidUserEntryHint);

        entry.lazy_merge(current_cycle)?;
        entry.pending += bonds_to_buy;
        registry_set_entry(&mut data, user_entry_idx as usize, &entry);
    }

    // Update global counters
    let mut registry = registry_loader.load_mut()?;
    registry.total_pending_tickets += bonds_to_buy;

### B. sell_bonds.rs

Update sell_bonds.rs to accept active_to_sell: u32 and pending_to_sell: u32 inputs. Load the UserWinnings account of the caller as a regular PDA in #[derive(Accounts)].

• Logic:  
 let user_key = ctx.accounts.user.key();  
 let user_winnings = &mut ctx.accounts.user_winnings;  
 let registry_loader = &ctx.accounts.ticket_registry;  
 let user_entry_idx = user_winnings.registry_entry_index;

    require!(user_entry_idx != u32::MAX, PremiumBondsError::InvalidUserEntryHint);

    let current_cycle = {
        let registry = registry_loader.load()?;
        registry.draw_cycle_id
    };

    let registry_ai = registry_loader.to_account_info();
    let mut data = registry_ai.try_borrow_mut_data()?;

    let mut entry = registry_get_entry(&data, user_entry_idx as usize);
    require!(entry.owner == user_key, PremiumBondsError::InvalidUserEntryHint);

    entry.lazy_merge(current_cycle)?;

    require!(entry.active >= active_to_sell, PremiumBondsError::InsufficientActiveTickets);
    require!(entry.pending >= pending_to_sell, PremiumBondsError::InsufficientPendingTickets);

    entry.active -= active_to_sell;
    entry.pending -= pending_to_sell;

    let mut registry = registry_loader.load_mut()?;
    registry.total_active_tickets -= active_to_sell;
    registry.total_pending_tickets -= pending_to_sell;

    if entry.active == 0 && entry.pending == 0 {
        // User is exiting the pool entirely
        user_winnings.registry_entry_index = u32::MAX;
        let last_entry_idx = registry.user_count - 1;

        if user_entry_idx != last_entry_idx {
            // Swap-and-pop the last entry into the vacated slot
            let last_entry = registry_get_entry(&data, last_entry_idx as usize);
            registry_set_entry(&mut data, user_entry_idx as usize, &last_entry);

            // Update the registry_entry_index on the swapped user's UserWinnings PDA
            let swapped_user_winnings_info = ctx.remaining_accounts.get(0)
                .ok_or(PremiumBondsError::MissingSwappedUserWinnings)?;

            // Verify PDA seeds & ownership on remaining account
            let expected_seeds = &[
                b"user_winnings",
                pool.pool_id.to_le_bytes().as_ref(),
                last_entry.owner.as_ref()
            ];
            let (expected_pda, _) = Pubkey::find_program_address(expected_seeds, ctx.program_id);
            require_keys_eq!(swapped_user_winnings_info.key(), expected_pda, PremiumBondsError::InvalidUserEntryHint);

            let mut swapped_winnings = Account::<crate::state::UserWinnings>::try_from(swapped_user_winnings_info)?;
            swapped_winnings.registry_entry_index = user_entry_idx;
            swapped_winnings.exit(&ctx.program_id)?; // serialize changes back to account
        }

        // Clear the popped last slot
        registry_set_entry(&mut data, last_entry_idx as usize, &crate::state::UserEntry::default());
        registry.user_count -= 1;
    } else {
        registry_set_entry(&mut data, user_entry_idx as usize, &entry);
    }

### C. harvest_yield_and_commit.rs

Simplify the registry merge down to O(1) global counter updates:

    let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;

    // Record draw eligibility stats
    eligible_locked_count = ticket_registry.total_active_tickets;

    // Shift all global pending tickets to active
    ticket_registry.total_active_tickets += ticket_registry.total_pending_tickets;
    ticket_registry.total_pending_tickets = 0;

    // Increment draw cycle to trigger lazy merges, and reset preparation index
    ticket_registry.draw_cycle_id += 1;
    ticket_registry.draw_prepared_up_to = 0;

### D. prepare_draw.rs (NEW instruction)

Create /home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/prepare_draw.rs:

    use crate::constants::{DRAW_CYCLE_SEED, PRIZE_POOL_SEED};
    use crate::error::PremiumBondsError;
    use crate::state::{DrawCycle, DrawStatus, PrizePool, TicketRegistry};
    use crate::utils::{registry_get_entry, registry_set_entry};
    use anchor_lang::prelude::*;

    #[derive(Accounts)]
    pub struct PrepareDraw<'info> {
        #[account(mut)]
        pub crank: Signer<'info>,

        #[account(
            mut,
            seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
            bump = pool.vault_authority_bump,
            has_one = ticket_registry,
            constraint = pool.is_frozen_for_draw @ PremiumBondsError::PoolNotFrozen,
        )]
        pub pool: Box<Account<'info, PrizePool>>,

        #[account(
            mut,
            seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.current_draw_cycle_id.to_le_bytes().as_ref()],
            bump,
            constraint = draw_cycle.status == DrawStatus::AwaitingRandomness @ PremiumBondsError::InvalidDrawStatus
        )]
        pub draw_cycle: Box<Account<'info, DrawCycle>>,

        #[account(mut)]
        pub ticket_registry: AccountLoader<'info, TicketRegistry>,
    }

    pub fn handle(ctx: Context<PrepareDraw>, batch_size: u32) -> Result<()> {
        let registry_loader = &ctx.accounts.ticket_registry;
        let mut registry = registry_loader.load_mut()?;
        let cycle_id = registry.draw_cycle_id;

        let start = registry.draw_prepared_up_to;
        let end = (start + batch_size).min(registry.user_count);

        let registry_ai = registry_loader.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;

        let mut cumulative = if start == 0 {
            0
        } else {
            registry_get_entry(&data, (start - 1) as usize).cumulative_active
        };

        for i in start..end {
            let mut entry = registry_get_entry(&data, i as usize);

            // Apply lazy merge
            entry.lazy_merge(cycle_id)?;

            cumulative = cumulative.checked_add(entry.active).ok_or(PremiumBondsError::MathOverflow)?;
            entry.cumulative_active = cumulative;

            registry_set_entry(&mut data, i as usize, &entry);
        }

        registry.draw_prepared_up_to = end;
        msg!("Prepared entries from index {} to {}. Cumulative active: {}", start, end, cumulative);

        Ok(())
    }

### E. reveal_and_pick_winners.rs

Update to use binary search against the cumulative prefix sums:

1.  Guard check: Enforce require!(registry.draw_prepared_up_to == registry.user_count).
2.  Derivation loop:  
    // Replace direct array index access with binary search  
    let user_count = registry.user_count;  
    let target_tickets = registry.total_active_tickets;

    for (tier_idx, tier) in pool.prize_tiers.iter().enumerate() {
    let prize_per_winner = tier.calculate_prize(draw_cycle.prize_pot);

         for i in 0..tier.num_winners {
             let winning_index = derive_random_index(
                 &random_seed,
                 tier_idx as u32,
                 i,
                 draw_cycle.cycle_id,
                 target_tickets, // total active tickets used as upper bounds
             );

             // Binary search for prefix range
             let mut lo = 0;
             let mut hi = user_count - 1;
             while lo < hi {
                 let mid = (lo + hi) / 2;
                 let mid_entry = registry_get_entry(&data, mid as usize);
                 if (mid_entry.cumulative_active as u64) <= winning_index {
                     lo = mid + 1;
                 } else {
                     hi = mid;
                 }
             }

             let winner_entry = registry_get_entry(&data, lo as usize);
             let winner_pubkey = winner_entry.owner;

             // ... push winner to payouts structure as normal
         }

    }

### F. reinvest_winnings.rs

Verify the winner entry is updated directly without search scans:

    let winner_winnings = &ctx.accounts.user_winnings;
    let user_entry_idx = winner_winnings.registry_entry_index;

    require!(user_entry_idx != u32::MAX, PremiumBondsError::InvalidUserEntryHint);

    let registry_loader = &ctx.accounts.ticket_registry;
    let current_cycle = {
        let registry = registry_loader.load()?;
        registry.draw_cycle_id
    };

    let registry_ai = registry_loader.to_account_info();
    let mut data = registry_ai.try_borrow_mut_data()?;

    let mut entry = registry_get_entry(&data, user_entry_idx as usize);
    require!(entry.owner == ctx.accounts.winner.key(), PremiumBondsError::InvalidUserEntryHint);

    entry.lazy_merge(current_cycle)?;
    entry.active += bonds_to_buy;

    registry_set_entry(&mut data, user_entry_idx as usize, &entry);

    let mut registry = registry_loader.load_mut()?;
    registry.total_active_tickets += bonds_to_buy;

### G. resize_registry.rs

Update to compute capacity via the new 48-byte structs:

    let new_len = ctx.accounts.ticket_registry.to_account_info().data_len();
    let new_capacity = registry_capacity_from_len(new_len); // updates with USER_ENTRY_SIZE (48)

    let mut registry = ctx.accounts.ticket_registry.load_mut()?;
    registry.capacity = new_capacity;
    ──────
