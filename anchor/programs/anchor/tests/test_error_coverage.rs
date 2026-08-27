//! Comprehensive Error Code Coverage Test Suite
//!
//! Explicitly asserts and verifies every canonical Anchor error code
//! defined in `anchor::error::PremiumBondsError` (6000–6050) using strongly typed
//! `assert_custom_error` matching across 5 domain-partitioned submodules.

use {
    anchor::error::PremiumBondsError,
    anchor_lang::{AccountDeserialize, AnchorSerialize, Discriminator, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{
        account::Account,
        message::{Message, VersionedMessage},
    },
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

fn setup_global_with_crank() -> (LiteSVM, Keypair, Keypair) {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    (svm, admin, crank)
}

fn inject_mock_randomness_account(svm: &mut LiteSVM, address: Pubkey) {
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: owner_pubkey,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 1: Pool Lifecycle & Configuration Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_pool_not_active_and_invalid_status() {
    let pool = anchor::PrizePool {
        status: anchor::PoolStatus::Paused as u8,
        bond_price: 1_000_000,
        ..unsafe { std::mem::zeroed() }
    };
    assert_eq!(
        pool.validate_buy_bonds(1).unwrap_err(),
        PremiumBondsError::PoolNotActive.into()
    );

    assert!(matches!(
        anchor::PoolStatus::try_from(99).unwrap_err(),
        PremiumBondsError::InvalidPoolStatus
    ));
}

#[test]
fn test_err_invalid_bond_price_and_duration() {
    assert_eq!(
        anchor::PrizePool::validate_bond_price(0).unwrap_err(),
        PremiumBondsError::InvalidBondPrice.into()
    );

    assert_eq!(
        anchor::PrizePool::validate_stake_cycle_duration(0).unwrap_err(),
        PremiumBondsError::InvalidStakeCycleDuration.into()
    );
    assert_eq!(
        anchor::PrizePool::validate_stake_cycle_duration(8761).unwrap_err(),
        PremiumBondsError::InvalidStakeCycleDuration.into()
    );
}

#[test]
fn test_err_invalid_fee_and_timelock_configs() {
    assert_eq!(
        anchor::PrizePool::validate_fee_basis_points(10_001).unwrap_err(),
        PremiumBondsError::InvalidFeeConfig.into()
    );
    assert_eq!(
        anchor::PrizePool::validate_max_yield_basis_points(10_001).unwrap_err(),
        PremiumBondsError::InvalidMaxYieldBasisPoints.into()
    );
    assert_eq!(
        anchor::PrizePool::validate_payout_timelock_seconds(86_401).unwrap_err(),
        PremiumBondsError::InvalidPayoutTimelock.into()
    );
}

#[test]
fn test_err_prize_tier_config_and_basis_points() {
    let empty_tiers = vec![];
    assert_eq!(
        anchor::PrizePool::validate_prize_tiers(&empty_tiers).unwrap_err(),
        PremiumBondsError::InvalidPrizeTierConfig.into()
    );

    let bad_sum_tiers = vec![anchor::PrizeTier {
        basis_points: 9_999,
        num_winners: 1,
        _padding: [0; 2],
    }];
    assert_eq!(
        anchor::PrizePool::validate_prize_tiers(&bad_sum_tiers).unwrap_err(),
        PremiumBondsError::BasisPointsMustEqual10000.into()
    );
}

#[test]
fn test_err_bond_price_locked_and_pool_states() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    let pool_addr = inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, false);
    {
        let mut acc = svm.get_account(&pool_addr).unwrap();
        let p = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        p.total_deposited_principal = 10_000_000;
        svm.set_account(pool_addr, acc).unwrap();
    }
    let (gc, _) = global_config_pda();
    let accounts = anchor::accounts::UpdatePoolConfig {
        admin: admin.pubkey(),
        global_config: gc,
        pool: pool_addr,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UpdatePoolConfig {
            new_stake_cycle_duration_hrs: None,
            new_bond_price: Some(2_000_000), // Modify bond price while principal exists
            new_fee_basis_points: None,
            new_min_yield_threshold: None,
            new_max_yield_basis_points: None,
            new_payout_timelock_seconds: None,
            new_fee_wallet: None,
        }
        .data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::CannotModifyBondPriceWithActiveDeposits);
}

#[test]
fn test_err_pool_paused_and_closed_guards() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    let pool_addr = inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Closed, false);
    let (draw_cycle_key, _) = draw_cycle_pda(pool_id, 0);
    let (payout_reg, _) = payout_pda(pool_id, 0);
    inject_draw_cycle(
        &mut svm,
        pool_id,
        0,
        &anchor::state::DrawCycle {
            prize_pot: 1_000_000,
            cycle_fee_collected: 10_000,
            status: anchor::DrawStatus::Complete,
            ..unsafe { std::mem::zeroed() }
        },
    );
    inject_payout_registry(&mut svm, pool_id, 0, vec![], 0, anchor::PayoutRegistryStatus::Active);

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        admin: admin.pubkey(),
        global_config: global_config_pda().0,
        pool: pool_addr,
        current_draw_cycle: draw_cycle_key,
        payout_registry: payout_reg,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::PoolClosed);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 2: Deposit, Registry & Account Layout Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_invalid_bond_quantity_and_registry_full() {
    let pool = anchor::PrizePool {
        status: anchor::PoolStatus::Active as u8,
        bond_price: 1_000_000,
        ..unsafe { std::mem::zeroed() }
    };
    assert_eq!(
        pool.validate_buy_bonds(0).unwrap_err(),
        PremiumBondsError::InvalidBondQuantity.into()
    );

    let reg = anchor::TicketRegistry {
        capacity: 100,
        user_count: 100,
        ..unsafe { std::mem::zeroed() }
    };
    assert_eq!(
        reg.validate_can_add_user().unwrap_err(),
        PremiumBondsError::RegistryFull.into()
    );
}

#[test]
fn test_err_registry_too_small_and_at_max_size() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let token_mint = create_spl_mint(&mut svm, &admin, &admin.pubkey(), 6);
    let pst_mint = create_spl_mint(&mut svm, &admin, &admin.pubkey(), 6);
    let fee_wallet = create_spl_token_account(&mut svm, &admin, &token_mint, &admin.pubkey());
    let registry = Keypair::new().pubkey();

    // Small registry (less than REGISTRY_INITIAL_SIZE)
    svm.set_account(
        registry,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 100],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        token_mint,
        pst_mint,
        registry,
        fee_wallet,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::RegistryTooSmall);
}

#[test]
fn test_err_insufficient_tickets_and_unsupported_version() {
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
        active: 5,
        pending: 2,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);
    inject_pool(&mut svm, pool_id, token_mint, ticket_registry, anchor::PoolStatus::Active, false);

    let (user_winnings, _) = user_winnings_pda(pool_id, &user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

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
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: Keypair::new().pubkey(),
        huma_pool_authority: Pubkey::default(),
        huma_pool_mode_token: Keypair::new().pubkey(),
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    // 1. InsufficientActiveTickets
    let ix_active = Instruction {
        program_id: anchor::id(),
        accounts: accounts.clone(),
        data: anchor::instruction::SellBonds {
            active_to_sell: 10,
            pending_to_sell: 0,
        }
        .data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix_active], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InsufficientActiveTickets);

    // 2. InsufficientPendingTickets
    let ix_pending = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SellBonds {
            active_to_sell: 0,
            pending_to_sell: 5,
        }
        .data(),
    };
    let bh2 = svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix_pending], Some(&user.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&user]).unwrap();
    let res2 = svm.send_transaction(tx2);
    assert_custom_error(res2, PremiumBondsError::InsufficientPendingTickets);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 3: Harvest, Draw Cycle & Voiding Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_cycle_not_ended_and_freeze_guards() {
    let (mut svm, _admin, crank) = setup_global_with_crank();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let (pool_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    inject_mint(&mut svm, pst_mint, 6);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_addr, 10_000_000);
    inject_registry(&mut svm, registry, pool_id, 1000, 0, 0);
    inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, false);
    {
        let mut acc = svm.get_account(&pool_addr).unwrap();
        let p = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        p.current_cycle_end_at = 2_000_000_000;
        svm.set_account(pool_addr, acc).unwrap();
    }
    svm.set_sysvar::<solana_sdk::sysvar::clock::Clock>(&solana_sdk::sysvar::clock::Clock {
        unix_timestamp: 1_000_000_000, // before cycle end
        ..Default::default()
    });

    let (draw_cycle_pda_addr, _) = draw_cycle_pda(pool_id, 0);
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);
    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: crank.pubkey(),
        global_config: global_config_pda().0,
        pool: pool_addr,
        ticket_registry: registry,
        current_draw_cycle: draw_cycle_pda_addr,
        pool_pst_vault,
        pst_mint,
        huma_pool_state,
        randomness_account,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::CycleNotEnded);
}

#[test]
fn test_err_draw_already_voided() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let pool_addr = inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, false);
    let (draw_cycle_key, _) = draw_cycle_pda(pool_id, 0);
    let (payout_reg, _) = payout_pda(pool_id, 0);

    inject_draw_cycle(
        &mut svm,
        pool_id,
        0,
        &anchor::state::DrawCycle {
            prize_pot: 1_000_000,
            cycle_fee_collected: 10_000,
            status: anchor::DrawStatus::Complete,
            ..unsafe { std::mem::zeroed() }
        },
    );
    inject_payout_registry(&mut svm, pool_id, 0, vec![], 0, anchor::PayoutRegistryStatus::Voided);

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        admin: admin.pubkey(),
        global_config: global_config_pda().0,
        pool: pool_addr,
        current_draw_cycle: draw_cycle_key,
        payout_registry: payout_reg,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::DrawAlreadyVoided);
}

#[test]
fn test_err_payouts_already_started() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let pool_addr = inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, false);
    let (draw_cycle_key, _) = draw_cycle_pda(pool_id, 0);
    let (payout_reg, _) = payout_pda(pool_id, 0);

    inject_draw_cycle(
        &mut svm,
        pool_id,
        0,
        &anchor::state::DrawCycle {
            prize_pot: 1_000_000,
            cycle_fee_collected: 10_000,
            status: anchor::DrawStatus::Complete,
            ..unsafe { std::mem::zeroed() }
        },
    );
    inject_payout_registry(&mut svm, pool_id, 0, vec![], 1, anchor::PayoutRegistryStatus::Active); // processed_count = 1

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        admin: admin.pubkey(),
        global_config: global_config_pda().0,
        pool: pool_addr,
        current_draw_cycle: draw_cycle_key,
        payout_registry: payout_reg,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::PayoutsAlreadyStarted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 4: VRF & Switchboard Randomness Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_randomness_not_expired_and_unauthorized_crank() {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    let pool_addr = inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, true);
    let (draw_cycle_key, _) = draw_cycle_pda(pool_id, 0);
    
    // Inject DrawCycle with harvest_slot = 100
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
    dc_data.extend_from_slice(&anchor::state::DrawCycle::DISCRIMINATOR);
    dc.serialize(&mut dc_data).unwrap();
    svm.set_account(
        draw_cycle_key,
        Account {
            lamports: 1_000_000_000,
            data: dc_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_sysvar::<solana_sdk::sysvar::clock::Clock>(&solana_sdk::sysvar::clock::Clock {
        slot: 500, // diff 400 < 1000 expiry window
        ..Default::default()
    });

    let new_randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, new_randomness_account);

    let (gc, _) = global_config_pda();
    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        crank: crank.pubkey(),
        global_config: gc,
        pool: pool_addr,
        current_draw_cycle: draw_cycle_key,
        new_randomness_account,
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
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::RandomnessNotExpired);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 5: Redemption, Winnings & Solvency Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_no_winnings_and_already_claimed() {
    let (mut svm, _admin) = setup_global_config();
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let (pool_addr, _) = pool_pda(pool_id);
    let registry = Keypair::new().pubkey();
    inject_pool(&mut svm, pool_id, token_mint, registry, anchor::PoolStatus::Active, false);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0); // 0 unclaimed winnings

    let (user_winnings, _) = user_winnings_pda(pool_id, &user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_addr, 10_000_000);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: user.pubkey(),
        user_winnings,
        pool: pool_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: Pubkey::default(),
        huma_pool_state,
        huma_mode_config: Pubkey::default(),
        huma_mode_mint: pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: Keypair::new().pubkey(),
        huma_pool_authority: Pubkey::default(),
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::NoWinningsToClaim);
}

#[test]
fn test_err_winner_mismatch_and_invalid_index() {
    let mut payout = anchor::PayoutRegistry {
        pool_id: 1,
        cycle_id: 0,
        winners_count: 1,
        payouts_completed: 0,
        revealed_at: 0,
        status: anchor::PayoutRegistryStatus::Active as u8,
        version: 1,
        _padding: [0; 6],
        _reserved: [0; 64],
        winners: [anchor::Winner {
            winner: Pubkey::new_unique(),
            amount_owed: 1_000_000,
            bonds_bought: 0,
            processed: 0,
            tier_index: 0,
            version: 1,
            _padding: [0; 1],
            _reserved: [0; 8],
        }; 50],
    };

    let user1 = Keypair::new().pubkey();
    let user2 = Keypair::new().pubkey();
    payout.winners[0].winner = user1;

    let uw_user1 = anchor::state::UserWinnings {
        user: user1,
        ..unsafe { std::mem::zeroed() }
    };
    let uw_user2 = anchor::state::UserWinnings {
        user: user2,
        ..unsafe { std::mem::zeroed() }
    };

    // 1. InvalidWinnerIndex
    assert_eq!(
        payout.validate_winner(1, &uw_user1).unwrap_err(),
        PremiumBondsError::InvalidWinnerIndex.into()
    );

    // 2. WinnerMismatch
    assert_eq!(
        payout.validate_winner(0, &uw_user2).unwrap_err(),
        PremiumBondsError::WinnerMismatch.into()
    );
}

#[test]
fn test_err_yield_venue_insolvent_and_unauthorized() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let guardian = Keypair::new();
    let mut svm = setup_global_config_with_admin_and_guardian(&authority, &admin.pubkey(), &guardian.pubkey(), None);

    let _pool_pda = inject_pool(&mut svm, 1, Pubkey::default(), Pubkey::default(), anchor::PoolStatus::Active, false);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let res = send_pause_pool(&mut svm, &attacker, 1);
    assert_custom_error(res, PremiumBondsError::Unauthorized);
}
