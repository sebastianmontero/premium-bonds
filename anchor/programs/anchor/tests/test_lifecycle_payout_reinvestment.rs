//! Lifecycle Milestone Test: Payout Distribution, Reinvestment and Claims
//!
//! Verifies:
//! 1. Winner resolution across multi-tier distributions.
//! 2. Winner reinvestment into new tickets and dust tracking in UserWinnings.
//! 3. Timelock enforcement before claims/reinvestments.
//! 4. Non-reinvested winnings claim into user USDC wallet.

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
fn test_lifecycle_payout_reinvestment_and_claims() {
    let mut h = setup_lifecycle_harness();
    let (pool_pda_addr, _) = pool_pda(h.pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(h.pool_id);
    let (gc, _) = global_config_pda();

    // 1. Deposits & Rollover into Cycle 1
    send_e2e_buy_bonds(&mut h, 100).expect("Alice buys 100 bonds");
    let bob_usdc = h.bob_usdc;
    send_e2e_buy_bonds_for_user(&mut h.ctx, &h.bob, bob_usdc, 50, Pubkey::default())
        .expect("Bob buys 50 bonds");

    // Cycle 0 Harvest
    warp_to_timestamp(&mut h.svm, 1_700_000_000 + 25 * 3600);
    let (draw_cycle_0_pda, _) = draw_cycle_pda(h.pool_id, 0);
    let rand_acc_0 = Keypair::new().pubkey();
    let clock_0: solana_sdk::clock::Clock = h.svm.get_sysvar();
    inject_randomness_account_data(&mut h.svm, rand_acc_0, 0, clock_0.slot, [0u8; 32]);

    let accounts_harvest_0 = anchor::accounts::HarvestYieldAndCommit {
        crank: h.crank.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        ticket_registry: h.ticket_registry,
        current_draw_cycle: draw_cycle_0_pda,
        pool_pst_vault,
        pst_mint: h.pst_mint,
        huma_pool_state: h.huma_pool_state,
        randomness_account: rand_acc_0,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_harvest_0 = Instruction {
        program_id: anchor::id(),
        accounts: accounts_harvest_0,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };
    let bh0 = h.svm.latest_blockhash();
    let msg0 = Message::new_with_blockhash(&[ix_harvest_0], Some(&h.crank.pubkey()), &bh0);
    let tx0 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg0), &[&h.crank]).unwrap();
    h.svm
        .send_transaction(tx0)
        .expect("Cycle 0 harvest must succeed");

    // 2. Yield Generation: 15 USDC yield accrued in Huma
    warp_to_timestamp(&mut h.svm, 1_700_000_000 + 50 * 3600);
    let huma_pool_state = h.huma_pool_state;
    let pst_mint = h.pst_mint;
    set_mock_huma_pool_assets(&mut h.svm, huma_pool_state, 165_000_000);
    set_token_mint_supply(&mut h.svm, pst_mint, 150_000_000);

    let (draw_cycle_1_pda, _) = draw_cycle_pda(h.pool_id, 1);
    let rand_acc_1 = Keypair::new().pubkey();
    let clock_1: solana_sdk::clock::Clock = h.svm.get_sysvar();
    inject_randomness_account_data(&mut h.svm, rand_acc_1, 0, clock_1.slot, [0u8; 32]);

    let accounts_harvest_1 = anchor::accounts::HarvestYieldAndCommit {
        crank: h.crank.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        ticket_registry: h.ticket_registry,
        current_draw_cycle: draw_cycle_1_pda,
        pool_pst_vault,
        pst_mint: h.pst_mint,
        huma_pool_state: h.huma_pool_state,
        randomness_account: rand_acc_1,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_harvest_1 = Instruction {
        program_id: anchor::id(),
        accounts: accounts_harvest_1,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };
    let bh1 = h.svm.latest_blockhash();
    let msg1 = Message::new_with_blockhash(&[ix_harvest_1], Some(&h.crank.pubkey()), &bh1);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&h.crank]).unwrap();
    h.svm
        .send_transaction(tx1)
        .expect("Cycle 1 harvest must succeed");

    // 3. PrepareDraw & Reveal
    let accounts_prepare = anchor::accounts::PrepareDraw {
        crank: h.crank.pubkey(),
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_1_pda,
        ticket_registry: h.ticket_registry,
    }
    .to_account_metas(None);

    let ix_prepare = Instruction {
        program_id: anchor::id(),
        accounts: accounts_prepare,
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };
    let bh_prep = h.svm.latest_blockhash();
    let msg_prep = Message::new_with_blockhash(&[ix_prepare], Some(&h.crank.pubkey()), &bh_prep);
    let tx_prep =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_prep), &[&h.crank]).unwrap();
    h.svm
        .send_transaction(tx_prep)
        .expect("PrepareDraw must succeed");

    let (payout_reg_pda, _) = payout_pda(h.pool_id, 1);
    let clock: solana_sdk::clock::Clock = h.svm.get_sysvar();
    inject_randomness_account_data(&mut h.svm, rand_acc_1, clock.slot, clock.slot, [42u8; 32]);

    let accounts_reveal = anchor::accounts::RevealAndPickWinners {
        crank: h.crank.pubkey(),
        current_draw_cycle: draw_cycle_1_pda,
        pool: pool_pda_addr,
        ticket_registry: h.ticket_registry,
        randomness_account: rand_acc_1,
        payout_registry: payout_reg_pda,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_reveal = Instruction {
        program_id: anchor::id(),
        accounts: accounts_reveal,
        data: anchor::instruction::RevealAndPickWinners {}.data(),
    };
    let bh_rev = h.svm.latest_blockhash();
    let msg_rev = Message::new_with_blockhash(&[ix_reveal], Some(&h.crank.pubkey()), &bh_rev);
    let tx_rev =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_rev), &[&h.crank]).unwrap();
    h.svm
        .send_transaction(tx_rev)
        .expect("RevealAndPickWinners must succeed");

    let winners = read_payout_winners(&h.svm, h.pool_id, 1);
    assert_eq!(winners.len(), 2, "2 winners across 2 tiers");

    // 4. Attempt Reinvestment Before Timelock Expires -> Must Fail
    let winner_0 = winners[0].winner;
    let (winner_0_winnings_pda, _) = user_winnings_pda(h.pool_id, &winner_0);

    let accounts_reinvest_early = anchor::accounts::ReinvestWinnings {
        crank: h.crank.pubkey(),
        winner: winner_0,
        payout_registry: payout_reg_pda,
        pool: pool_pda_addr,
        user_winnings: winner_0_winnings_pda,
        ticket_registry: h.ticket_registry,
        system_program: anchor_lang::solana_program::system_program::id(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_reinvest_early = Instruction {
        program_id: anchor::id(),
        accounts: accounts_reinvest_early,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 1,
            winner_index: 0,
        }
        .data(),
    };
    let bh_early = h.svm.latest_blockhash();
    let msg_early =
        Message::new_with_blockhash(&[ix_reinvest_early], Some(&h.crank.pubkey()), &bh_early);
    let tx_early =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_early), &[&h.crank]).unwrap();
    let res_early = h.svm.send_transaction(tx_early);
    assert_custom_error(
        res_early,
        anchor::error::PremiumBondsError::PayoutTimelockActive,
    );

    // 5. Advance Time Past 300s Timelock & Reinvest
    h.svm.expire_blockhash();
    warp_to_timestamp(&mut h.svm, 1_700_000_000 + 50 * 3600 + 301);

    let accounts_reinvest = anchor::accounts::ReinvestWinnings {
        crank: h.crank.pubkey(),
        winner: winner_0,
        payout_registry: payout_reg_pda,
        pool: pool_pda_addr,
        user_winnings: winner_0_winnings_pda,
        ticket_registry: h.ticket_registry,
        system_program: anchor_lang::solana_program::system_program::id(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_reinvest = Instruction {
        program_id: anchor::id(),
        accounts: accounts_reinvest,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 1,
            winner_index: 0,
        }
        .data(),
    };
    let bh_reinv = h.svm.latest_blockhash();
    let msg_reinv = Message::new_with_blockhash(&[ix_reinvest], Some(&h.crank.pubkey()), &bh_reinv);
    let tx_reinv =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_reinv), &[&h.crank]).unwrap();
    h.svm
        .send_transaction(tx_reinv)
        .expect("ReinvestWinnings must succeed after timelock");

    let winner_0_winnings = read_user_winnings_state(&h.svm, h.pool_id, &winner_0);
    assert_eq!(
        winner_0_winnings.total_reinvested, 9_000_000,
        "9 USDC reinvested into bonds"
    );
    assert_eq!(
        winner_0_winnings.unclaimed_non_reinvested_winnings, 450_000,
        "450k dust tracked as unclaimed winnings"
    );

    // 6. Winner 0 Claims Unclaimed Dust Winnings via ClaimNonReinvestedWinnings
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
    let (pending_claim_pda, _) = pending_redemption_pda(h.pool_id, 0);

    let winner_0_signer = if winner_0 == h.user.pubkey() {
        &h.user
    } else {
        &h.bob
    };
    let winner_0_usdc = if winner_0 == h.user.pubkey() {
        h.user_usdc_account
    } else {
        h.bob_usdc
    };

    let accounts_claim_dust = anchor::accounts::ClaimNonReinvestedWinnings {
        user: winner_0,
        pool: pool_pda_addr,
        user_winnings: winner_0_winnings_pda,
        pool_pst_vault,
        pending_redemption: pending_claim_pda,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: dummy,
        huma_pool_state: h.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: h.pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: h.huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_claim_dust = Instruction {
        program_id: anchor::id(),
        accounts: accounts_claim_dust,
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };
    let bh_dust = h.svm.latest_blockhash();
    let msg_dust = Message::new_with_blockhash(&[ix_claim_dust], Some(&winner_0), &bh_dust);
    let tx_dust =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg_dust), &[winner_0_signer])
            .unwrap();
    h.svm
        .send_transaction(tx_dust)
        .expect("ClaimNonReinvestedWinnings must succeed");

    let post_claim_winnings = read_user_winnings_state(&h.svm, h.pool_id, &winner_0);
    assert_eq!(
        post_claim_winnings.unclaimed_non_reinvested_winnings, 0,
        "Unclaimed dust fully emptied"
    );
    assert_eq!(
        post_claim_winnings.total_claimed, 450_000,
        "450k dust tracked as claimed"
    );
}
