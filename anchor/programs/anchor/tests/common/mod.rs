use anchor_lang::{AccountSerialize, AnchorDeserialize, InstructionData, Space, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

// ─── Seed mirrors ────────────────────────────────────────────────────────────

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const POOL_PST_SEED: &[u8] = b"pool_pst";
pub const HUMA_POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

// ─── Trigger Pubkeys ─────────────────────────────────────────────────────────

pub const FAIL_DEPOSIT_PUBKEY: Pubkey = Pubkey::new_from_array([1; 32]);
pub const FAIL_REDEMPTION_PUBKEY: Pubkey = Pubkey::new_from_array([2; 32]);
pub const FAIL_DISBURSE_PUBKEY: Pubkey = Pubkey::new_from_array([3; 32]);

// ─── PDA helpers ─────────────────────────────────────────────────────────────

pub fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

pub fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn pool_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn pool_pst_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_PST_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn user_winnings_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"user_winnings",
            pool_id.to_le_bytes().as_ref(),
            user.as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn pending_redemption_pda(pool_id: u32, redemption_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PENDING_REDEMPTION_SEED,
            pool_id.to_le_bytes().as_ref(),
            redemption_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn huma_program_id() -> Pubkey {
    anchor::constants::HUMA_PROGRAM_ID
}

pub fn huma_pool_authority_pda(pool_state: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[HUMA_POOL_AUTHORITY_SEED, pool_state.as_ref()],
        &huma_program_id(),
    )
}

// ─── Account/Mint Injectors ──────────────────────────────────────────────────

pub fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[44] = decimals;
    data[45] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
) -> Pubkey {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status: status as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: if is_frozen { 1 } else { 0 },
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier {
            num_winners: 0,
            basis_points: 0,
            _padding: [0, 0],
        }; 10],
        prize_tiers_count: 0,
        _padding: [0; 1],
        version: 1,
        _reserved: [0; 128],
    };

    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));

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

pub fn inject_registry(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
) {
    inject_registry_with_tickets(svm, address, pool_id, capacity, active, pending, &[]);
}

pub fn inject_registry_with_entries(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    entries: &[anchor::state::UserEntry],
) {
    let mut data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]); // discriminator
    data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    data[12..16].copy_from_slice(&capacity.to_le_bytes());
    data[16..20].copy_from_slice(&(entries.len() as u32).to_le_bytes()); // user_count

    let mut total_active: u32 = 0;
    let mut total_pending: u32 = 0;
    for (i, entry) in entries.iter().enumerate() {
        total_active = total_active.wrapping_add(entry.active);
        total_pending = total_pending.wrapping_add(entry.pending);
        anchor::utils::registry_set_entry(&mut data, i, entry);
    }

    data[20..24].copy_from_slice(&total_active.to_le_bytes());
    data[24..28].copy_from_slice(&total_pending.to_le_bytes());
    data[28..32].copy_from_slice(&0u32.to_le_bytes()); // draw_cycle_id = 0
    data[32..36].copy_from_slice(&0u32.to_le_bytes()); // draw_prepared_up_to = 0
    data[36] = 1; // version = 1

    svm.set_account(
        address,
        Account {
            lamports: 10_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_registry_with_tickets(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
    tickets: &[Pubkey],
) {
    let mut entries = Vec::new();
    for &owner in tickets {
        entries.push(anchor::state::UserEntry {
            owner,
            active: 1,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        });
    }
    if tickets.is_empty() && (active > 0 || pending > 0) {
        entries.push(anchor::state::UserEntry {
            owner: Pubkey::new_unique(),
            active,
            pending,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        });
    }
    inject_registry_with_entries(svm, address, pool_id, capacity, &entries);
}

pub fn setup_global_config(max_tickets_per_buy: u32) -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../../target/deploy/anchor.so"),
    );

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account: Keypair::new().pubkey(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx)
        .expect("initialize_global should succeed");

    (svm, admin)
}

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
    let acct = svm.get_account(&address).expect("account should exist");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

// ─── State Readers ───────────────────────────────────────────────────────────

pub fn read_pool_state(svm: &LiteSVM, pool_id: u32) -> anchor::PrizePool {
    let (pda, _) = pool_pda(pool_id);
    let acct = svm.get_account(&pda).expect("pool should exist");
    *bytemuck::from_bytes::<anchor::PrizePool>(&acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()])
}

pub fn read_user_winnings_state(
    svm: &LiteSVM,
    pool_id: u32,
    user: &Pubkey,
) -> anchor::state::UserWinnings {
    use anchor_lang::AccountDeserialize;
    let (pda, _) = user_winnings_pda(pool_id, user);
    let acct = svm
        .get_account(&pda)
        .expect("user winnings account should exist");
    anchor::state::UserWinnings::try_deserialize(&mut &acct.data[..]).unwrap()
}

pub fn inject_user_winnings_with_index(
    svm: &mut LiteSVM,
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    total_claimed: u64,
    total_reinvested: u64,
    registry_entry_index: u32,
) {
    use anchor_lang::AccountSerialize;
    let (pda, bump) = user_winnings_pda(pool_id, &user);
    let uw = anchor::state::UserWinnings {
        pool_id,
        user,
        unclaimed_non_reinvested_winnings: unclaimed,
        total_claimed,
        total_reinvested,
        registry_entry_index,
        bump,
        version: 1,
        _reserved: [0; 64],
    };
    let mut d = vec![];
    uw.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    svm.set_account(
        pda,
        solana_sdk::account::Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_user_winnings(
    svm: &mut LiteSVM,
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    total_claimed: u64,
    total_reinvested: u64,
) {
    inject_user_winnings_with_index(
        svm,
        pool_id,
        user,
        unclaimed,
        total_claimed,
        total_reinvested,
        u32::MAX,
    );
}

pub fn read_registry_pending(svm: &LiteSVM, address: Pubkey) -> u32 {
    let acct = svm.get_account(&address).expect("registry should exist");
    u32::from_le_bytes(acct.data[24..28].try_into().unwrap())
}

pub fn read_registry_active(svm: &LiteSVM, address: Pubkey) -> u32 {
    let acct = svm.get_account(&address).expect("registry should exist");
    u32::from_le_bytes(acct.data[20..24].try_into().unwrap())
}

pub fn read_registry_user_count(svm: &LiteSVM, address: Pubkey) -> u32 {
    let acct = svm.get_account(&address).expect("registry should exist");
    u32::from_le_bytes(acct.data[16..20].try_into().unwrap())
}

pub fn read_registry_entry(svm: &LiteSVM, address: Pubkey, idx: usize) -> anchor::state::UserEntry {
    let acct = svm.get_account(&address).expect("registry should exist");
    anchor::utils::registry_get_entry(&acct.data, idx)
}

// ─── E2E Context ─────────────────────────────────────────────────────────────

pub struct E2eContext {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub user: Keypair,
    pub usdc_mint_authority: Keypair,
    pub usdc_mint: Pubkey,
    pub pst_mint: Pubkey,
    pub user_usdc_account: Pubkey,
    pub ticket_registry: Pubkey,
    pub huma_pool_state: Pubkey,
    pub huma_pool_authority: Pubkey,
    pub huma_pool_underlying_token: Pubkey,
}

pub fn setup_e2e(max_tickets: u32) -> E2eContext {
    let mut svm = LiteSVM::new();
    // Load both programs
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../../target/deploy/anchor.so"),
    );
    let _ = svm.add_program(
        huma_program_id(),
        include_bytes!("../../../../target/deploy/mock_huma.so"),
    );

    let admin = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&admin.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 50_000_000_000).unwrap();

    // 1. Initialize GlobalConfig
    {
        let (global_config, _) = global_config_pda();
        let ix = Instruction {
            program_id: anchor::id(),
            accounts: anchor::accounts::InitializeGlobal {
                global_config,
                admin: admin.pubkey(),
                jobs_account: admin.pubkey(),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: anchor::instruction::InitializeGlobal {
                max_tickets_per_buy: max_tickets,
            }
            .data(),
        };
        let bh = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
        svm.send_transaction(tx).expect("init_global");
    }

    // 2. Create USDC mint (admin is mint authority for test convenience)
    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000)
        .unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    // 3. Create Huma pool_state stub (needs ModeState vec of len 1 at offset 26)
    let huma_pool_state = Keypair::new().pubkey();
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
                                                                       // assets is at 30..46, defaults to 0 for 1:1 conversion
    svm.set_account(
        huma_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: huma_pool_state_data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // 4. Derive pool_authority PDA from mock-huma
    let (huma_pool_authority, _) = huma_pool_authority_pda(&huma_pool_state);

    // 5. Create PST mint with pool_authority as mint_authority
    let pst_mint_kp = Keypair::new();
    {
        let mut data = vec![0u8; 82];
        data[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some
        data[4..36].copy_from_slice(&huma_pool_authority.to_bytes());
        data[44] = 6; // decimals
        data[45] = 1; // is_initialized
        svm.set_account(
            pst_mint_kp.pubkey(),
            Account {
                lamports: 1_000_000_000,
                data,
                owner: anchor_spl::token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    }
    let pst_mint = pst_mint_kp.pubkey();

    // 6. Create fee wallet (token account for USDC owned by admin)
    let fee_wallet = create_spl_token_account(&mut svm, &admin, &usdc_mint, &admin.pubkey());

    // 7. Create TicketRegistry
    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // 8. Create pool via instruction
    {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(1);
        let (pool_vault, _) = pool_vault_pda(1);
        let (pool_pst_vault, _) = pool_pst_vault_pda(1);

        let ix = Instruction {
            program_id: anchor::id(),
            accounts: anchor::accounts::CreatePool {
                global_config,
                admin: admin.pubkey(),
                pool,
                ticket_registry,
                token_mint: usdc_mint,
                pst_mint,
                pool_vault_account: pool_vault,
                pool_pst_vault,
                fee_wallet,
                system_program: anchor_lang::system_program::ID,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
            data: anchor::instruction::CreatePool {
                pool_id: 1,
                bond_price: 1_000_000,
                stake_cycle_duration_hrs: 24,
                fee_basis_points: 100,
            }
            .data(),
        };

        let bh = svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
        svm.send_transaction(tx).expect("create_pool");
    }

    // 9. Create user's USDC token account and fund it
    let user_usdc = create_spl_token_account(&mut svm, &user, &usdc_mint, &user.pubkey());
    mint_tokens(
        &mut svm,
        &admin,
        &usdc_mint,
        &user_usdc,
        &usdc_mint_authority,
        100_000_000,
    );

    // 10. Create huma_pool_underlying_token
    let huma_pool_underlying = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_underlying,
        usdc_mint,
        huma_pool_authority,
        0,
    );

    E2eContext {
        svm,
        admin,
        user,
        usdc_mint_authority,
        usdc_mint,
        pst_mint,
        user_usdc_account: user_usdc,
        ticket_registry,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token: huma_pool_underlying,
    }
}

pub fn send_e2e_buy_bonds_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    user_token_account: Pubkey,
    bonds: u32,
    huma_config: Pubkey,
) -> Result<(), String> {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &user.pubkey());

    let accounts = anchor::accounts::BuyBonds {
        user: user.pubkey(),
        user_winnings,
        global_config,
        pool,
        ticket_registry: ctx.ticket_registry,
        user_token_account,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: Pubkey::default(),
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: Pubkey::default(),
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds {
            tickets_to_buy: bonds,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

pub fn send_e2e_buy_bonds(ctx: &mut E2eContext, bonds: u32) -> Result<(), String> {
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
) -> Result<(), String> {
    let (pool_pda_key, _) = pool_pda(1);
    let pool = read_pool_state(&ctx.svm, 1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, pool.next_redemption_id);
    let dummy = Keypair::new().pubkey();
    let huma_lender_state = if huma_lender_state == Pubkey::default() {
        Keypair::new().pubkey()
    } else {
        huma_lender_state
    };

    let (user_winnings, _) = user_winnings_pda(1, &user.pubkey());

    // Auto-detect if a swap-and-pop is going to occur
    let user_winnings_acct = ctx.svm.get_account(&user_winnings);
    let mut swapped_user_winnings = None;
    if let Some(acct) = user_winnings_acct {
        let mut data_slice = &acct.data[8..];
        let unwrapped_winnings = anchor::state::UserWinnings::deserialize(&mut data_slice).unwrap();
        let user_entry_idx = unwrapped_winnings.registry_entry_index;

        if user_entry_idx != u32::MAX {
            let registry_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
            let user_count = u32::from_le_bytes(registry_acct.data[16..20].try_into().unwrap());
            let entry =
                anchor::utils::registry_get_entry(&registry_acct.data, user_entry_idx as usize);
            let will_exit = (entry.active <= active_to_sell) && (entry.pending <= pending_to_sell);

            if will_exit && user_count > 0 && user_entry_idx != user_count - 1 {
                let last_entry = anchor::utils::registry_get_entry(
                    &registry_acct.data,
                    (user_count - 1) as usize,
                );
                let (last_winnings, _) = user_winnings_pda(1, &last_entry.owner);
                swapped_user_winnings = Some(last_winnings);
            }
        }
    }

    let mut accounts = anchor::accounts::SellBonds {
        user: user.pubkey(),
        user_winnings,
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    if let Some(swapped) = swapped_user_winnings {
        accounts.push(AccountMeta::new(swapped, false));
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SellBonds {
            active_to_sell,
            pending_to_sell,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
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

pub fn inject_huma_pool_state(svm: &mut LiteSVM, address: Pubkey) {
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: huma_pool_state_data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
