//! Integration tests for Mock Huma Proportional Deposit Pricing & Solvency.
//!
//! Verifies that:
//! 1. Mock Huma deposits calculate shares proportionally based on `(assets * pst_supply) / total_assets`
//! 2. Post-yield deposits do not dilute the PST share price or cause redemption deficits
//! 3. ERC-4626 floor division rounding favors the protocol
//! 4. First depositor vault inflation defense (`ZeroSharesMinted`)
//! 5. Settle requests with empty escrow fails-fast (`NoEscrowedTokens`) without advancing queue

use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_program::pubkey::Pubkey,
    solana_sdk::{signature::Keypair, signer::Signer},
};

mod common;
use common::*;

struct MockHumaPricingEnv {
    svm: LiteSVM,
    admin: Keypair,
    user_a: Keypair,
    user_b: Keypair,
    user_c: Keypair,
    usdc_mint_authority: Keypair,
    usdc_mint: Pubkey,
    pst_mint: Pubkey,
    pool_state: Pubkey,
    pool_authority: Pubkey,
    pool_underlying_token: Pubkey,
    pool_mode_token: Pubkey,
    user_a_usdc: Pubkey,
    user_a_pst: Pubkey,
    user_b_usdc: Pubkey,
    user_b_pst: Pubkey,
    user_c_usdc: Pubkey,
    user_c_pst: Pubkey,
    lender_state: Pubkey,
}

fn setup_mock_huma_pricing_env() -> MockHumaPricingEnv {
    let mut svm = setup_svm();
    let admin = Keypair::new();
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    let user_c = Keypair::new();

    svm.airdrop(&admin.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user_a.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user_b.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user_c.pubkey(), 50_000_000_000).unwrap();

    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000).unwrap();
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
    inject_mint_with_authority_and_supply(
        &mut svm,
        pst_mint_kp.pubkey(),
        pool_authority,
        6,
        0,
    );
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
    inject_token_account(
        &mut svm,
        pool_mode_token,
        pst_mint,
        pool_authority,
        0,
    );

    let user_a_usdc = create_spl_token_account(&mut svm, &user_a, &usdc_mint, &user_a.pubkey());
    let user_a_pst = create_spl_token_account(&mut svm, &user_a, &pst_mint, &user_a.pubkey());

    let user_b_usdc = create_spl_token_account(&mut svm, &user_b, &usdc_mint, &user_b.pubkey());
    let user_b_pst = create_spl_token_account(&mut svm, &user_b, &pst_mint, &user_b.pubkey());

    let user_c_usdc = create_spl_token_account(&mut svm, &user_c, &usdc_mint, &user_c.pubkey());
    let user_c_pst = create_spl_token_account(&mut svm, &user_c, &pst_mint, &user_c.pubkey());

    let lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut svm, lender_state, 0);

    MockHumaPricingEnv {
        svm,
        admin,
        user_a,
        user_b,
        user_c,
        usdc_mint_authority,
        usdc_mint,
        pst_mint,
        pool_state,
        pool_authority,
        pool_underlying_token,
        pool_mode_token,
        user_a_usdc,
        user_a_pst,
        user_b_usdc,
        user_b_pst,
        user_c_usdc,
        user_c_pst,
        lender_state,
    }
}

fn read_lender_owed_from_svm(svm: &LiteSVM, lender_state: Pubkey) -> u64 {
    let acc = svm.get_account(&lender_state).expect("Lender state must exist");
    assert!(acc.data.len() >= 16, "Lender state must have at least 16 bytes");
    u64::from_le_bytes(acc.data[8..16].try_into().unwrap())
}

fn increment_huma_last_request_id(svm: &mut LiteSVM, pool_state: Pubkey) {
    let mut acc = svm.get_account(&pool_state).expect("Pool state must exist");
    let num_modes = u32::from_le_bytes(acc.data[26..30].try_into().unwrap()) as usize;
    let mode_config_keys_offset = 30 + num_modes * 216;
    let num_config_keys = u32::from_le_bytes(
        acc.data[mode_config_keys_offset..mode_config_keys_offset + 4]
            .try_into()
            .unwrap(),
    ) as usize;
    let redemption_offset = mode_config_keys_offset + 4 + num_config_keys * 32;
    let last_request_id = u128::from_le_bytes(
        acc.data[redemption_offset + 16..redemption_offset + 32]
            .try_into()
            .unwrap(),
    );
    let new_last = last_request_id.checked_add(1).unwrap();
    acc.data[redemption_offset + 16..redemption_offset + 32].copy_from_slice(&new_last.to_le_bytes());
    svm.set_account(pool_state, acc).unwrap();
}

fn send_deposit_for_user(
    env: &mut MockHumaPricingEnv,
    user: &Keypair,
    user_usdc: Pubkey,
    user_pst: Pubkey,
    amount: u64,
    huma_config: Pubkey,
) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::Deposit { assets: amount }.data(),
        mock_huma::accounts::MockDeposit {
            depositor: user.pubkey(),
            huma_config: if huma_config != Pubkey::default() { huma_config } else { dummy },
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            mode_mint: env.pst_mint,
            pool_authority: env.pool_authority,
            underlying_mint: env.usdc_mint,
            pool_underlying_token: env.pool_underlying_token,
            depositor_underlying_token: user_usdc,
            depositor_mode_token: user_pst,
            underlying_token_program: anchor_spl::token::ID,
            mode_token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, user, ix)
}

fn send_add_redemption_for_user(
    env: &mut MockHumaPricingEnv,
    user: &Keypair,
    user_pst: Pubkey,
    shares: u64,
) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::AddRedemptionRequestV2 { shares }.data(),
        mock_huma::accounts::MockAddRedemptionRequest {
            payer: user.pubkey(),
            lender: user.pubkey(),
            huma_config: dummy,
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            mode_mint: env.pst_mint,
            redemption_request: dummy,
            lender_state: env.lender_state,
            pool_authority: env.pool_authority,
            pool_mode_token: env.pool_mode_token,
            lender_mode_token: user_pst,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, user, ix)
}

fn send_settle_requests(env: &mut MockHumaPricingEnv, count: u32) -> TxResult {
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

fn send_disburse(env: &mut MockHumaPricingEnv, user: &Keypair, user_usdc: Pubkey) -> TxResult {
    let dummy = Keypair::new().pubkey();
    let ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::Disburse {}.data(),
        mock_huma::accounts::MockDisburse {
            lender: user.pubkey(),
            huma_config: dummy,
            pool_config: dummy,
            pool_state: env.pool_state,
            mode_config: dummy,
            lender_state: env.lender_state,
            underlying_mint: env.usdc_mint,
            pool_authority: env.pool_authority,
            pool_underlying_token: env.pool_underlying_token,
            lender_underlying_token: user_usdc,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, user, ix)
}

// ═════════════════════════════════════════════════════════════════════════════
// Test Scenarios
// ═════════════════════════════════════════════════════════════════════════════

/// Scenario 1: Proportional Deposit Pricing and Redemption Solvency
///
/// 1. User A deposits 10 USDC (10_000_000 micro-USDC) -> Mints 10_000_000 PST.
/// 2. Yield generates +2 USDC (total assets = 12_000_000 micro-USDC).
///    Share price = 1.20 USDC / PST.
/// 3. User A queues redemption for 3 USDC (locks 2_500_000 PST in escrow).
/// 4. User B deposits 6 USDC (6_000_000 micro-USDC).
///    With proportional pricing, User B receives:
///    6_000_000 * 10_000_000 / 12_000_000 = 5_000_000 PST shares (NOT 6M 1:1).
///    Share price remains exactly 1.20 USDC / PST!
/// 5. Settle requests runs -> 2_500_000 PST burns for EXACTLY 3_000_000 USDC.
/// 6. Disburse transfers 3_000_000 USDC with zero deficit.
#[test]
fn test_huma_proportional_deposit_pricing_and_redemption() {
    let mut env = setup_mock_huma_pricing_env();

    // 1. Initial Deposit: User A deposits 10 USDC
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_a_usdc,
        &env.usdc_mint_authority,
        10_000_000,
    );
    let user_a = clone_keypair(&env.user_a);
    let user_a_usdc = env.user_a_usdc;
    let user_a_pst = env.user_a_pst;

    send_deposit_for_user(
        &mut env,
        &user_a,
        user_a_usdc,
        user_a_pst,
        10_000_000,
        Pubkey::default(),
    )
    .unwrap();

    assert_eq!(read_token_balance(&env.svm, user_a_pst), 10_000_000);
    assert_eq!(read_mock_huma_pool_assets(&env.svm, env.pool_state), 10_000_000);

    // 2. Accrue 2 USDC Yield (Total Assets = 12 USDC)
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
    assert_eq!(read_mock_huma_pool_assets(&env.svm, env.pool_state), 12_000_000);

    // 3. User A queues redemption for 3 USDC value (2.5 PST shares @ 1.20 price)
    send_add_redemption_for_user(&mut env, &user_a, user_a_pst, 2_500_000).unwrap();
    assert_eq!(read_token_balance(&env.svm, user_a_pst), 7_500_000);
    assert_eq!(read_token_balance(&env.svm, env.pool_mode_token), 2_500_000);

    // 4. User B deposits 6 USDC after yield
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_b_usdc,
        &env.usdc_mint_authority,
        6_000_000,
    );
    let user_b = clone_keypair(&env.user_b);
    let user_b_usdc = env.user_b_usdc;
    let user_b_pst = env.user_b_pst;

    send_deposit_for_user(
        &mut env,
        &user_b,
        user_b_usdc,
        user_b_pst,
        6_000_000,
        Pubkey::default(),
    )
    .unwrap();

    // User B receives 5,000,000 PST (proportional: 6M * 10M / 12M = 5M)
    assert_eq!(
        read_token_balance(&env.svm, user_b_pst),
        5_000_000,
        "User B must receive proportional 5 PST shares (not 6 PST 1:1)"
    );

    // Total assets is now 18 USDC, total supply is 15 PST -> Price = 1.20 USDC / PST preserved!
    assert_eq!(read_mock_huma_pool_assets(&env.svm, env.pool_state), 18_000_000);

    // 5. Settle redemption requests
    send_settle_requests(&mut env, 1).unwrap();

    // 2.5 PST burned, leaving 0 in escrow
    assert_eq!(read_token_balance(&env.svm, env.pool_mode_token), 0);
    // Lender state owed must be EXACTLY 3 USDC (3_000_000 micro-USDC)
    let owed = read_lender_owed_from_svm(&env.svm, env.lender_state);
    assert_eq!(
        owed, 3_000_000,
        "Lender state owed must be exactly 3 USDC with no share price dilution"
    );

    // 6. Disburse transfers the full 3 USDC
    send_disburse(&mut env, &user_a, user_a_usdc).unwrap();
    assert_eq!(
        read_token_balance(&env.svm, user_a_usdc),
        3_000_000,
        "User A must receive exactly 3 USDC redemption payout"
    );
}

/// Scenario 2: ERC-4626 Strict Floor Rounding
///
/// Total assets = 12_000_000, PST supply = 10_000_000 (price = 1.20).
/// Deposit of 7 micro-USDC -> (7 * 10_000_000) / 12_000_000 = 70 / 12 = 5 shares (floor).
/// 5 shares * 1.20 = 6 USDC <= 7 USDC deposited. Post-deposit share price >= 1.20.
#[test]
fn test_huma_deposit_erc4626_floor_rounding() {
    let mut env = setup_mock_huma_pricing_env();

    // Initial 10 USDC deposit
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_a_usdc,
        &env.usdc_mint_authority,
        10_000_000,
    );
    let user_a = clone_keypair(&env.user_a);
    let user_a_usdc = env.user_a_usdc;
    let user_a_pst = env.user_a_pst;
    send_deposit_for_user(
        &mut env,
        &user_a,
        user_a_usdc,
        user_a_pst,
        10_000_000,
        Pubkey::default(),
    )
    .unwrap();

    // Yield +2 USDC
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

    // User B deposits 7 micro-USDC
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_b_usdc,
        &env.usdc_mint_authority,
        7,
    );
    let user_b = clone_keypair(&env.user_b);
    let user_b_usdc = env.user_b_usdc;
    let user_b_pst = env.user_b_pst;
    send_deposit_for_user(
        &mut env,
        &user_b,
        user_b_usdc,
        user_b_pst,
        7,
        Pubkey::default(),
    )
    .unwrap();

    // Strict floor division: (7 * 10,000,000) / 12,000,000 = 5 shares
    assert_eq!(
        read_token_balance(&env.svm, user_b_pst),
        5,
        "Floor rounding must mint exactly 5 shares for 7 micro-USDC deposit"
    );
}

/// Scenario 3: Interleaved Multi-User Lifecycle
///
/// 1. Depositor A deposits 100 USDC @ 1.0 (mints 100 PST)
/// 2. Yield +20 USDC (price = 1.20, assets = 120 USDC, PST = 100)
/// 3. Depositor B deposits 60 USDC @ 1.20 (mints 50 PST, total assets = 180, PST = 150)
/// 4. User A queues redemption of 20 USDC (locks 16.666666 PST)
/// 5. Yield +30 USDC (total assets = 210, PST = 150, price = 1.40)
/// 6. Depositor C deposits 70 USDC @ 1.40 (mints 50 PST, total assets = 280, PST = 200)
/// 7. Settle executes -> Full solvency across all participants
#[test]
fn test_huma_interleaved_multi_user_lifecycle() {
    let mut env = setup_mock_huma_pricing_env();

    // 1. User A deposits 100 USDC
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_a_usdc,
        &env.usdc_mint_authority,
        100_000_000,
    );
    let user_a = clone_keypair(&env.user_a);
    let user_a_usdc = env.user_a_usdc;
    let user_a_pst = env.user_a_pst;
    send_deposit_for_user(
        &mut env,
        &user_a,
        user_a_usdc,
        user_a_pst,
        100_000_000,
        Pubkey::default(),
    )
    .unwrap();
    assert_eq!(read_token_balance(&env.svm, user_a_pst), 100_000_000);

    // 2. Yield +20 USDC
    let yield_20m = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SimulateYield {
            yield_amount: 20_000_000,
        }
        .data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, yield_20m).unwrap();

    // 3. User B deposits 60 USDC @ 1.20 (mints 50M PST)
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_b_usdc,
        &env.usdc_mint_authority,
        60_000_000,
    );
    let user_b = clone_keypair(&env.user_b);
    let user_b_usdc = env.user_b_usdc;
    let user_b_pst = env.user_b_pst;
    send_deposit_for_user(
        &mut env,
        &user_b,
        user_b_usdc,
        user_b_pst,
        60_000_000,
        Pubkey::default(),
    )
    .unwrap();
    assert_eq!(read_token_balance(&env.svm, user_b_pst), 50_000_000);

    // 4. User A queues 20M PST redemption
    send_add_redemption_for_user(&mut env, &user_a, user_a_pst, 20_000_000).unwrap();

    // 5. Yield +30 USDC
    let yield_30m = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SimulateYield {
            yield_amount: 30_000_000,
        }
        .data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, yield_30m).unwrap();

    // 6. User C deposits 70 USDC @ 1.40 (total assets = 210M, supply = 150M -> price = 1.40)
    // 70M * 150M / 210M = 50M PST
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_c_usdc,
        &env.usdc_mint_authority,
        70_000_000,
    );
    let user_c = clone_keypair(&env.user_c);
    let user_c_usdc = env.user_c_usdc;
    let user_c_pst = env.user_c_pst;
    send_deposit_for_user(
        &mut env,
        &user_c,
        user_c_usdc,
        user_c_pst,
        70_000_000,
        Pubkey::default(),
    )
    .unwrap();
    assert_eq!(read_token_balance(&env.svm, user_c_pst), 50_000_000);

    // 7. Settle requests
    send_settle_requests(&mut env, 1).unwrap();

    // 20M PST @ 1.40 price burns for exactly 28,000,000 USDC
    let owed = read_lender_owed_from_svm(&env.svm, env.lender_state);
    assert_eq!(owed, 28_000_000);

    // Disburse transfers 28 USDC to User A
    send_disburse(&mut env, &user_a, user_a_usdc).unwrap();
    assert_eq!(read_token_balance(&env.svm, user_a_usdc), 28_000_000);
}

/// Scenario 4: First Depositor Vault Inflation Defense
///
/// First depositor deposits 1 micro-USDC (mints 1 PST share).
/// Total assets is artificially inflated via donation / yield to 10,000,000 USDC.
/// Second deposit of 5 micro-USDC calculates (5 * 1) / 10_000_000 = 0 shares.
/// Contract must fail with `MockHumaError::ZeroSharesMinted`.
#[test]
fn test_huma_first_depositor_vault_inflation_defense() {
    let mut env = setup_mock_huma_pricing_env();

    // First deposit: 1 micro-USDC -> 1 PST
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_a_usdc,
        &env.usdc_mint_authority,
        1,
    );
    let user_a = clone_keypair(&env.user_a);
    let user_a_usdc = env.user_a_usdc;
    let user_a_pst = env.user_a_pst;
    send_deposit_for_user(
        &mut env,
        &user_a,
        user_a_usdc,
        user_a_pst,
        1,
        Pubkey::default(),
    )
    .unwrap();

    // Artificially inflate total_assets to 10,000,000 USDC via set_total_assets
    let set_assets_ix = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma::id(),
        &mock_huma::instruction::SetTotalAssets {
            total_assets: 10_000_000,
        }
        .data(),
        mock_huma::accounts::SetTotalAssets {
            pool_state: env.pool_state,
            admin: env.admin.pubkey(),
        }
        .to_account_metas(None),
    );
    send_user_tx(&mut env.svm, &env.admin, set_assets_ix).unwrap();

    // Second deposit: 5 micro-USDC -> 0 shares
    mint_tokens(
        &mut env.svm,
        &env.admin,
        &env.usdc_mint,
        &env.user_b_usdc,
        &env.usdc_mint_authority,
        5,
    );
    let user_b = clone_keypair(&env.user_b);
    let user_b_usdc = env.user_b_usdc;
    let user_b_pst = env.user_b_pst;
    let res = send_deposit_for_user(
        &mut env,
        &user_b,
        user_b_usdc,
        user_b_pst,
        5,
        Pubkey::default(),
    );

    assert_mock_huma_error(res, mock_huma::MockHumaError::ZeroSharesMinted);
}

/// Scenario 5: Settle Empty Escrow Failure
///
/// 1. When `count_to_settle == 0` (no requests queued), `settle_requests` returns `Ok(())` safely.
/// 2. When `count_to_settle > 0` but `pool_mode_token` balance is 0 (unbacked queue),
///    `settle_requests` fails-fast with `MockHumaError::NoEscrowedTokens` without advancing `next_request_id`.
#[test]
fn test_huma_settle_empty_escrow_failure() {
    let mut env = setup_mock_huma_pricing_env();

    // 1. With 0 requests queued, settle_requests returns Ok(()) safely
    let res = send_settle_requests(&mut env, 0);
    assert!(res.is_ok(), "Empty queue settle must return Ok(())");

    // 2. Queue 1 request artificially by incrementing last_request_id on pool_state directly
    increment_huma_last_request_id(&mut env.svm, env.pool_state);

    // Escrow balance is 0
    assert_eq!(read_token_balance(&env.svm, env.pool_mode_token), 0);

    // Attempting to settle 1 request with 0 escrowed PST must fail with NoEscrowedTokens
    let res = send_settle_requests(&mut env, 1);
    assert_mock_huma_error(res, mock_huma::MockHumaError::NoEscrowedTokens);
}
