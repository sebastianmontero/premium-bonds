//! Lifecycle Milestone Test: Payout Distribution, Reinvestment and Claims
//!
//! Verifies:
//! 1. Winner resolution across multi-tier distributions.
//! 2. Winner reinvestment into new tickets and dust tracking in UserWinnings.
//! 3. Timelock enforcement before claims/reinvestments.
//! 4. Non-reinvested winnings claim into user USDC wallet.

use {
    anchor_lang::AccountDeserialize,
    solana_program::pubkey::Pubkey,
    solana_sdk::{signature::Keypair, signer::Signer},
};

mod common;
use common::*;

#[test]
fn test_lifecycle_payout_reinvestment_and_claims() {
    let mut h = setup_lifecycle_harness();
    let pool_id = h.pool_id;
    let crank = clone_keypair(&h.crank);
    let bob_usdc = h.bob_usdc;

    // 1. Deposits & Rollover into Cycle 1
    send_e2e_buy_bonds(&mut h, 100).expect("Alice buys 100 bonds");
    send_e2e_buy_bonds_for_user(&mut h.ctx, &h.bob, bob_usdc, 50, Pubkey::default())
        .expect("Bob buys 50 bonds");

    // Cycle 0 Harvest to mature pending tickets into active
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 0 harvest must succeed");

    // 2. Yield Generation: 15 USDC yield accrued in Huma (165M assets on 150M supply)
    let huma_pool_state = h.huma_pool_state;
    let pst_mint = h.pst_mint;
    set_mock_huma_pool_assets(&mut h.svm, huma_pool_state, 165_000_000);
    set_token_mint_supply(&mut h.svm, pst_mint, 150_000_000);

    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 1 harvest must succeed");

    // 3. PrepareDraw & Reveal
    send_e2e_prepare_draw_with_crank(&mut h.ctx, &crank, pool_id, 1, 10)
        .expect("PrepareDraw must succeed");

    let dc1 = read_draw_cycle_state(&h.svm, pool_id, 1);
    let rand_acc = dc1.randomness_account;
    inject_current_slot_randomness(&mut h.svm, rand_acc, [42u8; 32]);
    send_e2e_reveal_and_pick_winners_with_crank(&mut h.ctx, &crank, pool_id, 1, rand_acc)
        .expect("RevealAndPickWinners must succeed");

    let winners = read_payout_winners(&h.svm, pool_id, 1);
    assert_eq!(winners.len(), 2, "2 winners across 2 tiers");

    // 4. Attempt Reinvestment Before Timelock Expires -> Must Fail
    let winner_0 = winners[0].winner;
    let res_early =
        send_e2e_reinvest_winnings_with_crank(&mut h.ctx, &crank, pool_id, &winner_0, 1, 0);
    assert_custom_error(
        res_early,
        anchor::error::PremiumBondsError::PayoutTimelockActive,
    );

    // 5. Advance Time Past 300s Timelock & Reinvest
    h.svm.expire_blockhash();
    warp_forward_seconds(
        &mut h.svm,
        (anchor::constants::DEFAULT_PAYOUT_TIMELOCK_SECONDS as i64) + 1,
    );

    send_e2e_reinvest_winnings_with_crank(&mut h.ctx, &crank, pool_id, &winner_0, 1, 0)
        .expect("ReinvestWinnings must succeed after timelock");

    let winner_owed = winners[0].amount_owed;
    let bond_price = read_pool_state(&h.svm, pool_id).bond_price;
    let winner_winnings = read_user_winnings_state(&h.svm, pool_id, &winner_0);

    // 1. Exact Multiple Property: Reinvested amount must be an exact integer multiple of bond_price
    assert_eq!(
        winner_winnings.total_reinvested % bond_price,
        0,
        "Reinvested amount must be an exact multiple of bond price"
    );
    // 2. Strict Remainder Bound: Unclaimed dust must be strictly less than 1 bond price
    assert!(
        winner_winnings.unclaimed_non_reinvested_winnings < bond_price,
        "Unclaimed dust must be strictly less than bond price"
    );
    // 3. Exact Conservation Law: Total Reinvested + Dust == Total Prize Owed
    assert_eq!(
        winner_winnings.total_reinvested + winner_winnings.unclaimed_non_reinvested_winnings,
        winner_owed,
        "Winner mass conservation: total_reinvested + unclaimed dust == winner_owed"
    );

    // 6. Winner 0 Claims Unclaimed Dust Winnings via ClaimNonReinvestedWinnings
    let dummy = Keypair::new().pubkey();
    let huma_pool_mode_token = Keypair::new().pubkey();
    let huma_pool_authority = h.huma_pool_authority;
    inject_token_account(
        &mut h.svm,
        huma_pool_mode_token,
        pst_mint,
        huma_pool_authority,
        0,
    );

    let winner_0_signer = if winner_0 == h.user.pubkey() {
        clone_keypair(&h.user)
    } else {
        clone_keypair(&h.bob)
    };

    let ix_claim_dust = ClaimNonReinvestedWinningsBuilder::new(&h.ctx)
        .with_user(&winner_0)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_huma_pool_config(dummy)
        .with_huma_mode_config(dummy)
        .with_huma_redemption_request(dummy)
        .with_huma_lender_state(dummy)
        .build_ix();

    send_user_tx(&mut h.svm, &winner_0_signer, ix_claim_dust)
        .expect("ClaimNonReinvestedWinnings must succeed");

    let post_claim_winnings = read_user_winnings_state(&h.svm, pool_id, &winner_0);
    assert_eq!(
        post_claim_winnings.unclaimed_non_reinvested_winnings, 0,
        "Unclaimed dust fully emptied"
    );
    assert_eq!(
        post_claim_winnings.total_claimed, winner_winnings.unclaimed_non_reinvested_winnings,
        "Claimed winnings must match previous unclaimed dust"
    );
}
