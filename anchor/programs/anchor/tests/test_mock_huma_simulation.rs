use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_sdk::account::Account,
    solana_program::pubkey::Pubkey,
};

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
        }.to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &pool_state_kp]).unwrap();
    svm.send_transaction(tx).unwrap();

    // Verify it was initialized with mode length = 1
    let pool_acc = svm.get_account(&pool_state_kp.pubkey()).unwrap();
    assert_eq!(u32::from_le_bytes(pool_acc.data[26..30].try_into().unwrap()), 1);

    // 2. Test simulate_yield Delta Addition
    let yield_amount = 5_000_000u64; // 5 USDC
    let yield_instruction = solana_program::instruction::Instruction::new_with_bytes(
        mock_huma_id,
        &mock_huma::instruction::SimulateYield { yield_amount }.data(),
        mock_huma::accounts::MockSimulateYield {
            pool_state: pool_state_kp.pubkey(),
            admin: payer.pubkey(),
        }.to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[yield_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx).unwrap();

    // Verify assets increased by delta
    let pool_acc = svm.get_account(&pool_state_kp.pubkey()).unwrap();
    assert_eq!(u128::from_le_bytes(pool_acc.data[30..46].try_into().unwrap()), 5_000_000);
}



