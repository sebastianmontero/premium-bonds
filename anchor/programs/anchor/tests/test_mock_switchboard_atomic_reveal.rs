//! Integration tests for `mock_switchboard` and atomic reveal bundle.

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{account::Account, signature::Keypair, signer::Signer};

mod common;
use common::*;

#[test]
fn test_mock_switchboard_atomic_reveal_bundle_succeeds() {
    let mut ctx = RevealFixture::builder()
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_tiers(vec![anchor::PrizeTier::default_single_winner()])
        .with_locked_tickets(5)
        .with_prize_pot(1_000_000)
        .with_num_tickets(5)
        .with_allocated_prizes(10_000_000_000)
        .build();

    // Load mock_switchboard program
    ctx.svm
        .add_program(
            mock_switchboard::id(),
            include_bytes!("../../../target/deploy/mock_switchboard.so"),
        )
        .expect("Failed to add mock_switchboard program to LiteSVM");

    // Advance slot so current slot > seed slot
    let target_slot = 100u64;
    let seed_slot = 95u64;
    ctx.svm.warp_to_slot(target_slot);

    // Update draw cycle state with seed_slot
    mutate_draw_cycle(&mut ctx.svm, ctx.pool_id, ctx.cycle_id, |dc| {
        dc.vrf_seed_slot = seed_slot;
        dc.status = anchor::DrawStatus::AwaitingRandomness;
    });

    // Setup unrevealed randomness account owned by mock_switchboard
    inject_randomness_account_data_with_owner(
        &mut ctx.svm,
        ctx.randomness_account,
        seed_slot,
        0, // unrevealed
        [0u8; 32],
        mock_switchboard::id(),
    );

    let seed = [42u8; 32];

    // Instruction 0: mock_switchboard::reveal
    let mock_ix = Instruction {
        program_id: mock_switchboard::id(),
        accounts: mock_switchboard::accounts::MockReveal {
            randomness_account: ctx.randomness_account,
        }
        .to_account_metas(None),
        data: mock_switchboard::instruction::Reveal {
            value: Some(seed),
        }
        .data(),
    };

    // Instruction 1: anchor::reveal_and_pick_winners
    let reveal_ix = account_builders::RevealAndPickWinnersBuilder::for_pool(
        ctx.pool_id,
        ctx.cycle_id,
        ctx.crank.pubkey(),
    )
    .with_ticket_registry(ctx.ticket_registry)
    .with_randomness_account(ctx.randomness_account)
    .build_ix();

    // Execute atomic 2-instruction bundle in a single transaction
    let res = send_txs(&mut ctx.svm, &ctx.crank, &[], &[mock_ix, reveal_ix]);
    assert!(
        res.is_ok(),
        "Atomic [mock_switchboard::reveal, anchor::reveal_and_pick_winners] should succeed: {:?}",
        res.err()
    );

    // Verify randomness account state updated on-chain to exact slot and seed
    let rand_acc = ctx.svm.get_account(&ctx.randomness_account).unwrap();
    assert!(rand_acc.data.len() >= 408);
    let reveal_slot_bytes: [u8; 8] = rand_acc.data[144..152].try_into().unwrap();
    let reveal_slot = u64::from_le_bytes(reveal_slot_bytes);
    assert_eq!(
        reveal_slot, target_slot,
        "Reveal slot must match clock slot at transaction execution"
    );
    let value_bytes: [u8; 32] = rand_acc.data[152..184].try_into().unwrap();
    assert_eq!(value_bytes, seed, "Randomness value must match supplied seed");

    // Verify draw cycle state transitioned to TimelockWaiting (or Complete)
    let dc = read_draw_cycle_state(&ctx.svm, ctx.pool_id, ctx.cycle_id);
    assert_ne!(
        dc.status,
        anchor::DrawStatus::AwaitingRandomness,
        "Draw cycle must have progressed beyond AwaitingRandomness"
    );
}

#[test]
fn test_mock_switchboard_data_too_short_fails() {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    svm.add_program(
        mock_switchboard::id(),
        include_bytes!("../../../target/deploy/mock_switchboard.so"),
    )
    .unwrap();

    let randomness_account = Keypair::new().pubkey();
    // Inject only 100 bytes (less than 408 min)
    let mut data = vec![0u8; 100];
    data[0..8].copy_from_slice(&anchor::constants::SWITCHBOARD_RANDOMNESS_DISCRIMINATOR);
    svm.set_account(
        randomness_account,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: mock_switchboard::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: mock_switchboard::id(),
        accounts: mock_switchboard::accounts::MockReveal {
            randomness_account,
        }
        .to_account_metas(None),
        data: mock_switchboard::instruction::Reveal {
            value: Some([1u8; 32]),
        }
        .data(),
    };

    let res = send_user_tx(&mut svm, &payer, ix);
    let expected_code = (mock_switchboard::MockSwitchboardError::InvalidAccountDataLength as u32)
        + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_custom_code_at(res, 0, expected_code, "InvalidAccountDataLength");
}

#[test]
fn test_mock_switchboard_invalid_owner_fails() {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    svm.add_program(
        mock_switchboard::id(),
        include_bytes!("../../../target/deploy/mock_switchboard.so"),
    )
    .unwrap();

    let randomness_account = Keypair::new().pubkey();
    // Inject with System Program as owner instead of mock_switchboard
    let mut data = vec![0u8; 408];
    data[0..8].copy_from_slice(&anchor::constants::SWITCHBOARD_RANDOMNESS_DISCRIMINATOR);
    svm.set_account(
        randomness_account,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: mock_switchboard::id(),
        accounts: mock_switchboard::accounts::MockReveal {
            randomness_account,
        }
        .to_account_metas(None),
        data: mock_switchboard::instruction::Reveal {
            value: Some([1u8; 32]),
        }
        .data(),
    };

    let res = send_user_tx(&mut svm, &payer, ix);
    let expected_code = (mock_switchboard::MockSwitchboardError::IllegalOwner as u32)
        + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_custom_code_at(res, 0, expected_code, "IllegalOwner");
}

#[test]
fn test_mock_switchboard_invalid_discriminator_fails() {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    svm.add_program(
        mock_switchboard::id(),
        include_bytes!("../../../target/deploy/mock_switchboard.so"),
    )
    .unwrap();

    let randomness_account = Keypair::new().pubkey();
    // Inject invalid discriminator
    let data = vec![0u8; 408];
    svm.set_account(
        randomness_account,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: mock_switchboard::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: mock_switchboard::id(),
        accounts: mock_switchboard::accounts::MockReveal {
            randomness_account,
        }
        .to_account_metas(None),
        data: mock_switchboard::instruction::Reveal {
            value: Some([1u8; 32]),
        }
        .data(),
    };

    let res = send_user_tx(&mut svm, &payer, ix);
    let expected_code = (mock_switchboard::MockSwitchboardError::InvalidAccountDiscriminator as u32)
        + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_custom_code_at(res, 0, expected_code, "InvalidAccountDiscriminator");
}
