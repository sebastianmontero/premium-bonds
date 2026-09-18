use {
    crate::common::{
        account_builders::*, constants::*, dispatch::*, injectors::*, pda::*, readers::*, spl::*,
        state_builders::*, vrf::*,
    },
    anchor_lang::{
        solana_program::bpf_loader_upgradeable::UpgradeableLoaderState, AccountDeserialize,
        Discriminator,
    },
    litesvm::LiteSVM,
    solana_program::pubkey::Pubkey,
    solana_sdk::{
        account::Account,
        message::{Message, VersionedMessage},
        signature::Keypair,
        signer::Signer,
        transaction::VersionedTransaction,
    },
};

// ─── Test Config & Prize Tiers ───────────────────────────────────────────────

pub fn default_prize_tiers() -> Vec<anchor::PrizeTier> {
    vec![anchor::PrizeTier::default_single_winner()]
}

#[derive(Clone, Debug)]
pub struct TestPoolConfig {
    pub pool_id: u32,
    pub bond_price: u64,
    pub stake_cycle_duration_hrs: i64,
    pub fee_basis_points: u16,
    pub min_yield_threshold: u64,
    pub max_yield_basis_points: u16,
    pub payout_timelock_seconds: u32,
    pub prize_tiers: Vec<anchor::PrizeTier>,
    pub token_mint: Pubkey,
    pub pst_mint: Pubkey,
    pub ticket_registry: Pubkey,
    pub fee_wallet: Pubkey,
    pub huma_pool_state: Pubkey,
    pub token_program: Pubkey,
    pub pst_token_program: Pubkey,
}

impl Default for TestPoolConfig {
    fn default() -> Self {
        Self {
            pool_id: 1,
            bond_price: 1_000_000,
            stake_cycle_duration_hrs: 24,
            fee_basis_points: 100,
            min_yield_threshold: 0,
            max_yield_basis_points: 0,
            payout_timelock_seconds: 300,
            prize_tiers: default_prize_tiers(),
            token_mint: Pubkey::default(),
            pst_mint: Pubkey::default(),
            ticket_registry: Pubkey::default(),
            fee_wallet: Pubkey::default(),
            huma_pool_state: Pubkey::default(),
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
        }
    }
}

// ─── SVM Setup & Global Config ───────────────────────────────────────────────

pub fn setup_program_data(svm: &mut LiteSVM, upgrade_authority: Option<&Pubkey>) {
    let (pda, _) = program_data_pda();
    if let Some(mut account) = svm.get_account(&pda) {
        let program_data_state = UpgradeableLoaderState::ProgramData {
            slot: 1,
            upgrade_authority_address: upgrade_authority.cloned(),
        };
        let header_bytes = bincode::serialize(&program_data_state).unwrap();
        account.data[..header_bytes.len()].copy_from_slice(&header_bytes);
        svm.set_account(pda, account).unwrap();
    }
}

pub fn setup_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../../target/deploy/anchor.so"),
    );
    let _ = svm.add_program(
        huma_program_id(),
        include_bytes!("../../../../target/deploy/mock_huma.so"),
    );
    set_clock_timestamp(&mut svm, 1_700_000_000);
    svm
}

pub fn setup_svm_with_authority(authority: &Keypair) -> LiteSVM {
    let mut svm = setup_svm();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    setup_program_data(&mut svm, Some(&authority.pubkey()));
    svm
}

pub fn setup_global_config_with_admin(
    authority: &Keypair,
    admin: &Pubkey,
    jobs_account: Option<&Pubkey>,
) -> LiteSVM {
    let mut svm = setup_svm_with_authority(authority);
    let default_jobs = Keypair::new().pubkey();
    let jobs = jobs_account.unwrap_or(&default_jobs);
    let guardian = Keypair::new().pubkey();
    send_initialize_global(&mut svm, authority, admin, &guardian, jobs)
        .expect("initialize_global should succeed");
    svm
}

pub fn setup_global_config_with_admin_and_guardian(
    authority: &Keypair,
    admin: &Pubkey,
    guardian: &Pubkey,
    jobs_account: Option<&Pubkey>,
) -> LiteSVM {
    let mut svm = setup_svm_with_authority(authority);
    let default_jobs = Keypair::new().pubkey();
    let jobs = jobs_account.unwrap_or(&default_jobs);
    send_initialize_global(&mut svm, authority, admin, guardian, jobs)
        .expect("initialize_global should succeed");
    svm
}

pub fn setup_global_config() -> (LiteSVM, Keypair) {
    let authority = Keypair::new();
    let svm = setup_global_config_with_admin(&authority, &authority.pubkey(), None);
    (svm, authority)
}

pub struct GlobalRolesContext {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub guardian: Keypair,
    pub crank: Keypair,
}

impl GlobalRolesContext {
    pub fn new() -> Self {
        let authority = Keypair::new();
        let admin = Keypair::new();
        let guardian = Keypair::new();
        let crank = Keypair::new();
        let mut svm = setup_svm_with_authority(&authority);
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&guardian.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
        send_initialize_global(
            &mut svm,
            &authority,
            &admin.pubkey(),
            &guardian.pubkey(),
            &crank.pubkey(),
        )
        .expect("initialize_global should succeed");
        Self {
            svm,
            admin,
            guardian,
            crank,
        }
    }
}

pub fn setup_global_roles() -> GlobalRolesContext {
    GlobalRolesContext::new()
}

pub fn setup_global_with_crank() -> (LiteSVM, Keypair, Keypair) {
    let ctx = setup_global_roles();
    (ctx.svm, ctx.admin, ctx.crank)
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
    pub huma_pool_mode_token: Pubkey,
    pub pool_id: u32,
    pub fee_wallet: Pubkey,
}

pub fn setup_e2e() -> E2eContext {
    let mut svm = setup_svm();

    let admin = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&admin.pubkey(), 50_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 50_000_000_000).unwrap();
    setup_program_data(&mut svm, Some(&admin.pubkey()));

    // 1. Initialize GlobalConfig
    send_initialize_global(
        &mut svm,
        &admin,
        &admin.pubkey(),
        &admin.pubkey(),
        &admin.pubkey(),
    )
    .expect("init_global");

    // 2. Create USDC mint (admin is mint authority for test convenience)
    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000)
        .unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    // 3. Create Huma pool_state stub (needs ModeState vec of len 1 at offset 26)
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    // 4. Derive pool_authority PDA from mock-huma
    let (huma_pool_authority, _) = huma_pool_authority_pda(&huma_pool_state);

    // 5. Create PST mint with pool_authority as mint_authority
    let pst_mint_kp = Keypair::new();
    inject_mint_with_authority_and_supply(
        &mut svm,
        pst_mint_kp.pubkey(),
        huma_pool_authority,
        6,
        0,
    );
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

    // 8. Create pool via builder
    CreatePoolBuilder::new(admin.pubkey(), 1)
        .with_mints(usdc_mint, pst_mint)
        .with_ticket_registry(ticket_registry)
        .with_fee_wallet(fee_wallet)
        .with_huma_pool_state(huma_pool_state)
        .send(&mut svm, &admin)
        .expect("create_pool in setup_e2e must succeed");

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

    // 10b. Create huma_pool_mode_token (PST token account owned by huma_pool_authority)
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_mode_token,
        pst_mint,
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
        huma_pool_mode_token,
        pool_id: 1,
        fee_wallet,
    }
}

// ─── Lifecycle Test Harness ──────────────────────────────────────────────────

pub struct LifecycleTestHarness {
    pub ctx: E2eContext, // Alice is default user in ctx.user & ctx.user_usdc_account
    pub guardian: Keypair,
    pub crank: Keypair,
    pub bob: Keypair,
    pub bob_usdc: Pubkey,
    pub pool_id: u32,
    pub fee_wallet: Pubkey,
}

impl std::ops::Deref for LifecycleTestHarness {
    type Target = E2eContext;
    fn deref(&self) -> &Self::Target {
        &self.ctx
    }
}

impl std::ops::DerefMut for LifecycleTestHarness {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.ctx
    }
}

impl LifecycleTestHarness {
    #[inline]
    pub fn alice(&self) -> &Keypair {
        &self.ctx.user
    }

    #[inline]
    pub fn alice_usdc(&self) -> Pubkey {
        self.ctx.user_usdc_account
    }
}

pub fn setup_lifecycle_harness() -> LifecycleTestHarness {
    let mut svm = setup_svm();

    let admin = Keypair::new();
    let guardian = Keypair::new();
    let crank = Keypair::new();
    let alice = Keypair::new();
    let bob = Keypair::new();

    for kp in &[&admin, &guardian, &crank, &alice, &bob] {
        svm.airdrop(&kp.pubkey(), 50_000_000_000).unwrap();
    }
    setup_program_data(&mut svm, Some(&admin.pubkey()));

    send_initialize_global(
        &mut svm,
        &admin,
        &admin.pubkey(),
        &guardian.pubkey(),
        &crank.pubkey(),
    )
    .expect("Initialize GlobalConfig must succeed");

    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000)
        .unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let (huma_pool_authority, _) = huma_pool_authority_pda(&huma_pool_state);
    let pst_mint_kp = Keypair::new();
    inject_mint_with_authority_and_supply(
        &mut svm,
        pst_mint_kp.pubkey(),
        huma_pool_authority,
        6,
        0,
    );
    let pst_mint = pst_mint_kp.pubkey();

    let huma_pool_underlying_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_underlying_token,
        usdc_mint,
        huma_pool_authority,
        1_000_000_000,
    );

    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_mode_token,
        pst_mint,
        huma_pool_authority,
        0,
    );

    let ticket_registry_kp = Keypair::new();
    svm.set_account(
        ticket_registry_kp.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let ticket_registry = ticket_registry_kp.pubkey();

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, usdc_mint, admin.pubkey(), 0);

    let pool_id = 1;
    let tiers = vec![
        anchor::PrizeTier::new(1, 7000),
        anchor::PrizeTier::new(1, 3000),
    ];

    CreatePoolBuilder::new(admin.pubkey(), pool_id)
        .with_mints(usdc_mint, pst_mint)
        .with_fee_basis_points(1000)
        .with_prize_tiers(tiers)
        .with_ticket_registry(ticket_registry)
        .with_fee_wallet(fee_wallet)
        .with_huma_pool_state(huma_pool_state)
        .send(&mut svm, &admin)
        .expect("Create PrizePool must succeed");

    let dummy = Keypair::new().pubkey();
    let ix_init_lender = build_initialize_huma_lender_ix(
        admin.pubkey(),
        pool_id,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        huma_pool_state,
        dummy,
        pst_mint,
        dummy,
        dummy,
    );
    send_initialize_huma_lender(&mut svm, &admin, ix_init_lender)
        .expect("Initialize Huma Lender must succeed");

    let alice_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, alice_usdc, usdc_mint, alice.pubkey(), 200_000_000);
    let bob_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, bob_usdc, usdc_mint, bob.pubkey(), 100_000_000);

    LifecycleTestHarness {
        ctx: E2eContext {
            svm,
            admin,
            user: alice,
            usdc_mint_authority,
            usdc_mint,
            pst_mint,
            ticket_registry,
            huma_pool_state,
            huma_pool_authority,
            huma_pool_underlying_token,
            huma_pool_mode_token,
            user_usdc_account: alice_usdc,
            pool_id,
            fee_wallet,
        },
        guardian,
        crank,
        bob,
        bob_usdc,
        pool_id,
        fee_wallet,
    }
}

// ─── Test Fixture & State Mutation Helpers ────────────────────────────────────

pub fn clone_keypair(keypair: &Keypair) -> Keypair {
    keypair.insecure_clone()
}

pub fn warp_to_timestamp(svm: &mut LiteSVM, target_unix_timestamp: i64) {
    let clock: solana_sdk::clock::Clock = svm.get_sysvar();
    assert!(
        target_unix_timestamp >= clock.unix_timestamp,
        "Cannot warp backwards in time: current {}, target {}",
        clock.unix_timestamp,
        target_unix_timestamp
    );

    let delta_seconds = target_unix_timestamp - clock.unix_timestamp;
    let delta_slots = (delta_seconds as u64 * 5) / 2;
    if delta_slots > 0 {
        svm.warp_to_slot(clock.slot + delta_slots);
    }

    let mut updated_clock: solana_sdk::clock::Clock = svm.get_sysvar();
    updated_clock.unix_timestamp = target_unix_timestamp;
    svm.set_sysvar(&updated_clock);
}

pub fn warp_forward_seconds(svm: &mut LiteSVM, seconds: i64) {
    let clock: solana_sdk::clock::Clock = svm.get_sysvar();
    warp_to_timestamp(svm, clock.unix_timestamp + seconds);
}

pub fn set_clock_timestamp(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: solana_sdk::clock::Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

pub fn substitute_account_meta(
    ix: &mut solana_program::instruction::Instruction,
    target: Pubkey,
    replacement: Pubkey,
) {
    let mut found = false;
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == target {
            meta.pubkey = replacement;
            found = true;
            break;
        }
    }
    assert!(
        found,
        "Target account {target} not found in instruction accounts"
    );
}

pub fn set_signer_flag(
    accounts: &mut [solana_program::instruction::AccountMeta],
    pubkey: &Pubkey,
    is_signer: bool,
) {
    let meta = accounts
        .iter_mut()
        .find(|m| m.pubkey == *pubkey)
        .unwrap_or_else(|| panic!("Account {pubkey} not found in instruction accounts"));
    meta.is_signer = is_signer;
}

pub fn set_mock_huma_pool_assets(svm: &mut LiteSVM, huma_pool_state: Pubkey, assets: u128) {
    let mut acc = svm
        .get_account(&huma_pool_state)
        .expect("Huma pool state must exist");
    acc.data[30..46].copy_from_slice(&assets.to_le_bytes());
    svm.set_account(huma_pool_state, acc)
        .expect("Updating Huma pool assets must succeed");
}

pub fn set_mock_huma_next_request_id(
    svm: &mut LiteSVM,
    huma_pool_state: Pubkey,
    next_request_id: u128,
) {
    let mut acc = svm
        .get_account(&huma_pool_state)
        .expect("Huma pool state must exist");
    acc.data[250..266].copy_from_slice(&next_request_id.to_le_bytes());
    svm.set_account(huma_pool_state, acc)
        .expect("Updating Huma next_request_id must succeed");
}

pub fn mutate_pool_state<F>(svm: &mut LiteSVM, pool_id: u32, mutator: F)
where
    F: FnOnce(&mut anchor::PrizePool),
{
    let (pda, _) = pool_pda(pool_id);
    let mut account = svm.get_account(&pda).expect("Pool account must exist");
    let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut account.data[8..]);
    mutator(pool);
    svm.set_account(pda, account)
        .expect("Set pool account failed");
}

pub fn mutate_anchor_account<T, F>(svm: &mut LiteSVM, address: Pubkey, f: F)
where
    T: anchor_lang::AccountDeserialize + anchor_lang::AccountSerialize,
    F: FnOnce(&mut T),
{
    let mut account = svm.get_account(&address).expect("Account must exist");
    let mut data = T::try_deserialize(&mut account.data.as_slice())
        .expect("Deserialize anchor account failed");
    f(&mut data);
    let mut new_data = Vec::new();
    data.try_serialize(&mut new_data)
        .expect("Serialize anchor account failed");
    let target_len = account.data.len().max(new_data.len());
    new_data.resize(target_len, 0);
    account.data = new_data;
    svm.set_account(address, account)
        .expect("Set anchor account failed");
}

pub fn mutate_draw_cycle<F>(svm: &mut LiteSVM, pool_id: u32, cycle_id: u32, mutator: F)
where
    F: FnOnce(&mut anchor::DrawCycle),
{
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    mutate_anchor_account(svm, pda, mutator);
}

pub fn mutate_global_config<F>(svm: &mut LiteSVM, mutator: F)
where
    F: FnOnce(&mut anchor::GlobalConfig),
{
    let (pda, _) = global_config_pda();
    mutate_anchor_account(svm, pda, mutator);
}

pub fn mutate_user_winnings<F>(svm: &mut LiteSVM, pool_id: u32, user: &Pubkey, mutator: F)
where
    F: FnOnce(&mut anchor::UserWinnings),
{
    let (pda, _) = user_winnings_pda(pool_id, user);
    mutate_anchor_account(svm, pda, mutator);
}

pub fn mutate_ticket_registry_header<F>(svm: &mut LiteSVM, address: Pubkey, f: F)
where
    F: FnOnce(&mut anchor::state::TicketRegistry),
{
    let mut acc = svm
        .get_account(&address)
        .expect("Ticket registry account must exist");
    let mut reg =
        anchor::utils::get_ticket_registry_mut(&mut acc.data).expect("Valid TicketRegistry header");
    f(reg.header);
    svm.set_account(address, acc)
        .expect("Set ticket registry account failed");
}

pub fn inject_huma_yield_ratio(
    svm: &mut LiteSVM,
    huma_pool_state: Pubkey,
    pst_mint: Pubkey,
    total_assets: u64,
    pst_supply: u64,
) {
    set_mock_huma_pool_assets(svm, huma_pool_state, total_assets as u128);
    set_token_mint_supply(svm, pst_mint, pst_supply);
}

pub fn set_huma_solvency_state(
    svm: &mut LiteSVM,
    huma_pool_state: Pubkey,
    pst_mint: Pubkey,
    total_assets: u128,
    pst_supply: u64,
) {
    set_mock_huma_pool_assets(svm, huma_pool_state, total_assets);
    set_token_mint_supply(svm, pst_mint, pst_supply);
}

pub fn force_user_entries_version(
    svm: &mut LiteSVM,
    registry_pda: Pubkey,
    version: u8,
    entry_count: usize,
) {
    let mut acc = svm.get_account(&registry_pda).expect("Registry must exist");
    let entries_offset = 8 + std::mem::size_of::<anchor::state::TicketRegistry>();
    for i in 0..entry_count {
        let offset = entries_offset + i * std::mem::size_of::<anchor::state::UserEntry>();
        let entry = bytemuck::from_bytes_mut::<anchor::state::UserEntry>(
            &mut acc.data[offset..offset + std::mem::size_of::<anchor::state::UserEntry>()],
        );
        entry.version = version;
    }
    svm.set_account(registry_pda, acc)
        .expect("Updating registry must succeed");
}

// ─── Reveal Fixture & Builder ────────────────────────────────────────────────

pub struct RevealFixture {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub crank: Keypair,
    pub jobs_account: Keypair,
    pub ticket_registry: Pubkey,
    pub tickets: Vec<Pubkey>,
    pub randomness_account: Pubkey,
    pub pool_id: u32,
    pub cycle_id: u32,
}

impl RevealFixture {
    pub fn builder() -> RevealFixtureBuilder {
        RevealFixtureBuilder::new()
    }

    pub fn send_reveal(&mut self, seed: [u8; 32]) -> TxResult {
        inject_current_slot_randomness(&mut self.svm, self.randomness_account, seed);
        let crank = clone_keypair(&self.crank);
        crate::common::account_builders::RevealAndPickWinnersBuilder::for_pool(
            self.pool_id,
            self.cycle_id,
            crank.pubkey(),
        )
        .with_ticket_registry(self.ticket_registry)
        .with_randomness_account(self.randomness_account)
        .send(&mut self.svm, &crank)
    }

    pub fn send_reveal_for_cycle(
        &mut self,
        pool_id: u32,
        cycle_id: u32,
        seed: [u8; 32],
    ) -> TxResult {
        inject_current_slot_randomness(&mut self.svm, self.randomness_account, seed);
        let crank = clone_keypair(&self.crank);
        crate::common::account_builders::RevealAndPickWinnersBuilder::for_pool(
            pool_id,
            cycle_id,
            crank.pubkey(),
        )
        .with_ticket_registry(self.ticket_registry)
        .with_randomness_account(self.randomness_account)
        .send(&mut self.svm, &crank)
    }

    pub fn send_reinvest(&mut self, winner: &Pubkey, winner_index: u32) -> TxResult {
        let (uw_pda, _) = user_winnings_pda(self.pool_id, winner);
        if self.svm.get_account(&uw_pda).is_none() {
            inject_user_winnings(&mut self.svm, self.pool_id, *winner, 0, 0, 0);
        }
        let crank = clone_keypair(&self.crank);
        crate::common::account_builders::ReinvestWinningsBuilder::for_pool(
            self.pool_id,
            self.cycle_id,
            crank.pubkey(),
        )
        .with_winner(winner)
        .with_ticket_registry(self.ticket_registry)
        .with_winner_index(winner_index)
        .send(&mut self.svm, &crank)
    }

    pub fn send_crank_close(&mut self) -> TxResult {
        let crank = clone_keypair(&self.crank);
        crate::common::account_builders::CrankClosePayoutRegistryBuilder::new(
            crank.pubkey(),
            self.pool_id,
            self.cycle_id,
        )
        .send(&mut self.svm, &crank)
    }
}

pub struct RevealFixtureBuilder {
    pool_id: u32,
    cycle_id: u32,
    status: anchor::PoolStatus,
    is_frozen: bool,
    tiers: Vec<anchor::PrizeTier>,
    num_tickets: usize,
    locked_tickets: Option<u32>,
    prize_pot: u64,
    allocated_prizes: Option<u64>,
    draw_status: anchor::DrawStatus,
}

impl RevealFixtureBuilder {
    pub fn new() -> Self {
        Self {
            pool_id: 1,
            cycle_id: 0,
            status: anchor::PoolStatus::Active,
            is_frozen: true,
            tiers: vec![anchor::PrizeTier::default_single_winner()],
            num_tickets: 5,
            locked_tickets: None,
            prize_pot: 1_000_000,
            allocated_prizes: None,
            draw_status: anchor::DrawStatus::AwaitingRandomness,
        }
    }

    pub fn with_pool_id(mut self, pool_id: u32) -> Self {
        self.pool_id = pool_id;
        self
    }

    pub fn with_cycle_id(mut self, cycle_id: u32) -> Self {
        self.cycle_id = cycle_id;
        self
    }

    pub fn with_status(mut self, status: anchor::PoolStatus) -> Self {
        self.status = status;
        self
    }

    pub fn with_frozen(mut self, is_frozen: bool) -> Self {
        self.is_frozen = is_frozen;
        self
    }

    pub fn with_tiers(mut self, tiers: Vec<anchor::PrizeTier>) -> Self {
        self.tiers = tiers;
        self
    }

    pub fn with_num_tickets(mut self, num_tickets: usize) -> Self {
        self.num_tickets = num_tickets;
        self
    }

    pub fn with_locked_tickets(mut self, locked_tickets: u32) -> Self {
        self.locked_tickets = Some(locked_tickets);
        self
    }

    pub fn with_prize_pot(mut self, prize_pot: u64) -> Self {
        self.prize_pot = prize_pot;
        self
    }

    pub fn with_allocated_prizes(mut self, allocated_prizes: u64) -> Self {
        self.allocated_prizes = Some(allocated_prizes);
        self
    }

    pub fn with_draw_status(mut self, draw_status: anchor::DrawStatus) -> Self {
        self.draw_status = draw_status;
        self
    }

    pub fn build(self) -> RevealFixture {
        let authority = Keypair::new();
        let admin = Keypair::new();
        let crank = Keypair::new();
        let jobs = crank.insecure_clone();
        let mut svm =
            setup_global_config_with_admin(&authority, &admin.pubkey(), Some(&crank.pubkey()));
        svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

        let tickets = create_test_ticket_owners(self.num_tickets);
        let registry = Keypair::new().pubkey();
        inject_registry_with_tickets(
            &mut svm,
            registry,
            self.pool_id,
            10_000,
            self.num_tickets as u32,
            0,
            &tickets,
        );

        let allocated = self.allocated_prizes.unwrap_or(self.prize_pot);
        crate::common::state_builders::PrizePoolTestBuilder::new(self.pool_id)
            .with_ticket_registry(registry)
            .with_status(self.status)
            .with_frozen(self.is_frozen)
            .with_prize_tiers(self.tiers)
            .with_current_draw_cycle_id(self.cycle_id)
            .with_cycle_end_at(1_700_000_000)
            .with_solvency_state((self.num_tickets as u64) * 1_000_000, allocated, 0)
            .inject(&mut svm);

        let randomness_account = Keypair::new().pubkey();
        inject_mock_randomness_account(&mut svm, randomness_account);

        let locked = self.locked_tickets.unwrap_or(self.num_tickets as u32);
        crate::common::state_builders::DrawCycleTestBuilder::new(self.pool_id, self.cycle_id)
            .with_status(self.draw_status)
            .with_locked_tickets(locked)
            .with_prize_pot(self.prize_pot)
            .with_randomness_account(randomness_account)
            .inject(&mut svm);

        RevealFixture {
            svm,
            admin,
            crank,
            jobs_account: jobs,
            ticket_registry: registry,
            tickets,
            randomness_account,
            pool_id: self.pool_id,
            cycle_id: self.cycle_id,
        }
    }
}

impl Default for RevealFixtureBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Claim Redemption Fixture & Builder ──────────────────────────────────────

pub struct ClaimRedemptionFixture {
    pub svm: LiteSVM,
    pub user: Keypair,
    pub token_mint: Pubkey,
    pub pst_mint: Pubkey,
    pub pool_vault: Pubkey,
    pub user_token_account: Pubkey,
    pub huma_pool_state: Pubkey,
    pub huma_lender_state: Pubkey,
    pub pool_id: u32,
    pub redemption_id: u64,
}

impl ClaimRedemptionFixture {
    pub fn builder() -> ClaimRedemptionFixtureBuilder {
        ClaimRedemptionFixtureBuilder::new()
    }

    pub fn claim_builder(&self, caller: Pubkey) -> ClaimRedemptionBuilder {
        ClaimRedemptionBuilder::for_redemption(
            self.pool_id,
            self.redemption_id,
            caller,
            self.user.pubkey(),
        )
        .with_token_mint(self.token_mint)
        .with_pool_vault_account(self.pool_vault)
        .with_user_token_account(self.user_token_account)
        .with_huma_pool_state(self.huma_pool_state)
        .with_huma_lender_state(self.huma_lender_state)
    }

    pub fn send_claim(&mut self, caller_kp: &Keypair) -> TxResult {
        let ix = self.claim_builder(caller_kp.pubkey()).build_ix();
        send_user_tx(&mut self.svm, caller_kp, ix)
    }
}

pub struct ClaimRedemptionFixtureBuilder {
    pool_id: u32,
    redemption_id: u64,
    redemption_amount: u64,
    redemption_owner: Option<Pubkey>,
    vault_balance: u64,
    pool_status: anchor::PoolStatus,
    settled_huma: Option<(u64, u64)>,
}

impl ClaimRedemptionFixtureBuilder {
    pub fn new() -> Self {
        Self {
            pool_id: 1,
            redemption_id: 0,
            redemption_amount: 1_000_000,
            redemption_owner: None,
            vault_balance: 0,
            pool_status: anchor::PoolStatus::Active,
            settled_huma: None,
        }
    }

    pub fn with_pool_id(mut self, pool_id: u32) -> Self {
        self.pool_id = pool_id;
        self
    }

    pub fn with_redemption(mut self, id: u64, amount: u64, owner: Option<Pubkey>) -> Self {
        self.redemption_id = id;
        self.redemption_amount = amount;
        self.redemption_owner = owner;
        self
    }

    pub fn with_redemption_id(mut self, id: u64) -> Self {
        self.redemption_id = id;
        self
    }

    pub fn with_redemption_amount(mut self, amount: u64) -> Self {
        self.redemption_amount = amount;
        self
    }

    pub fn with_redemption_owner(mut self, owner: Pubkey) -> Self {
        self.redemption_owner = Some(owner);
        self
    }

    pub fn with_vault_balance(mut self, amount: u64) -> Self {
        self.vault_balance = amount;
        self
    }

    pub fn with_pool_status(mut self, status: anchor::PoolStatus) -> Self {
        self.pool_status = status;
        self
    }

    pub fn with_settled_huma(mut self, next_request_id: u64, amount_settled: u64) -> Self {
        self.settled_huma = Some((next_request_id, amount_settled));
        self
    }

    pub fn build(self) -> ClaimRedemptionFixture {
        let mut svm = setup_svm();

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

        let token_mint = Keypair::new().pubkey();
        let pst_mint = Keypair::new().pubkey();
        inject_mint(&mut svm, token_mint, 6);
        inject_mint(&mut svm, pst_mint, 6);

        let huma_pool_state = Keypair::new().pubkey();
        inject_huma_pool_state(&mut svm, huma_pool_state);

        let pool_key = pool_pda(self.pool_id).0;

        PrizePoolTestBuilder::new(self.pool_id)
            .with_token_mint(token_mint)
            .with_huma_pool_state(huma_pool_state)
            .with_status(self.pool_status)
            .with_frozen(false)
            .inject(&mut svm);

        let (pool_vault, _) = pool_vault_pda(self.pool_id);
        inject_token_account(&mut svm, pool_vault, token_mint, pool_key, self.vault_balance);

        let owner = self.redemption_owner.unwrap_or_else(|| user.pubkey());

        inject_pending_redemption(
            &mut svm,
            self.pool_id,
            self.redemption_id,
            owner,
            self.redemption_amount,
            self.redemption_amount,
        );

        let user_token_account =
            create_spl_token_account(&mut svm, &user, &token_mint, &user.pubkey());

        let huma_lender_state = Keypair::new().pubkey();
        if let Some((next_request_id, amount_settled)) = self.settled_huma {
            inject_lender_state(&mut svm, huma_lender_state, amount_settled);
            settle_huma_redemption(&mut svm, huma_pool_state, next_request_id);
        } else {
            inject_dummy_huma_account(&mut svm, huma_lender_state);
        }

        ClaimRedemptionFixture {
            svm,
            user,
            token_mint,
            pst_mint,
            pool_vault,
            user_token_account,
            huma_pool_state,
            huma_lender_state,
            pool_id: self.pool_id,
            redemption_id: self.redemption_id,
        }
    }
}

impl Default for ClaimRedemptionFixtureBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Harvest Fixture & Builder ───────────────────────────────────────────────

pub struct HarvestFixture {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub crank: Keypair,
    pub pst_mint: Pubkey,
    pub ticket_registry: Pubkey,
    pub huma_pool_state: Pubkey,
    pub randomness_account: Pubkey,
    pub pool_id: u32,
}

impl HarvestFixture {
    pub fn builder() -> HarvestFixtureBuilder {
        HarvestFixtureBuilder::new()
    }

    pub fn harvest_builder(&self, pool_id: u32) -> HarvestYieldAndCommitBuilder {
        let (pool_key, _) = pool_pda(pool_id);
        let cycle_id = self
            .svm
            .get_account(&pool_key)
            .and_then(|acc| anchor::PrizePool::try_deserialize(&mut acc.data.as_slice()).ok())
            .map(|p| p.current_draw_cycle_id)
            .unwrap_or(0);

        let crank_pubkey = self.crank.pubkey();
        HarvestYieldAndCommitBuilder::for_pool(pool_id, cycle_id, crank_pubkey)
            .with_ticket_registry(self.ticket_registry)
            .with_pst_mint(self.pst_mint)
            .with_huma_pool_state(self.huma_pool_state)
            .with_randomness_account(self.randomness_account)
    }

    pub fn send_harvest(&mut self, pool_id: u32, _cycle_id: u32) -> TxResult {
        let crank = clone_keypair(&self.crank);
        let ix = self.harvest_builder(pool_id).build_ix();
        send_user_tx(&mut self.svm, &crank, ix)
    }
}

pub struct HarvestFixtureBuilder {
    pool_id: u32,
    status: anchor::PoolStatus,
    is_frozen: bool,
    active_tickets: u32,
    pending_tickets: u32,
    fee_basis_points: u16,
    max_yield_basis_points: u16,
    min_yield_threshold: u64,
    payout_timelock_seconds: u32,
    cycle_end_at: i64,
    prize_tiers: Vec<anchor::PrizeTier>,
    principal: u64,
    pst_shares_amount: u64,
    pst_supply: u64,
    total_assets: u128,
}

impl HarvestFixtureBuilder {
    pub fn new() -> Self {
        Self {
            pool_id: 1,
            status: anchor::PoolStatus::Active,
            is_frozen: false,
            active_tickets: 0,
            pending_tickets: 0,
            fee_basis_points: 100,
            max_yield_basis_points: 0,
            min_yield_threshold: 0,
            payout_timelock_seconds: 300,
            cycle_end_at: 0,
            prize_tiers: vec![anchor::PrizeTier::default_single_winner()],
            principal: 0,
            pst_shares_amount: 0,
            pst_supply: 0,
            total_assets: 0,
        }
    }

    pub fn with_pool_id(mut self, pool_id: u32) -> Self {
        self.pool_id = pool_id;
        self
    }

    pub fn with_status(mut self, status: anchor::PoolStatus, is_frozen: bool) -> Self {
        self.status = status;
        self.is_frozen = is_frozen;
        self
    }

    pub fn with_frozen(mut self, is_frozen: bool) -> Self {
        self.is_frozen = is_frozen;
        self
    }

    pub fn with_tickets(mut self, active: u32, pending: u32) -> Self {
        self.active_tickets = active;
        self.pending_tickets = pending;
        self
    }

    pub fn with_simulated_yield(mut self, principal: u64, yield_amount: u64) -> Self {
        self.principal = principal;
        self.pst_shares_amount = principal;
        self.pst_supply = principal;
        self.total_assets = (principal.saturating_add(yield_amount)) as u128;
        self
    }

    pub fn with_insolvency_deficit(mut self, principal: u64, deficit_amount: u64) -> Self {
        self.principal = principal;
        self.pst_shares_amount = principal;
        self.pst_supply = principal;
        self.total_assets = (principal.saturating_sub(deficit_amount)) as u128;
        self
    }

    pub fn with_raw_huma_state(
        mut self,
        pst_balance: u64,
        pst_supply: u64,
        total_assets: u128,
        principal: u64,
    ) -> Self {
        self.pst_shares_amount = pst_balance;
        self.pst_supply = pst_supply;
        self.total_assets = total_assets;
        self.principal = principal;
        self
    }

    pub fn with_circuit_breaker(mut self, max_yield_bps: u16, fee_bps: u16) -> Self {
        self.max_yield_basis_points = max_yield_bps;
        self.fee_basis_points = fee_bps;
        self
    }

    pub fn with_min_yield_threshold(mut self, min: u64) -> Self {
        self.min_yield_threshold = min;
        self
    }

    pub fn with_payout_timelock_seconds(mut self, secs: u32) -> Self {
        self.payout_timelock_seconds = secs;
        self
    }

    pub fn with_cycle_end_at(mut self, timestamp: i64) -> Self {
        self.cycle_end_at = timestamp;
        self
    }

    pub fn with_prize_tiers(mut self, tiers: Vec<anchor::PrizeTier>) -> Self {
        self.prize_tiers = tiers;
        self
    }

    pub fn build(self) -> HarvestFixture {
        let GlobalRolesContext {
            mut svm,
            admin,
            crank,
            ..
        } = setup_global_roles();

        let token_mint = Keypair::new().pubkey();
        let pst_mint = Keypair::new().pubkey();
        inject_mint_with_supply(&mut svm, token_mint, 6, 1_000_000_000_000);
        inject_mint_with_supply(&mut svm, pst_mint, 6, self.pst_supply);

        let fee_wallet = Keypair::new().pubkey();
        let ticket_registry = Keypair::new().pubkey();
        inject_registry(
            &mut svm,
            ticket_registry,
            self.pool_id,
            1000,
            self.active_tickets,
            self.pending_tickets,
        );

        let pool_key = pool_pda(self.pool_id).0;
        let (pool_pst_vault, _) = pool_pst_vault_pda(self.pool_id);
        inject_token_account(
            &mut svm,
            pool_pst_vault,
            pst_mint,
            pool_key,
            self.pst_shares_amount,
        );

        let huma_pool_state = Keypair::new().pubkey();
        inject_huma_pool_state_with_assets(&mut svm, huma_pool_state, self.total_assets);

        let randomness_account = Keypair::new().pubkey();
        inject_mock_randomness_account(&mut svm, randomness_account);

        PrizePoolTestBuilder::new(self.pool_id)
            .with_token_mint(token_mint)
            .with_ticket_registry(ticket_registry)
            .with_fee_wallet(fee_wallet)
            .with_huma_pool_state(huma_pool_state)
            .with_status(self.status)
            .with_frozen(self.is_frozen)
            .with_fee_basis_points(self.fee_basis_points)
            .with_max_yield_basis_points(self.max_yield_basis_points)
            .with_min_yield_threshold(self.min_yield_threshold)
            .with_payout_timelock_seconds(self.payout_timelock_seconds)
            .with_cycle_end_at(self.cycle_end_at)
            .with_current_draw_cycle_id(0)
            .with_prize_tiers(self.prize_tiers)
            .with_solvency_state(self.principal, 0, 0)
            .inject(&mut svm);

        warp_to_timestamp(&mut svm, 1_700_001_000);

        HarvestFixture {
            svm,
            admin,
            crank,
            pst_mint,
            ticket_registry,
            huma_pool_state,
            randomness_account,
            pool_id: self.pool_id,
        }
    }
}

impl Default for HarvestFixtureBuilder {
    fn default() -> Self {
        Self::new()
    }
}

