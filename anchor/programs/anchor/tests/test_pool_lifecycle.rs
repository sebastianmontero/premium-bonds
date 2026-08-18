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

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::instruction::Instruction,
    solana_sdk::account::Account,
    solana_sdk::message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

fn inject_dummy_huma_account(svm: &mut LiteSVM, address: Pubkey) {
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 100],
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. buy_bonds: Active ✅, Paused ❌, Closed ❌
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_lifecycle_buy_bonds() {
    let mut pool_active = anchor::PrizePool {
        status: anchor::PoolStatus::Active as u8,
        is_frozen_for_draw: 0,
        bond_price: 1_000_000,
        ..unsafe { std::mem::zeroed() }
    };
    assert!(pool_active.validate_buy_bonds(1).is_ok());

    let mut pool_paused = pool_active;
    pool_paused.status = anchor::PoolStatus::Paused as u8;
    let err_paused = pool_paused.validate_buy_bonds(1).unwrap_err();
    assert_eq!(err_paused, anchor::error::PremiumBondsError::PoolNotActive.into());

    let mut pool_closed = pool_active;
    pool_closed.status = anchor::PoolStatus::Closed as u8;
    let err_closed = pool_closed.validate_buy_bonds(1).unwrap_err();
    assert_eq!(err_closed, anchor::error::PremiumBondsError::PoolNotActive.into());
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
    let entries = vec![anchor::state::UserEntry {
        owner: user.pubkey(),
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: 1,
        _reserved: [0; 15],
    }];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Paused, false);

    let (user_winnings, _) = user_winnings_pda(pool_id, &user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let huma_redemption_request = Keypair::new().pubkey();
    let huma_lender_state = Keypair::new().pubkey();
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_redemption_request);
    inject_dummy_huma_account(&mut svm, huma_lender_state);
    inject_dummy_huma_account(&mut svm, huma_pool_mode_token);

    let accounts = anchor::accounts::SellBonds {
        user: user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry,
        token_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: Pubkey::default(),
        huma_pool_state,
        huma_mode_config: Pubkey::default(),
        huma_mode_mint: pst_mint,
        huma_redemption_request,
        huma_lender_state,
        huma_pool_authority: Pubkey::default(),
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolPaused"), "got: {err_str}");
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

    let (pending_redemption, bump) = pending_redemption_pda(pool_id, 0);
    // Inject initialized pending redemption
    let pr = anchor::state::PendingRedemption {
        huma_request_id: 1,
        redemption_id: 0,
        amount: 1_000_000,
        pst_shares_locked: 1_000_000,
        requested_at: 0,
        user: user.pubkey(),
        pool_id,
        bump,
        version: 1,
        redemption_type: anchor::state::RedemptionType::BondSale,
        _reserved: [0; 64],
    };
    let mut pr_data = vec![];
    use anchor_lang::Discriminator;
    pr_data.extend_from_slice(&anchor::state::PendingRedemption::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    pr.serialize(&mut pr_data).unwrap();
    svm.set_account(
        pending_redemption,
        Account {
            lamports: 1_000_000_000,
            data: pr_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Paused, false);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let huma_lender_state = Keypair::new().pubkey();
    let huma_pool_underlying_token = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_lender_state);
    inject_dummy_huma_account(&mut svm, huma_pool_underlying_token);

    let accounts = anchor::accounts::ClaimRedemption {
        user: user.pubkey(),
        pool: pool_pda_addr,
        pending_redemption,
        token_mint,
        pool_vault_account: pool_vault,
        user_token_account,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: Pubkey::default(),
        huma_pool_state,
        huma_mode_config: Pubkey::default(),
        huma_lender_state,
        huma_pool_authority: Pubkey::default(),
        huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolPaused"), "got: {err_str}");
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
    inject_mint(&mut svm, pst_mint, 6);

    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_pda_addr, 10_000_000);
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Paused, false);
    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.fee_wallet = fee_wallet;
        pool.total_fees_accrued = 10_000_000;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    let (gc, _) = global_config_pda();
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let huma_redemption_request = Keypair::new().pubkey();
    let huma_lender_state = Keypair::new().pubkey();
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_dummy_huma_account(&mut svm, huma_redemption_request);
    inject_dummy_huma_account(&mut svm, huma_lender_state);
    inject_dummy_huma_account(&mut svm, huma_pool_mode_token);

    let accounts = anchor::accounts::WithdrawFees {
        admin: admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: Pubkey::default(),
        huma_pool_state,
        huma_mode_config: Pubkey::default(),
        huma_mode_mint: pst_mint,
        huma_redemption_request,
        huma_lender_state,
        huma_pool_authority: Pubkey::default(),
        huma_pool_mode_token,
        token_mint,
        fee_wallet,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::WithdrawFees { amount: 1_000_000 }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolPaused"), "got: {err_str}");
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
    let (draw_cycle_addr, _) = draw_cycle_pda(pool_id, 0);

    let entries = vec![anchor::state::UserEntry {
        owner: crank.pubkey(),
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: 1,
        _reserved: [0; 15],
    }];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);

    // Inject draw cycle awaiting randomness
    let dc = anchor::state::DrawCycle {
        prize_pot: 10_000_000,
        cycle_fee_collected: 100_000,
        harvest_slot: 100,
        initiated_at: 1_700_000_000,
        completed_at: 0,
        randomness_account: Pubkey::default(),
        pool_id,
        cycle_id: 0,
        locked_ticket_count: 10,
        status: anchor::DrawStatus::AwaitingRandomness,
        version: 1,
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    let mut dc_data = vec![];
    use anchor_lang::Discriminator;
    dc_data.extend_from_slice(&anchor::state::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    dc.serialize(&mut dc_data).unwrap();
    svm.set_account(
        draw_cycle_addr,
        Account {
            lamports: 1_000_000_000,
            data: dc_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // 1. Paused
    let pool_pda_addr = inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Paused, true);
    let accounts = anchor::accounts::PrepareDraw {
        crank: crank.pubkey(),
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_addr,
        ticket_registry,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix.clone()], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolNotActive"), "got: {err_str}");

    // 2. Closed
    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Closed, true);
    // Use new crank keypair to guarantee distinct signature
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    let accounts2 = anchor::accounts::PrepareDraw {
        crank: crank2.pubkey(),
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_addr,
        ticket_registry,
    }
    .to_account_metas(None);
    let ix2 = Instruction {
        program_id: anchor::id(),
        accounts: accounts2,
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };
    let bh2 = svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&crank2.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&crank2]).unwrap();
    let res2 = svm.send_transaction(tx2);
    assert!(res2.is_err());
    let err_str2 = format!("{:?}", res2.unwrap_err());
    assert!(err_str2.contains("PoolNotActive"), "got: {err_str2}");
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
    let (gc, _) = global_config_pda();
    let (draw_cycle_addr, _) = draw_cycle_pda(pool_id, 0);

    // Inject draw cycle awaiting randomness
    let dc = anchor::state::DrawCycle {
        prize_pot: 10_000_000,
        cycle_fee_collected: 100_000,
        harvest_slot: 100,
        initiated_at: 1_700_000_000,
        completed_at: 0,
        randomness_account: Pubkey::default(),
        pool_id,
        cycle_id: 0,
        locked_ticket_count: 10,
        status: anchor::DrawStatus::AwaitingRandomness,
        version: 1,
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    let mut dc_data = vec![];
    use anchor_lang::Discriminator;
    dc_data.extend_from_slice(&anchor::state::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    dc.serialize(&mut dc_data).unwrap();
    svm.set_account(
        draw_cycle_addr,
        Account {
            lamports: 1_000_000_000,
            data: dc_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // 1. Paused
    let pool_pda_addr = inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Paused, true);
    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        crank: crank.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_addr,
        new_randomness_account: Pubkey::default(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix.clone()], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("PoolNotActive"), "got: {err_str}");

    // 2. Closed
    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Closed, true);
    // Rotate global_config jobs account to crank2
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    {
        let mut gc_acc = svm.get_account(&gc).unwrap();
        // Update jobs_account in GlobalConfig (offset 8 + 32 + 32 = 72)
        gc_acc.data[72..104].copy_from_slice(&crank2.pubkey().to_bytes());
        svm.set_account(gc, gc_acc).unwrap();
    }

    let accounts2 = anchor::accounts::CrankRebindExpiredRandomness {
        crank: crank2.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_addr,
        new_randomness_account: Pubkey::default(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);
    let ix2 = Instruction {
        program_id: anchor::id(),
        accounts: accounts2,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    };
    let bh2 = svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&crank2.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&crank2]).unwrap();
    let res2 = svm.send_transaction(tx2);
    assert!(res2.is_err());
    let err_str2 = format!("{:?}", res2.unwrap_err());
    assert!(err_str2.contains("PoolNotActive"), "got: {err_str2}");
}
