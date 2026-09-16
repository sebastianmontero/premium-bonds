use {
    anchor_spl::token::spl_token::state::Account as SplAccount,
    anchor_spl::token::spl_token::state::Mint as SplMint,
    anchor_spl::token_2022::spl_token_2022::extension::BaseStateWithExtensionsMut,
    litesvm::LiteSVM,
    solana_program::{program_pack::Pack, pubkey::Pubkey},
    solana_sdk::{
        account::Account,
        message::{Message, VersionedMessage},
        signature::Keypair,
        signer::Signer,
        transaction::VersionedTransaction,
    },
};

// ─── SPL Helpers ─────────────────────────────────────────────────────────────

pub fn create_spl_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint_authority: &Pubkey,
    decimals: u8,
) -> Pubkey {
    use solana_system_interface::instruction as system_instruction;

    let mint_kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(82);

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint_kp.pubkey(),
        rent,
        82,
        &anchor_spl::token::ID,
    );

    let init_mint_ix = anchor_spl::token::spl_token::instruction::initialize_mint(
        &anchor_spl::token::ID,
        &mint_kp.pubkey(),
        mint_authority,
        None,
        decimals,
    )
    .unwrap();

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[create_ix, init_mint_ix], Some(&payer.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, &mint_kp]).unwrap();
    svm.send_transaction(tx).expect("create_spl_mint failed");

    mint_kp.pubkey()
}

pub fn create_spl_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    use solana_system_interface::instruction as system_instruction;

    let acct_kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(165);

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &acct_kp.pubkey(),
        rent,
        165,
        &anchor_spl::token::ID,
    );

    let init_ix = anchor_spl::token::spl_token::instruction::initialize_account(
        &anchor_spl::token::ID,
        &acct_kp.pubkey(),
        mint,
        owner,
    )
    .unwrap();

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[create_ix, init_ix], Some(&payer.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, &acct_kp]).unwrap();
    svm.send_transaction(tx)
        .expect("create_spl_token_account failed");

    acct_kp.pubkey()
}

pub fn mint_tokens(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    mint_authority: &Keypair,
    amount: u64,
) {
    let ix = anchor_spl::token::spl_token::instruction::mint_to(
        &anchor_spl::token::ID,
        mint,
        dest,
        &mint_authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, mint_authority])
        .unwrap();
    svm.send_transaction(tx).expect("mint_tokens failed");
}

pub fn read_token_balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    let acct = svm.get_account(&address).expect("Token account must exist");
    let acct_len = SplAccount::LEN;
    SplAccount::unpack(&acct.data[..acct_len])
        .expect("Valid SPL token account")
        .amount
}

pub fn set_token_balance(svm: &mut LiteSVM, address: Pubkey, amount: u64) {
    let mut acc = svm.get_account(&address).expect("Token account must exist");
    let acct_len = SplAccount::LEN;
    let mut state = SplAccount::unpack(&acc.data[..acct_len]).expect("Valid SPL token account");
    state.amount = amount;
    SplAccount::pack_into_slice(&state, &mut acc.data[..acct_len]);
    svm.set_account(address, acc)
        .expect("Set token account failed");
}

pub fn set_token_mint_supply(svm: &mut LiteSVM, mint: Pubkey, supply: u64) {
    let mut acc = svm.get_account(&mint).expect("Mint account must exist");
    let mint_len = SplMint::LEN;
    let mut mint_state = SplMint::unpack(&acc.data[..mint_len]).expect("Unpack SPL Mint failed");
    mint_state.supply = supply;
    SplMint::pack_into_slice(&mint_state, &mut acc.data[..mint_len]);
    svm.set_account(mint, acc).expect("Set Mint account failed");
}

// ─── Token-2022 Test Utilities ───────────────────────────────────────────────

pub fn inject_token_2022_mint(
    svm: &mut LiteSVM,
    mint: Pubkey,
    decimals: u8,
    extension: Option<anchor_spl::token_2022::spl_token_2022::extension::ExtensionType>,
) {
    use anchor_spl::token_2022::spl_token_2022::extension::{
        ExtensionType, StateWithExtensionsMut,
    };

    let space = if let Some(ext) = extension {
        ExtensionType::try_calculate_account_len::<
            anchor_spl::token_2022::spl_token_2022::state::Mint,
        >(&[ext])
        .unwrap()
    } else {
        82
    };

    let mut data = vec![0u8; space];
    if let Some(ext) = extension {
        let mut state = StateWithExtensionsMut::<
            anchor_spl::token_2022::spl_token_2022::state::Mint,
        >::unpack_uninitialized(&mut data)
        .unwrap();
        state.init_account_type().unwrap();
        match ext {
            ExtensionType::TransferFeeConfig => {
                state
                    .init_extension::<anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFeeConfig>(
                        true,
                    )
                    .unwrap();
            }
            ExtensionType::TransferHook => {
                state
                    .init_extension::<anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::TransferHook>(
                        true,
                    )
                    .unwrap();
            }
            ExtensionType::PermanentDelegate => {
                state
                    .init_extension::<anchor_spl::token_2022::spl_token_2022::extension::permanent_delegate::PermanentDelegate>(
                        true,
                    )
                    .unwrap();
            }
            ExtensionType::MintCloseAuthority => {
                state
                    .init_extension::<anchor_spl::token_2022::spl_token_2022::extension::mint_close_authority::MintCloseAuthority>(
                        true,
                    )
                    .unwrap();
            }
            _ => panic!("Unsupported test extension"),
        }
    }
    // Set standard mint header fields: is_initialized = true, decimals
    data[44] = decimals;
    data[45] = 1;

    svm.set_account(
        mint,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token_2022::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_token_2022_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let token_state = SplAccount {
        mint,
        owner,
        amount,
        delegate: solana_program::program_option::COption::None,
        state: anchor_spl::token::spl_token::state::AccountState::Initialized,
        is_native: solana_program::program_option::COption::None,
        delegated_amount: 0,
        close_authority: solana_program::program_option::COption::None,
    };
    let mut data = vec![0u8; SplAccount::LEN];
    Pack::pack_into_slice(&token_state, &mut data);

    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token_2022::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn assert_token_balance(svm: &LiteSVM, account: &Pubkey, expected: u64) {
    let actual = read_token_balance(svm, *account);
    assert_eq!(
        actual, expected,
        "Token balance mismatch on account {}: expected {}, got {}",
        account, expected, actual
    );
}
