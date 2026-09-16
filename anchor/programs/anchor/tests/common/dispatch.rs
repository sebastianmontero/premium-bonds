use {
    crate::common::{account_builders::*, context::*, pda::*, readers::*, spl::*},
    anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
    },
    solana_sdk::{
        message::{Message, VersionedMessage},
        signature::Keypair,
        signer::Signer,
        transaction::VersionedTransaction,
    },
};

// ─── Transaction Execution Result ────────────────────────────────────────────

pub type TxResult =
    Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>;

// ─── Universal Transaction Dispatchers ───────────────────────────────────────

pub fn send_tx(
    svm: &mut LiteSVM,
    payer: &Keypair,
    additional_signers: &[&Keypair],
    ix: Instruction,
) -> TxResult {
    let mut signers = vec![payer];
    signers.extend_from_slice(additional_signers);
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .expect("Failed to construct VersionedTransaction");
    svm.send_transaction(tx)
}

pub fn send_user_tx(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> TxResult {
    send_tx(svm, payer, &[], ix)
}

pub fn send_txs(
    svm: &mut LiteSVM,
    payer: &Keypair,
    additional_signers: &[&Keypair],
    ixs: &[Instruction],
) -> TxResult {
    let mut signers = vec![payer];
    signers.extend_from_slice(additional_signers);
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .expect("Failed to construct VersionedTransaction");
    svm.send_transaction(tx)
}

// ─── Global & Pool Management Instruction Dispatchers ────────────────────────

pub fn build_initialize_global_ix(
    authority: &Pubkey,
    admin: &Pubkey,
    guardian: &Pubkey,
    jobs_account: &Pubkey,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (program_data, _) = program_data_pda();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        authority: *authority,
        admin: *admin,
        guardian: *guardian,
        jobs_account: *jobs_account,
        program_data,
        program: anchor::id(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {}.data(),
    }
}

pub fn send_initialize_global(
    svm: &mut LiteSVM,
    authority: &Keypair,
    admin: &Pubkey,
    guardian: &Pubkey,
    jobs_account: &Pubkey,
) -> TxResult {
    let ix = build_initialize_global_ix(&authority.pubkey(), admin, guardian, jobs_account);
    send_user_tx(svm, authority, ix)
}

pub fn build_update_global_config_ix(
    admin: &Pubkey,
    new_guardian: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::UpdateGlobalConfig {
        global_config,
        admin: *admin,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UpdateGlobalConfig {
            new_guardian,
            new_jobs_account,
        }
        .data(),
    }
}

pub fn send_update_global_config(
    svm: &mut LiteSVM,
    admin: &Keypair,
    new_guardian: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
) -> TxResult {
    let ix = build_update_global_config_ix(&admin.pubkey(), new_guardian, new_jobs_account);
    send_user_tx(svm, admin, ix)
}

pub fn build_nominate_admin_ix(admin: &Pubkey, pending_admin: Pubkey) -> Instruction {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::NominateAdmin {
        global_config,
        admin: *admin,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::NominateAdmin { pending_admin }.data(),
    }
}

pub fn send_nominate_admin(svm: &mut LiteSVM, admin: &Keypair, pending_admin: Pubkey) -> TxResult {
    let ix = build_nominate_admin_ix(&admin.pubkey(), pending_admin);
    send_user_tx(svm, admin, ix)
}

pub fn build_cancel_admin_nomination_ix(admin: &Pubkey) -> Instruction {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::CancelAdminNomination {
        global_config,
        admin: *admin,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CancelAdminNomination {}.data(),
    }
}

pub fn send_cancel_admin_nomination(svm: &mut LiteSVM, admin: &Keypair) -> TxResult {
    let ix = build_cancel_admin_nomination_ix(&admin.pubkey());
    send_user_tx(svm, admin, ix)
}

pub fn build_accept_admin_ix(new_admin: &Pubkey) -> Instruction {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::AcceptAdmin {
        global_config,
        new_admin: *new_admin,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AcceptAdmin {}.data(),
    }
}

pub fn send_accept_admin(svm: &mut LiteSVM, new_admin: &Keypair) -> TxResult {
    let ix = build_accept_admin_ix(&new_admin.pubkey());
    send_user_tx(svm, new_admin, ix)
}

pub fn build_create_pool_instruction_with_programs(
    admin: &Keypair,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    min_yield_threshold: u64,
    max_yield_basis_points: u16,
    payout_timelock_seconds: u32,
    prize_tiers: Vec<anchor::PrizeTier>,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    fee_wallet: Pubkey,
    huma_pool_state: Pubkey,
    token_program: Pubkey,
    pst_token_program: Pubkey,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::CreatePool {
            global_config,
            admin: admin.pubkey(),
            pool,
            ticket_registry,
            token_mint,
            pst_mint,
            pool_vault_account: pool_vault,
            pool_pst_vault,
            fee_wallet,
            huma_pool_state,
            system_program: anchor_lang::system_program::ID,
            token_program,
            pst_token_program,
        }
        .to_account_metas(None),
        data: anchor::instruction::CreatePool {
            pool_id,
            bond_price,
            stake_cycle_duration_hrs,
            fee_basis_points,
            min_yield_threshold,
            max_yield_basis_points,
            payout_timelock_seconds,
            prize_tiers,
        }
        .data(),
    }
}

pub fn build_create_pool_instruction(
    admin: &Keypair,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    min_yield_threshold: u64,
    max_yield_basis_points: u16,
    payout_timelock_seconds: u32,
    prize_tiers: Vec<anchor::PrizeTier>,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    fee_wallet: Pubkey,
    huma_pool_state: Pubkey,
) -> Instruction {
    build_create_pool_instruction_with_programs(
        admin,
        pool_id,
        bond_price,
        stake_cycle_duration_hrs,
        fee_basis_points,
        min_yield_threshold,
        max_yield_basis_points,
        payout_timelock_seconds,
        prize_tiers,
        token_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token::ID,
        anchor_spl::token::ID,
    )
}

pub fn build_create_pool_instruction_from_config(
    admin: &Keypair,
    config: &TestPoolConfig,
) -> Instruction {
    build_create_pool_instruction_with_programs(
        admin,
        config.pool_id,
        config.bond_price,
        config.stake_cycle_duration_hrs,
        config.fee_basis_points,
        config.min_yield_threshold,
        config.max_yield_basis_points,
        config.payout_timelock_seconds,
        config.prize_tiers.clone(),
        config.token_mint,
        config.pst_mint,
        config.ticket_registry,
        config.fee_wallet,
        config.huma_pool_state,
        config.token_program,
        config.pst_token_program,
    )
}

pub fn send_create_pool(svm: &mut LiteSVM, admin: &Keypair, config: &TestPoolConfig) -> TxResult {
    let ix = build_create_pool_instruction_from_config(admin, config);
    send_user_tx(svm, admin, ix)
}

pub fn build_update_pool_config_ix(
    admin: &Pubkey,
    pool_id: u32,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
    new_min_yield_threshold: Option<u64>,
    new_stake_cycle_duration_hrs: Option<i64>,
    new_max_yield_basis_points: Option<u16>,
    new_payout_timelock_seconds: Option<u32>,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let mut accounts = anchor::accounts::UpdatePoolConfig {
        global_config,
        admin: *admin,
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    if let Some(fw) = new_fee_wallet {
        accounts.push(AccountMeta::new_readonly(fw, false));
    }

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UpdatePoolConfig {
            new_fee_basis_points,
            new_bond_price,
            new_fee_wallet,
            new_min_yield_threshold,
            new_stake_cycle_duration_hrs,
            new_max_yield_basis_points,
            new_payout_timelock_seconds,
        }
        .data(),
    }
}

pub fn send_update_pool_config(
    svm: &mut LiteSVM,
    admin: &Keypair,
    pool_id: u32,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
    new_min_yield_threshold: Option<u64>,
    new_stake_cycle_duration_hrs: Option<i64>,
    new_max_yield_basis_points: Option<u16>,
    new_payout_timelock_seconds: Option<u32>,
) -> TxResult {
    let ix = build_update_pool_config_ix(
        &admin.pubkey(),
        pool_id,
        new_fee_basis_points,
        new_bond_price,
        new_fee_wallet,
        new_min_yield_threshold,
        new_stake_cycle_duration_hrs,
        new_max_yield_basis_points,
        new_payout_timelock_seconds,
    );
    send_user_tx(svm, admin, ix)
}

pub fn build_set_prize_tiers_ix(
    admin: &Pubkey,
    pool_id: u32,
    tiers: Vec<anchor::state::PrizeTier>,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let accounts = anchor::accounts::SetPrizeTiers {
        global_config,
        admin: *admin,
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SetPrizeTiers { tiers }.data(),
    }
}

pub fn send_set_prize_tiers(
    svm: &mut LiteSVM,
    admin: &Keypair,
    pool_id: u32,
    tiers: Vec<anchor::state::PrizeTier>,
) -> TxResult {
    let ix = build_set_prize_tiers_ix(&admin.pubkey(), pool_id, tiers);
    send_user_tx(svm, admin, ix)
}

pub fn build_pause_pool_ix(signer: &Pubkey, pool_id: u32) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::PausePool {
        global_config,
        signer: *signer,
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PausePool {}.data(),
    }
}

pub fn send_pause_pool(svm: &mut LiteSVM, signer: &Keypair, pool_id: u32) -> TxResult {
    let ix = build_pause_pool_ix(&signer.pubkey(), pool_id);
    send_user_tx(svm, signer, ix)
}

pub fn build_unpause_pool_ix(admin: &Pubkey, pool_id: u32) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::UnpausePool {
        global_config,
        admin: *admin,
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UnpausePool {}.data(),
    }
}

pub fn send_unpause_pool(svm: &mut LiteSVM, admin: &Keypair, pool_id: u32) -> TxResult {
    let ix = build_unpause_pool_ix(&admin.pubkey(), pool_id);
    send_user_tx(svm, admin, ix)
}

pub fn build_close_pool_ix(admin: &Pubkey, pool_id: u32) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::ClosePool {
        global_config,
        admin: *admin,
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClosePool {}.data(),
    }
}

pub fn send_close_pool(svm: &mut LiteSVM, admin: &Keypair, pool_id: u32) -> TxResult {
    let ix = build_close_pool_ix(&admin.pubkey(), pool_id);
    send_user_tx(svm, admin, ix)
}

pub fn build_admin_void_payout_registry_ix(
    admin: &Pubkey,
    pool_id: u32,
    cycle_id: u32,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
    let (payout_registry, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        global_config,
        admin: *admin,
        pool,
        current_draw_cycle,
        payout_registry,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    }
}

pub fn send_admin_void_payout_registry(
    svm: &mut LiteSVM,
    admin: &Keypair,
    pool_id: u32,
    cycle_id: u32,
) -> TxResult {
    let ix = build_admin_void_payout_registry_ix(&admin.pubkey(), pool_id, cycle_id);
    send_user_tx(svm, admin, ix)
}

pub fn build_admin_force_unlock_ix(admin: &Pubkey, pool_id: u32, cycle_id: u32) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::AdminForceUnlockDraw {
        admin: *admin,
        global_config,
        pool,
        current_draw_cycle,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    }
}

pub fn send_admin_force_unlock(
    svm: &mut LiteSVM,
    admin: &Keypair,
    pool_id: u32,
    cycle_id: u32,
) -> TxResult {
    let ix = build_admin_force_unlock_ix(&admin.pubkey(), pool_id, cycle_id);
    send_user_tx(svm, admin, ix)
}

pub fn build_initialize_huma_lender_ix(
    admin: Pubkey,
    pool_id: u32,
    pst_token_program: Pubkey,
    huma_program: Pubkey,
    huma_config: Pubkey,
    huma_pool_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_config: Pubkey,
    huma_mode_mint: Pubkey,
    huma_lender_state: Pubkey,
    huma_lender_mode_token: Pubkey,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    let accounts = anchor::accounts::InitializeHumaLender {
        admin,
        global_config,
        pool,
        pool_pst_vault,
        huma_program,
        huma_config,
        huma_pool_config,
        huma_pool_state,
        huma_mode_config,
        huma_mode_mint,
        huma_lender_state,
        huma_lender_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    }
}

pub fn send_initialize_huma_lender(
    svm: &mut LiteSVM,
    admin: &Keypair,
    ix: Instruction,
) -> TxResult {
    send_user_tx(svm, admin, ix)
}

pub fn build_crank_rebind_instruction(
    crank: &Keypair,
    pool_id: u32,
    cycle_id: u32,
    current_randomness_account: Pubkey,
    new_randomness_account: Pubkey,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        crank: crank.pubkey(),
        global_config,
        pool,
        current_draw_cycle,
        current_randomness_account,
        new_randomness_account,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    }
}

pub fn settle_huma_redemption(svm: &mut LiteSVM, huma_pool_state: Pubkey, count: u64) {
    let mut account = svm
        .get_account(&huma_pool_state)
        .expect("Huma pool state account not found");
    let data = &mut account.data;
    if data.len() < 30 {
        panic!("Huma pool state account data too short");
    }
    let num_modes = u32::from_le_bytes(data[26..30].try_into().unwrap()) as usize;
    let mode_config_keys_offset = 30 + num_modes * 216;
    if data.len() < mode_config_keys_offset + 4 {
        panic!("Huma pool state account data too short for mode config keys");
    }
    let num_config_keys = u32::from_le_bytes(
        data[mode_config_keys_offset..mode_config_keys_offset + 4]
            .try_into()
            .unwrap(),
    ) as usize;
    let redemption_offset = mode_config_keys_offset + 4 + num_config_keys * 32;
    if data.len() < redemption_offset + 32 {
        panic!("Huma pool state account data too short for redemption offset");
    }

    let mut next_request_id = u128::from_le_bytes(
        data[redemption_offset..redemption_offset + 16]
            .try_into()
            .unwrap(),
    );
    next_request_id += count as u128;
    data[redemption_offset..redemption_offset + 16].copy_from_slice(&next_request_id.to_le_bytes());

    let mut last_request_id = u128::from_le_bytes(
        data[redemption_offset + 16..redemption_offset + 32]
            .try_into()
            .unwrap(),
    );
    if last_request_id < next_request_id {
        last_request_id = next_request_id;
        data[redemption_offset + 16..redemption_offset + 32]
            .copy_from_slice(&last_request_id.to_le_bytes());
    }

    svm.set_account(huma_pool_state, account).unwrap();
}

// ─── E2E Action Wrappers ─────────────────────────────────────────────────────

pub fn send_e2e_buy_bonds_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    user_token_account: Pubkey,
    bonds: u32,
    huma_config: Pubkey,
) -> TxResult {
    let mut builder = BuyBondsBuilder::new(ctx).with_user(&user.pubkey(), user_token_account);
    if huma_config != Pubkey::default() {
        builder = builder.with_huma_config(huma_config);
    }
    let ix = builder.build_ix(bonds);
    send_user_tx(&mut ctx.svm, user, ix)
}

pub fn send_e2e_buy_bonds(ctx: &mut E2eContext, bonds: u32) -> TxResult {
    let bytes = ctx.user.to_bytes();
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&bytes[0..32]);
    let user = Keypair::new_from_array(secret);
    let user_token_account = ctx.user_usdc_account;
    send_e2e_buy_bonds_for_user(ctx, &user, user_token_account, bonds, Pubkey::default())
}

pub fn send_e2e_sell_bonds_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    active_to_sell: u32,
    pending_to_sell: u32,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> TxResult {
    let (user_winnings, _) = user_winnings_pda(1, &user.pubkey());
    let mut swapped_user_winnings = None;
    if let Some(acct) = ctx.svm.get_account(&user_winnings) {
        let mut data_slice = &acct.data[8..];
        if let Ok(unwrapped_winnings) = anchor::state::UserWinnings::deserialize(&mut data_slice) {
            let user_entry_idx = unwrapped_winnings.registry_entry_index;
            if user_entry_idx != u32::MAX {
                let reg = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
                let entry =
                    read_registry_entry(&ctx.svm, ctx.ticket_registry, user_entry_idx as usize);
                let will_exit =
                    (entry.active <= active_to_sell) && (entry.pending <= pending_to_sell);
                if will_exit && reg.user_count > 0 && user_entry_idx != reg.user_count - 1 {
                    let last_entry = read_registry_entry(
                        &ctx.svm,
                        ctx.ticket_registry,
                        (reg.user_count - 1) as usize,
                    );
                    let (last_winnings, _) = user_winnings_pda(1, &last_entry.owner);
                    swapped_user_winnings = Some(last_winnings);
                }
            }
        }
    }

    let huma_pool_mode_token = if huma_pool_mode_token == Pubkey::default() {
        create_spl_token_account(
            &mut ctx.svm,
            &ctx.admin,
            &ctx.pst_mint,
            &ctx.huma_pool_authority,
        )
    } else {
        huma_pool_mode_token
    };

    let mut builder = SellBondsBuilder::new(ctx)
        .with_user(&user.pubkey())
        .with_swapped_user_winnings(swapped_user_winnings)
        .with_huma_pool_mode_token(huma_pool_mode_token);
    if huma_config != Pubkey::default() {
        builder = builder.with_huma_config(huma_config);
    }
    if huma_lender_state != Pubkey::default() {
        builder = builder.with_huma_lender_state(huma_lender_state);
    }

    let ix = builder.build_ix(active_to_sell, pending_to_sell);
    send_user_tx(&mut ctx.svm, user, ix)
}

pub fn send_e2e_sell_bonds(
    ctx: &mut E2eContext,
    user: &Keypair,
    active_to_sell: u32,
    pending_to_sell: u32,
) -> TxResult {
    send_e2e_sell_bonds_for_user(
        ctx,
        user,
        active_to_sell,
        pending_to_sell,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
    )
}

pub fn send_e2e_claim_redemption_full(
    ctx: &mut E2eContext,
    caller: &Keypair,
    beneficiary: Pubkey,
    beneficiary_token_account: Pubkey,
    redemption_id: u64,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
) -> TxResult {
    let (pending_redemption, _) = pending_redemption_pda(1, redemption_id);
    let mut builder = ClaimRedemptionBuilder::new(ctx)
        .with_caller(caller.pubkey())
        .with_beneficiary(beneficiary, beneficiary_token_account)
        .with_pending_redemption(pending_redemption);
    if huma_config != Pubkey::default() {
        builder = builder.with_huma_config(huma_config);
    }
    if huma_lender_state != Pubkey::default() {
        builder = builder.with_huma_lender_state(huma_lender_state);
    }

    let ix = builder.build_ix();
    send_user_tx(&mut ctx.svm, caller, ix)
}

pub fn send_e2e_claim_redemption_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    user_token_account: Pubkey,
    redemption_id: u64,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
) -> TxResult {
    send_e2e_claim_redemption_full(
        ctx,
        user,
        user.pubkey(),
        user_token_account,
        redemption_id,
        huma_config,
        huma_lender_state,
    )
}

pub fn send_e2e_harvest_yield_and_commit_with_crank(
    ctx: &mut E2eContext,
    crank: &Keypair,
) -> TxResult {
    let (global_config, _) = global_config_pda();
    let (pool_key, _) = pool_pda(1);
    let pool = read_pool_state(&ctx.svm, 1);

    // Warp clock to current_cycle_end_at to satisfy time check without clobbering other fields
    warp_to_timestamp(&mut ctx.svm, pool.current_cycle_end_at);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (current_draw_cycle, _) = draw_cycle_pda(1, pool.current_draw_cycle_id);

    let randomness_account = Keypair::new().pubkey();
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    ctx.svm
        .set_account(
            randomness_account,
            solana_sdk::account::Account {
                lamports: 1_000_000_000,
                data: vec![0u8; 1000],
                owner: owner_pubkey,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let clock: solana_sdk::clock::Clock = ctx.svm.get_sysvar();
    crate::common::injectors::inject_randomness_account_data(
        &mut ctx.svm,
        randomness_account,
        clock.slot,
        clock.slot,
        [0u8; 32],
    );

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: crank.pubkey(),
        global_config,
        pool: pool_key,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: ctx.huma_pool_state,
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

    send_user_tx(&mut ctx.svm, crank, ix)
}

pub fn send_e2e_harvest_yield_and_commit(ctx: &mut E2eContext) -> TxResult {
    let admin = clone_keypair(&ctx.admin);
    send_e2e_harvest_yield_and_commit_with_crank(ctx, &admin)
}

pub fn send_e2e_prepare_draw_with_crank(
    ctx: &mut E2eContext,
    crank: &Keypair,
    pool_id: u32,
    cycle_id: u32,
    batch_size: u32,
) -> TxResult {
    let (pool, _) = pool_pda(pool_id);
    let (draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
    let accounts = anchor::accounts::PrepareDraw {
        crank: crank.pubkey(),
        pool,
        draw_cycle,
        ticket_registry: ctx.ticket_registry,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PrepareDraw { batch_size }.data(),
    };

    send_user_tx(&mut ctx.svm, crank, ix)
}

pub fn send_e2e_prepare_draw(
    ctx: &mut E2eContext,
    pool_id: u32,
    cycle_id: u32,
    batch_size: u32,
) -> TxResult {
    let admin = clone_keypair(&ctx.admin);
    send_e2e_prepare_draw_with_crank(ctx, &admin, pool_id, cycle_id, batch_size)
}

pub fn send_e2e_reveal_and_pick_winners_with_crank(
    ctx: &mut E2eContext,
    crank: &Keypair,
    pool_id: u32,
    cycle_id: u32,
    randomness_account: Pubkey,
) -> TxResult {
    let (pool, _) = pool_pda(pool_id);
    let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
    let (payout_registry, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::RevealAndPickWinners {
        crank: crank.pubkey(),
        current_draw_cycle,
        pool,
        ticket_registry: ctx.ticket_registry,
        randomness_account,
        payout_registry,
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

    send_user_tx(&mut ctx.svm, crank, ix)
}

pub fn send_e2e_reveal_and_pick_winners(
    ctx: &mut E2eContext,
    pool_id: u32,
    cycle_id: u32,
    randomness_account: Pubkey,
) -> TxResult {
    let admin = clone_keypair(&ctx.admin);
    send_e2e_reveal_and_pick_winners_with_crank(ctx, &admin, pool_id, cycle_id, randomness_account)
}

pub fn send_e2e_reinvest_winnings_with_crank(
    ctx: &mut E2eContext,
    crank: &Keypair,
    pool_id: u32,
    winner: &Pubkey,
    cycle_id: u32,
    winner_index: u32,
) -> TxResult {
    let (pool, _) = pool_pda(pool_id);
    let (payout_reg, _) = payout_pda(pool_id, cycle_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, winner);

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: crank.pubkey(),
        winner: *winner,
        payout_registry: payout_reg,
        pool,
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
            cycle_id,
            winner_index,
        }
        .data(),
    };

    send_user_tx(&mut ctx.svm, crank, ix)
}

pub fn send_e2e_reinvest_winnings(
    ctx: &mut E2eContext,
    pool_id: u32,
    winner: &Pubkey,
    cycle_id: u32,
    winner_index: u32,
) -> TxResult {
    let admin = clone_keypair(&ctx.admin);
    send_e2e_reinvest_winnings_with_crank(ctx, &admin, pool_id, winner, cycle_id, winner_index)
}
