//! Lifecycle Milestone Test: Yield Harvesting and Draw Resolution
//!
//! Verifies the core yield accumulation, draw preparation, and VRF resolution lifecycle:
//! 1. Multi-user bond purchases across cycles.
//! 2. Pending to active ticket transition on harvest.
//! 3. Yield generation and harvest commit.
//! 4. Batch prepare_draw processing.
//! 5. VRF reveal and winner selection with unfreezing.

use {
    anchor_lang::AccountDeserialize,
    solana_program::pubkey::Pubkey,
    solana_sdk::{signature::Keypair, signer::Signer},
};

mod common;
use common::*;

#[test]
fn test_lifecycle_yield_harvest_and_draw_resolution() {
    let mut h = setup_lifecycle_harness();
    let pool_id = h.pool_id;
    let crank = clone_keypair(&h.crank);
    let admin = clone_keypair(&h.admin);

    let custom_tiers = vec![
        anchor::PrizeTier::new(1, 6000),
        anchor::PrizeTier::new(2, 2000),
    ];
    send_set_prize_tiers(&mut h.svm, &admin, pool_id, custom_tiers.clone())
        .expect("Set prize tiers must succeed");

    // 1. Deposits in Cycle 0
    send_e2e_buy_bonds(&mut h, 100).expect("Alice buy_bonds must succeed");
    let bob_usdc = h.bob_usdc;
    send_e2e_buy_bonds_for_user(&mut h.ctx, &h.bob, bob_usdc, 50, Pubkey::default())
        .expect("Bob buy_bonds must succeed");

    let reg_0 = read_ticket_registry(&h.svm, h.ticket_registry);
    assert_eq!(reg_0.user_count, 2, "2 users registered in ticket registry");
    assert_eq!(reg_0.total_pending_tickets, 150, "150 pending tickets");
    assert_eq!(
        reg_0.total_active_tickets, 0,
        "0 active tickets before cycle 0 harvest"
    );

    // 2. Cycle 0 Harvest -> Rolls pending tickets into active tickets
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 0 harvest must succeed");

    let reg_1 = read_ticket_registry(&h.svm, h.ticket_registry);
    assert_eq!(
        reg_1.total_active_tickets, 150,
        "Pending tickets converted to active"
    );
    assert_eq!(
        reg_1.total_pending_tickets, 0,
        "No remaining pending tickets"
    );

    // 3. Cycle 1 Yield Generation and Harvest (20 USDC yield accrued in Huma)
    let huma_pool_state = h.huma_pool_state;
    let pst_mint = h.pst_mint;
    set_mock_huma_pool_assets(&mut h.svm, huma_pool_state, 170_000_000);
    set_token_mint_supply(&mut h.svm, pst_mint, 150_000_000);

    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 1 harvest must succeed");

    let pool_frozen = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_frozen.is_frozen_for_draw, 1,
        "Pool must be frozen for draw"
    );

    // 4. Batch PrepareDraw
    send_e2e_prepare_draw_with_crank(&mut h.ctx, &crank, pool_id, 1, 10)
        .expect("PrepareDraw must succeed");

    let reg_prep = read_ticket_registry(&h.svm, h.ticket_registry);
    assert_eq!(
        reg_prep.draw_prepared_up_to, 2,
        "All 2 entries prepared for draw"
    );

    // 5. Reveal VRF Randomness and Pick Winners
    let dc1 = read_draw_cycle_state(&h.svm, pool_id, 1);
    let rand_acc = dc1.randomness_account;
    inject_current_slot_randomness(&mut h.svm, rand_acc, [42u8; 32]);
    send_e2e_reveal_and_pick_winners_with_crank(&mut h.ctx, &crank, pool_id, 1, rand_acc)
        .expect("RevealAndPickWinners must succeed");

    let pool_unfrozen = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_unfrozen.is_frozen_for_draw, 0,
        "Pool must be un-frozen after reveal"
    );
    assert_eq!(
        pool_unfrozen.total_prizes_allocated, 18_000_000,
        "18 USDC prizes allocated (20 USDC total yield - 10% fee = 18 USDC)"
    );

    let winners = read_payout_winners(&h.svm, pool_id, 1);
    assert_eq!(
        winners.len(),
        3,
        "Must pick exactly 3 winners across configured tiers (1 in Tier 1, 2 in Tier 2)"
    );

    // Invariant Oracles
    assert_fee_partition_conserved(20_000_000, 1000, 2_000_000, 18_000_000);
    assert_prize_tier_distribution(18_000_000, &custom_tiers, &winners, winners.len());
}
