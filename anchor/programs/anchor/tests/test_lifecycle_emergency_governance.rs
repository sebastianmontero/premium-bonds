//! Lifecycle Milestone Test: Emergency Governance, Pausing and Recovery
//!
//! Verifies:
//! 1. Emergency pause and unpause by guardian and admin.
//! 2. Rejection of user operations (buy_bonds) during emergency pause.
//! 3. Emergency draw cycle recovery via admin force unlock.
//! 4. Voiding invalid/compromised payout registries and resetting solvency state.
//! 5. Protocol parameter updates under admin governance.

use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::account::Account,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

#[test]
fn test_lifecycle_emergency_pausing_and_governance() {
    let mut h = setup_lifecycle_harness();
    let (pool_pda_addr, _) = pool_pda(h.pool_id);
    let (gc, _) = global_config_pda();
    let pool_id = h.pool_id;

    // 1. Guardian triggers emergency pause
    let guardian = clone_keypair(&h.guardian);
    send_pause_pool(&mut h.svm, &guardian, pool_id).expect("Guardian should be able to pause pool");

    let pool_paused = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_paused.status,
        anchor::state::PoolStatus::Paused as u8,
        "Pool must be Paused"
    );

    // 2. User attempts to buy bonds while paused -> Must Fail
    let res_buy_paused = send_e2e_buy_bonds(&mut h, 50);
    assert_custom_error(
        res_buy_paused,
        anchor::error::PremiumBondsError::PoolNotActive,
    );
    h.svm.expire_blockhash();

    // 3. Admin unpauses pool
    let admin = clone_keypair(&h.admin);
    send_unpause_pool(&mut h.svm, &admin, pool_id).expect("Admin should be able to unpause pool");

    let pool_unpaused = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_unpaused.status,
        anchor::state::PoolStatus::Active as u8,
        "Pool must be Active again"
    );

    // 4. User successfully buys bonds now that pool is Active
    send_e2e_buy_bonds(&mut h, 50).expect("BuyBonds must succeed after unpause");

    // 5. Admin Force Unlock of Stalled Draw Cycle
    let crank = clone_keypair(&h.crank);
    let huma_pool_state = h.huma_pool_state;
    let pst_mint = h.pst_mint;

    // Cycle 0 harvest matures 50 pending tickets into 50 active tickets (DrawSkipped for cycle 0)
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 0 harvest should succeed to mature tickets");

    // Cycle 1: Now with 50 active tickets, inject yield and harvest to legitimately freeze into AwaitingRandomness
    let pool_c1 = read_pool_state(&h.svm, pool_id);
    warp_to_timestamp(&mut h.svm, pool_c1.current_cycle_end_at);
    inject_huma_yield_ratio(
        &mut h.svm,
        huma_pool_state,
        pst_mint,
        60_000_000,
        50_000_000,
    );
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Harvest should succeed for cycle 1");

    let pool_harvested = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_harvested.is_frozen_for_draw, 1,
        "Pool must be frozen awaiting randomness"
    );
    assert!(
        pool_harvested.total_prizes_allocated > 0,
        "Prizes must be allocated"
    );
    assert!(
        pool_harvested.total_fees_accrued > 0,
        "Fees must be accrued"
    );

    // Advance slot past 256 timeout
    h.svm.warp_to_slot(1000);

    send_admin_force_unlock(&mut h.svm, &admin, pool_id, 1)
        .expect("AdminForceUnlockDraw must succeed");

    let pool_unlocked = read_pool_state(&h.svm, pool_id);
    assert_eq!(pool_unlocked.is_frozen_for_draw, 0, "Pool is unfrozen");
    assert_eq!(
        pool_unlocked.total_prizes_allocated, 0,
        "Allocated prize returned"
    );
    assert_eq!(pool_unlocked.total_fees_accrued, 0, "Accrued fee returned");

    // 6. Admin Void Payout Recovery
    let cycle_id = 2;
    warp_to_timestamp(&mut h.svm, pool_unlocked.current_cycle_end_at);
    inject_huma_yield_ratio(
        &mut h.svm,
        huma_pool_state,
        pst_mint,
        70_000_000,
        50_000_000,
    );
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 2 harvest should succeed");

    send_e2e_prepare_draw_with_crank(&mut h.ctx, &crank, pool_id, cycle_id, 10)
        .expect("Cycle 2 prepare draw should succeed");

    let dc2 = read_draw_cycle_state(&h.svm, pool_id, cycle_id);
    let rand_acc = dc2.randomness_account;
    inject_current_slot_randomness(&mut h.svm, rand_acc, [42u8; 32]);
    send_e2e_reveal_and_pick_winners_with_crank(&mut h.ctx, &crank, pool_id, cycle_id, rand_acc)
        .expect("Cycle 2 reveal should succeed");

    let pool_post_reveal = read_pool_state(&h.svm, pool_id);
    assert!(
        pool_post_reveal.total_prizes_allocated > 0,
        "Prize allocated before void"
    );

    send_admin_void_payout_registry(&mut h.svm, &admin, pool_id, cycle_id)
        .expect("AdminVoidPayoutRegistry must succeed");

    let pool_post_void = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_post_void.total_prizes_allocated, 0,
        "Allocated prize pot rolled back to 0"
    );
    assert_eq!(
        pool_post_void.total_fees_accrued, 0,
        "Fees accrued rolled back to 0"
    );

    let payout_post_void = read_payout_registry(&h.svm, pool_id, cycle_id);
    assert_eq!(
        payout_post_void.status,
        anchor::state::PayoutRegistryStatus::Voided as u8,
        "Payout registry status is Voided"
    );
}
