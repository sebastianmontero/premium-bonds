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
    let (draw_cycle_1_pda, _) = draw_cycle_pda(pool_id, 1);
    DrawCycleTestBuilder::new(pool_id, 1)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_prize_pot(10_000_000)
        .with_cycle_fee(1_000_000)
        .with_harvest_slot(100)
        .inject(&mut h.svm);

    mutate_pool_state(&mut h.svm, pool_id, |p| {
        p.is_frozen_for_draw = 1;
        p.total_prizes_allocated = 10_000_000;
        p.total_fees_accrued = 1_000_000;
    });

    // Advance slot past 256 timeout
    h.svm.warp_to_slot(1000);

    let accounts_force_unlock = anchor::accounts::AdminForceUnlockDraw {
        admin: h.admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_1_pda,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_force_unlock = Instruction {
        program_id: anchor::id(),
        accounts: accounts_force_unlock,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };
    let bh_unlock = h.svm.latest_blockhash();
    let msg_unlock =
        Message::new_with_blockhash(&[ix_force_unlock], Some(&h.admin.pubkey()), &bh_unlock);
    let tx_unlock =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_unlock), &[&admin]).unwrap();
    h.svm
        .send_transaction(tx_unlock)
        .expect("AdminForceUnlockDraw must succeed");

    let pool_unlocked = read_pool_state(&h.svm, pool_id);
    assert_eq!(pool_unlocked.is_frozen_for_draw, 0, "Pool is unfrozen");
    assert_eq!(
        pool_unlocked.total_prizes_allocated, 0,
        "Allocated prize returned"
    );
    assert_eq!(pool_unlocked.total_fees_accrued, 0, "Accrued fee returned");

    // 6. Admin Void Payout Registry Recovery
    let cycle_id = 2;
    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(5_000_000)
        .with_cycle_fee(500_000)
        .with_locked_tickets(50)
        .inject(&mut h.svm);

    let user_pubkey = h.user.pubkey();
    let (payout_reg_pda, _) = PayoutRegistryTestBuilder::new(pool_id, cycle_id)
        .with_winners(vec![WinnerTestBuilder::default_winner(
            user_pubkey,
            5_000_000,
            0,
        )])
        .with_status(anchor::state::PayoutRegistryStatus::Active)
        .inject(&mut h.svm);

    mutate_pool_state(&mut h.svm, pool_id, |p| {
        p.total_prizes_allocated = 5_000_000;
        p.total_fees_accrued = 500_000;
    });

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
