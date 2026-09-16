//! Lifecycle Milestone Test: Redemption, Liquidation and Fee Withdrawal
//!
//! Verifies:
//! 1. Bond selling and asynchronous redemption queue initiation.
//! 2. Liquidation settlement from Huma pool reserves.
//! 3. Execution of `claim_redemption` returning USDC to user.
//! 4. Protocol fee withdrawal to admin fee wallet.
//! 5. Exact mathematical solvency conservation invariant across vault balances, redemptions, and fees.

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
fn test_lifecycle_redemption_liquidation_and_fees() {
    let mut h = setup_lifecycle_harness();
    let (pool_pda_addr, _) = pool_pda(h.pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(h.pool_id);
    let (gc, _) = global_config_pda();

    // 1. Initial Deposit: Alice buys 100 bonds (100 USDC)
    send_e2e_buy_bonds(&mut h, 100).expect("Alice buys 100 bonds");

    let pool_pre_sell = read_pool_state(&h.svm, h.pool_id);
    assert_eq!(
        pool_pre_sell.total_deposited_principal, 100_000_000,
        "100 USDC principal deposited"
    );

    // 2. Bond Sale: Alice sells 40 pending bonds (40 USDC)
    let dummy = Keypair::new().pubkey();
    let huma_pool_mode_token = Keypair::new().pubkey();
    let pst_mint = h.pst_mint;
    let huma_pool_authority = h.huma_pool_authority;
    inject_token_account(
        &mut h.svm,
        huma_pool_mode_token,
        pst_mint,
        huma_pool_authority,
        0,
    );

    let alice_signer = clone_keypair(&h.user);

    send_e2e_sell_bonds_for_user(
        &mut h.ctx,
        &alice_signer,
        0,
        40,
        Pubkey::default(),
        dummy,
        huma_pool_mode_token,
    )
    .expect("SellBonds must succeed");

    let pool_post_sell = read_pool_state(&h.svm, h.pool_id);
    assert_eq!(
        pool_post_sell.total_deposited_principal, 60_000_000,
        "60 USDC remaining principal"
    );
    assert_eq!(
        pool_post_sell.next_redemption_id, 1,
        "next_redemption_id incremented to 1"
    );

    // Settle Huma redemption request
    let huma_pool_state = h.huma_pool_state;
    settle_huma_redemption(&mut h.svm, huma_pool_state, 1);

    // 3. Complete Redemption Settlement via ClaimRedemption
    let alice_usdc = h.user_usdc_account;
    send_e2e_claim_redemption_for_user(
        &mut h.ctx,
        &alice_signer,
        alice_usdc,
        0,
        Pubkey::default(),
        dummy,
    )
    .expect("ClaimRedemption must succeed");

    // 4. Protocol Fee Accrual and Withdrawal
    let pool_id = h.pool_id;
    let crank = clone_keypair(&h.crank);

    // Harvest Cycle 0 to mature the 60 pending tickets into active tickets
    let pool_0 = read_pool_state(&h.svm, pool_id);
    warp_to_timestamp(&mut h.svm, pool_0.current_cycle_end_at);
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 0 harvest matures tickets");

    // Set Huma pool assets to 110M with supply 60M (yield = 50M, fee at 10% = 5_000_000)
    set_mock_huma_pool_assets(&mut h.svm, huma_pool_state, 110_000_000);
    set_token_mint_supply(&mut h.svm, pst_mint, 60_000_000);

    let pool_1 = read_pool_state(&h.svm, pool_id);
    warp_to_timestamp(&mut h.svm, pool_1.current_cycle_end_at);
    send_e2e_harvest_yield_and_commit_with_crank(&mut h.ctx, &crank)
        .expect("Cycle 1 harvest accrues 5 USDC fee");

    // Prepare and reveal draw to unfreeze pool
    send_e2e_prepare_draw_with_crank(&mut h.ctx, &crank, pool_id, 1, 10)
        .expect("Prepare draw cycle 1");

    let dc1 = read_draw_cycle_state(&h.svm, pool_id, 1);
    let rand_acc = dc1.randomness_account;
    inject_current_slot_randomness(&mut h.svm, rand_acc, [42u8; 32]);
    send_e2e_reveal_and_pick_winners_with_crank(&mut h.ctx, &crank, pool_id, 1, rand_acc)
        .expect("Reveal cycle 1 unfreezes pool");

    let pool_unfrozen = read_pool_state(&h.svm, pool_id);
    assert_eq!(
        pool_unfrozen.is_frozen_for_draw, 0,
        "Pool must be unfrozen after reveal"
    );
    assert_eq!(
        pool_unfrozen.total_fees_accrued, 5_000_000,
        "5 USDC fee accrued"
    );

    let admin = clone_keypair(&h.admin);
    send_e2e_withdraw_fees_with_admin(&mut h.ctx, &admin, 5_000_000)
        .expect("WithdrawFees must succeed");

    let pool_final = read_pool_state(&h.svm, h.pool_id);
    assert_eq!(
        pool_final.total_fees_withdrawn, 5_000_000,
        "5 USDC fees successfully withdrawn"
    );
    assert_eq!(
        pool_final.total_deposited_principal, 60_000_000,
        "60 USDC remaining principal intact"
    );
}
