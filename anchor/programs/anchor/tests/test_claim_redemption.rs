//! Integration tests for the `claim_redemption` instruction.
//!
//! Guard tests verify that basic validation rules (like ownership, pool, mint,
//! and program address constraints) fire and fail before calling the Huma CPI.
//! E2E tests verify the full flow: buy bonds -> sell bonds -> inject Huma lender state -> claim redemption.

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

// ─── Local Helpers ───────────────────────────────────────────────────────────

fn clone_keypair(keypair: &Keypair) -> Keypair {
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&keypair.to_bytes()[..32]);
    Keypair::new_from_array(seed)
}

fn inject_lender_state(svm: &mut LiteSVM, address: Pubkey, amount: u64) {
    let mut data = vec![0u8; 16];
    data[8..16].copy_from_slice(&amount.to_le_bytes());
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_pending_redemption(
    svm: &mut LiteSVM,
    pool_id: u32,
    redemption_id: u64,
    user: Pubkey,
    amount: u64,
    pst_shares_locked: u64,
) -> Pubkey {
    let (pda, bump) = pending_redemption_pda(pool_id, redemption_id);
    let pending = anchor::state::PendingRedemption {
        pool_id,
        redemption_id,
        user,
        amount,
        pst_shares_locked,
        requested_at: 0,
        huma_request_id: 0,
        bump,
        version: 1,
        _reserved: [0; 64],
    };
    let mut data = vec![];
    pending.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::state::PendingRedemption::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

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
        user,
        pool,
        pending_redemption,
        token_mint,
        pool_vault_account,
        user_token_account,
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
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    }
}

// ─── E2E CPI Helpers ─────────────────────────────────────────────────────────

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
        user: user.pubkey(),
        pool: pool_pda_key,
        pending_redemption,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        user_token_account,
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

// ─── Guard Test Setup ────────────────────────────────────────────────────────

struct ClaimGuardCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pool_vault: Pubkey,
    user_token_account: Pubkey,
    huma_config: Pubkey,
    huma_pool_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_underlying_token: Pubkey,
}

fn setup_claim_redemption_guard(
    pool_id: u32,
    redemption_id: u64,
    redemption_amount: u64,
    redemption_owner: Option<Pubkey>,
) -> ClaimGuardCtx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(pool_id).0;

    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 0);

    let owner = redemption_owner.unwrap_or_else(|| user.pubkey());

    inject_pending_redemption(
        &mut svm,
        pool_id,
        redemption_id,
        owner,
        redemption_amount,
        redemption_amount,
    );

    let user_token_account = create_spl_token_account(&mut svm, &user, &token_mint, &user.pubkey());

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let dummy = Keypair::new().pubkey();

    ClaimGuardCtx {
        svm,
        user,
        token_mint,
        pool_vault,
        user_token_account,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: dummy,
        huma_pool_underlying_token: dummy,
    }
}

fn send_claim_redemption_guard(
    ctx: &mut ClaimGuardCtx,
    user_kp: &Keypair,
    pool_id: u32,
    redemption_id: u64,
    override_token_mint: Option<Pubkey>,
    override_pool_vault: Option<Pubkey>,
    override_user_token_account: Option<Pubkey>,
    override_huma_program: Option<Pubkey>,
) -> Result<(), String> {
    let ix = build_claim_redemption_ix(
        user_kp.pubkey(),
        pool_id,
        redemption_id,
        override_token_mint.unwrap_or(ctx.token_mint),
        override_pool_vault.unwrap_or(ctx.pool_vault),
        override_user_token_account.unwrap_or(ctx.user_token_account),
        override_huma_program.unwrap_or(huma_program_id()),
        ctx.huma_config,
        ctx.huma_pool_config,
        ctx.huma_pool_state,
        ctx.huma_mode_config,
        ctx.huma_lender_state,
        ctx.huma_pool_authority,
        ctx.huma_pool_underlying_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user_kp.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user_kp]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard Tests (Validation checks before any Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_redemption_fails_wrong_user() {
    let wrong_user = Pubkey::new_unique();
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, Some(wrong_user));
    let user_kp = clone_keypair(&ctx.user);
    // User ctx.user is unauthorized because the pending redemption owner is wrong_user.
    let err =
        send_claim_redemption_guard(&mut ctx, &user_kp, 1, 0, None, None, None, None).unwrap_err();
    assert!(err.contains("InvalidRedemptionOwner"), "got: {err}");
}

#[test]
fn test_claim_redemption_fails_token_mint_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    let wrong_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, wrong_mint, 6);
    let err =
        send_claim_redemption_guard(&mut ctx, &user_kp, 1, 0, Some(wrong_mint), None, None, None)
            .unwrap_err();
    assert!(
        err.contains("ConstraintAddress") || err.contains("ConstraintRaw"),
        "Expected address constraint failure, got: {err}"
    );
}

#[test]
fn test_claim_redemption_fails_pool_id_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    // Use pool_id = 2 instead of 1. It will fail to resolve pool account or pending redemption constraint checks.
    let err =
        send_claim_redemption_guard(&mut ctx, &user_kp, 2, 0, None, None, None, None).unwrap_err();
    assert!(
        err.contains("AccountNotFound")
            || err.contains("ConstraintSeeds")
            || err.contains("ConstraintRaw")
            || err.contains("AccountNotInitialized")
            || err.contains("AccountOwnedByWrongProgram"),
        "Expected constraint mismatch error, got: {err}"
    );
}

#[test]
fn test_claim_redemption_fails_huma_program_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    let wrong_huma_program = Pubkey::new_unique();
    let err = send_claim_redemption_guard(
        &mut ctx,
        &user_kp,
        1,
        0,
        None,
        None,
        None,
        Some(wrong_huma_program),
    )
    .unwrap_err();
    assert!(
        err.contains("ConstraintAddress"),
        "Expected address check failure for Huma Program, got: {err}"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// E2E Happy Path & Failure Tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_redemption_e2e_happy_path() {
    let mut ctx = setup_e2e(10);

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

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 90_000_000);

    // Inject simulated Huma lender state with 3 USDC settled
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("claim redemption should succeed");

    // User A should have received 3 USDC back (93 USDC total)
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 93_000_000);

    // PendingRedemption PDA should be closed and its rent/account space deleted
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_none());
}

#[test]
fn test_claim_redemption_fails_insufficient_settled_amount() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    // Inject lender state with insufficient settled amount (500_000 USDC < 1_000_000 USDC needed)
    inject_lender_state(&mut ctx.svm, huma_lender_state, 500_000);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("HumaRedemptionNotSettled"));

    // PendingRedemption PDA should NOT be closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_some());
}

#[test]
fn test_claim_redemption_fails_simulated_disburse_failure() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 1_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim with FAIL_DISBURSE_PUBKEY to trigger simulated Huma error
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        FAIL_DISBURSE_PUBKEY,
        huma_lender_state,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("SimulatedDisburseFailure"));

    // PendingRedemption PDA should NOT be closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_some());
}

fn set_huma_total_assets(svm: &mut LiteSVM, huma_pool_state: Pubkey, assets: u128) {
    let mut account = svm.get_account(&huma_pool_state).unwrap();
    account.data[30..46].copy_from_slice(&assets.to_le_bytes());
    svm.set_account(huma_pool_state, account).unwrap();
}

fn set_pool_prizes_allocated(svm: &mut LiteSVM, pool_id: u32, amount: u64) {
    let (pda, _) = pool_pda(pool_id);
    let mut pool = read_pool_state(svm, pool_id);
    pool.total_prizes_allocated = amount;
    use anchor_lang::Discriminator;
    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));
    let mut account = svm.get_account(&pda).unwrap();
    account.data = data;
    svm.set_account(pda, account).unwrap();
}

fn send_e2e_claim_winnings_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> Result<(), String> {
    let (pool_pda_key, _) = pool_pda(1);
    let pool = read_pool_state(&ctx.svm, 1);
    let (user_winnings, _) = user_winnings_pda(1, &user.pubkey());
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, pool.next_redemption_id);
    let dummy = Keypair::new().pubkey();
    let huma_lender_state = if huma_lender_state == Pubkey::default() {
        Keypair::new().pubkey()
    } else {
        huma_lender_state
    };

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: user.pubkey(),
        pool: pool_pda_key,
        user_winnings,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn test_claim_redemption_rounding_error_failure() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Manipulate Huma pool state: total_assets = 10,000,030, pst_supply = 10,000,000
    // Yield rate is > 1:1 (approx 1.000003 USDC per share)
    set_huma_total_assets(&mut ctx.svm, ctx.huma_pool_state, 10_000_030);

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> target USDC = 3,000,000
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_key, _) = pending_redemption_pda(1, 0);
    let pending_acct = ctx.svm.get_account(&pending_key).unwrap();
    let pending_data =
        anchor::state::PendingRedemption::try_deserialize(&mut &pending_acct.data[..]).unwrap();

    // S = ceil(3,000,000 * 10,000,000 / 10,000,030) = 2,999,992 shares
    // This assertion verifies that ceiling behavior is applied.
    assert_eq!(pending_data.pst_shares_locked, 2_999_992);

    // Huma payout calculation on old code:
    // D = floor(2,999,991 * 10,000,030 / 10,000,000) = 2,999,999 USDC
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 2_999_999);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption - MUST FAIL because Huma only disbursed 2,999,999 but program tries to pay 3,000,000.
    // The pool vault has 0 USDC start balance (all was deposited to Huma during buy_bonds).
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert!(res.is_err());
    // Since vault only has 2,999,999 USDC but attempts to transfer 3,000,000,
    // the SPL transfer will fail with InsufficientFunds.
    let err_msg = res.unwrap_err();
    assert!(
        err_msg.contains("custom program error: 0x1") || err_msg.contains("InsufficientFunds"),
        "got: {}",
        err_msg
    );
}

#[test]
fn test_claim_redemption_case_a_1_to_1() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // Verify locked shares (exactly 3,000,000 for 1:1)
    let (pending_key, _) = pending_redemption_pda(1, 0);
    let pending_acct = ctx.svm.get_account(&pending_key).unwrap();
    let pending_data =
        anchor::state::PendingRedemption::try_deserialize(&mut &pending_acct.data[..]).unwrap();
    assert_eq!(pending_data.pst_shares_locked, 3_000_000);

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("Case A: 1:1 redemption claim should succeed");

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 93_000_000);
}

#[test]
fn test_claim_redemption_case_b_accrued_yield() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        15_000_000, // Mint enough USDC in Huma pool underlying token to cover all redemptions
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Manipulate Huma pool state: total_assets = 12_000_030, pst_supply = 10,000,000
    // Yield rate is > 1:1 (approx 1.200003 USDC per share)
    set_huma_total_assets(&mut ctx.svm, ctx.huma_pool_state, 12_000_030);

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // ── Operation 1: Sell 3 pending bonds -> target USDC = 3,000,000 ──
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_key0, _) = pending_redemption_pda(1, 0);
    let pending_acct0 = ctx.svm.get_account(&pending_key0).unwrap();
    let pending_data0 =
        anchor::state::PendingRedemption::try_deserialize(&mut &pending_acct0.data[..]).unwrap();

    // Ceiling expectation:
    // S = ceil(3,000,000 * 10,000,000 / 12,000,030) = 2,499,994 shares
    assert_eq!(pending_data0.pst_shares_locked, 2_499_994);

    let huma_lender_state0 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state0, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 0
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state0,
    )
    .expect("Redemption 0 should succeed");

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 93_000_000);

    // ── Operation 2: Claim 2,000,000 USDC winnings ──
    set_pool_prizes_allocated(&mut ctx.svm, 1, 2_000_000);
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, user_a.pubkey(), 2_000_000, 0, 0, 0);

    send_e2e_claim_winnings_for_user(
        &mut ctx,
        &user_a,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_key1, _) = pending_redemption_pda(1, 1);
    let pending_acct1 = ctx.svm.get_account(&pending_key1).unwrap();
    let pending_data1 =
        anchor::state::PendingRedemption::try_deserialize(&mut &pending_acct1.data[..]).unwrap();

    // Ceiling expectation:
    // S = ceil(2,000,000 * 10,000,000 / 12,000,030) = 1,666,663 shares
    assert_eq!(pending_data1.pst_shares_locked, 1_666_663);

    let huma_lender_state1 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state1, 2_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 1
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        1,
        Pubkey::default(),
        huma_lender_state1,
    )
    .expect("Redemption 1 (winnings) should succeed");

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 95_000_000);

    // ── Operation 3: Sell remaining 7 pending bonds -> target USDC = 7,000,000 ──
    // The remaining tickets occupy indices 0..6 in the pending registry
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        7,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_key2, _) = pending_redemption_pda(1, 2);
    let pending_acct2 = ctx.svm.get_account(&pending_key2).unwrap();
    let pending_data2 =
        anchor::state::PendingRedemption::try_deserialize(&mut &pending_acct2.data[..]).unwrap();

    // Ceiling expectation:
    // S = ceil(7,000,000 * 10,000,000 / 12,000,030) = 5,833,319 shares
    assert_eq!(pending_data2.pst_shares_locked, 5_833_319);

    let huma_lender_state2 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state2, 7_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 2
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        2,
        Pubkey::default(),
        huma_lender_state2,
    )
    .expect("Redemption 2 (remaining bonds) should succeed");

    // Total claimed should be user's start balance (90 USDC) + 10 USDC (bonds principal) + 2 USDC (winnings) = 102 USDC
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 102_000_000);

    // Vault should have 0 USDC left
    let (pool_vault, _) = pool_vault_pda(1);
    assert_eq!(read_token_balance(&ctx.svm, pool_vault), 0);
}
