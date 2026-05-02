//! Integration tests for `buy_bonds`.
//!
//! # Testing Strategy
//!
//! The `BuyBonds` instruction has 18 accounts including `InterfaceAccount<TokenAccount>`,
//! `InterfaceAccount<Mint>`, and `Interface<TokenInterface>`. Anchor's constraint validation
//! for these token-interface types causes a BPF stack overflow in LiteSVM before any
//! business logic runs (Access violation in stack frame 5 at ~6700 CU consumed).
//!
//! Therefore, the buy_bonds guard logic is tested as **unit tests** on the extracted
//! `PrizePool::validate_buy_bonds` and `PrizePool::validate_registry_capacity` methods
//! in `src/state/pool.rs`. This provides full coverage of:
//!
//! - Pool status check (Active/Paused/Closed → `PoolNotActive`)
//! - Draw freeze check (`AwaitingRandomnessFreeze`)
//! - Zero quantity check (`InvalidBondQuantity`)
//! - Max tickets per buy check (`MaxTicketsPerBuyExceeded`)
//! - Amount calculation (bond_price × quantity)
//! - Registry capacity check (`RegistryFull`)
//! - Guard priority ordering
//!
//! Run them with: `cargo test --lib -- pool::tests::buy_bonds`
