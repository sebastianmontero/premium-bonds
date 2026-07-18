use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas, Space};
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

fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"draw_cycle",
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

struct Ctx {
    svm: LiteSVM,
    admin: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
}

fn setup(admin: &Keypair, draw_status: anchor::DrawStatus) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    // Setup global config
    let (global_config, _) = global_config_pda();
    let init_accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account: Keypair::new().pubkey(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let init_ix = Instruction {
        program_id: anchor::id(),
        accounts: init_accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: 100,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();
    svm.send_transaction(tx).unwrap();

    // Inject pool
    let pool_key = pool_pda(1).0;
    let ticket_registry = Keypair::new().pubkey();
    inject_pool(&mut svm, 1, Keypair::new().pubkey(), ticket_registry, anchor::PoolStatus::Active, true);

    // Inject draw cycle
    let (current_draw_cycle, _) = draw_cycle_pda(1, 0);
    let dc = anchor::DrawCycle {
        pool_id: 1,
        cycle_id: 0,
        status: draw_status,
        locked_ticket_count: 10,
        randomness_seed: [0u8; 32],
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        randomness_account: Pubkey::default(),
        harvest_slot: 0,
    };
    let mut data = vec![];
    dc.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);
    svm.set_account(
        current_draw_cycle,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    Ctx {
        svm,
        admin: clone_keypair(admin),
        pool_key,
        current_draw_cycle,
    }
}

fn clone_keypair(keypair: &Keypair) -> Keypair {
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&keypair.to_bytes()[..32]);
    Keypair::new_from_array(seed)
}

fn send_force_unlock(ctx: &mut Ctx, signer: &Keypair) -> Result<(), String> {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::AdminForceUnlockDraw {
        global_config,
        admin: signer.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn test_admin_force_unlock_happy_path() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::AwaitingRandomness);

    send_force_unlock(&mut ctx, &admin).unwrap();

    // Verify status is Complete and pool is unfrozen
    let pool_acct = ctx.svm.get_account(&ctx.pool_key).unwrap();
    let pool = anchor::PrizePool::try_deserialize(&mut pool_acct.data.as_slice()).unwrap();
    assert!(!pool.is_frozen_for_draw);

    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::Complete);
}

#[test]
fn test_admin_force_unlock_fails_unauthorized_admin() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::AwaitingRandomness);

    let fake_admin = Keypair::new();
    ctx.svm.airdrop(&fake_admin.pubkey(), 10_000_000_000).unwrap();

    let err = send_force_unlock(&mut ctx, &fake_admin).unwrap_err();
    assert!(err.contains("UnauthorizedAdmin"), "got: {err}");
}

#[test]
fn test_admin_force_unlock_fails_invalid_draw_status() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::Complete);

    let err = send_force_unlock(&mut ctx, &admin).unwrap_err();
    assert!(err.contains("InvalidDrawStatus"), "got: {err}");
}
