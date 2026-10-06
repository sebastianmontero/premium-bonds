use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::pubkey::Pubkey,
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
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: 0u64,
        }
        .data(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// Dynamic PST-Valued Redemption Simulation Suite (7 Comprehensive Vectors)
// ═══════════════════════════════════════════════════════════════════════════════

struct MockHumaTestEnv {
    svm: LiteSVM,
    admin: Keypair,
    user: Keypair,
    usdc_mint_authority: Keypair,
    usdc_mint: Pubkey,
    pst_mint: Pubkey,
    pool_state: Pubkey,
    pool_authority: Pubkey,
    pool_underlying_token: Pubkey,
    pool_mode_token: Pubkey,
    user_underlying_token: Pubkey,
    user_mode_token: Pubkey,
    lender_state: Pubkey,
}

fn setup_mock_huma_env() -> MockHumaTestEnv {
    let mut svm = setup_svm();
    let admin = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&admin.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 50_000_000_000).unwrap();

    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000)
        .unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    let pool_state_kp = Keypair::new();
    let pool_state = pool_state_kp.pubkey();
    let init_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::InitializeMockPoolState {}.data(),
        mock_huma::accounts::InitializeMockPoolState {
            pool_state,
            payer: admin.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_tx(&mut svm, &admin, &[&pool_state_kp], init_instruction).unwrap();

    let (pool_authority, _) = huma_pool_authority_pda(&pool_state);

    let pst_mint_kp = Keypair::new();
    inject_mint_with_authority_and_supply(&mut svm, pst_mint_kp.pubkey(), pool_authority, 6, 0);
    let pst_mint = pst_mint_kp.pubkey();

    let pool_underlying_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        pool_underlying_token,
        usdc_mint,
        pool_authority,
        0,
    );

    let pool_mode_token = Keypair::new().pubkey();
    inject_token_account(&mut svm, pool_mode_token, pst_mint, pool_authority, 0);

    let user_underlying_token =
        create_spl_token_account(&mut svm, &user, &usdc_mint, &user.pubkey());
    let user_mode_token = create_spl_token_account(&mut svm, &user, &pst_mint, &user.pubkey());

    let lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut svm, lender_state, 0);

    MockHumaTestEnv {
        svm,
        admin,
        user,
        usdc_mint_authority,
        usdc_mint,
        pst_mint,
        pool_state,
        pool_authority,
        pool_underlying_token,
        pool_mode_token,
        user_underlying_token,
        user_mode_token,
        lender_state,
    }
}

fn send_mock_deposit(env: &mut MockHumaTestEnv, amount: u64, huma_config: Pubkey) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::Deposit { assets: amount }.data(),
        mock_huma::accounts::MockDeposit {
            depositor: env.user.pubkey(),
            huma_config: if huma_config != Pubkey::default() {
                huma_config
            } else {
                dummy
            },
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            mode_mint: env.pst_mint,
            pool_authority: env.pool_authority,
            underlying_mint: env.usdc_mint,
            pool_underlying_token: env.pool_underlying_token,
            depositor_underlying_token: env.user_underlying_token,
            depositor_mode_token: env.user_mode_token,
            underlying_token_program: anchor_spl::token::ID,
            mode_token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.user, ix)
}

fn send_mock_add_redemption(
    env: &mut MockHumaTestEnv,
    shares: u64,
    huma_config: Pubkey,
) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::AddRedemptionRequestV2 { shares }.data(),
        mock_huma::accounts::MockAddRedemptionRequest {
            payer: env.user.pubkey(),
            lender: env.user.pubkey(),
            huma_config: if huma_config != Pubkey::default() {
                huma_config
            } else {
                dummy
            },
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            mode_mint: env.pst_mint,
            redemption_request: dummy,
            lender_state: env.lender_state,
            pool_authority: env.pool_authority,
            pool_mode_token: env.pool_mode_token,
            lender_mode_token: env.user_mode_token,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.user, ix)
}

fn send_mock_settle_requests(env: &mut MockHumaTestEnv, count: u32) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SettleRequests { count }.data(),
        mock_huma::accounts::MockSettleRequests {
            lender: env.admin.pubkey(),
            huma_config: dummy,
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            lender_state: env.lender_state,
            underlying_mint: env.usdc_mint,
            mode_mint: env.pst_mint,
            pool_authority: env.pool_authority,
            pool_underlying_token: env.pool_underlying_token,
            pool_mode_token: env.pool_mode_token,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, ix)
}

fn send_mock_disburse_full(
    env: &mut MockHumaTestEnv,
    huma_config: Pubkey,
    lender_state: Pubkey,
) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::Disburse {}.data(),
        mock_huma::accounts::MockDisburse {
            lender: env.user.pubkey(),
            huma_config: if huma_config != Pubkey::default() {
                huma_config
            } else {
                dummy
            },
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            lender_state: if lender_state != Pubkey::default() {
                lender_state
            } else {
                env.lender_state
            },
            underlying_mint: env.usdc_mint,
            pool_authority: env.pool_authority,
            pool_underlying_token: env.pool_underlying_token,
            lender_underlying_token: env.user_underlying_token,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.user, ix)
}

fn send_mock_disburse(env: &mut MockHumaTestEnv) -> TxResult {
    send_mock_disburse_full(env, Pubkey::default(), Pubkey::default())
}

// ─── Vector 1: 1:1 Parity Dynamic Redemptions ───────────────────────────────

#[test]
fn test_huma_dynamic_redemption_1_to_1_parity() {
    let mut env = setup_mock_huma_env();

    // 1. Fund user with 10 USDC (10_000_000)
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        10_000_000,
    );

    // 2. Deposit 10 USDC -> user receives 10 PST, pool has 10 USDC
    send_mock_deposit(&mut env, 10_000_000, Pubkey::default()).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, env.user_mode_token),
        10_000_000
    );
    assert_eq!(
        read_token_balance(&env.svm, env.pool_underlying_token),
        10_000_000
    );
    assert_eq!(
        read_mock_huma_pool_assets(&env.svm, env.pool_state),
        10_000_000
    );

    // 3. User requests redemption of 3 PST (3_000_000)
    send_mock_add_redemption(&mut env, 3_000_000, Pubkey::default()).unwrap();
    assert_eq!(read_token_balance(&env.svm, env.user_mode_token), 7_000_000);
    assert_eq!(read_token_balance(&env.svm, env.pool_mode_token), 3_000_000);

    // 4. Settle redemption request (count = 1)
    send_mock_settle_requests(&mut env, 1).unwrap();

    // Escrowed PST burned, pool assets decreased by exactly 3 USDC to 7 USDC
    assert_eq!(read_token_balance(&env.svm, env.pool_mode_token), 0);
    assert_eq!(
        read_mock_huma_pool_assets(&env.svm, env.pool_state),
        7_000_000
    );

    // Lender state owed accumulated to 3 USDC
    let owed = read_lender_owed_from_svm(&env.svm, env.lender_state);
    assert_eq!(owed, 3_000_000, "Lender state owed must equal 3 USDC");

    // 5. Disburse owed USDC to user
    send_mock_disburse(&mut env).unwrap();

    // User receives exact 3 USDC, pool has 7 USDC remaining, lender owed is 0
    assert_eq!(
        read_token_balance(&env.svm, env.user_underlying_token),
        3_000_000
    );
    assert_eq!(
        read_token_balance(&env.svm, env.pool_underlying_token),
        7_000_000
    );
    assert_eq!(read_lender_owed_from_svm(&env.svm, env.lender_state), 0);
}

// ─── Vector 2: Accrued Yield Dynamic Redemptions ─────────────────────────────

#[test]
fn test_huma_dynamic_redemption_accrued_yield() {
    let mut env = setup_mock_huma_env();

    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        10_000_000,
    );

    // 1. Deposit 10 USDC -> 10 PST
    send_mock_deposit(&mut env, 10_000_000, Pubkey::default()).unwrap();

    // 2. Simulate yield: +2 USDC (total assets = 12 USDC, PST supply = 10 -> 1.2x price)
    let yield_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SimulateYield {
            yield_amount: 2_000_000,
        }
        .data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, yield_ix).unwrap();

    // Mint 2 USDC into pool underlying token to provide yield liquidity
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.pool_underlying_token,
        &env.usdc_mint_authority,
        2_000_000,
    );
    assert_eq!(
        read_token_balance(&env.svm, env.pool_underlying_token),
        12_000_000
    );

    // 3. User redeems 2.5 PST (2_500_000)
    send_mock_add_redemption(&mut env, 2_500_000, Pubkey::default()).unwrap();

    // 4. Settle requests: value = 2.5 PST * 12 USDC / 10 PST = 3.0 USDC (3_000_000)
    send_mock_settle_requests(&mut env, 1).unwrap();
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        3_000_000
    );
    assert_eq!(
        read_mock_huma_pool_assets(&env.svm, env.pool_state),
        9_000_000
    );

    // 5. Disburse transfers exact 3 USDC
    send_mock_disburse(&mut env).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, env.user_underlying_token),
        3_000_000
    );
    assert_eq!(
        read_token_balance(&env.svm, env.pool_underlying_token),
        9_000_000
    );
    assert_eq!(read_lender_owed_from_svm(&env.svm, env.lender_state), 0);
}

// ─── Vector 3: Deficit Dynamic Redemptions ───────────────────────────────────

#[test]
fn test_huma_dynamic_redemption_deficit() {
    let mut env = setup_mock_huma_env();

    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        10_000_000,
    );

    // 1. Deposit 10 USDC -> 10 PST
    send_mock_deposit(&mut env, 10_000_000, Pubkey::default()).unwrap();

    // 2. Simulate deficit: -2 USDC (total assets = 8 USDC, PST supply = 10 -> 0.8x price)
    let deficit_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SimulateDeficit {
            deficit_amount: 2_000_000,
        }
        .data(),
        mock_huma::accounts::MockSimulateDeficit {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, deficit_ix).unwrap();
    assert_eq!(
        read_mock_huma_pool_assets(&env.svm, env.pool_state),
        8_000_000
    );

    // 3. User redeems 5 PST (5_000_000)
    send_mock_add_redemption(&mut env, 5_000_000, Pubkey::default()).unwrap();

    // 4. Settle requests: value = 5 PST * 8 USDC / 10 PST = 4.0 USDC (4_000_000)
    send_mock_settle_requests(&mut env, 1).unwrap();
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        4_000_000
    );
    assert_eq!(
        read_mock_huma_pool_assets(&env.svm, env.pool_state),
        4_000_000
    );

    // 5. Disburse transfers exact 4 USDC
    send_mock_disburse(&mut env).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, env.user_underlying_token),
        4_000_000
    );
    assert_eq!(
        read_token_balance(&env.svm, env.pool_underlying_token),
        6_000_000
    );
    assert_eq!(read_lender_owed_from_svm(&env.svm, env.lender_state), 0);
}

// ─── Vector 4: Multi-Batch Sequential Disbursal ──────────────────────────────

#[test]
fn test_huma_multi_batch_sequential_disbursal() {
    let mut env = setup_mock_huma_env();

    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        20_000_000,
    );

    // Deposit 20 USDC
    send_mock_deposit(&mut env, 20_000_000, Pubkey::default()).unwrap();

    // Queue 2 requests of 5 PST each
    send_mock_add_redemption(&mut env, 5_000_000, Pubkey::default()).unwrap();
    send_mock_add_redemption(&mut env, 5_000_000, Pubkey::default()).unwrap();

    // Settle both requests (count = 2)
    send_mock_settle_requests(&mut env, 2).unwrap();
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        10_000_000,
        "Total owed across 2 settled requests must equal 10 USDC"
    );

    // Simulate limited liquidity in Huma vault: set pool_underlying balance to 6 USDC
    set_token_balance(&mut env.svm, env.pool_underlying_token, 6_000_000);

    // First disburse: capped to available balance (6 USDC)
    send_mock_disburse(&mut env).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, env.user_underlying_token),
        6_000_000
    );
    assert_eq!(read_token_balance(&env.svm, env.pool_underlying_token), 0);
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        4_000_000,
        "Remaining owed in lender_state must be decremented to 4 USDC"
    );

    // Top up Huma pool underlying vault with 4 USDC
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.pool_underlying_token,
        &env.usdc_mint_authority,
        4_000_000,
    );

    // Second disburse: transfers remaining 4 USDC
    send_mock_disburse(&mut env).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, env.user_underlying_token),
        10_000_000
    );
    assert_eq!(read_token_balance(&env.svm, env.pool_underlying_token), 0);
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        0,
        "Final owed amount must be 0 after full sequential disbursal"
    );
}

// ─── Vector 5: Non-Divisible Remainder Truncation (Floor Division) ───────────

#[test]
fn test_huma_non_divisible_floor_division_truncation() {
    // 1. Pure function assertions: strict floor division (never ceiling or rounding up)
    // 2_999_992 * 10_000_030 / 10_000_000 = 30_000_001_999_976 / 10_000_000 = 3_000_000 (floor)
    let val1 = mock_huma::pst_shares_to_usdc(2_999_992, 10_000_000, 10_000_030).unwrap();
    assert_eq!(
        val1, 3_000_000,
        "Math must floor 3_000_000.1999976 down to 3_000_000"
    );

    // 2_999_991 * 10_000_030 / 10_000_000 = 29_999_999_999_973 / 10_000_000 = 2_999_999 (floor)
    let val2 = mock_huma::pst_shares_to_usdc(2_999_991, 10_000_000, 10_000_030).unwrap();
    assert_eq!(
        val2, 2_999_999,
        "Math must floor 2_999_999.999973 down to 2_999_999"
    );

    // 2. End-to-End SVM execution with non-divisible assets
    let mut env = setup_mock_huma_env();
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        10_000_000,
    );
    send_mock_deposit(&mut env, 10_000_000, Pubkey::default()).unwrap();

    // Set total assets to 10_000_030
    let set_assets_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 10_000_030,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, set_assets_ix).unwrap();

    // Redeem 2_999_992 PST
    send_mock_add_redemption(&mut env, 2_999_992, Pubkey::default()).unwrap();

    // Settle
    send_mock_settle_requests(&mut env, 1).unwrap();
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        3_000_000,
        "On-chain settlement must truncate remainder strictly downwards"
    );
}

// ─── Vector 6: Proportional Partial Batch Settlement ─────────────────────────

#[test]
fn test_huma_proportional_partial_batch_settlement() {
    let mut env = setup_mock_huma_env();

    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        20_000_000,
    );
    send_mock_deposit(&mut env, 20_000_000, Pubkey::default()).unwrap();

    // Queue request 0: 3 PST (3_000_000)
    send_mock_add_redemption(&mut env, 3_000_000, Pubkey::default()).unwrap();
    // Queue request 1: 7 PST (7_000_000)
    send_mock_add_redemption(&mut env, 7_000_000, Pubkey::default()).unwrap();

    // Total escrowed = 10 PST, pending count = 2
    assert_eq!(
        read_token_balance(&env.svm, env.pool_mode_token),
        10_000_000
    );

    // Settle 1 of 2 requests (settle_requests(1))
    // Proportional burn: (10_000_000 * 1) / 2 = 5_000_000 PST
    send_mock_settle_requests(&mut env, 1).unwrap();

    assert_eq!(
        read_token_balance(&env.svm, env.pool_mode_token),
        5_000_000,
        "5 PST must remain in escrow after partial settlement"
    );
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        5_000_000,
        "Lender state must be credited with 5 USDC from partial batch settlement"
    );

    // Settle remaining 1 request (settle_requests(1))
    // Settle 1 of 1 -> burns all remaining 5_000_000 PST
    send_mock_settle_requests(&mut env, 1).unwrap();

    assert_eq!(
        read_token_balance(&env.svm, env.pool_mode_token),
        0,
        "0 PST in escrow after all requests settled"
    );
    assert_eq!(
        read_lender_owed_from_svm(&env.svm, env.lender_state),
        10_000_000,
        "Lender state must accumulate full 10 USDC across both partial settlements"
    );
}

// ─── Vector 7: Boundary & Error Vectors ───────────────────────────────────────

#[test]
fn test_huma_boundary_and_error_vectors() {
    // 1. Math zero boundaries
    assert_eq!(
        mock_huma::pst_shares_to_usdc(1_000_000, 10_000_000, 0).unwrap(),
        0
    );
    assert_eq!(
        mock_huma::pst_shares_to_usdc(0, 10_000_000, 10_000_000).unwrap(),
        0
    );
    assert_eq!(
        mock_huma::pst_shares_to_usdc(1_000_000, 0, 10_000_000).unwrap(),
        1_000_000
    );

    // 2. Escrowed PST == 0 settlement (no-op)
    let mut env = setup_mock_huma_env();
    let res = send_mock_settle_requests(&mut env, 1);
    assert!(
        res.is_ok(),
        "Settling when escrow is 0 must return Ok(()) without error"
    );

    // 3. Short lender_state account data (< 16 bytes) fails with InvalidLenderStateData
    let short_lender = Keypair::new().pubkey();
    env.svm
        .set_account(
            short_lender,
            solana_sdk::account::Account {
                lamports: 1_000_000,
                data: vec![0u8; 8], // 8 bytes < 16 bytes
                owner: mock_huma::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let res_disburse = send_mock_disburse_full(&mut env, Pubkey::default(), short_lender);
    assert_mock_huma_error(
        res_disburse,
        mock_huma::MockHumaError::InvalidLenderStateData,
    );

    // 4. Simulated failure pubkeys
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        10_000_000,
    );

    let res_deposit_fail = send_mock_deposit(&mut env, 1_000_000, FAIL_DEPOSIT_PUBKEY);
    assert_mock_huma_error(
        res_deposit_fail,
        mock_huma::MockHumaError::SimulatedDepositFailure,
    );

    let res_redemption_fail = send_mock_add_redemption(&mut env, 1_000_000, FAIL_REDEMPTION_PUBKEY);
    assert_mock_huma_error(
        res_redemption_fail,
        mock_huma::MockHumaError::SimulatedRedemptionFailure,
    );

    let res_disburse_fail =
        send_mock_disburse_full(&mut env, FAIL_DISBURSE_PUBKEY, Pubkey::default());
    assert_mock_huma_error(
        res_disburse_fail,
        mock_huma::MockHumaError::SimulatedDisburseFailure,
    );
}

#[test]
fn test_mock_huma_settle_multi_cycle_no_oom() {
    let mut env = setup_mock_huma_env();

    // Mint USDC for initial capital
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_underlying_token,
        &env.usdc_mint_authority,
        100_000_000,
    );

    // Initial deposit
    send_mock_deposit(&mut env, 50_000_000, Pubkey::default()).unwrap();

    // Run 25 redemption & settlement cycles in sequence
    for cycle in 0..25 {
        env.svm.expire_blockhash();
        send_mock_add_redemption(&mut env, 1_000_000, Pubkey::default()).unwrap();
        env.svm.expire_blockhash();
        let meta =
            send_mock_settle_requests(&mut env, 1).expect("Settlement in cycle must succeed");
        assert!(
            meta.compute_units_consumed < 100_000,
            "Cycle {cycle} consumed too many CUs: {}",
            meta.compute_units_consumed
        );
    }

    let remaining_assets = read_mock_huma_pool_assets(&env.svm, env.pool_state);
    assert_eq!(remaining_assets, 25_000_000);
}

fn read_lender_owed_from_svm(svm: &LiteSVM, lender_state: Pubkey) -> u64 {
    let acc = svm
        .get_account(&lender_state)
        .expect("Lender state must exist");
    assert!(
        acc.data.len() >= 16,
        "Lender state must have at least 16 bytes"
    );
    u64::from_le_bytes(acc.data[8..16].try_into().unwrap())
}
