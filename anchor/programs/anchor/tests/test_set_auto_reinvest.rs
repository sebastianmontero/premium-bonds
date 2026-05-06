use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas, system_program};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};

const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const USER_PREF_SEED: &[u8] = b"user_pref";

fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn user_pref_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            USER_PREF_SEED,
            pool_id.to_le_bytes().as_ref(),
            user.as_ref(),
        ],
        &anchor::id(),
    )
}

fn inject_pool(svm: &mut LiteSVM, pool_id: u32) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);

    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status: anchor::PoolStatus::Active,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: false,
        current_draw_cycle_id: 0,
        max_withdrawal_slippage_dust: 0,
        prize_tiers: vec![],
        auto_reinvest_default: false,
    };

    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();

    let full_size = 8 + anchor::PrizePool::INIT_SPACE;
    data.resize(full_size, 0);

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

fn setup_env() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();

    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    (svm, user)
}

fn build_set_auto_reinvest_ix(
    user: &Keypair,
    pool_pda: Pubkey,
    pool_id: u32,
    enabled: bool,
) -> Instruction {
    let (user_preference_pda, _) = user_pref_pda(pool_id, &user.pubkey());

    let accounts = anchor::accounts::SetAutoReinvest {
        user: user.pubkey(),
        pool: pool_pda,
        user_preference: user_preference_pda,
        system_program: system_program::ID,
    };

    let data = anchor::instruction::SetAutoReinvest { enabled }.data();

    Instruction {
        program_id: anchor::ID,
        accounts: accounts.to_account_metas(Some(true)),
        data,
    }
}

#[test]
fn test_set_auto_reinvest_create_enabled() {
    let (mut svm, user) = setup_env();
    let pool_id = 1;
    let pool_key = inject_pool(&mut svm, pool_id);

    let ix = build_set_auto_reinvest_ix(&user, pool_key, pool_id, true);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "Instruction should succeed");

    let (pref_pda, _) = user_pref_pda(pool_id, &user.pubkey());
    let pref_acc = svm.get_account(&pref_pda).unwrap();
    let mut data_slice: &[u8] = &pref_acc.data;
    let pref_state = anchor::state::UserPreference::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pref_state.pool_id, pool_id);
    assert_eq!(pref_state.user, user.pubkey());
    assert_eq!(pref_state.auto_reinvest, true);
}

#[test]
fn test_set_auto_reinvest_create_disabled() {
    let (mut svm, user) = setup_env();
    let pool_id = 1;
    let pool_key = inject_pool(&mut svm, pool_id);

    let ix = build_set_auto_reinvest_ix(&user, pool_key, pool_id, false);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "Instruction should succeed");

    let (pref_pda, _) = user_pref_pda(pool_id, &user.pubkey());
    let pref_acc = svm.get_account(&pref_pda).unwrap();
    let mut data_slice: &[u8] = &pref_acc.data;
    let pref_state = anchor::state::UserPreference::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pref_state.auto_reinvest, false);
}

#[test]
fn test_set_auto_reinvest_update_existing() {
    let (mut svm, user) = setup_env();
    let pool_id = 1;
    let pool_key = inject_pool(&mut svm, pool_id);

    // 1. Create with true
    let ix1 = build_set_auto_reinvest_ix(&user, pool_key, pool_id, true);
    let blockhash1 = svm.latest_blockhash();
    let msg1 = Message::new_with_blockhash(&[ix1], Some(&user.pubkey()), &blockhash1);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&user]).unwrap();
    svm.send_transaction(tx1).unwrap();

    let (pref_pda, _) = user_pref_pda(pool_id, &user.pubkey());
    let mut data_slice: &[u8] = &svm.get_account(&pref_pda).unwrap().data;
    assert_eq!(
        anchor::state::UserPreference::try_deserialize(&mut data_slice).unwrap().auto_reinvest,
        true
    );

    svm.expire_blockhash();

    // 2. Update to false
    let ix2 = build_set_auto_reinvest_ix(&user, pool_key, pool_id, false);
    let blockhash2 = svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&user.pubkey()), &blockhash2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&user]).unwrap();
    let res2 = svm.send_transaction(tx2);
    assert!(res2.is_ok(), "Update should succeed via init_if_needed");

    let mut data_slice2: &[u8] = &svm.get_account(&pref_pda).unwrap().data;
    assert_eq!(
        anchor::state::UserPreference::try_deserialize(&mut data_slice2).unwrap().auto_reinvest,
        false
    );
}

#[test]
fn test_set_auto_reinvest_fails_wrong_pool() {
    let (mut svm, user) = setup_env();
    let pool_id = 1;
    // Inject pool 2 instead
    let wrong_pool_key = inject_pool(&mut svm, 2);

    // We try to pass pool 2 as the pool_pda but keep pool_id = 1 for the pref seeds
    let ix = build_set_auto_reinvest_ix(&user, wrong_pool_key, pool_id, true);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("ConstraintSeeds"));
}

#[test]
fn test_set_auto_reinvest_fails_wrong_user_pda() {
    let (mut svm, attacker) = setup_env();
    let pool_id = 1;
    let pool_key = inject_pool(&mut svm, pool_id);

    let victim = Keypair::new();
    let (victim_pref_pda, _) = user_pref_pda(pool_id, &victim.pubkey());

    // Attacker tries to pass Victim's PDA
    let accounts = anchor::accounts::SetAutoReinvest {
        user: attacker.pubkey(),
        pool: pool_key,
        user_preference: victim_pref_pda,
        system_program: system_program::ID,
    };

    let data = anchor::instruction::SetAutoReinvest { enabled: true }.data();

    let ix = Instruction {
        program_id: anchor::ID,
        accounts: accounts.to_account_metas(Some(true)),
        data,
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("ConstraintSeeds"));
}
