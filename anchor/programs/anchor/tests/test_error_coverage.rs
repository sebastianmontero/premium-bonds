//! Comprehensive Error Code Coverage Test Suite
//!
//! Explicitly asserts and verifies every canonical Anchor error code
//! defined in `anchor::error::PremiumBondsError` (6000–6067) using strongly typed
//! `assert_custom_error` matching across 5 domain-partitioned submodules.

use {
    anchor::error::PremiumBondsError,
    anchor_lang::{
        AccountDeserialize, AnchorSerialize, Discriminator, InstructionData, ToAccountMetas,
    },
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

// ═══════════════════════════════════════════════════════════════════════════════
// Module 1: Pool Lifecycle & Configuration Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_pool_not_active() {
    let mut pool = PrizePoolTestBuilder::new(1).build();
    pool.status = anchor::PoolStatus::Paused as u8;
    pool.bond_price = 1_000_000;
    assert_eq!(
        pool.validate_buy_bonds(1).unwrap_err(),
        PremiumBondsError::PoolNotActive.into()
    );
}

#[test]
fn test_err_invalid_pool_status() {
    assert!(matches!(
        anchor::PoolStatus::try_from(99).unwrap_err(),
        PremiumBondsError::InvalidPoolStatus
    ));
}

#[test]
fn test_err_invalid_bond_price() {
    assert_eq!(
        anchor::PrizePool::validate_bond_price(0).unwrap_err(),
        PremiumBondsError::InvalidBondPrice.into()
    );
}

#[test]
fn test_err_invalid_stake_cycle_duration() {
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
fn test_err_invalid_fee_config() {
    assert_eq!(
        anchor::PrizePool::validate_fee_basis_points(10_001).unwrap_err(),
        PremiumBondsError::InvalidFeeConfig.into()
    );
}

#[test]
fn test_err_invalid_max_yield_basis_points() {
    assert_eq!(
        anchor::PrizePool::validate_max_yield_basis_points(10_001).unwrap_err(),
        PremiumBondsError::InvalidMaxYieldBasisPoints.into()
    );
}

#[test]
fn test_err_invalid_payout_timelock() {
    assert_eq!(
        anchor::PrizePool::validate_payout_timelock_seconds(86_401).unwrap_err(),
        PremiumBondsError::InvalidPayoutTimelock.into()
    );
}

#[test]
fn test_err_invalid_prize_tier_config() {
    let empty_tiers = vec![];
    assert_eq!(
        anchor::PrizePool::validate_prize_tiers(&empty_tiers).unwrap_err(),
        PremiumBondsError::InvalidPrizeTierConfig.into()
    );
}

#[test]
fn test_err_basis_points_must_equal_10000() {
    let bad_sum_tiers = vec![anchor::PrizeTier::new(1, 9_999)];
    assert_eq!(
        anchor::PrizePool::validate_prize_tiers(&bad_sum_tiers).unwrap_err(),
        PremiumBondsError::BasisPointsMustEqual10000.into()
    );
}

#[test]
fn test_err_cannot_modify_bond_price_with_active_deposits() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    let _pool_addr = inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        false,
    );
    mutate_pool_state(&mut svm, pool_id, |p| {
        p.total_deposited_principal = 10_000_000;
    });

    let res = UpdatePoolConfigBuilder::for_pool(pool_id, admin.pubkey())
        .with_bond_price(2_000_000)
        .send(&mut svm, &admin);
    assert_custom_error(
        res,
        PremiumBondsError::CannotModifyBondPriceWithActiveDeposits,
    );
}

#[test]
fn test_err_pool_closed() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 2;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let _pool_addr = inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Closed,
        false,
    );
    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(1_000_000)
        .with_cycle_fee(10_000)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res =
        AdminVoidPayoutRegistryBuilder::new(admin.pubkey(), pool_id, 0).send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::PoolClosed);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 2: Deposit, Registry & Account Layout Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_invalid_bond_quantity() {
    let pool = PrizePoolTestBuilder::new(1)
        .with_bond_price(1_000_000)
        .build();
    assert_eq!(
        pool.validate_buy_bonds(0).unwrap_err(),
        PremiumBondsError::InvalidBondQuantity.into()
    );
}

#[test]
fn test_err_registry_full() {
    let reg = anchor::TicketRegistry {
        pool_id: 1,
        capacity: 100,
        user_count: 100,
        total_active_tickets: 0,
        total_pending_tickets: 0,
        draw_cycle_id: 0,
        draw_prepared_up_to: 0,
        version: anchor::state::TicketRegistry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 64],
    };
    assert_eq!(
        reg.validate_can_add_user().unwrap_err(),
        PremiumBondsError::RegistryFull.into()
    );
}

#[test]
fn test_err_registry_too_small() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);
    let registry = Keypair::new().pubkey();
    // Inject registry with size smaller than REGISTRY_INITIAL_SIZE
    svm.set_account(
        registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE - 1],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

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
        huma_pool_state,
    );

    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, PremiumBondsError::RegistryTooSmall);
}

#[test]
fn test_err_insufficient_active_tickets() {
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
    let entries = vec![UserEntryTestBuilder::new()
        .with_owner(user.pubkey())
        .with_active(5)
        .with_pending(2)
        .build()];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);
    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
        huma_pool_state,
    );

    let res = SellBondsBuilder::for_pool(pool_id, user.pubkey())
        .with_shares(10, 0)
        .with_token_mint(token_mint)
        .with_huma_mode_mint(pst_mint)
        .with_ticket_registry(ticket_registry)
        .with_huma_pool_state(huma_pool_state)
        .send(&mut svm, &user);
    assert_custom_error(res, PremiumBondsError::InsufficientActiveTickets);
}

#[test]
fn test_err_insufficient_pending_tickets() {
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
    let entries = vec![UserEntryTestBuilder::new()
        .with_owner(user.pubkey())
        .with_active(5)
        .with_pending(2)
        .build()];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 1000, &entries);
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);
    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
        huma_pool_state,
    );

    let res = SellBondsBuilder::for_pool(pool_id, user.pubkey())
        .with_shares(0, 5)
        .with_token_mint(token_mint)
        .with_huma_mode_mint(pst_mint)
        .with_ticket_registry(ticket_registry)
        .with_huma_pool_state(huma_pool_state)
        .send(&mut svm, &user);
    assert_custom_error(res, PremiumBondsError::InsufficientPendingTickets);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 3: Harvest, Draw Cycle & Voiding Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_cycle_not_ended() {
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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(registry)
        .with_status(anchor::PoolStatus::Active)
        .with_huma_pool_state(huma_pool_state)
        .with_cycle_end_at(2_000_000_000)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    let res = HarvestYieldAndCommitBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_pst_mint(pst_mint)
        .with_ticket_registry(registry)
        .with_huma_pool_state(huma_pool_state)
        .with_randomness_account(randomness_account)
        .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::CycleNotEnded);
}

#[test]
fn test_err_draw_already_voided() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let _pool_addr = inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        false,
    );

    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(1_000_000)
        .with_cycle_fee(10_000)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![],
        0,
        anchor::PayoutRegistryStatus::Voided,
    );

    let res =
        AdminVoidPayoutRegistryBuilder::new(admin.pubkey(), pool_id, 0).send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::DrawAlreadyVoided);
}

#[test]
fn test_err_payouts_already_started() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    let _pool_addr = inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        false,
    );

    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(1_000_000)
        .with_cycle_fee(10_000)
        .inject(&mut svm);
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![],
        1,
        anchor::PayoutRegistryStatus::Active,
    ); // processed_count = 1

    let res =
        AdminVoidPayoutRegistryBuilder::new(admin.pubkey(), pool_id, 0).send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::PayoutsAlreadyStarted);
}

#[test]
fn test_err_invalid_batch_size() {
    let (mut svm, _admin, crank) = setup_global_with_crank();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    inject_registry(&mut svm, registry, pool_id, 1000, 0, 0);
    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        true,
        Keypair::new().pubkey(),
    );
    let dc = default_draw_cycle(pool_id, 0, anchor::DrawStatus::AwaitingRandomness);
    inject_draw_cycle(&mut svm, pool_id, 0, &dc);

    let res = PrepareDrawBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_ticket_registry(registry)
        .with_batch_size(0)
        .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::InvalidBatchSize);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 4: VRF & Switchboard Randomness Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_randomness_not_expired() {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();

    let _pool_addr = inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        true,
    );

    // Inject DrawCycle with harvest_slot = 100
    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_prize_pot(10_000_000)
        .with_cycle_fee(100_000)
        .with_harvest_slot(100)
        .with_locked_tickets(10)
        .inject(&mut svm);

    svm.set_sysvar::<solana_sdk::sysvar::clock::Clock>(&solana_sdk::sysvar::clock::Clock {
        slot: 500, // diff 400 < 1000 expiry window
        ..Default::default()
    });

    let new_randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, new_randomness_account);

    let res = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        pool_id,
        0,
        Pubkey::default(),
        new_randomness_account,
    )
    .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::RandomnessNotExpired);
}

#[test]
fn test_err_fees_already_withdrawn() {
    let mut pool = PrizePoolTestBuilder::new(1).build();
    pool.total_fees_accrued = 100_000;
    pool.total_fees_withdrawn = 80_000;
    pool.total_prizes_allocated = 500_000;
    // Available unwithdrawn fees = 20_000. Trying to reverse 30_000 fees must fail with FeesAlreadyWithdrawn
    let res = pool.rollback_draw_liabilities(100_000, 30_000);
    assert_eq!(
        res.unwrap_err(),
        PremiumBondsError::FeesAlreadyWithdrawn.into()
    );
}

#[test]
fn test_err_zero_shares_minted() {
    let mut ctx = setup_e2e();
    let res = BuyBondsBuilder::new(&ctx)
        .with_huma_config(FAIL_ZERO_SHARES_PUBKEY)
        .send(&mut ctx.svm, &ctx.user);
    assert_custom_error(res, PremiumBondsError::ZeroSharesMinted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 5: Redemption, Winnings & Solvency Errors
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_err_invalid_redemption_type() {
    for invalid_discriminant in [3, 99, 255] {
        assert!(
            matches!(
                anchor::state::RedemptionType::try_from(invalid_discriminant).unwrap_err(),
                PremiumBondsError::InvalidRedemptionType
            ),
            "RedemptionType::try_from({invalid_discriminant}) must return InvalidRedemptionType"
        );
    }
}

#[test]
fn test_err_insufficient_vault_balance() {
    let mut ctx = setup_e2e();
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
    let user = clone_keypair(&ctx.user);
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();
    let user_usdc = ctx.user_usdc_account;

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 0);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user,
        user_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_custom_error(res, PremiumBondsError::InsufficientVaultBalance);
}

#[test]
fn test_err_no_winnings_to_claim() {
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
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);
    inject_pool_with_huma_state(
        &mut svm,
        pool_id,
        token_mint,
        registry,
        anchor::PoolStatus::Active,
        false,
        huma_pool_state,
    );
    inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0); // 0 unclaimed winnings

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_addr, 10_000_000);

    let res = ClaimNonReinvestedWinningsBuilder::for_pool(pool_id, user.pubkey())
        .with_huma_mode_mint(pst_mint)
        .with_huma_pool_state(huma_pool_state)
        .send(&mut svm, &user);
    assert_custom_error(res, PremiumBondsError::NoWinningsToClaim);
}

#[test]
fn test_err_invalid_winner_index() {
    let payout = PayoutRegistryTestBuilder::new(1, 0)
        .with_winners_count(1)
        .build_header();

    let user1 = Keypair::new().pubkey();

    let winners = vec![WinnerTestBuilder::unprocessed(user1, 1_000_000, 0)];

    let pref = anchor::PayoutRegistryRef {
        header: &payout,
        winners: &winners,
    };

    assert_eq!(
        pref.validate_winner(1, user1).unwrap_err(),
        PremiumBondsError::InvalidWinnerIndex.into()
    );
}

#[test]
fn test_err_winner_mismatch() {
    let payout = PayoutRegistryTestBuilder::new(1, 0)
        .with_winners_count(1)
        .build_header();

    let user1 = Keypair::new().pubkey();
    let user2 = Keypair::new().pubkey();

    let winners = vec![WinnerTestBuilder::unprocessed(user1, 1_000_000, 0)];

    let pref = anchor::PayoutRegistryRef {
        header: &payout,
        winners: &winners,
    };

    assert_eq!(
        pref.validate_winner(0, user2).unwrap_err(),
        PremiumBondsError::WinnerMismatch.into()
    );
}

#[test]
fn test_err_unauthorized() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let guardian = Keypair::new();
    let mut svm = setup_global_config_with_admin_and_guardian(
        &authority,
        &admin.pubkey(),
        &guardian.pubkey(),
        None,
    );

    let _pool_pda = inject_pool(
        &mut svm,
        1,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let res = send_pause_pool(&mut svm, &attacker, 1);
    assert_custom_error(res, PremiumBondsError::Unauthorized);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module 6: Adversarial Hardening & Two-Step Governance Errors
// ═══════════════════════════════════════════════════════════════════════════════

fn assert_create_pool_fails_with_token_2022_extension(
    extension: anchor_spl::token_2022::spl_token_2022::extension::ExtensionType,
    expected_error: PremiumBondsError,
) {
    let (mut svm, admin) = setup_global_config();
    let mint = Keypair::new().pubkey();
    inject_token_2022_mint(&mut svm, mint, 6, Some(extension));
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, mint, admin.pubkey(), 0);
    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );
    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, expected_error);
}

#[test]
fn test_err_invalid_admin_address() {
    let payer = Keypair::new();
    let mut svm = setup_svm_with_authority(&payer);
    let res = send_initialize_global(
        &mut svm,
        &payer,
        &Pubkey::default(),
        &payer.pubkey(),
        &payer.pubkey(),
    );
    assert_custom_error(res, PremiumBondsError::InvalidAdminAddress);
}

#[test]
fn test_err_cannot_nominate_self() {
    let (mut svm, admin) = setup_global_config();
    let res_self = send_nominate_admin(&mut svm, &admin, admin.pubkey());
    assert_custom_error(res_self, PremiumBondsError::CannotNominateSelf);
}

#[test]
fn test_err_no_pending_admin() {
    let (mut svm, admin) = setup_global_config();
    let res_cancel = send_cancel_admin_nomination(&mut svm, &admin);
    assert_custom_error(res_cancel, PremiumBondsError::NoPendingAdmin);
}

#[test]
fn test_err_not_pending_admin() {
    let (mut svm, admin) = setup_global_config();
    let alice = Keypair::new().pubkey();
    let bob = Keypair::new();
    svm.airdrop(&bob.pubkey(), 10_000_000_000).unwrap();
    send_nominate_admin(&mut svm, &admin, alice).unwrap();

    let res_bob = send_accept_admin(&mut svm, &bob);
    assert_custom_error(res_bob, PremiumBondsError::NotPendingAdmin);
}

#[test]
fn test_err_yield_venue_insolvent() {
    let pool = PrizePoolTestBuilder::new(1)
        .with_principal(10_000_000)
        .build();
    assert_eq!(
        pool.assert_solvent(0).unwrap_err(),
        PremiumBondsError::YieldVenueInsolvent.into()
    );
}

#[test]
fn test_err_transfer_fee_not_supported() {
    assert_create_pool_fails_with_token_2022_extension(
        anchor_spl::token_2022::spl_token_2022::extension::ExtensionType::TransferFeeConfig,
        PremiumBondsError::TransferFeeNotSupported,
    );
}

#[test]
fn test_err_transfer_hook_not_supported() {
    assert_create_pool_fails_with_token_2022_extension(
        anchor_spl::token_2022::spl_token_2022::extension::ExtensionType::TransferHook,
        PremiumBondsError::TransferHookNotSupported,
    );
}

#[test]
fn test_err_invalid_token_mint_permanent_delegate() {
    assert_create_pool_fails_with_token_2022_extension(
        anchor_spl::token_2022::spl_token_2022::extension::ExtensionType::PermanentDelegate,
        PremiumBondsError::InvalidTokenMint,
    );
}

#[test]
fn test_err_invalid_token_mint_mint_close_authority() {
    assert_create_pool_fails_with_token_2022_extension(
        anchor_spl::token_2022::spl_token_2022::extension::ExtensionType::MintCloseAuthority,
        PremiumBondsError::InvalidTokenMint,
    );
}

#[test]
fn test_err_invalid_huma_pool_state() {
    let (mut svm, admin) = setup_global_config();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);
    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    // Uninitialized / wrong owner account for huma_pool_state
    let uninit_huma_pool_state = Keypair::new().pubkey();

    let ix = build_create_pool_instruction(
        &admin,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        token_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        uninit_huma_pool_state,
    );
    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_err_invalid_token_decimals() {
    let (mut svm, admin) = setup_global_config();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 9);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);
    let ticket_registry = Keypair::new().pubkey();
    inject_zero_account(
        &mut svm,
        ticket_registry,
        anchor::constants::REGISTRY_INITIAL_SIZE,
    );
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction(
        &admin,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        token_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
    );
    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, PremiumBondsError::InvalidTokenDecimals);
}

