//! Integration tests for winner index swap resilience and full registry fallbacks.

use anchor_lang::AccountDeserialize;
use solana_program::pubkey::Pubkey;
use solana_sdk::{signature::Keypair, signer::Signer};

mod common;
use common::*;

#[test]
fn test_winner_swap_resilience_preserves_payout_claim() {
    let mut h = setup_lifecycle_harness();
    let pool_id = h.pool_id;
    let alice = clone_keypair(&h.ctx.user);
    let bob = clone_keypair(&h.bob);
    let crank = clone_keypair(&h.crank);
    let alice_usdc = h.ctx.user_usdc_account;
    let bob_usdc = h.bob_usdc;

    // 1. User A (Alice) buys 5 bonds, User B (Bob) buys 5 bonds
    send_e2e_buy_bonds_for_user(&mut h.ctx, &alice, alice_usdc, 5, Pubkey::default())
        .expect("Alice buys 5 bonds");
    send_e2e_buy_bonds_for_user(&mut h.ctx, &bob, bob_usdc, 5, Pubkey::default())
        .expect("Bob buys 5 bonds");

    // Alice is index 0, Bob is index 1
    let uw_a_init = read_user_winnings_state(&h.svm, pool_id, &alice.pubkey());
    let uw_b_init = read_user_winnings_state(&h.svm, pool_id, &bob.pubkey());
    assert_eq!(uw_a_init.registry_entry_index, 0);
    assert_eq!(uw_b_init.registry_entry_index, 1);

    // 2. Advance clock and harvest Cycle 0 so tickets mature from pending to active
    let pool_0 = read_pool_state(&h.svm, pool_id);
    warp_to_timestamp(&mut h.svm, pool_0.current_cycle_end_at);
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 0 harvest matures tickets");

    // 3. In Cycle 1, inject yield and execute harvest, prepare, and reveal
    let pool_1 = read_pool_state(&h.svm, pool_id);
    warp_to_timestamp(&mut h.svm, pool_1.current_cycle_end_at);
    let huma_pool_state = h.huma_pool_state;
    let pst_mint = h.pst_mint;
    inject_huma_yield_ratio(
        &mut h.svm,
        huma_pool_state,
        pst_mint,
        20_000_000,
        10_000_000,
    );
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 1 harvest should succeed");

    send_e2e_prepare_draw_with_crank(&mut h.ctx, &crank, pool_id, 1, 10)
        .expect("Prepare draw cycle 1");

    let dc1 = read_draw_cycle_state(&h.svm, pool_id, 1);
    let rand_acc = dc1.randomness_account;
    inject_current_slot_randomness(&mut h.svm, rand_acc, [42u8; 32]);
    send_e2e_reveal_and_pick_winners_with_crank(&mut h.ctx, &crank, pool_id, 1, rand_acc)
        .expect("Reveal cycle 1");

    let winners = read_payout_winners(&h.svm, pool_id, 1);
    assert!(!winners.is_empty(), "Winners must be selected");

    // 4. User A (Alice at index 0) sells all 5 active bonds
    // Program executes genuine swap-and-pop on-chain: Bob moves from index 1 to 0
    send_e2e_sell_bonds_for_user(
        &mut h.ctx,
        &alice,
        5,
        0,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
    )
    .expect("Alice sells all bonds triggering swap-and-pop");

    // Verify Bob's registry_entry_index was updated to 0 on-chain by the program
    let uw_b_after_swap = read_user_winnings_state(&h.svm, pool_id, &bob.pubkey());
    assert_eq!(
        uw_b_after_swap.registry_entry_index, 0,
        "Bob's registry_entry_index must be updated to 0 on-chain"
    );

    // 5. Warp past payout timelock and execute ReinvestWinnings on-chain for the winner
    warp_forward_seconds(&mut h.svm, 301);

    let bob_winner_idx = winners.iter().position(|w| w.winner == bob.pubkey());
    if let Some(w_idx) = bob_winner_idx {
        let meta = send_e2e_reinvest_winnings_with_crank(
            &mut h.ctx,
            &crank,
            pool_id,
            &bob.pubkey(),
            1,
            w_idx as u32,
        )
        .expect("Bob reinvestment after index swap must succeed");

        let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
        assert_eq!(event.winner, bob.pubkey(), "Event winner matches Bob");
        assert_eq!(event.winner_index, w_idx as u32);
        assert!(event.amount_reinvested > 0, "Amount reinvested > 0");

        let updated_winners = read_payout_winners(&h.svm, pool_id, 1);
        assert_eq!(
            updated_winners[w_idx].processed, 1,
            "Winner marked processed"
        );
    } else {
        let a_idx = winners
            .iter()
            .position(|w| w.winner == alice.pubkey())
            .unwrap();
        let meta = send_e2e_reinvest_winnings_with_crank(
            &mut h.ctx,
            &crank,
            pool_id,
            &alice.pubkey(),
            1,
            a_idx as u32,
        )
        .expect("Alice reinvestment after full exit must succeed");

        let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
        assert_eq!(event.winner, alice.pubkey(), "Event winner matches Alice");
    }
}
