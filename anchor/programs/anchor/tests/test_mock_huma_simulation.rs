use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

mod common;
use common::*;

#[test]
fn test_huma_simulation_yield_and_settle() {
    let mut svm = LiteSVM::new();
    let mock_huma_id = mock_huma::id();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    // Load mock_huma program
    let _ = svm.add_program(
        mock_huma_id,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    // 1. Initialize Pool State Account owned by Mock Huma
    let pool_state_kp = Keypair::new();

    let init_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::InitializeMockPoolState {}.data(),
        mock_huma::accounts::InitializeMockPoolState {
            pool_state: pool_state_kp.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );

    send_tx(&mut svm, &payer, &[&pool_state_kp], init_instruction).unwrap();

    // Verify it was initialized with mode length = 1
    assert_eq!(
        read_mock_huma_mode_count(&svm, pool_state_kp.pubkey()),
        1,
        "Mock pool state must initialize with 1 mode entry"
    );

    // 2. Test simulate_yield Delta Addition
    let yield_amount = 5_000_000u64; // 5 USDC
    let yield_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateYield { yield_amount }.data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );

    send_user_tx(&mut svm, &payer, yield_instruction).unwrap();

    // Verify assets increased by delta
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        5_000_000,
        "Mock pool state assets must increase by simulated yield"
    );
}

#[test]
fn test_huma_simulation_set_total_assets() {
    let mut svm = LiteSVM::new();
    let mock_huma_id = mock_huma::id();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let _ = svm.add_program(
        mock_huma_id,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    let pool_state_kp = Keypair::new();
    let init_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::InitializeMockPoolState {}.data(),
        mock_huma::accounts::InitializeMockPoolState {
            pool_state: pool_state_kp.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_tx(&mut svm, &payer, &[&pool_state_kp], init_instruction).unwrap();

    // Vector 1: Happy path - Set total assets to 50,000,000 (50 USDC)
    let set_50m_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 50_000_000u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_50m_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        50_000_000,
        "Pool assets must match 50,000,000"
    );

    // Vector 2: Bidirectional downward adjustment (Deficit / Insolvency)
    let set_20m_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 20_000_000u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_20m_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        20_000_000,
        "Pool assets must decrease to 20,000,000"
    );

    // Vector 3: Bidirectional upward adjustment (Yield recovery)
    let set_80m_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 80_000_000u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_80m_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        80_000_000,
        "Pool assets must increase to 80,000,000"
    );

    // Vector 4: Extreme boundary - 0 (Complete loss)
    let set_0_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 0u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_0_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        0,
        "Pool assets must be 0"
    );

    // Vector 5: Extreme boundary - u128::MAX
    let set_max_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: u128::MAX,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_max_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        u128::MAX,
        "Pool assets must support full u128 range"
    );

    // Vector 6: Idempotency - sequential identical calls produce stable state
    let set_100_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 100u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_100_ix.clone()).unwrap();
    svm.expire_blockhash();
    send_user_tx(&mut svm, &payer, set_100_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        100,
        "Idempotent set must remain 100"
    );

    // Vector 7: Negative cases - Invalid owner & Invalid buffer length
    // 7a: Invalid owner
    let non_owner_kp = Keypair::new();
    svm.airdrop(&non_owner_kp.pubkey(), 1_000_000_000).unwrap();
    let invalid_owner_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 500u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: non_owner_kp.pubkey(), // owned by system program, not mock_huma
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    let res = send_user_tx(&mut svm, &payer, invalid_owner_ix);
    assert!(
        res.is_err(),
        "Setting total assets on an account not owned by mock_huma must fail"
    );

    // 7b: Invalid pool state data length (< 46 bytes)
    let short_account = Keypair::new();
    svm.set_account(
        short_account.pubkey(),
        solana_sdk::account::Account {
            lamports: 1_000_000,
            data: vec![0u8; 30], // 30 bytes < 46 bytes
            owner: mock_huma_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let short_buf_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 500u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: short_account.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    let res_short = send_user_tx(&mut svm, &payer, short_buf_ix);
    assert!(
        res_short.is_err(),
        "Setting total assets on account with < 46 bytes must fail with InvalidPoolStateData"
    );
}

#[test]
fn test_huma_simulation_deficit() {
    let mut svm = LiteSVM::new();
    let mock_huma_id = mock_huma::id();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let _ = svm.add_program(
        mock_huma_id,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    let pool_state_kp = Keypair::new();
    let init_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::InitializeMockPoolState {}.data(),
        mock_huma::accounts::InitializeMockPoolState {
            pool_state: pool_state_kp.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_tx(&mut svm, &payer, &[&pool_state_kp], init_instruction).unwrap();

    // Seed pool state with 10M total assets
    let set_10m_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 10_000_000u128,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, set_10m_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        10_000_000
    );

    // Vector 1: Happy path - simulate 4M deficit (10M - 4M = 6M)
    let deficit_4m_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: 4_000_000u64,
        }
        .data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, deficit_4m_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        6_000_000,
        "Pool assets must decrease by 4M to 6M"
    );

    // Vector 2: Boundary - 0 deficit leaves assets unchanged
    let deficit_0_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateDeficit { deficit_amount: 0u64 }.data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, deficit_0_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        6_000_000,
        "0 deficit must leave assets unchanged"
    );

    // Vector 3: Boundary / Saturation - Deficit exceeding current assets saturates to 0
    let deficit_max_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: u64::MAX,
        }
        .data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, deficit_max_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        0,
        "Excessive deficit must saturate total assets to 0"
    );

    // Vector 4: Zero-asset pool saturation - calling simulate_deficit when total_assets == 0 remains 0
    let deficit_again_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: 1_000_000u64,
        }
        .data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut svm, &payer, deficit_again_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        0,
        "Deficit on 0-asset pool remains 0"
    );

    // Vector 5: Access control / Ownership constraint
    let non_owner_kp = Keypair::new();
    svm.airdrop(&non_owner_kp.pubkey(), 1_000_000_000).unwrap();
    let invalid_owner_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: 500u64,
        }
        .data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: non_owner_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    let res = send_user_tx(&mut svm, &payer, invalid_owner_ix);
    assert!(
        res.is_err(),
        "Simulating deficit on non-mock_huma owned account must fail"
    );
}

