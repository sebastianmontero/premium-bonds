use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::pubkey::Pubkey,
    solana_sdk::account::Account,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

#[test]
fn test_huma_simulation_yield_and_settle() {
    let mut svm = LiteSVM::new();
    let mock_huma_id = mock_huma::id();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    // Load mock_huma program
    let _ = svm.add_program(
        mock_huma_id,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    // 1. Initialize Pool State Account owned by Mock Huma
    let pool_state_kp = Keypair::new();

    let init_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::InitializeMockPoolState {}.data(),
        mock_huma::accounts::InitializeMockPoolState {
            pool_state: pool_state_kp.pubkey(),
            payer: payer.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );

    send_tx(&mut svm, &payer, &[&pool_state_kp], init_instruction).unwrap();

    // Verify it was initialized with mode length = 1
    assert_eq!(
        read_mock_huma_mode_count(&svm, pool_state_kp.pubkey()),
        1,
        "Mock pool state must initialize with 1 mode entry"
    );

    // 2. Test simulate_yield Delta Addition
    let yield_amount = 5_000_000u64; // 5 USDC
    let yield_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateYield { yield_amount }.data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }
        .to_account_metas(None),
    );

    send_user_tx(&mut svm, &payer, yield_instruction).unwrap();

    // Verify assets increased by delta
    assert_eq!(
        read_mock_huma_pool_assets(&svm, pool_state_kp.pubkey()),
        5_000_000,
        "Mock pool state assets must increase by simulated yield"
    );
}
