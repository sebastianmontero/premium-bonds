use {
    anchor_lang::{InstructionData, ToAccountMetas},
    solana_keypair::Keypair,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_signer::Signer,
};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1: User Instructions (4) Signer Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_signer_enforcement_user_buy_bonds() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings,
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
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &ctx.user.pubkey(),
        &[],
        "buy_bonds",
        "user",
    );
}

#[test]
fn test_signer_enforcement_user_sell_bonds() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma.huma_program,
        huma_config: huma.huma_config,
        huma_pool_config: huma.huma_pool_config,
        huma_pool_state: huma.huma_pool_state,
        huma_mode_config: huma.huma_mode_config,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: huma.huma_lender_state,
        huma_pool_authority: huma.huma_pool_authority,
        huma_pool_mode_token: huma.huma_pool_underlying_token,
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &ctx.user.pubkey(),
        &[],
        "sell_bonds",
        "user",
    );
}

#[test]
fn test_signer_enforcement_user_claim_non_reinvested_winnings() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma.huma_program,
        huma_config: huma.huma_config,
        huma_pool_config: huma.huma_pool_config,
        huma_pool_state: huma.huma_pool_state,
        huma_mode_config: huma.huma_mode_config,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: huma.huma_lender_state,
        huma_pool_authority: huma.huma_pool_authority,
        huma_pool_mode_token: huma.huma_pool_underlying_token,
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
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &ctx.user.pubkey(),
        &[],
        "claim_non_reinvested_winnings",
        "user",
    );
}

#[test]
fn test_signer_enforcement_user_claim_redemption() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let ix = build_claim_redemption_ix(
        ctx.user.pubkey(),
        ctx.user.pubkey(),
        pool_id,
        0,
        ctx.usdc_mint,
        ctx.user_usdc_account,
        &huma,
        Some(pool_vault),
    );
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &ctx.user.pubkey(),
        &[],
        "claim_redemption",
        "caller",
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2: Admin Instructions (15) Signer Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_signer_enforcement_admin_initialize_global() {
    let mut ctx = setup_e2e();
    let admin_pubkey = ctx.admin.pubkey();
    let payer = Keypair::new();
    let ix = build_initialize_global_ix(
        &payer.pubkey(),
        &admin_pubkey,
        &admin_pubkey,
        &admin_pubkey,
    );
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &payer.pubkey(),
        &[],
        "initialize_global",
        "payer",
    );
}

#[test]
fn test_signer_enforcement_admin_update_global_config() {
    let mut ctx = setup_e2e();
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_update_global_config_ix(&admin_pubkey, None, None);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "update_global_config",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_initialize_huma_lender() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (global_config_pda_addr, _) = global_config_pda();
    let huma = TestHumaAccounts::from_e2e(&ctx);
    let admin_pubkey = ctx.admin.pubkey();
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    let accounts = anchor::accounts::InitializeHumaLender {
        admin: admin_pubkey,
        global_config: global_config_pda_addr,
        pool: pool_pda_addr,
        pool_pst_vault,
        huma_program: huma.huma_program,
        huma_config: huma.huma_config,
        huma_pool_config: huma.huma_pool_config,
        huma_pool_state: huma.huma_pool_state,
        huma_mode_config: huma.huma_mode_config,
        huma_mode_mint: ctx.pst_mint,
        huma_lender_state: huma.huma_lender_state,
        huma_lender_mode_token: Keypair::new().pubkey(),
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &admin_pubkey,
        &[],
        "initialize_huma_lender",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_nominate_admin() {
    let mut ctx = setup_e2e();
    let admin_pubkey = ctx.admin.pubkey();
    let pending_admin_kp = Keypair::new();
    let ix = build_nominate_admin_ix(&admin_pubkey, pending_admin_kp.pubkey());
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "nominate_admin",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_cancel_admin_nomination() {
    let mut ctx = setup_e2e();
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_cancel_admin_nomination_ix(&admin_pubkey);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "cancel_admin_nomination",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_accept_admin() {
    let mut ctx = setup_e2e();
    let pending_admin_kp = Keypair::new();
    let ix = build_accept_admin_ix(&pending_admin_kp.pubkey());
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &pending_admin_kp.pubkey(),
        &[],
        "accept_admin",
        "pending_admin",
    );
}

#[test]
fn test_signer_enforcement_admin_create_pool() {
    let mut ctx = setup_e2e();
    let admin_pubkey = ctx.admin.pubkey();
    let huma = TestHumaAccounts::from_e2e(&ctx);
    let new_registry = Keypair::new().pubkey();
    let ix = build_create_pool_instruction(
        &ctx.admin,
        2,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        ctx.usdc_mint,
        ctx.pst_mint,
        new_registry,
        ctx.user_usdc_account,
        huma.huma_pool_state,
    );
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "create_pool",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_update_pool_config() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_update_pool_config_ix(
        &admin_pubkey,
        pool_id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "update_pool_config",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_set_prize_tiers() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_set_prize_tiers_ix(&admin_pubkey, pool_id, default_prize_tiers());
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "set_prize_tiers",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_pause_pool() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_pause_pool_ix(&admin_pubkey, pool_id);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1, // in PausePool: global_config=0, signer=1
        &admin_pubkey,
        &[],
        "pause_pool",
        "signer",
    );
}

#[test]
fn test_signer_enforcement_admin_unpause_pool() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_unpause_pool_ix(&admin_pubkey, pool_id);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1, // in UnpausePool: global_config=0, admin=1
        &admin_pubkey,
        &[],
        "unpause_pool",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_close_pool() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_close_pool_ix(&admin_pubkey, pool_id);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1, // in ClosePool: global_config=0, admin=1
        &admin_pubkey,
        &[],
        "close_pool",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_withdraw_fees() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (global_config_pda_addr, _) = global_config_pda();
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pending_pda, _) = pending_redemption_pda(pool_id, 0);
    let huma = TestHumaAccounts::from_e2e(&ctx);
    let admin_pubkey = ctx.admin.pubkey();

    let accounts = anchor::accounts::WithdrawFees {
        admin: admin_pubkey,
        global_config: global_config_pda_addr,
        pool: pool_pda_addr,
        fee_wallet: ctx.user_usdc_account,
        pool_pst_vault,
        pending_redemption: pending_pda,
        huma_program: huma.huma_program,
        huma_config: huma.huma_config,
        huma_pool_config: huma.huma_pool_config,
        huma_pool_state: huma.huma_pool_state,
        huma_mode_config: huma.huma_mode_config,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: huma.huma_lender_state,
        huma_pool_authority: huma.huma_pool_authority,
        huma_pool_mode_token: huma.huma_pool_underlying_token,
        token_mint: ctx.usdc_mint,
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
        data: anchor::instruction::WithdrawFees { amount: 1_000 }.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &admin_pubkey,
        &[],
        "withdraw_fees",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_force_unlock_draw() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (global_config_pda_addr, _) = global_config_pda();
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(pool_id, 0);
    let admin_pubkey = ctx.admin.pubkey();

    let accounts = anchor::accounts::AdminForceUnlockDraw {
        admin: admin_pubkey,
        global_config: global_config_pda_addr,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_pda_addr,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "admin_force_unlock_draw",
        "admin",
    );
}

#[test]
fn test_signer_enforcement_admin_void_payout_registry() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let admin_pubkey = ctx.admin.pubkey();
    let ix = build_admin_void_payout_registry_ix(&admin_pubkey, pool_id, 0);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &admin_pubkey,
        &[],
        "admin_void_payout_registry",
        "admin",
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3: Crank Instructions (6) Signer Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_signer_enforcement_crank_harvest_yield_and_commit() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (global_config_pda_addr, _) = global_config_pda();
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(pool_id, 0);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let huma = TestHumaAccounts::from_e2e(&ctx);
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();
    let randomness_account = Keypair::new().pubkey();

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: crank_pubkey,
        global_config: global_config_pda_addr,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle: draw_cycle_pda_addr,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: huma.huma_pool_state,
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
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &crank_pubkey,
        &[],
        "harvest_yield_and_commit",
        "crank",
    );
}

#[test]
fn test_signer_enforcement_crank_prepare_draw() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(pool_id, 0);
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();

    let accounts = anchor::accounts::PrepareDraw {
        crank: crank_pubkey,
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_pda_addr,
        ticket_registry: ctx.ticket_registry,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &crank_pubkey,
        &[],
        "prepare_draw",
        "crank",
    );
}

#[test]
fn test_signer_enforcement_crank_reveal_and_pick_winners() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(pool_id, 0);
    let (payout_pda_addr, _) = payout_pda(pool_id, 0);
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();
    let randomness_account = Keypair::new().pubkey();

    let accounts = anchor::accounts::RevealAndPickWinners {
        crank: crank_pubkey,
        current_draw_cycle: draw_cycle_pda_addr,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        randomness_account,
        payout_registry: payout_pda_addr,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::RevealAndPickWinners {}.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &crank_pubkey,
        &[],
        "reveal_and_pick_winners",
        "crank",
    );
}

#[test]
fn test_signer_enforcement_crank_reinvest_winnings() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (payout_pda_addr, _) = payout_pda(pool_id, 0);
    let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: crank_pubkey,
        winner: ctx.user.pubkey(),
        payout_registry: payout_pda_addr,
        pool: pool_pda_addr,
        user_winnings,
        ticket_registry: ctx.ticket_registry,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 0,
            winner_index: 0,
        }
        .data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &crank_pubkey,
        &[],
        "reinvest_winnings",
        "crank",
    );
}

#[test]
fn test_signer_enforcement_crank_rebind_expired_randomness() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();
    let randomness_account = Keypair::new().pubkey();
    let new_randomness = Keypair::new().pubkey();

    let ix =
        build_crank_rebind_instruction(&crank, pool_id, 0, randomness_account, new_randomness);
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &crank_pubkey,
        &[],
        "crank_rebind_expired_randomness",
        "crank",
    );
}

#[test]
fn test_signer_enforcement_crank_close_payout_registry() {
    let mut ctx = setup_e2e();
    let (global_config_pda_addr, _) = global_config_pda();
    let (payout_pda_addr, _) = payout_pda(1, 0);
    let crank = Keypair::new();
    let crank_pubkey = crank.pubkey();

    let accounts = anchor::accounts::CrankClosePayoutRegistry {
        global_config: global_config_pda_addr,
        crank: crank_pubkey,
        payout_registry: payout_pda_addr,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankClosePayoutRegistry {
            pool_id: 1,
            cycle_id: 0,
        }
        .data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        1,
        &crank_pubkey,
        &[],
        "crank_close_payout_registry",
        "crank",
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4: Payer Instructions (1) Signer Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_signer_enforcement_payer_resize_registry() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let payer = Keypair::new();
    let payer_pubkey = payer.pubkey();

    let accounts = anchor::accounts::ResizeRegistry {
        payer: payer_pubkey,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };
    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &payer_pubkey,
        &[],
        "resize_registry",
        "payer",
    );
}
