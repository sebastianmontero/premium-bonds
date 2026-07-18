//! Integration tests for `claim_non_reinvested_winnings` (Huma-based async redemption).
//!
//! Guard tests verify validation logic before CPI is reached.
//! Happy-path tests require a mock-huma program and are marked #[ignore].

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
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

const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const POOL_PST_SEED: &[u8] = b"pool_pst";
const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_pst_vault_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_PST_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn user_winnings_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"user_winnings",
            pool_id.to_le_bytes().as_ref(),
            user.as_ref(),
        ],
        &anchor::id(),
    )
}
fn pending_redemption_pda(pool_id: u32, redemption_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PENDING_REDEMPTION_SEED,
            pool_id.to_le_bytes().as_ref(),
            redemption_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
) -> Pubkey {
    inject_pool_with_next_redemption_id(svm, pool_id, token_mint, status, 0)
}

fn inject_pool_with_next_redemption_id(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
    next_redemption_id: u64,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 1_000_000_000,
        next_redemption_id,
        total_pending_redemptions: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: false,
        current_draw_cycle_id: 0,
        prize_tiers: vec![],
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
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

use common::inject_user_winnings;

fn inject_huma_pool_state(svm: &mut LiteSVM, address: Pubkey) {
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: huma_pool_state_data,
            owner: anchor::constants::HUMA_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ─── Instruction builder ─────────────────────────────────────────────────────

fn build_claim_ix(user: Pubkey, pool_id: u32, pst_mint: Pubkey) -> Instruction {
    build_claim_ix_with_redemption_id(
        user,
        pool_id,
        pst_mint,
        0,
        Pubkey::default(),
        Pubkey::default(),
    )
}

fn build_claim_ix_with_redemption_id(
    user: Pubkey,
    pool_id: u32,
    pst_mint: Pubkey,
    redemption_id: u64,
    huma_pool_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &user);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user,
        pool,
        user_winnings,
        pool_pst_vault,
        pending_redemption,
        huma_program: anchor::constants::HUMA_PROGRAM_ID,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: dummy,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

struct ClaimCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    huma_pool_state: Pubkey,
    huma_pool_mode_token: Pubkey,
}

fn setup_claim_guard(unclaimed_amount: u64, status: anchor::PoolStatus) -> ClaimCtx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );
    let _ = svm.add_program(
        anchor::constants::HUMA_PROGRAM_ID,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, status);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 1_000_000_000); // Fund vault with PST to pass Huma transfer

    inject_user_winnings(&mut svm, 1, user.pubkey(), unclaimed_amount, 0, 0);

    // Setup and inject valid huma_pool_state stub
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    // Setup and inject huma_pool_mode_token
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_mode_token,
        pst_mint,
        Pubkey::default(),
        0,
    );

    ClaimCtx {
        svm,
        user,
        token_mint,
        pst_mint,
        huma_pool_state,
        huma_pool_mode_token,
    }
}

fn send_claim(ctx: &mut ClaimCtx, pool_id: u32) -> Result<(), String> {
    send_claim_with_redemption_id(ctx, pool_id, 0)
}

fn send_claim_with_redemption_id(
    ctx: &mut ClaimCtx,
    pool_id: u32,
    redemption_id: u64,
) -> Result<(), String> {
    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        pool_id,
        ctx.pst_mint,
        redemption_id,
        ctx.huma_pool_state,
        ctx.huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests (validation fires before Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_no_winnings() {
    let mut ctx = setup_claim_guard(0, anchor::PoolStatus::Active);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("NoWinningsToClaim"), "got: {err}");
}

#[test]
fn test_claim_fails_pool_not_active() {
    let mut ctx = setup_claim_guard(500_000, anchor::PoolStatus::Paused);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("PoolNotActive"), "got: {err}");
}

#[test]
fn test_claim_fails_total_claimed_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject user winnings with total_claimed = u64::MAX
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 100, u64::MAX, 0);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_claim_fails_next_redemption_id_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject pool with next_redemption_id = u64::MAX
    inject_pool_with_next_redemption_id(
        &mut ctx.svm,
        1,
        ctx.token_mint,
        anchor::PoolStatus::Active,
        u64::MAX,
    );
    let err = send_claim_with_redemption_id(&mut ctx, 1, u64::MAX).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_claim_fails_invalid_mode_mint() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    let fake_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, fake_mint, 6);

    ctx.pst_mint = fake_mint;

    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("InvalidModeMint"),
        "Expected InvalidModeMint, got: {err}"
    );
}
