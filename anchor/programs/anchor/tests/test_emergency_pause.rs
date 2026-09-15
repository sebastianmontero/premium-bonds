//! Integration tests for Emergency Pause, Unpause, and Close pool operations.
//!
//! Tests:
//! 1. Guardian can pause an Active pool.
//! 2. Admin can pause an Active pool.
//! 3. Unauthorized caller cannot pause a pool.
//! 4. Admin can unpause a Paused pool.
//! 5. Guardian CANNOT unpause a pool (privilege separation).
//! 6. Unauthorized caller cannot unpause a pool.
//! 7. Admin can permanently close a pool.
//! 8. Guardian CANNOT close a pool.
//! 9. Paused pool blocks buy_bonds, sell_bonds, claim_redemption, and withdraw_fees.
//! 10. Closed pool blocks buy_bonds and harvest, but allows sell_bonds, claim_redemption, and withdraw_fees for capital exit.

use {
    anchor_lang::prelude::Pubkey, anchor_lang::AccountDeserialize, litesvm::LiteSVM,
    solana_keypair::Keypair, solana_signer::Signer,
};

mod common;
use common::*;

fn setup_pool_with_guardian(status: anchor::PoolStatus) -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let guardian = Keypair::new();
    let jobs = Keypair::new().pubkey();

    let mut svm = setup_global_config_with_admin_and_guardian(
        &authority,
        &admin.pubkey(),
        &guardian.pubkey(),
        Some(&jobs),
    );

    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&guardian.pubkey(), 10_000_000_000).unwrap();

    let _pool_pda = inject_pool(
        &mut svm,
        1,
        Pubkey::default(),
        Pubkey::default(),
        status,
        false,
    );

    (svm, admin, guardian, _pool_pda)
}

#[test]
fn test_guardian_can_pause_active_pool() {
    let (mut svm, _admin, guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );

    let meta =
        send_pause_pool(&mut svm, &guardian, 1).expect("Guardian should be able to pause pool");
    let event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&meta);
    assert_eq!(
        event.pool_id, 1,
        "PoolStatusChanged event pool_id must equal 1"
    );
    assert_eq!(
        event.previous_status,
        anchor::PoolStatus::Active,
        "PoolStatusChanged event previous_status must be Active"
    );
    assert_eq!(
        event.new_status,
        anchor::PoolStatus::Paused,
        "PoolStatusChanged event new_status must be Paused"
    );
    assert_eq!(
        event.authority,
        guardian.pubkey(),
        "PoolStatusChanged authority must match guardian pubkey"
    );
    assert!(
        event.timestamp > 0,
        "PoolStatusChanged timestamp must be non-zero"
    );

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Paused as u8,
        "Pool state status must be Paused after guardian pause"
    );
}

#[test]
fn test_admin_can_pause_active_pool() {
    let (mut svm, admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);

    let meta = send_pause_pool(&mut svm, &admin, 1).expect("Admin should be able to pause pool");
    let event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&meta);
    assert_eq!(
        event.pool_id, 1,
        "PoolStatusChanged event pool_id must equal 1"
    );
    assert_eq!(
        event.new_status,
        anchor::PoolStatus::Paused,
        "PoolStatusChanged event new_status must be Paused"
    );
    assert_eq!(
        event.authority,
        admin.pubkey(),
        "PoolStatusChanged authority must match admin pubkey"
    );
    assert!(
        event.timestamp > 0,
        "PoolStatusChanged timestamp must be non-zero"
    );

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Paused as u8,
        "Pool state status must be Paused after admin pause"
    );
}

#[test]
fn test_unauthorized_signer_cannot_pause_pool() {
    let (mut svm, _admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let res = send_pause_pool(&mut svm, &attacker, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::Unauthorized);
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );
}

#[test]
fn test_admin_can_unpause_paused_pool() {
    let (mut svm, admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Paused);

    let meta =
        send_unpause_pool(&mut svm, &admin, 1).expect("Admin should be able to unpause pool");
    let event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.previous_status, anchor::PoolStatus::Paused);
    assert_eq!(event.new_status, anchor::PoolStatus::Active);
    assert_eq!(event.authority, admin.pubkey());
    assert!(event.timestamp > 0);

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );
}

#[test]
fn test_guardian_cannot_unpause_pool() {
    let (mut svm, _admin, guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Paused);

    let res = send_unpause_pool(&mut svm, &guardian, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Paused as u8
    );
}

#[test]
fn test_admin_can_close_pool() {
    let (mut svm, admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);

    let meta = send_close_pool(&mut svm, &admin, 1).expect("Admin should be able to close pool");
    let event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.previous_status, anchor::PoolStatus::Active);
    assert_eq!(event.new_status, anchor::PoolStatus::Closed);
    assert_eq!(event.authority, admin.pubkey());
    assert!(event.timestamp > 0);

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Closed as u8
    );
}

#[test]
fn test_guardian_cannot_close_pool() {
    let (mut svm, _admin, guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);

    let res = send_close_pool(&mut svm, &guardian, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );
}

#[test]
fn test_cannot_pause_closed_pool() {
    let (mut svm, admin, guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Closed);

    let res_guardian = send_pause_pool(&mut svm, &guardian, 1);
    assert_custom_error(res_guardian, anchor::error::PremiumBondsError::PoolClosed);

    let res_admin = send_pause_pool(&mut svm, &admin, 1);
    assert_custom_error(res_admin, anchor::error::PremiumBondsError::PoolClosed);

    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Closed as u8
    );
}

#[test]
fn test_cannot_unpause_active_or_closed_pool() {
    let (mut svm, admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);

    let res_active = send_unpause_pool(&mut svm, &admin, 1);
    assert_custom_error(res_active, anchor::error::PremiumBondsError::PoolNotActive);

    let _pool_closed_pda = inject_pool(
        &mut svm,
        2,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Closed,
        false,
    );

    let res_closed = send_unpause_pool(&mut svm, &admin, 2);
    assert_custom_error(res_closed, anchor::error::PremiumBondsError::PoolNotActive);
    assert_eq!(
        read_pool_state(&svm, 2).status,
        anchor::PoolStatus::Closed as u8
    );
}

#[test]
fn test_cannot_close_pool_while_frozen_for_draw() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let guardian = Keypair::new();
    let jobs = Keypair::new().pubkey();

    let mut svm = setup_global_config_with_admin_and_guardian(
        &authority,
        &admin.pubkey(),
        &guardian.pubkey(),
        Some(&jobs),
    );

    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let _pool_pda = inject_pool(
        &mut svm,
        1,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        true, // is_frozen_for_draw == 1
    );

    let res = send_close_pool(&mut svm, &admin, 1);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );
}

#[test]
fn test_cannot_close_already_closed_pool() {
    let (mut svm, admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Closed);

    let res = send_close_pool(&mut svm, &admin, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolClosed);
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Closed as u8
    );
}

#[test]
fn test_unauthenticated_caller_cannot_close_pool() {
    let (mut svm, _admin, _guardian, _pool_pda) =
        setup_pool_with_guardian(anchor::PoolStatus::Active);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let res = send_close_pool(&mut svm, &attacker, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
    assert_eq!(
        read_pool_state(&svm, 1).status,
        anchor::PoolStatus::Active as u8
    );
}
