use {
    anchor_lang::{AccountSerialize, InstructionData, Space, ToAccountMetas},
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

#[test]
fn test_off_canonical_pda_rejection_on_bump_constraint() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let huma = TestHumaAccounts::from_e2e(&ctx);

    // Derive off-canonical PDA for user_winnings
    let pool_id_bytes = pool_id.to_le_bytes();
    let user_bytes = ctx.user.pubkey().to_bytes();
    let seeds: [&[u8]; 3] = [b"user_winnings", &pool_id_bytes, &user_bytes];
    let (off_canonical_pda, off_bump) = find_off_canonical_bump(&seeds, &anchor::id());

    // Inject valid UserWinnings account data at the off-canonical PDA
    let uw = anchor::state::UserWinnings {
        pool_id,
        user: ctx.user.pubkey(),
        unclaimed_non_reinvested_winnings: 0,
        total_claimed: 0,
        total_reinvested: 0,
        registry_entry_index: 0,
        bump: off_bump,
        version: anchor::state::UserWinnings::CURRENT_VERSION,
        _reserved: [0; 64],
    };
    let mut d = vec![];
    uw.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            off_canonical_pda,
            Account {
                lamports: 10_000_000,
                data: d,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // BuyBonds enforces canonical bump derivation: `seeds = [...], bump`
    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings: off_canonical_pda, // Off-canonical PDA passed
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        user_token_account: ctx.user_usdc_account,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma.huma_program,
        huma_config: huma.huma_config,
        huma_pool_config: huma.huma_pool_config,
        huma_pool_state: huma.huma_pool_state,
        huma_mode_config: huma.huma_mode_config,
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: huma.huma_pool_authority,
        huma_pool_underlying_token: huma.huma_pool_underlying_token,
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
        data: anchor::instruction::BuyBonds { tickets_to_buy: 1 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_stored_bump_tampering_on_claim_redemption() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let redemption_id = 0;
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let (_canonical_pda, canonical_bump) = pending_redemption_pda(pool_id, redemption_id);
    let tampered_bump = canonical_bump.wrapping_sub(1);

    // Inject PendingRedemption with tampered stored bump
    inject_pending_redemption_with_params(
        &mut ctx.svm,
        anchor::state::InitPendingRedemptionParams {
            pool_id,
            redemption_id,
            bump: tampered_bump, // Tampered stored bump
            user: ctx.user.pubkey(),
            amount: 1_000_000,
            pst_shares_locked: 1_000_000,
            huma_request_id: 0,
            requested_at: 0,
            redemption_type: anchor::state::RedemptionType::BondSale,
        },
    );

    let ix = build_claim_redemption_ix(
        ctx.user.pubkey(),
        ctx.user.pubkey(),
        pool_id,
        redemption_id,
        ctx.usdc_mint,
        ctx.user_usdc_account,
        &huma,
        Some(pool_vault),
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}
