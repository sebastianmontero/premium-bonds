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
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();


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
        initiated_at: 1_700_000_000,
        completed_at: 0,
        version: 1,
        _reserved: [0; 64],
    };
    let mut data = vec![];
    use anchor_lang::Discriminator;
    data.extend_from_slice(&anchor::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    dc.serialize(&mut data).unwrap();
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

fn send_rebind(ctx: &mut Ctx, signer: &Keypair) -> Result<litesvm::types::TransactionMetadata, String> {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        global_config,
        crank: signer.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        new_randomness_account: ctx.new_randomness_account,
        event_authority: event_authority_pda(),
        program: anchor::id(),
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
    let meta = send_rebind(&mut ctx, &crank).unwrap();
    let event = assert_cpi_event::<anchor::events::RandomnessRebound>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.old_randomness_account, Pubkey::default());
    assert_eq!(event.new_randomness_account, ctx.new_randomness_account);
    assert_eq!(event.harvest_slot, 1001);

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

#[test]
fn test_crank_rebind_exact_slot_boundary() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 100);

    // Boundary 1: Exactly 1000 slots passed (100 -> 1100). 1100 - 100 = 1000 (not > 1000).
    let mut clock = solana_sdk::clock::Clock::default();
    clock.slot = 1100;
    ctx.svm.set_sysvar(&clock);

    let crank = clone_keypair(&ctx.crank);
    let err = send_rebind(&mut ctx, &crank).unwrap_err();
    assert!(err.contains("RandomnessNotExpired"), "got: {err}");

    // Boundary 2: 1001 slots passed (100 -> 1101). 1101 - 100 = 1001 (> 1000). Should succeed!
    clock.slot = 1101;
    ctx.svm.set_sysvar(&clock);
    ctx.svm.expire_blockhash();

    let meta = send_rebind(&mut ctx, &crank).expect("rebind at exact expiration slot boundary should succeed");
    let event = assert_cpi_event::<anchor::events::RandomnessRebound>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.old_randomness_account, Pubkey::default());
    assert_eq!(event.new_randomness_account, ctx.new_randomness_account);
    assert_eq!(event.harvest_slot, 1101);
}


fn clone_keypair(keypair: &Keypair) -> Keypair {
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&keypair.to_bytes()[..32]);
    Keypair::new_from_array(seed)
}

