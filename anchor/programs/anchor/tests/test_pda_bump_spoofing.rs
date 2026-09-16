use {
    anchor_lang::{AccountSerialize, Space},
    solana_program::pubkey::Pubkey,
    solana_sdk::account::Account,
    solana_signer::Signer,
};

mod common;
use common::*;

#[test]
fn test_off_canonical_pda_rejection_on_bump_constraint() {
    let mut ctx = setup_e2e();
    let pool_id: u32 = 1;

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
    let ix = BuyBondsBuilder::new(&ctx)
        .with_user_winnings(off_canonical_pda)
        .build_ix(1);
    let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_stored_bump_tampering_on_claim_redemption() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let redemption_id = 0;

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

    let ix = ClaimRedemptionBuilder::new(&ctx)
        .with_redemption_id(redemption_id)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}
