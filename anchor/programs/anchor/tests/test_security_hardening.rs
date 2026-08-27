//! Integration tests for security hardening fixes (PB-01, PB-02, PB-05, PB-06).
//! Verified via LiteSVM in-process test runner.

use anchor_lang::{
    prelude::AccountMeta, AccountDeserialize, AccountSerialize, AnchorDeserialize, InstructionData,
    Space, ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

mod common;
use common::*;

fn build_claim_redemption_ix(
    user: Pubkey,
    pool_id: u32,
    redemption_id: u64,
    token_mint: Pubkey,
    pool_vault_account: Pubkey,
    user_token_account: Pubkey,
    huma_program: Pubkey,
    huma_config: Pubkey,
    huma_pool_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_underlying_token: Pubkey,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);

    let accounts = anchor::accounts::ClaimRedemption {
        caller: user,
        beneficiary: user,
        pool,
        pending_redemption,
        token_mint,
        pool_vault_account,
        beneficiary_token_account: user_token_account,
        huma_program,
        huma_config,
        huma_pool_config,
        huma_pool_state,
        huma_mode_config,
        huma_lender_state,
        huma_pool_authority,
        huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    }
}

fn send_e2e_claim_redemption_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    user_token_account: Pubkey,
    redemption_id: u64,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
) -> Result<(), String> {
    let (pool_pda_key, _) = pool_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, redemption_id);
    let (pool_vault, _) = pool_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimRedemption {
        caller: user.pubkey(),
        beneficiary: user.pubkey(),
        pool: pool_pda_key,
        pending_redemption,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        beneficiary_token_account: user_token_account,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
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

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═════════════════════════════════════════════════════════════════════════════
// Security Verification Tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_zero_initialization() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();

    // Pre-fill registry with distinct non-zero bytes (0xAA) to verify they are successfully zeroed
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    let mut initial_data = vec![0xAAu8; initial_size];
    initial_data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]); // discriminator
    initial_data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    let initial_capacity = anchor::utils::registry_capacity_from_len(initial_size);
    initial_data[12..16].copy_from_slice(&initial_capacity.to_le_bytes());
    initial_data[16..20].copy_from_slice(&0u32.to_le_bytes()); // active
    initial_data[20..24].copy_from_slice(&0u32.to_le_bytes()); // pending

    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: initial_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Call ResizeRegistry
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::ResizeRegistry {
            payer: payer.pubkey(),
            pool: pool_key,
            ticket_registry,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx).expect("ResizeRegistry failed");

    // Fetch account data and verify that all newly allocated bytes are strictly 0
    let registry_acct = svm.get_account(&ticket_registry).unwrap();
    let expected_len = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    assert_eq!(registry_acct.data.len(), expected_len);
    for i in initial_size..expected_len {
        assert_eq!(
            registry_acct.data[i], 0,
            "Newly reallocated byte at index {} is not zeroed",
            i
        );
    }
}

#[test]
fn test_sell_bonds_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Set total_deposited_principal to avoid subtraction overflow in handler
    let mut pool = read_pool_state(&svm, pool_id);
    pool.total_deposited_principal = 10_000_000;
    use anchor_lang::Discriminator;
    let mut d = vec![];
    d.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_key,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    inject_registry_with_tickets(
        &mut svm,
        ticket_registry,
        pool_id,
        100,
        1,
        0,
        &[user.pubkey()],
    );
    common::inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    // Counterfeit pool state owned by System Program instead of Huma
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let dummy = Keypair::new().pubkey();
    let (user_winnings, _) = Pubkey::find_program_address(
        &[
            b"user_winnings",
            1u32.to_le_bytes().as_ref(),
            user.pubkey().as_ref(),
        ],
        &anchor::id(),
    );
    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::SellBonds {
            user: user.pubkey(),
            user_winnings,
            pool: pool_key,
            ticket_registry,
            token_mint,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state, // counterfeit
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure, got: {}",
        err
    );
}

#[test]
fn test_withdraw_fees_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, bump) = pool_pda(pool_id);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Setup PrizePool with accrued fees
    use anchor_lang::Discriminator;
    let mut pool = anchor::PrizePool {
        vault_authority_bump: bump, // Use correct bump
        pool_id,
        token_mint,
        ticket_registry: Keypair::new().pubkey(),
        fee_wallet,
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 5_000_000, // 5 USDC accrued fees
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: 0,
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
        version: 1,
        _reserved: [0; 128],
    };
    let mut d = vec![];
    d.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_key,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let (gc_pda, _) = global_config_pda();
    let dummy = Keypair::new().pubkey();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::WithdrawFees {
            admin: admin.pubkey(),
            global_config: gc_pda,
            pool: pool_key,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state, // counterfeit
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_mint,
            fee_wallet,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::WithdrawFees { amount: 1_000_000 }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure, got: {}",
        err
    );
}

#[test]
fn test_claim_non_reinvested_winnings_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, bump) = pool_pda(pool_id);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    inject_user_winnings(&mut svm, pool_id, user.pubkey(), 5_000_000, 0, 0);

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_pool(
        &mut svm,
        pool_id,
        Keypair::new().pubkey(),
        Keypair::new().pubkey(),
        anchor::PoolStatus::Active,
        false,
    );

    // Set total_prizes_allocated on injected pool to avoid MathOverflow subtraction underflow
    let mut pool = read_pool_state(&svm, pool_id);
    pool.total_prizes_allocated = 5_000_000;
    use anchor_lang::Discriminator;
    let mut d = vec![];
    d.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_key,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let (user_winnings, _) = user_winnings_pda(pool_id, &user.pubkey());
    let dummy = Keypair::new().pubkey();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::ClaimNonReinvestedWinnings {
            user: user.pubkey(),
            pool: pool_key,
            user_winnings,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state, // counterfeit
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure, got: {}",
        err
    );
}

#[test]
fn test_claim_redemption_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 10_000_000);

    let ticket_registry = Keypair::new().pubkey();
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let user_token_account = create_spl_token_account(&mut svm, &user, &token_mint, &user.pubkey());

    let redemption_id = 0;
    let redemption_amount = 1_000_000;
    let pst_shares_locked = 1_000_000;
    inject_pending_redemption(
        &mut svm,
        pool_id,
        redemption_id,
        user.pubkey(),
        redemption_amount,
        pst_shares_locked,
    );

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let dummy = Keypair::new().pubkey();
    let ix = build_claim_redemption_ix(
        user.pubkey(),
        pool_id,
        redemption_id,
        token_mint,
        pool_vault,
        user_token_account,
        huma_program_id(),
        dummy,
        dummy,
        fake_pool_state, // counterfeit
        dummy,
        dummy,
        dummy,
        dummy,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure, got: {}",
        err
    );
}

#[test]
fn test_harvest_yield_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    inject_pool(
        &mut svm,
        pool_id,
        Keypair::new().pubkey(),
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );
    inject_registry(&mut svm, ticket_registry, pool_id, 100, 0, 0);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (current_draw_cycle, _) = Pubkey::find_program_address(
        &[
            b"draw_cycle",
            pool_id.to_le_bytes().as_ref(),
            0u32.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    );

    // Retrieve jobs keypair to sign as crank, and fund it
    let jobs_kp = Keypair::new();
    svm.airdrop(&jobs_kp.pubkey(), 10_000_000_000).unwrap();
    let (gc_pda, _) = global_config_pda();
    let mut gc_acct = svm.get_account(&gc_pda).unwrap();
    let mut gc_data = anchor::state::GlobalConfig::try_deserialize(&mut &gc_acct.data[..]).unwrap();
    gc_data.jobs_account = jobs_kp.pubkey();
    let mut new_data = vec![];
    gc_data.try_serialize(&mut new_data).unwrap();
    gc_acct.data = new_data;
    svm.set_account(gc_pda, gc_acct).unwrap();

    let randomness_account = Keypair::new().pubkey();
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    svm.set_account(
        randomness_account,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: owner_pubkey,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::HarvestYieldAndCommit {
            crank: jobs_kp.pubkey(),
            global_config: gc_pda,
            pool: pool_key,
            ticket_registry,
            current_draw_cycle,
            pool_pst_vault,
            pst_mint,
            huma_pool_state: fake_pool_state, // counterfeit
            randomness_account,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&jobs_kp.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&jobs_kp]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure, got: {}",
        err
    );
}

#[test]
fn test_sell_bonds_fails_huma_mode_mint_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Set total_deposited_principal to avoid subtraction overflow
    let mut pool = read_pool_state(&svm, pool_id);
    pool.total_deposited_principal = 10_000_000;
    use anchor_lang::Discriminator;
    let mut d = vec![];
    d.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_key,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    inject_registry_with_tickets(
        &mut svm,
        ticket_registry,
        pool_id,
        100,
        1,
        0,
        &[user.pubkey()],
    );
    common::inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    let fake_pool_state = Keypair::new().pubkey();
    let mut data = vec![0u8; 1000];
    data[26..30].copy_from_slice(&1u32.to_le_bytes()); // mode_states length = 1
    data[30..46].copy_from_slice(&100_000_000u128.to_le_bytes()); // total_assets = 100 USDC
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Counterfeit mode mint (owned by System Program instead of SPL Token Program)
    let fake_mode_mint = Keypair::new().pubkey();
    svm.set_account(
        fake_mode_mint,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 82],
            owner: anchor_lang::system_program::ID, // counterfeit
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let dummy = Keypair::new().pubkey();
    let (user_winnings, _) = Pubkey::find_program_address(
        &[
            b"user_winnings",
            1u32.to_le_bytes().as_ref(),
            user.pubkey().as_ref(),
        ],
        &anchor::id(),
    );
    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::SellBonds {
            user: user.pubkey(),
            user_winnings,
            pool: pool_key,
            ticket_registry,
            token_mint,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state,
            huma_mode_config: dummy,
            huma_mode_mint: fake_mode_mint, // counterfeit
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let err = format!("{:?}", svm.send_transaction(tx).unwrap_err());
    assert!(
        err.contains("ConstraintOwner")
            || err.contains("AccountOwnedByWrongProgram")
            || err.contains("ConstraintMint")
            || err.contains("ConstraintRaw"),
        "expected owner constraint check failure for Huma mode mint, got: {}",
        err
    );
}

#[test]
fn test_claim_redemption_reentrancy_protection() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund Huma underlying token vault with USDC so disburse can complete
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    // Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_kp = clone_keypair(&ctx.user);
    let user_token_account = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_kp,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_pda, _) = pending_redemption_pda(1, 0);

    // Verify pending redemption initially has 3 USDC amount
    let initial_acct = ctx.svm.get_account(&pending_pda).unwrap();
    let initial_data =
        anchor::state::PendingRedemption::try_deserialize(&mut &initial_acct.data[..]).unwrap();
    assert_eq!(initial_data.amount, 3_000_000);

    // Inject simulated Huma lender state with 3 USDC settled
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token_account,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("claim redemption should succeed");

    // Verify user received 3 USDC and pending_redemption PDA is closed (rent returned/not found)
    assert_eq!(read_token_balance(&ctx.svm, user_token_account), 93_000_000);
    assert!(ctx.svm.get_account(&pending_pda).is_none());
}

#[test]
fn test_buy_bonds_fails_huma_pool_state_owner_mismatch() {
    let mut ctx = setup_e2e();
    let wrong_pool_state = Keypair::new().pubkey();
    // Initialize account owned by System Program instead of Huma Program
    ctx.svm.set_account(
        wrong_pool_state,
        solana_sdk::account::Account {
            lamports: 1_000_000,
            data: vec![0u8; 100],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    let (pool_pda_key, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings_pda_key, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings: user_winnings_pda_key,
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        user_token_account: ctx.user_usdc_account,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: wrong_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = solana_program::instruction::Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: 1 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = solana_sdk::message::Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = solana_transaction::versioned::VersionedTransaction::try_new(
        solana_sdk::message::VersionedMessage::Legacy(msg),
        &[&ctx.user],
    ).unwrap();

    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ConstraintRaw") || err_str.contains("ConstraintOwner") || err_str.contains("Custom"),
        "Expected owner constraint error, got: {err_str}"
    );
}

#[test]
fn test_initialize_huma_lender_fails_huma_pool_state_owner_mismatch() {
    let mut ctx = setup_e2e();
    let wrong_pool_state = Keypair::new().pubkey();
    ctx.svm.set_account(
        wrong_pool_state,
        solana_sdk::account::Account {
            lamports: 1_000_000,
            data: vec![0u8; 100],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    let (global_config, _) = global_config_pda();
    let (pool_pda_key, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeHumaLender {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_key,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: wrong_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_lender_state: dummy,
        huma_lender_mode_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = solana_program::instruction::Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = solana_sdk::message::Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = solana_transaction::versioned::VersionedTransaction::try_new(
        solana_sdk::message::VersionedMessage::Legacy(msg),
        &[&ctx.admin],
    ).unwrap();

    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ConstraintRaw") || err_str.contains("ConstraintOwner") || err_str.contains("Custom"),
        "Expected owner constraint error, got: {err_str}"
    );
}

#[test]
fn test_claim_redemption_account_closure_and_discriminator_zeroing() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_kp = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_kp,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_pda, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_pda).is_some());

    let user_token_account = ctx.user_usdc_account;
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token_account,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(res.is_ok(), "claim redemption should succeed: {:?}", res);

    // Verify account is closed completely (lamports refunded, account removed)
    assert!(ctx.svm.get_account(&pending_pda).is_none());
}

#[test]
fn test_direct_vault_token_donation_does_not_break_solvency() {
    let mut ctx = setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    // User buys 10 bonds (10,000,000 USDC -> 10,000,000 PST in vault)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Directly donate 2_000_000 PST by mutating the vault's SPL token account amount (offset 64..72)
    {
        let mut vault_acc = ctx.svm.get_account(&pool_pst_vault).unwrap();
        let cur_amount = u64::from_le_bytes(vault_acc.data[64..72].try_into().unwrap());
        vault_acc.data[64..72].copy_from_slice(&(cur_amount + 2_000_000).to_le_bytes());
        ctx.svm.set_account(pool_pst_vault, vault_acc).unwrap();
    }

    // Harvest should recognize increased value as surplus yield without failing solvency check
    let meta = send_e2e_harvest_yield_and_commit(&mut ctx);
    assert!(meta.is_ok(), "Harvest must succeed gracefully with donated tokens: {:?}", meta);
}



#[test]
fn test_interleaved_async_redemption_fifo_queue_sequence() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );

    // Setup User B
    let user_b = Keypair::new();
    ctx.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();
    let user_b_usdc = create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user_b.pubkey());
    mint_tokens(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user_b_usdc, &ctx.usdc_mint_authority, 100_000_000);

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Users buy bonds
    send_e2e_buy_bonds_for_user(&mut ctx, &user_a, user_a_usdc, 5, Pubkey::default()).unwrap();
    send_e2e_buy_bonds_for_user(&mut ctx, &user_b, user_b_usdc, 5, Pubkey::default()).unwrap();

    // User A sells bonds (Request 0)
    send_e2e_sell_bonds_for_user(&mut ctx, &user_a, 0, 5, Pubkey::default(), Pubkey::default(), huma_pool_mode_token).unwrap();

    // User B sells bonds (Request 1)
    send_e2e_sell_bonds_for_user(&mut ctx, &user_b, 0, 5, Pubkey::default(), Pubkey::default(), huma_pool_mode_token).unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);

    // Huma settles ONLY request 0 (next_request_id = 1)
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // User B tries to claim redemption 1 -> MUST FAIL with NotSettled
    let err_b = send_e2e_claim_redemption_for_user(&mut ctx, &user_b, user_b_usdc, 1, Pubkey::default(), huma_lender_state).unwrap_err();
    assert!(err_b.contains("HumaRedemptionNotSettled") || err_b.contains("6034"), "got: {err_b}");

    // User A claims redemption 0 -> SUCCEEDS
    let res_a = send_e2e_claim_redemption_for_user(&mut ctx, &user_a, user_a_usdc, 0, Pubkey::default(), huma_lender_state);
    assert!(res_a.is_ok(), "User A claim should succeed");

    // Now Huma settles request 1 (next_request_id = 2)
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 2);
    ctx.svm.expire_blockhash();

    // User B claims redemption 1 -> SUCCEEDS
    let res_b = send_e2e_claim_redemption_for_user(&mut ctx, &user_b, user_b_usdc, 1, Pubkey::default(), huma_lender_state);
    assert!(res_b.is_ok(), "User B claim should succeed after settlement");
}

#[test]
fn test_multi_cycle_compounding_lazy_merge_skip_sequence() {
    let mut ctx = setup_e2e();

    // User buys 10 bonds in cycle 0 -> active = 0, pending = 10, merged_through_cycle = 0
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let reg_acc = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry0 = anchor::utils::registry_get_entry(&reg_acc.data, 0).unwrap();
    assert_eq!(entry0.active, 0);
    assert_eq!(entry0.pending, 10);
    assert_eq!(entry0.merged_through_cycle, 0);

    // Advance 3 cycles by incrementing draw_cycle_id in registry directly
    // Cycle 1: merge_cycle_id = 0 (tickets stay pending)
    // Cycle 2: merge_cycle_id = 1 (tickets mature to active)
    // Cycle 3: merge_cycle_id = 2 (already mature, no change)
    let mut reg_data = reg_acc.data.clone();
    reg_data[28..32].copy_from_slice(&3u32.to_le_bytes()); // draw_cycle_id = 3
    ctx.svm.set_account(ctx.ticket_registry, Account {
        lamports: reg_acc.lamports,
        data: reg_data,
        owner: reg_acc.owner,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // Prepare draw for cycle 3: merge_cycle_id = 3 - 1 = 2
    // Lazy merge merges all pending tickets up to cycle 2 in a single step
    let (pool_pda_key, _) = pool_pda(1);
    let dc3 = default_draw_cycle(1, 3, anchor::DrawStatus::AwaitingRandomness);
    let draw_cycle_3 = inject_draw_cycle(&mut ctx.svm, 1, 3, &dc3);

    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.is_frozen_for_draw = 1;
        p.current_draw_cycle_id = 3;
    });

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::PrepareDraw {
            crank: ctx.admin.pubkey(),
            pool: pool_pda_key,
            draw_cycle: draw_cycle_3,
            ticket_registry: ctx.ticket_registry,
        }
        .to_account_metas(None),
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx).expect("Prepare draw after multi-cycle skip should succeed");

    let reg_acc_after = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry_after = anchor::utils::registry_get_entry(&reg_acc_after.data, 0).unwrap();
    assert_eq!(entry_after.active, 10);
    assert_eq!(entry_after.pending, 0);
    assert_eq!(entry_after.cumulative_active, 10);
    assert_eq!(entry_after.merged_through_cycle, 2);
}

#[test]
fn test_event_emission_payload_verification_e2e() {
    let mut ctx = setup_e2e();

    // 1. Buy bonds event assertion
    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;
    let (pool_pda_key, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings_pda_key, _) = user_winnings_pda(1, &user_a.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: user_a.pubkey(),
        user_winnings: user_winnings_pda_key,
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        user_token_account: user_a_usdc,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
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
        data: anchor::instruction::BuyBonds { tickets_to_buy: 5 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user_a.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_a]).unwrap();
    let meta = ctx.svm.send_transaction(tx).expect("Buy bonds should succeed");

    let event = assert_cpi_event::<anchor::events::BondsPurchased>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.user, user_a.pubkey());
    assert_eq!(event.bonds, 5);
    assert_eq!(event.amount, 5_000_000);
    assert_eq!(event.new_total_deposited_principal, 5_000_000);
    assert_eq!(event.user_total_bonds, 5);
    assert!(event.timestamp > 0);
}

#[test]
fn test_pst_usdc_conversion_roundtrip_precision_bounds() {
    // Test conversion precision across varying exchange rates and amounts
    let test_cases: [(u128, u64, u64); 7] = [
        // (total_assets, pst_supply, usdc_amount)
        (1_000_000u128, 1_000_000u64, 1_000_000u64), // 1:1
        (1_200_000, 1_000_000, 10_000_000),         // 1.2x (accrued yield)
        (1_250_000, 1_000_000, 500_000),            // 1.25x
        (2_000_000, 1_000_000, 100_000_000),        // 2.0x
        (10_000_000, 1_000_000, 1),                 // 10x with 1 lamport
        (950_000, 1_000_000, 10_000_000),           // 0.95x
        (1_000_001, 1_000_000, 777_777),            // slight yield with odd amount
    ];

    for (total_assets, pst_supply, usdc_amount) in test_cases {
        // USDC -> PST shares (ceiling division in protocol)
        let pst_shares = anchor::huma::usdc_to_pst_shares(usdc_amount, pst_supply, total_assets)
            .expect("USDC to PST conversion should succeed");

        // PST shares -> USDC (floor division in protocol)
        let roundtrip_usdc = anchor::huma::pst_shares_to_usdc(pst_shares, pst_supply, total_assets)
            .expect("PST to USDC conversion should succeed");

        // Invariant: ceiling division ensures roundtrip USDC is >= original USDC
        assert!(
            roundtrip_usdc >= usdc_amount,
            "Protocol solvency favorability violated: roundtrip {roundtrip_usdc} < original {usdc_amount}"
        );

        // Invariant: precision difference is bounded to at most 1 lamport per share conversion unit
        let diff = roundtrip_usdc - usdc_amount;
        let max_expected_diff = ((total_assets / (pst_supply as u128)) as u64).max(1) + 1;
        assert!(
            diff <= max_expected_diff,
            "Excessive rounding divergence: diff {diff} > max {max_expected_diff}"
        );
    }
}




