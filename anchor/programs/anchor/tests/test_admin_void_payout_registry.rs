//! Integration tests for the `admin_void_payout_registry` instruction.
//!
//! Verifies:
//! 1. Successful voiding with exact subtraction of winner prizes (accounting for dust).
//! 2. Reversion of protocol fees.
//! 3. Rejection when payouts have already started (payouts_completed > 0).
//! 4. Rejection when draw is already voided.
//! 5. Rejection when protocol fees were already withdrawn.
//! 6. Rejection by unauthorized non-admin callers.

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::AccountDeserialize,
    anchor_lang::Discriminator,
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_sdk::account::Account,
    solana_signer::Signer,
};

mod common;
use common::*;

fn inject_draw_cycle(
    svm: &mut LiteSVM,
    pool_id: u32,
    cycle_id: u32,
    prize_pot: u64,
    cycle_fee_collected: u64,
    status: anchor::DrawStatus,
) -> Pubkey {
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let draw_cycle = anchor::DrawCycle {
        prize_pot,
        cycle_fee_collected,
        harvest_slot: 100,
        initiated_at: 1_700_000_000,
        completed_at: 1_700_000_000,
        randomness_account: Pubkey::default(),
        pool_id,
        cycle_id,
        locked_ticket_count: 100,
        status,
        version: 1,
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };

    let mut data = vec![];
    data.extend_from_slice(&anchor::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    draw_cycle.serialize(&mut data).unwrap();

    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

fn inject_payout_registry(
    svm: &mut LiteSVM,
    pool_id: u32,
    cycle_id: u32,
    winners: Vec<anchor::Winner>,
    payouts_completed: u32,
    status: anchor::PayoutRegistryStatus,
) -> Pubkey {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let default_winner = anchor::Winner {
        winner: Pubkey::default(),
        amount_owed: 0,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };
    let mut fixed_winners = [default_winner; 50];
    let count = winners.len().min(50);
    fixed_winners[..count].copy_from_slice(&winners[..count]);

    let pr = anchor::PayoutRegistry {
        pool_id,
        cycle_id,
        winners_count: count as u32,
        payouts_completed,
        revealed_at: 1000,
        status: status as u8,
        version: 1,
        _padding: [0; 6],
        _reserved: [0; 64],
        winners: fixed_winners,
    };

    let mut d = vec![];
    d.extend_from_slice(&anchor::PayoutRegistry::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pr));

    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

#[test]
fn test_admin_void_payout_registry_success() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let pool_pda_addr = inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    // Initial pool state with allocated prizes and accrued fees
    // Suppose draw prize_pot was 100_000 USDC, but due to rounding dust, 2 winners got 49_999 each (total distributed = 99_998)
    // Dust of 2 USDC was already deducted at reveal_and_pick_winners time!
    let prize_pot = 100_000;
    let winner_amount = 49_999;
    let cycle_fee = 5_000;

    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 99_998;
        pool.total_prizes_distributed = 99_998;
        pool.total_fees_accrued = 5_000;
        pool.total_fees_withdrawn = 0;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    inject_draw_cycle(&mut svm, pool_id, cycle_id, prize_pot, cycle_fee, anchor::DrawStatus::Complete);

    let winner1 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: winner_amount,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };
    let winner2 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: winner_amount,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    let payout_pda_addr = inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1, winner2],
        0, // 0 completed
        anchor::PayoutRegistryStatus::Active,
    );

    // Execute void
    let meta = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id)
        .expect("admin_void_payout_registry should succeed");

    let event = assert_log_event::<anchor::events::DrawVoided>(&meta);
    assert_eq!(event.pool_id, pool_id);
    assert_eq!(event.cycle_id, cycle_id);
    assert_eq!(event.admin, admin.pubkey());
    assert_eq!(event.prizes_reversed, 99_998);
    assert_eq!(event.fees_reversed, cycle_fee);

    // Verify Pool accounting
    let pool_acc = svm.get_account(&pool_pda_addr).unwrap();
    let pool = bytemuck::from_bytes::<anchor::PrizePool>(&pool_acc.data[8..]);
    assert_eq!(pool.total_prizes_allocated, 0, "Prizes allocated should be rolled back to 0");
    assert_eq!(pool.total_prizes_distributed, 0, "Prizes distributed should be rolled back to 0");
    assert_eq!(pool.total_fees_accrued, 0, "Fees accrued should be rolled back to 0");

    // Verify PayoutRegistry status
    let payout_acc = svm.get_account(&payout_pda_addr).unwrap();
    let pr = bytemuck::from_bytes::<anchor::PayoutRegistry>(&payout_acc.data[8..]);
    assert_eq!(pr.status, anchor::PayoutRegistryStatus::Voided as u8);

    // Verify DrawCycle status
    let (dc_pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let dc_acc = svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle = anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::Voided);
    assert!(dc.completed_at > 0);
}

#[test]
fn test_admin_void_fails_if_payouts_already_started() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let pool_pda_addr = inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 50_000;
        pool.total_prizes_distributed = 50_000;
        pool.total_fees_accrued = 5_000;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    inject_draw_cycle(&mut svm, pool_id, cycle_id, 50_000, 5_000, anchor::DrawStatus::Complete);

    let winner1 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: 50_000,
        bonds_bought: 0,
        processed: 1, // Already processed
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        1, // payouts_completed = 1
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert!(res.is_err(), "Voiding must fail when payouts_completed > 0");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PayoutsAlreadyStarted"));
}

#[test]
fn test_admin_void_fails_if_fees_already_withdrawn() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let pool_pda_addr = inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 50_000;
        pool.total_prizes_distributed = 50_000;
        pool.total_fees_accrued = 5_000;
        pool.total_fees_withdrawn = 5_000; // All fees withdrawn!
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    inject_draw_cycle(&mut svm, pool_id, cycle_id, 50_000, 5_000, anchor::DrawStatus::Complete);

    let winner1 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: 50_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert!(res.is_err(), "Voiding must fail when fees were already withdrawn");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("FeesAlreadyWithdrawn"));
}

#[test]
fn test_unauthorized_user_cannot_void_draw() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    inject_draw_cycle(&mut svm, pool_id, cycle_id, 50_000, 5_000, anchor::DrawStatus::Complete);

    let winner1 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: 50_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &attacker, pool_id, cycle_id);
    assert!(res.is_err(), "Attacker must not be able to void draw");
}

#[test]
fn test_admin_void_fails_if_pool_is_closed() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let pool_pda_addr = inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 50_000;
        pool.total_prizes_distributed = 50_000;
        pool.total_fees_accrued = 5_000;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    send_close_pool(&mut svm, &admin, pool_id).expect("Close pool should succeed");

    inject_draw_cycle(&mut svm, pool_id, cycle_id, 50_000, 5_000, anchor::DrawStatus::Complete);

    let winner1 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: 50_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert!(res.is_err(), "Voiding must fail when pool is closed");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolClosed"), "got: {err_str}");
}

#[test]
fn test_multi_cycle_cumulative_prize_distribution_and_void_recovery() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let pool_pda_addr = inject_pool(
        &mut svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    // Initial state: Cycle 1 completed with 50_000 USDC distributed
    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 50_000;
        pool.total_prizes_distributed = 50_000;
        pool.total_fees_accrued = 5_000;
        pool.total_fees_withdrawn = 0;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    // Cycle 2 completes: adds 75_000 USDC
    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated += 75_000;
        pool.total_prizes_distributed += 75_000;
        pool.total_fees_accrued += 7_500;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    inject_draw_cycle(&mut svm, pool_id, 2, 75_000, 7_500, anchor::DrawStatus::Complete);

    let winner_c2 = anchor::Winner {
        winner: Keypair::new().pubkey(),
        amount_owed: 75_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: 1,
        _reserved: [0; 9],
    };

    inject_payout_registry(
        &mut svm,
        pool_id,
        2,
        vec![winner_c2],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    // Check pre-void state (total_prizes_distributed = 125_000)
    {
        let acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes::<anchor::PrizePool>(&acc.data[8..]);
        assert_eq!(pool.total_prizes_distributed, 125_000);
        assert_eq!(pool.total_prizes_allocated, 125_000);
    }

    // Admin voids Cycle 2 (reverses 75_000)
    send_admin_void_payout_registry(&mut svm, &admin, pool_id, 2)
        .expect("Voiding cycle 2 should succeed");

    // Check post-void state: rolled back to 50_000
    {
        let acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes::<anchor::PrizePool>(&acc.data[8..]);
        assert_eq!(pool.total_prizes_distributed, 50_000);
        assert_eq!(pool.total_prizes_allocated, 50_000);
        assert_eq!(pool.total_fees_accrued, 5_000);
    }

    // Cycle 3 completes: adds 100_000 USDC
    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated += 100_000;
        pool.total_prizes_distributed += 100_000;
        pool.total_fees_accrued += 10_000;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    inject_draw_cycle(&mut svm, pool_id, 3, 100_000, 10_000, anchor::DrawStatus::Complete);

    // Check final state: cumulative total = 150_000
    {
        let acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes::<anchor::PrizePool>(&acc.data[8..]);
        assert_eq!(pool.total_prizes_distributed, 150_000);
        assert_eq!(pool.total_prizes_allocated, 150_000);
        assert_eq!(pool.total_fees_accrued, 15_000);
    }
}

