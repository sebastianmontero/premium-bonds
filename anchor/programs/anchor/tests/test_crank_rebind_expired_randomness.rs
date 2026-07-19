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
    crank: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
    new_randomness_account: Pubkey,
}

fn setup(draw_status: anchor::DrawStatus, harvest_slot: u64) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    // Setup global config with jobs_account = crank
    let (global_config, _) = global_config_pda();
    let init_accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account: crank.pubkey(),
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
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).unwrap();

    // Inject pool
    let pool_key = pool_pda(1).0;
    let ticket_registry = Keypair::new().pubkey();
    inject_pool(
        &mut svm,
        1,
        Keypair::new().pubkey(),
        ticket_registry,
        anchor::PoolStatus::Active,
        true,
    );

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
        harvest_slot,
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

    // Create a new randomness account owned by Switchboard On-Demand
    let new_randomness_account = Keypair::new().pubkey();
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    svm.set_account(
        new_randomness_account,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: owner_pubkey,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    Ctx {
        svm,
        crank,
        pool_key,
        current_draw_cycle,
        new_randomness_account,
    }
}

fn send_rebind(ctx: &mut Ctx, signer: &Keypair) -> Result<(), String> {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        crank: signer.pubkey(),
        global_config,
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        new_randomness_account: ctx.new_randomness_account,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
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
fn test_rebind_happy_path() {
    // 1001 slots passed since harvest (slot 0 -> 1001)
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    let mut clock = solana_sdk::clock::Clock::default();
    clock.slot = 1001;
    ctx.svm.set_sysvar(&clock);

    let crank = clone_keypair(&ctx.crank);
    send_rebind(&mut ctx, &crank).unwrap();

    // Verify draw cycle randomness account is updated and harvest slot reset
    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.randomness_account, ctx.new_randomness_account);
    assert_eq!(dc.harvest_slot, 1001);
}

#[test]
fn test_rebind_fails_unauthorized_crank() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    let fake_crank = Keypair::new();
    ctx.svm
        .airdrop(&fake_crank.pubkey(), 10_000_000_000)
        .unwrap();

    let err = send_rebind(&mut ctx, &fake_crank).unwrap_err();
    assert!(err.contains("UnauthorizedCrank"), "got: {err}");
}

#[test]
fn test_rebind_fails_invalid_draw_status() {
    let mut ctx = setup(anchor::DrawStatus::Complete, 0);

    let crank = clone_keypair(&ctx.crank);
    let err = send_rebind(&mut ctx, &crank).unwrap_err();
    assert!(err.contains("InvalidDrawStatus"), "got: {err}");
}

#[test]
fn test_rebind_fails_randomness_not_expired() {
    // Only 1000 slots passed (0 -> 1000)
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    let mut clock = solana_sdk::clock::Clock::default();
    clock.slot = 1000;
    ctx.svm.set_sysvar(&clock);

    let crank = clone_keypair(&ctx.crank);
    let err = send_rebind(&mut ctx, &crank).unwrap_err();
    assert!(err.contains("RandomnessNotExpired"), "got: {err}");
}

#[test]
fn test_rebind_fails_invalid_randomness_account() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    let mut clock = solana_sdk::clock::Clock::default();
    clock.slot = 1001;
    ctx.svm.set_sysvar(&clock);

    // Set new_randomness_account owner to system program
    ctx.svm
        .set_account(
            ctx.new_randomness_account,
            Account {
                lamports: 1_000_000_000,
                data: vec![],
                owner: Pubkey::default(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let crank = clone_keypair(&ctx.crank);
    let err = send_rebind(&mut ctx, &crank).unwrap_err();
    assert!(err.contains("InvalidRandomnessAccount"), "got: {err}");
}

fn clone_keypair(keypair: &Keypair) -> Keypair {
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&keypair.to_bytes()[..32]);
    Keypair::new_from_array(seed)
}
