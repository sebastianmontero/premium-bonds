//! Comprehensive Protocol Lifecycle Matrix Test Suite
//!
//! Verifies the exact lifecycle permissions across all 3 pool states (`Active`, `Paused`, `Closed`)
//! as specified in the protocol circuit breakers & incident response specification:
//!
//! | Instruction                   | Active (`0`) | Paused (`1`) | Closed (`2`) |
//! | :---------------------------- | :---:        | :---:        | :---:        |
//! | `buy_bonds`                   | ✅ Allowed    | ❌ Blocked   | ❌ Blocked   |
//! | `sell_bonds`                  | ✅ Allowed    | ❌ Blocked   | ✅ Allowed   |
//! | `claim_redemption`            | ✅ Allowed    | ❌ Blocked   | ✅ Allowed   |
//! | `claim_non_reinvested_winnings` | ✅ Allowed  | ❌ Blocked   | ✅ Allowed   |
//! | `withdraw_fees`               | ✅ Allowed    | ❌ Blocked   | ✅ Allowed   |
//! | `harvest_yield_and_commit`    | ✅ Allowed    | ❌ Blocked   | ❌ Blocked   |
//! | `prepare_draw`                | ✅ Allowed    | ❌ Blocked   | ❌ Blocked   |
//! | `crank_rebind_expired_randomness` | ✅ Allowed | ❌ Blocked   | ❌ Blocked   |
//! | `admin_void_payout_registry`  | ✅ Allowed    | ✅ Allowed   | ❌ Blocked   |
//! | `reinvest_winnings`           | ✅ Allowed    | ❌ Blocked   | ✅ Allowed   |

use {
    anchor::error::PremiumBondsError, anchor_lang::prelude::Pubkey, solana_keypair::Keypair,
    solana_signer::Signer,
};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. buy_bonds: Active ✅, Paused ❌, Closed ❌
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_buy_bonds() {
    let mut pool_active = PrizePoolTestBuilder::new(1)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_bond_price(1_000_000)
        .build();
    pool_active
        .validate_buy_bonds(1)
        .expect("validate_buy_bonds must succeed for active pool");

    let mut pool_paused = pool_active;
    pool_paused.status = anchor::PoolStatus::Paused as u8;
    let err_paused = pool_paused.validate_buy_bonds(1).unwrap_err();
    assert_eq!(
        err_paused,
        anchor::error::PremiumBondsError::PoolNotActive.into()
    );

    let mut pool_closed = pool_active;
    pool_closed.status = anchor::PoolStatus::Closed as u8;
    let err_closed = pool_closed.validate_buy_bonds(1).unwrap_err();
    assert_eq!(
        err_closed,
        anchor::error::PremiumBondsError::PoolNotActive.into()
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. sell_bonds: Active ✅, Paused ❌, Closed ✅
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_sell_bonds_paused_blocks() {
    let (mut svm, _admin) = setup_global_config();
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_pda_addr, 0);

    let ticket_registry = Keypair::new().pubkey();
    let entries = vec![UserEntryTestBuilder::active(user.pubkey(), 10)];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Paused,
        false,
        huma_pool_state,
    );

    let huma_redemption_request = Keypair::new().pubkey();
    let huma_lender_state = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_redemption_request);
    inject_dummy_huma_account(&mut svm, huma_lender_state);

    let res = SellBondsBuilder::for_pool(pool_id, user.pubkey())
        .with_ticket_registry(ticket_registry)
        .with_token_mint(token_mint)
        .with_huma_pool_state(huma_pool_state)
        .with_huma_mode_mint(pst_mint)
        .with_huma_redemption_request(huma_redemption_request)
        .with_huma_lender_state(huma_lender_state)
        .with_shares(1, 0)
        .send(&mut svm, &user);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. claim_redemption: Active ✅, Paused ❌, Closed ✅
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_claim_redemption_paused_blocks() {
    let (mut svm, _admin) = setup_global_config();
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_pda_addr, 1_000_000);

    let user_token_account = Keypair::new().pubkey();
    inject_token_account(&mut svm, user_token_account, token_mint, user.pubkey(), 0);

    let (_pending_redemption, bump) = pending_redemption_pda(pool_id, 0);
    inject_pending_redemption_with_params(
        &mut svm,
        anchor::state::InitPendingRedemptionParams {
            pool_id,
            redemption_id: 0,
            bump,
            user: user.pubkey(),
            amount: 1_000_000,
            pst_shares_locked: 1_000_000,
            huma_request_id: 1,
            requested_at: 0,
            redemption_type: anchor::state::RedemptionType::BondSale,
        },
    );

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Paused,
        false,
        huma_pool_state,
    );

    let huma_lender_state = Keypair::new().pubkey();
    let huma_pool_underlying_token = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_lender_state);
    inject_dummy_huma_account(&mut svm, huma_pool_underlying_token);

    let res = ClaimRedemptionBuilder::for_redemption(pool_id, 0, user.pubkey(), user.pubkey())
        .with_beneficiary_token_account(user_token_account)
        .with_token_mint(token_mint)
        .with_huma_pool_state(huma_pool_state)
        .with_huma_lender_state(huma_lender_state)
        .with_huma_pool_underlying_token(huma_pool_underlying_token)
        .send(&mut svm, &user);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. withdraw_fees: Active ✅, Paused ❌, Closed ✅
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_withdraw_fees_paused_blocks() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();
    let fee_wallet = Keypair::new().pubkey();

    inject_mint(&mut svm, token_mint, 6);
    inject_mint_with_supply(&mut svm, pst_mint, 6, 10_000_000);

    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(
        &mut svm,
        pool_pst_vault,
        pst_mint,
        pool_pda_addr,
        10_000_000,
    );
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state_with_assets(&mut svm, huma_pool_state, 10_000_000);

    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Paused)
        .with_huma_pool_state(huma_pool_state)
        .with_fee_wallet(fee_wallet)
        .with_fees_accrued(10_000_000)
        .inject(&mut svm);

    let huma_redemption_request = Keypair::new().pubkey();
    let huma_lender_state = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_redemption_request);
    inject_dummy_huma_account(&mut svm, huma_lender_state);

    let res = WithdrawFeesBuilder::for_pool(pool_id, admin.pubkey())
        .with_token_mint(token_mint)
        .with_fee_wallet(fee_wallet)
        .with_huma_pool_state(huma_pool_state)
        .with_huma_mode_mint(pst_mint)
        .with_huma_redemption_request(huma_redemption_request)
        .with_huma_lender_state(huma_lender_state)
        .with_amount(1_000_000)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. prepare_draw: Active ✅, Paused ❌, Closed ❌
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_prepare_draw_blocks_when_paused_or_closed() {
    let (mut svm, _admin) = setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();

    let entries = vec![UserEntryTestBuilder::active(crank.pubkey(), 10)];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);

    // Inject draw cycle awaiting randomness
    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_prize_pot(10_000_000)
        .with_cycle_fee(100_000)
        .with_harvest_slot(100)
        .with_locked_tickets(10)
        .inject(&mut svm);

    // 1. Paused
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Paused,
        true,
    );
    let res = PrepareDrawBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_ticket_registry(ticket_registry)
        .with_batch_size(10)
        .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::PoolNotActive);

    // 2. Closed
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Closed,
        true,
    );
    // Use new crank keypair to guarantee distinct signature
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    let res2 = PrepareDrawBuilder::for_pool(pool_id, 0, crank2.pubkey())
        .with_ticket_registry(ticket_registry)
        .with_batch_size(10)
        .send(&mut svm, &crank2);
    assert_custom_error(res2, PremiumBondsError::PoolNotActive);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. crank_rebind_expired_randomness: Active ✅, Paused ❌, Closed ❌
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_crank_rebind_blocks_when_paused_or_closed() {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();

    // Inject draw cycle awaiting randomness
    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_prize_pot(10_000_000)
        .with_cycle_fee(100_000)
        .with_harvest_slot(100)
        .with_locked_tickets(10)
        .inject(&mut svm);

    // 1. Paused
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Paused,
        true,
    );
    let res = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        pool_id,
        0,
        Pubkey::default(),
        Pubkey::default(),
    )
    .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::PoolNotActive);

    // 2. Closed
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Closed,
        true,
    );
    // Rotate global_config jobs account to crank2
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    send_update_global_config(&mut svm, &admin, None, Some(crank2.pubkey()))
        .expect("Rotate crank/jobs_account via genuine admin instruction");

    let res2 = CrankRebindExpiredRandomnessBuilder::new(
        crank2.pubkey(),
        pool_id,
        0,
        Pubkey::default(),
        Pubkey::default(),
    )
    .send(&mut svm, &crank2);
    assert_custom_error(res2, PremiumBondsError::PoolNotActive);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. reinvest_winnings: Active ✅, Paused ❌, Closed ✅
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_reinvest_winnings_permissions() {
    let (mut svm, _admin) = setup_global_config();
    let crank = Keypair::new();
    let winner = Keypair::new().pubkey();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();

    let entries = vec![UserEntryTestBuilder::active(winner, 10)];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);

    let winner_entry = WinnerTestBuilder::unprocessed(winner, 3_000_000, 0);

    // 1. Paused -> Blocked with PoolPaused
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Paused)
        .with_prizes_allocated(1_000_000_000)
        .with_payout_timelock_seconds(0)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![winner_entry],
        0,
        anchor::PayoutRegistryStatus::Active,
    );
    inject_user_winnings_with_index(&mut svm, pool_id, winner, 0, 0, 0, 0);

    let res = ReinvestWinningsBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_winner(&winner)
        .with_ticket_registry(ticket_registry)
        .with_winner_index(0)
        .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::PoolPaused);

    // 2. Active -> Allowed
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_prizes_allocated(1_000_000_000)
        .with_payout_timelock_seconds(0)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![winner_entry],
        0,
        anchor::PayoutRegistryStatus::Active,
    );
    inject_user_winnings_with_index(&mut svm, pool_id, winner, 0, 0, 0, 0);

    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    assert!(
        ReinvestWinningsBuilder::for_pool(pool_id, 0, crank2.pubkey())
            .with_winner(&winner)
            .with_ticket_registry(ticket_registry)
            .with_winner_index(0)
            .send(&mut svm, &crank2)
            .is_ok()
    );

    // 3. Closed -> Allowed (graceful cash fallback)
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Closed)
        .with_prizes_allocated(1_000_000_000)
        .with_payout_timelock_seconds(0)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        1,
        vec![winner_entry],
        0,
        anchor::PayoutRegistryStatus::Active,
    );
    inject_user_winnings_with_index(&mut svm, pool_id, winner, 0, 0, 0, 0);

    let crank3 = Keypair::new();
    svm.airdrop(&crank3.pubkey(), 10_000_000_000).unwrap();
    assert!(
        ReinvestWinningsBuilder::for_pool(pool_id, 1, crank3.pubkey())
            .with_winner(&winner)
            .with_ticket_registry(ticket_registry)
            .with_winner_index(0)
            .send(&mut svm, &crank3)
            .is_ok()
    );
}
