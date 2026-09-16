use {
    crate::common::{context::E2eContext, dispatch::*, pda::*, readers::*},
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
    },
    solana_sdk::signature::{Keypair, Signer},
};

// ─── 1. BuyBondsBuilder ──────────────────────────────────────────────────────

pub struct BuyBondsBuilder {
    pub pool_id: u32,
    pub accounts: anchor::accounts::BuyBonds,
    pub tickets_to_buy: u32,
}

impl BuyBondsBuilder {
    pub fn for_pool(pool_id: u32, user: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &user);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::BuyBonds {
                user,
                user_winnings,
                pool: pool_pda_addr,
                ticket_registry: dummy,
                user_token_account: dummy,
                token_mint: dummy,
                pool_vault_account: pool_vault,
                pool_pst_vault,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: dummy,
                huma_mode_config: dummy,
                huma_mode_mint: dummy,
                huma_pool_authority: dummy,
                huma_pool_underlying_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            tickets_to_buy: 1,
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::BuyBonds {
                user: ctx.user.pubkey(),
                user_winnings,
                pool: pool_pda_addr,
                ticket_registry: ctx.ticket_registry,
                user_token_account: ctx.user_usdc_account,
                token_mint: ctx.usdc_mint,
                pool_vault_account: pool_vault,
                pool_pst_vault,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: ctx.huma_pool_state,
                huma_mode_config: dummy,
                huma_mode_mint: ctx.pst_mint,
                huma_pool_authority: ctx.huma_pool_authority,
                huma_pool_underlying_token: ctx.huma_pool_underlying_token,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            tickets_to_buy: 1,
        }
    }

    pub fn with_tickets(mut self, tickets_to_buy: u32) -> Self {
        self.tickets_to_buy = tickets_to_buy;
        self
    }

    pub fn with_user(mut self, user: &Pubkey, user_token_account: Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_token_account = user_token_account;
        self.accounts.user_winnings = user_winnings_pda(self.pool_id, user).0;
        self
    }

    pub fn with_user_token_account(mut self, user_token_account: Pubkey) -> Self {
        self.accounts.user_token_account = user_token_account;
        self
    }

    pub fn with_user_winnings(mut self, user_winnings: Pubkey) -> Self {
        self.accounts.user_winnings = user_winnings;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.accounts.token_mint = token_mint;
        self
    }

    pub fn with_pool_vault_account(mut self, pool_vault_account: Pubkey) -> Self {
        self.accounts.pool_vault_account = pool_vault_account;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_mode_mint(mut self, huma_mode_mint: Pubkey) -> Self {
        self.accounts.huma_mode_mint = huma_mode_mint;
        self
    }

    pub fn with_huma_pool_authority(mut self, huma_pool_authority: Pubkey) -> Self {
        self.accounts.huma_pool_authority = huma_pool_authority;
        self
    }

    pub fn with_huma_pool_underlying_token(mut self, huma_pool_underlying_token: Pubkey) -> Self {
        self.accounts.huma_pool_underlying_token = huma_pool_underlying_token;
        self
    }

    pub fn with_token_program(mut self, token_program: Pubkey) -> Self {
        self.accounts.token_program = token_program;
        self
    }

    pub fn with_pst_token_program(mut self, pst_token_program: Pubkey) -> Self {
        self.accounts.pst_token_program = pst_token_program;
        self
    }

    pub fn with_system_program(mut self, system_program: Pubkey) -> Self {
        self.accounts.system_program = system_program;
        self
    }

    pub fn with_event_authority(mut self, event_authority: Pubkey) -> Self {
        self.accounts.event_authority = event_authority;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::BuyBonds)>(mut self, f: F) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self, tickets_to_buy: u32) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::BuyBonds { tickets_to_buy }.data(),
        }
    }

    pub fn build_default_ix(&self) -> Instruction {
        self.build_ix(self.tickets_to_buy)
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_default_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_default_ix())
    }
}

// ─── 2. SellBondsBuilder ─────────────────────────────────────────────────────

pub struct SellBondsBuilder {
    pub pool_id: u32,
    pub accounts: anchor::accounts::SellBonds,
    pub remaining_accounts: Vec<AccountMeta>,
    pub active_to_sell: u32,
    pub pending_to_sell: u32,
}

impl SellBondsBuilder {
    pub fn for_pool(pool_id: u32, user: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
        let (user_winnings, _) = user_winnings_pda(pool_id, &user);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::SellBonds {
                user,
                user_winnings,
                pool: pool_pda_addr,
                ticket_registry: dummy,
                token_mint: dummy,
                pool_pst_vault,
                pending_redemption,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: dummy,
                huma_mode_config: dummy,
                huma_mode_mint: dummy,
                huma_redemption_request: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: dummy,
                huma_pool_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            remaining_accounts: Vec::new(),
            active_to_sell: 1,
            pending_to_sell: 0,
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, pool.next_redemption_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::SellBonds {
                user: ctx.user.pubkey(),
                user_winnings,
                pool: pool_pda_addr,
                ticket_registry: ctx.ticket_registry,
                token_mint: ctx.usdc_mint,
                pool_pst_vault,
                pending_redemption,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: ctx.huma_pool_state,
                huma_mode_config: dummy,
                huma_mode_mint: ctx.pst_mint,
                huma_redemption_request: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: ctx.huma_pool_authority,
                huma_pool_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            remaining_accounts: Vec::new(),
            active_to_sell: 1,
            pending_to_sell: 0,
        }
    }

    pub fn with_shares(mut self, active_to_sell: u32, pending_to_sell: u32) -> Self {
        self.active_to_sell = active_to_sell;
        self.pending_to_sell = pending_to_sell;
        self
    }

    pub fn with_user(mut self, user: &Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_winnings = user_winnings_pda(self.pool_id, user).0;
        self
    }

    pub fn with_user_winnings(mut self, user_winnings: Pubkey) -> Self {
        self.accounts.user_winnings = user_winnings;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.accounts.token_mint = token_mint;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_pending_redemption(mut self, pending_redemption: Pubkey) -> Self {
        self.accounts.pending_redemption = pending_redemption;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_mode_mint(mut self, huma_mode_mint: Pubkey) -> Self {
        self.accounts.huma_mode_mint = huma_mode_mint;
        self
    }

    pub fn with_huma_redemption_request(mut self, huma_redemption_request: Pubkey) -> Self {
        self.accounts.huma_redemption_request = huma_redemption_request;
        self
    }

    pub fn with_huma_lender_state(mut self, huma_lender_state: Pubkey) -> Self {
        self.accounts.huma_lender_state = huma_lender_state;
        self
    }

    pub fn with_huma_pool_authority(mut self, huma_pool_authority: Pubkey) -> Self {
        self.accounts.huma_pool_authority = huma_pool_authority;
        self
    }

    pub fn with_huma_pool_mode_token(mut self, huma_pool_mode_token: Pubkey) -> Self {
        self.accounts.huma_pool_mode_token = huma_pool_mode_token;
        self
    }

    pub fn with_swapped_user_winnings(mut self, swapped: Option<Pubkey>) -> Self {
        if let Some(s) = swapped {
            self.remaining_accounts.push(AccountMeta::new(s, false));
        }
        self
    }

    pub fn with_remaining_account(mut self, meta: AccountMeta) -> Self {
        self.remaining_accounts.push(meta);
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::SellBonds)>(mut self, f: F) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        let mut metas = self.accounts.to_account_metas(None);
        metas.extend(self.remaining_accounts.clone());
        metas
    }

    pub fn build_ix(&self, active_to_sell: u32, pending_to_sell: u32) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::SellBonds {
                active_to_sell,
                pending_to_sell,
            }
            .data(),
        }
    }

    pub fn build_default_ix(&self) -> Instruction {
        self.build_ix(self.active_to_sell, self.pending_to_sell)
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_default_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_default_ix())
    }
}

// ─── 3. ClaimRedemptionBuilder ───────────────────────────────────────────────

pub struct ClaimRedemptionBuilder {
    pub pool_id: u32,
    pub redemption_id: u64,
    pub accounts: anchor::accounts::ClaimRedemption,
}

impl ClaimRedemptionBuilder {
    pub fn for_redemption(
        pool_id: u32,
        redemption_id: u64,
        caller: Pubkey,
        beneficiary: Pubkey,
    ) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            redemption_id,
            accounts: anchor::accounts::ClaimRedemption {
                caller,
                beneficiary,
                pool: pool_pda_addr,
                pending_redemption,
                token_mint: dummy,
                pool_vault_account: pool_vault,
                beneficiary_token_account: dummy,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: dummy,
                huma_mode_config: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: dummy,
                huma_pool_underlying_token: dummy,
                token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let redemption_id = 0;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            redemption_id,
            accounts: anchor::accounts::ClaimRedemption {
                caller: ctx.user.pubkey(),
                beneficiary: ctx.user.pubkey(),
                pool: pool_pda_addr,
                pending_redemption,
                token_mint: ctx.usdc_mint,
                pool_vault_account: pool_vault,
                beneficiary_token_account: ctx.user_usdc_account,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: ctx.huma_pool_state,
                huma_mode_config: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: ctx.huma_pool_authority,
                huma_pool_underlying_token: ctx.huma_pool_underlying_token,
                token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn with_caller(mut self, caller: Pubkey) -> Self {
        self.accounts.caller = caller;
        self
    }

    pub fn with_user(mut self, user: &Pubkey, user_token_account: Pubkey) -> Self {
        self.accounts.caller = *user;
        self.accounts.beneficiary = *user;
        self.accounts.beneficiary_token_account = user_token_account;
        self
    }

    pub fn with_user_token_account(mut self, user_token_account: Pubkey) -> Self {
        self.accounts.beneficiary_token_account = user_token_account;
        self
    }

    pub fn with_beneficiary(
        mut self,
        beneficiary: Pubkey,
        beneficiary_token_account: Pubkey,
    ) -> Self {
        self.accounts.beneficiary = beneficiary;
        self.accounts.beneficiary_token_account = beneficiary_token_account;
        self
    }

    pub fn with_redemption_id(mut self, redemption_id: u64) -> Self {
        self.accounts.pending_redemption = pending_redemption_pda(1, redemption_id).0;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_pending_redemption(mut self, pending_redemption: Pubkey) -> Self {
        self.accounts.pending_redemption = pending_redemption;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.accounts.token_mint = token_mint;
        self
    }

    pub fn with_pool_vault_account(mut self, pool_vault_account: Pubkey) -> Self {
        self.accounts.pool_vault_account = pool_vault_account;
        self
    }

    pub fn with_beneficiary_token_account(mut self, beneficiary_token_account: Pubkey) -> Self {
        self.accounts.beneficiary_token_account = beneficiary_token_account;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_lender_state(mut self, huma_lender_state: Pubkey) -> Self {
        self.accounts.huma_lender_state = huma_lender_state;
        self
    }

    pub fn with_huma_pool_authority(mut self, huma_pool_authority: Pubkey) -> Self {
        self.accounts.huma_pool_authority = huma_pool_authority;
        self
    }

    pub fn with_huma_pool_underlying_token(mut self, huma_pool_underlying_token: Pubkey) -> Self {
        self.accounts.huma_pool_underlying_token = huma_pool_underlying_token;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::ClaimRedemption)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::ClaimRedemption {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 4. WithdrawFeesBuilder ──────────────────────────────────────────────────

pub struct WithdrawFeesBuilder {
    pub accounts: anchor::accounts::WithdrawFees,
    pub amount: u64,
}

impl WithdrawFeesBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (global_config, _) = global_config_pda();
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, pool.next_redemption_id);
        let dummy = Keypair::new().pubkey();

        Self {
            accounts: anchor::accounts::WithdrawFees {
                admin: ctx.admin.pubkey(),
                global_config,
                pool: pool_pda_addr,
                fee_wallet: pool.fee_wallet,
                pending_redemption,
                token_mint: ctx.usdc_mint,
                pool_pst_vault,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: ctx.huma_pool_state,
                huma_mode_config: dummy,
                huma_mode_mint: ctx.pst_mint,
                huma_redemption_request: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: ctx.huma_pool_authority,
                huma_pool_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            amount: 1_000_000,
        }
    }

    pub fn with_amount(mut self, amount: u64) -> Self {
        self.amount = amount;
        self
    }

    pub fn with_admin(mut self, admin: Pubkey) -> Self {
        self.accounts.admin = admin;
        self
    }

    pub fn with_fee_wallet(mut self, fee_wallet: Pubkey) -> Self {
        self.accounts.fee_wallet = fee_wallet;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_pending_redemption(mut self, pending_redemption: Pubkey) -> Self {
        self.accounts.pending_redemption = pending_redemption;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.accounts.token_mint = token_mint;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_mode_mint(mut self, huma_mode_mint: Pubkey) -> Self {
        self.accounts.huma_mode_mint = huma_mode_mint;
        self
    }

    pub fn with_huma_redemption_request(mut self, huma_redemption_request: Pubkey) -> Self {
        self.accounts.huma_redemption_request = huma_redemption_request;
        self
    }

    pub fn with_huma_lender_state(mut self, huma_lender_state: Pubkey) -> Self {
        self.accounts.huma_lender_state = huma_lender_state;
        self
    }

    pub fn with_huma_pool_authority(mut self, huma_pool_authority: Pubkey) -> Self {
        self.accounts.huma_pool_authority = huma_pool_authority;
        self
    }

    pub fn with_huma_pool_mode_token(mut self, huma_pool_mode_token: Pubkey) -> Self {
        self.accounts.huma_pool_mode_token = huma_pool_mode_token;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::WithdrawFees)>(mut self, f: F) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self, amount: u64) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::WithdrawFees { amount }.data(),
        }
    }

    pub fn build_default_ix(&self) -> Instruction {
        self.build_ix(self.amount)
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_default_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_default_ix())
    }
}

// ─── 5. HarvestYieldAndCommitBuilder ─────────────────────────────────────────

pub struct HarvestYieldAndCommitBuilder {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub accounts: anchor::accounts::HarvestYieldAndCommit,
}

impl HarvestYieldAndCommitBuilder {
    pub fn for_pool(pool_id: u32, cycle_id: u32, crank: Pubkey) -> Self {
        let (global_config, _) = global_config_pda();
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            cycle_id,
            accounts: anchor::accounts::HarvestYieldAndCommit {
                crank,
                global_config,
                pool: pool_pda_addr,
                ticket_registry: dummy,
                current_draw_cycle,
                pool_pst_vault,
                pst_mint: dummy,
                huma_pool_state: dummy,
                randomness_account: dummy,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (global_config, _) = global_config_pda();
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            cycle_id: pool.current_draw_cycle_id,
            accounts: anchor::accounts::HarvestYieldAndCommit {
                crank: ctx.admin.pubkey(),
                global_config,
                pool: pool_pda_addr,
                ticket_registry: ctx.ticket_registry,
                current_draw_cycle,
                pool_pst_vault,
                pst_mint: ctx.pst_mint,
                huma_pool_state: ctx.huma_pool_state,
                randomness_account: dummy,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_current_draw_cycle(mut self, current_draw_cycle: Pubkey) -> Self {
        self.accounts.current_draw_cycle = current_draw_cycle;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_pst_mint(mut self, pst_mint: Pubkey) -> Self {
        self.accounts.pst_mint = pst_mint;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_randomness_account(mut self, randomness_account: Pubkey) -> Self {
        self.accounts.randomness_account = randomness_account;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::HarvestYieldAndCommit)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::HarvestYieldAndCommit {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 6. PrepareDrawBuilder ───────────────────────────────────────────────────

pub struct PrepareDrawBuilder {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub accounts: anchor::accounts::PrepareDraw,
    pub batch_size: u32,
}

impl PrepareDrawBuilder {
    pub fn for_pool(pool_id: u32, cycle_id: u32, crank: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            cycle_id,
            accounts: anchor::accounts::PrepareDraw {
                crank,
                pool: pool_pda_addr,
                draw_cycle,
                ticket_registry: dummy,
            },
            batch_size: 100,
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);

        Self {
            pool_id,
            cycle_id: pool.current_draw_cycle_id,
            accounts: anchor::accounts::PrepareDraw {
                crank: ctx.admin.pubkey(),
                pool: pool_pda_addr,
                draw_cycle,
                ticket_registry: ctx.ticket_registry,
            },
            batch_size: 100,
        }
    }

    pub fn with_batch_size(mut self, batch_size: u32) -> Self {
        self.batch_size = batch_size;
        self
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_draw_cycle(mut self, draw_cycle: Pubkey) -> Self {
        self.accounts.draw_cycle = draw_cycle;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::PrepareDraw)>(mut self, f: F) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self, batch_size: u32) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::PrepareDraw { batch_size }.data(),
        }
    }

    pub fn build_default_ix(&self) -> Instruction {
        self.build_ix(self.batch_size)
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_default_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_default_ix())
    }
}

// ─── 7. RevealAndPickWinnersBuilder ──────────────────────────────────────────

pub struct RevealAndPickWinnersBuilder {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub accounts: anchor::accounts::RevealAndPickWinners,
}

impl RevealAndPickWinnersBuilder {
    pub fn for_pool(pool_id: u32, cycle_id: u32, crank: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
        let (payout_registry, _) = payout_pda(pool_id, cycle_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            cycle_id,
            accounts: anchor::accounts::RevealAndPickWinners {
                crank,
                current_draw_cycle,
                pool: pool_pda_addr,
                ticket_registry: dummy,
                randomness_account: dummy,
                payout_registry,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);
        let (payout_registry, _) = payout_pda(pool_id, pool.current_draw_cycle_id);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            cycle_id: pool.current_draw_cycle_id,
            accounts: anchor::accounts::RevealAndPickWinners {
                crank: ctx.admin.pubkey(),
                current_draw_cycle,
                pool: pool_pda_addr,
                ticket_registry: ctx.ticket_registry,
                randomness_account: dummy,
                payout_registry,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_current_draw_cycle(mut self, current_draw_cycle: Pubkey) -> Self {
        self.accounts.current_draw_cycle = current_draw_cycle;
        self
    }

    pub fn with_payout_registry(mut self, payout_registry: Pubkey) -> Self {
        self.accounts.payout_registry = payout_registry;
        self
    }

    pub fn with_randomness_account(mut self, randomness_account: Pubkey) -> Self {
        self.accounts.randomness_account = randomness_account;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::RevealAndPickWinners)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::RevealAndPickWinners {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 8. ReinvestWinningsBuilder ──────────────────────────────────────────────

pub struct ReinvestWinningsBuilder {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub winner_index: u32,
    pub accounts: anchor::accounts::ReinvestWinnings,
}

impl ReinvestWinningsBuilder {
    pub fn for_pool(pool_id: u32, cycle_id: u32, crank: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (payout_registry, _) = payout_pda(pool_id, cycle_id);
        let dummy = Keypair::new().pubkey();
        let (user_winnings, _) = user_winnings_pda(pool_id, &dummy);

        Self {
            pool_id,
            cycle_id,
            winner_index: 0,
            accounts: anchor::accounts::ReinvestWinnings {
                crank,
                winner: dummy,
                payout_registry,
                pool: pool_pda_addr,
                user_winnings,
                ticket_registry: dummy,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (payout_registry, _) = payout_pda(pool_id, 0);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());

        Self {
            pool_id,
            cycle_id: 0,
            winner_index: 0,
            accounts: anchor::accounts::ReinvestWinnings {
                crank: ctx.admin.pubkey(),
                winner: ctx.user.pubkey(),
                payout_registry,
                pool: pool_pda_addr,
                user_winnings,
                ticket_registry: ctx.ticket_registry,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn with_cycle_id(mut self, cycle_id: u32) -> Self {
        self.cycle_id = cycle_id;
        self.accounts.payout_registry = payout_pda(self.pool_id, cycle_id).0;
        self
    }

    pub fn with_winner_index(mut self, winner_index: u32) -> Self {
        self.winner_index = winner_index;
        self
    }

    pub fn with_winner(mut self, winner: &Pubkey) -> Self {
        self.accounts.winner = *winner;
        self.accounts.user_winnings = user_winnings_pda(self.pool_id, winner).0;
        self
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_payout_registry(mut self, payout_registry: Pubkey) -> Self {
        self.accounts.payout_registry = payout_registry;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_user_winnings(mut self, user_winnings: Pubkey) -> Self {
        self.accounts.user_winnings = user_winnings;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::ReinvestWinnings)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self, cycle_id: u32, winner_index: u32) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::ReinvestWinnings {
                cycle_id,
                winner_index,
            }
            .data(),
        }
    }

    pub fn build_default_ix(&self) -> Instruction {
        self.build_ix(self.cycle_id, self.winner_index)
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_default_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_default_ix())
    }
}

// ─── 9. ClaimNonReinvestedWinningsBuilder ─────────────────────────────────────

pub struct ClaimNonReinvestedWinningsBuilder {
    pub pool_id: u32,
    pub accounts: anchor::accounts::ClaimNonReinvestedWinnings,
}

impl ClaimNonReinvestedWinningsBuilder {
    pub fn for_pool(pool_id: u32, user: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
        let (user_winnings, _) = user_winnings_pda(pool_id, &user);
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::ClaimNonReinvestedWinnings {
                user,
                pool: pool_pda_addr,
                user_winnings,
                pool_pst_vault,
                pending_redemption,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: dummy,
                huma_mode_config: dummy,
                huma_mode_mint: dummy,
                huma_redemption_request: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: dummy,
                huma_pool_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx)
    }

    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, pool.next_redemption_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
            pool_id,
            accounts: anchor::accounts::ClaimNonReinvestedWinnings {
                user: ctx.user.pubkey(),
                pool: pool_pda_addr,
                user_winnings,
                pool_pst_vault,
                pending_redemption,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state: ctx.huma_pool_state,
                huma_mode_config: dummy,
                huma_mode_mint: ctx.pst_mint,
                huma_redemption_request: dummy,
                huma_lender_state: dummy,
                huma_pool_authority: ctx.huma_pool_authority,
                huma_pool_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
        }
    }

    pub fn with_redemption_id(mut self, pool_id: u32, redemption_id: u64) -> Self {
        self.accounts.pending_redemption = pending_redemption_pda(pool_id, redemption_id).0;
        self
    }

    pub fn with_user(mut self, user: &Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_winnings = user_winnings_pda(self.pool_id, user).0;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_user_winnings(mut self, user_winnings: Pubkey) -> Self {
        self.accounts.user_winnings = user_winnings;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_pending_redemption(mut self, pending_redemption: Pubkey) -> Self {
        self.accounts.pending_redemption = pending_redemption;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_mode_mint(mut self, huma_mode_mint: Pubkey) -> Self {
        self.accounts.huma_mode_mint = huma_mode_mint;
        self
    }

    pub fn with_huma_redemption_request(mut self, huma_redemption_request: Pubkey) -> Self {
        self.accounts.huma_redemption_request = huma_redemption_request;
        self
    }

    pub fn with_huma_lender_state(mut self, huma_lender_state: Pubkey) -> Self {
        self.accounts.huma_lender_state = huma_lender_state;
        self
    }

    pub fn with_huma_pool_authority(mut self, huma_pool_authority: Pubkey) -> Self {
        self.accounts.huma_pool_authority = huma_pool_authority;
        self
    }

    pub fn with_huma_pool_mode_token(mut self, huma_pool_mode_token: Pubkey) -> Self {
        self.accounts.huma_pool_mode_token = huma_pool_mode_token;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::ClaimNonReinvestedWinnings)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 10. ResizeRegistryBuilder ───────────────────────────────────────────────

pub struct ResizeRegistryBuilder {
    pub accounts: anchor::accounts::ResizeRegistry,
    pub additional_entries: u32,
}

impl ResizeRegistryBuilder {
    pub fn from_ctx(ctx: &E2eContext) -> Self {
        let (pool_pda_addr, _) = pool_pda(1);
        Self::new(1, ctx.ticket_registry, ctx.admin.pubkey()).with_pool(pool_pda_addr)
    }

    pub fn new(pool_id: u32, ticket_registry: Pubkey, payer: Pubkey) -> Self {
        let (pool_pda_addr, _) = pool_pda(pool_id);
        Self {
            accounts: anchor::accounts::ResizeRegistry {
                payer,
                pool: pool_pda_addr,
                ticket_registry,
                system_program: anchor_lang::system_program::ID,
            },
            additional_entries: 100,
        }
    }

    pub fn with_additional_entries(mut self, additional_entries: u32) -> Self {
        self.additional_entries = additional_entries;
        self
    }

    pub fn with_payer(mut self, payer: Pubkey) -> Self {
        self.accounts.payer = payer;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.accounts.ticket_registry = ticket_registry;
        self
    }

    pub fn with_system_program(mut self, system_program: Pubkey) -> Self {
        self.accounts.system_program = system_program;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::ResizeRegistry)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::ResizeRegistry {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 11. CrankClosePayoutRegistryBuilder ─────────────────────────────────────

pub struct CrankClosePayoutRegistryBuilder {
    pub accounts: anchor::accounts::CrankClosePayoutRegistry,
    pub pool_id: u32,
    pub cycle_id: u32,
}

impl CrankClosePayoutRegistryBuilder {
    pub fn from_ctx(ctx: &E2eContext, pool_id: u32, cycle_id: u32) -> Self {
        Self::new(ctx.admin.pubkey(), pool_id, cycle_id)
    }

    pub fn new(crank: Pubkey, pool_id: u32, cycle_id: u32) -> Self {
        let (global_config, _) = global_config_pda();
        let (payout_registry, _) = payout_pda(pool_id, cycle_id);

        Self {
            accounts: anchor::accounts::CrankClosePayoutRegistry {
                global_config,
                crank,
                payout_registry,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            pool_id,
            cycle_id,
        }
    }

    pub fn with_cycle_id(mut self, cycle_id: u32) -> Self {
        self.cycle_id = cycle_id;
        self.accounts.payout_registry = payout_pda(self.pool_id, cycle_id).0;
        self
    }

    pub fn with_pool_id(mut self, pool_id: u32) -> Self {
        self.pool_id = pool_id;
        self.accounts.payout_registry = payout_pda(pool_id, self.cycle_id).0;
        self
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_payout_registry(mut self, payout_registry: Pubkey) -> Self {
        self.accounts.payout_registry = payout_registry;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::CrankClosePayoutRegistry)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::CrankClosePayoutRegistry {
                pool_id: self.pool_id,
                cycle_id: self.cycle_id,
            }
            .data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 12. InitializeHumaLenderBuilder ─────────────────────────────────────────

pub struct InitializeHumaLenderBuilder {
    pub accounts: anchor::accounts::InitializeHumaLender,
    pub pool_id: u32,
}

impl InitializeHumaLenderBuilder {
    pub fn from_ctx(ctx: &E2eContext) -> Self {
        Self::new(ctx.admin.pubkey(), 1, ctx.huma_pool_state, ctx.pst_mint)
    }

    pub fn new(admin: Pubkey, pool_id: u32, huma_pool_state: Pubkey, pst_mint: Pubkey) -> Self {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
            accounts: anchor::accounts::InitializeHumaLender {
                admin,
                global_config,
                pool,
                pool_pst_vault,
                huma_program: huma_program_id(),
                huma_config: dummy,
                huma_pool_config: dummy,
                huma_pool_state,
                huma_mode_config: dummy,
                huma_mode_mint: pst_mint,
                huma_lender_state: dummy,
                huma_lender_mode_token: dummy,
                token_program: anchor_spl::token::ID,
                pst_token_program: anchor_spl::token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: anchor_lang::system_program::ID,
            },
            pool_id,
        }
    }

    pub fn with_admin(mut self, admin: Pubkey) -> Self {
        self.accounts.admin = admin;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_pool_pst_vault(mut self, pool_pst_vault: Pubkey) -> Self {
        self.accounts.pool_pst_vault = pool_pst_vault;
        self
    }

    pub fn with_huma_program(mut self, huma_program: Pubkey) -> Self {
        self.accounts.huma_program = huma_program;
        self
    }

    pub fn with_huma_config(mut self, huma_config: Pubkey) -> Self {
        self.accounts.huma_config = huma_config;
        self
    }

    pub fn with_huma_pool_config(mut self, huma_pool_config: Pubkey) -> Self {
        self.accounts.huma_pool_config = huma_pool_config;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.accounts.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_huma_mode_config(mut self, huma_mode_config: Pubkey) -> Self {
        self.accounts.huma_mode_config = huma_mode_config;
        self
    }

    pub fn with_huma_mode_mint(mut self, huma_mode_mint: Pubkey) -> Self {
        self.accounts.huma_mode_mint = huma_mode_mint;
        self
    }

    pub fn with_huma_lender_state(mut self, huma_lender_state: Pubkey) -> Self {
        self.accounts.huma_lender_state = huma_lender_state;
        self
    }

    pub fn with_huma_lender_mode_token(mut self, huma_lender_mode_token: Pubkey) -> Self {
        self.accounts.huma_lender_mode_token = huma_lender_mode_token;
        self
    }

    pub fn with_pst_token_program(mut self, pst_token_program: Pubkey) -> Self {
        self.accounts.pst_token_program = pst_token_program;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::InitializeHumaLender)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::InitializeHumaLender {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 13. CrankRebindExpiredRandomnessBuilder ─────────────────────────────────

pub struct CrankRebindExpiredRandomnessBuilder {
    pub accounts: anchor::accounts::CrankRebindExpiredRandomness,
    pub pool_id: u32,
    pub cycle_id: u32,
}

impl CrankRebindExpiredRandomnessBuilder {
    pub fn from_ctx(
        ctx: &E2eContext,
        pool_id: u32,
        cycle_id: u32,
        current_randomness_account: Pubkey,
        new_randomness_account: Pubkey,
    ) -> Self {
        Self::new(
            ctx.admin.pubkey(),
            pool_id,
            cycle_id,
            current_randomness_account,
            new_randomness_account,
        )
    }

    pub fn new(
        crank: Pubkey,
        pool_id: u32,
        cycle_id: u32,
        current_randomness_account: Pubkey,
        new_randomness_account: Pubkey,
    ) -> Self {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

        Self {
            accounts: anchor::accounts::CrankRebindExpiredRandomness {
                crank,
                global_config,
                pool,
                current_draw_cycle,
                current_randomness_account,
                new_randomness_account,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            pool_id,
            cycle_id,
        }
    }

    pub fn with_crank(mut self, crank: Pubkey) -> Self {
        self.accounts.crank = crank;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_current_draw_cycle(mut self, current_draw_cycle: Pubkey) -> Self {
        self.accounts.current_draw_cycle = current_draw_cycle;
        self
    }

    pub fn with_current_randomness_account(mut self, current: Pubkey) -> Self {
        self.accounts.current_randomness_account = current;
        self
    }

    pub fn with_new_randomness_account(mut self, new_rand: Pubkey) -> Self {
        self.accounts.new_randomness_account = new_rand;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::CrankRebindExpiredRandomness)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 14. AdminForceUnlockDrawBuilder ─────────────────────────────────────────

pub struct AdminForceUnlockDrawBuilder {
    pub accounts: anchor::accounts::AdminForceUnlockDraw,
    pub pool_id: u32,
    pub cycle_id: u32,
}

impl AdminForceUnlockDrawBuilder {
    pub fn from_ctx(ctx: &E2eContext, pool_id: u32, cycle_id: u32) -> Self {
        Self::new(ctx.admin.pubkey(), pool_id, cycle_id)
    }

    pub fn new(admin: Pubkey, pool_id: u32, cycle_id: u32) -> Self {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

        Self {
            accounts: anchor::accounts::AdminForceUnlockDraw {
                admin,
                global_config,
                pool,
                current_draw_cycle,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            pool_id,
            cycle_id,
        }
    }

    pub fn with_admin(mut self, admin: Pubkey) -> Self {
        self.accounts.admin = admin;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_current_draw_cycle(mut self, current_draw_cycle: Pubkey) -> Self {
        self.accounts.current_draw_cycle = current_draw_cycle;
        self
    }

    pub fn with_event_authority(mut self, event_authority: Pubkey) -> Self {
        self.accounts.event_authority = event_authority;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::AdminForceUnlockDraw)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::AdminForceUnlockDraw {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 15. AdminVoidPayoutRegistryBuilder ──────────────────────────────────────

pub struct AdminVoidPayoutRegistryBuilder {
    pub accounts: anchor::accounts::AdminVoidPayoutRegistry,
    pub pool_id: u32,
    pub cycle_id: u32,
}

impl AdminVoidPayoutRegistryBuilder {
    pub fn from_ctx(ctx: &E2eContext, pool_id: u32, cycle_id: u32) -> Self {
        Self::new(ctx.admin.pubkey(), pool_id, cycle_id)
    }

    pub fn new(admin: Pubkey, pool_id: u32, cycle_id: u32) -> Self {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
        let (payout_registry, _) = payout_pda(pool_id, cycle_id);

        Self {
            accounts: anchor::accounts::AdminVoidPayoutRegistry {
                global_config,
                admin,
                pool,
                current_draw_cycle,
                payout_registry,
                event_authority: event_authority_pda(),
                program: anchor::id(),
            },
            pool_id,
            cycle_id,
        }
    }

    pub fn with_admin(mut self, admin: Pubkey) -> Self {
        self.accounts.admin = admin;
        self
    }

    pub fn with_global_config(mut self, global_config: Pubkey) -> Self {
        self.accounts.global_config = global_config;
        self
    }

    pub fn with_pool(mut self, pool: Pubkey) -> Self {
        self.accounts.pool = pool;
        self
    }

    pub fn with_current_draw_cycle(mut self, current_draw_cycle: Pubkey) -> Self {
        self.accounts.current_draw_cycle = current_draw_cycle;
        self
    }

    pub fn with_payout_registry(mut self, payout_registry: Pubkey) -> Self {
        self.accounts.payout_registry = payout_registry;
        self
    }

    pub fn with_event_authority(mut self, event_authority: Pubkey) -> Self {
        self.accounts.event_authority = event_authority;
        self
    }

    pub fn modify_accounts<F: FnOnce(&mut anchor::accounts::AdminVoidPayoutRegistry)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.accounts);
        self
    }

    pub fn build_metas(&self) -> Vec<AccountMeta> {
        self.accounts.to_account_metas(None)
    }

    pub fn build_ix(&self) -> Instruction {
        Instruction {
            program_id: anchor::id(),
            accounts: self.build_metas(),
            data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
        }
    }

    pub fn send(&self, svm: &mut LiteSVM, payer: &Keypair) -> TxResult {
        send_user_tx(svm, payer, self.build_ix())
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        payer: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        send_tx(svm, payer, additional_signers, self.build_ix())
    }
}

// ─── 16. CreatePoolBuilder ───────────────────────────────────────────────────

pub struct CreatePoolBuilder {
    pub admin: Pubkey,
    pub config: crate::common::context::TestPoolConfig,
}

impl CreatePoolBuilder {
    pub fn new(admin: Pubkey, pool_id: u32) -> Self {
        let config = crate::common::context::TestPoolConfig {
            pool_id,
            ..Default::default()
        };
        Self { admin, config }
    }

    pub fn with_bond_price(mut self, bond_price: u64) -> Self {
        self.config.bond_price = bond_price;
        self
    }

    pub fn with_stake_cycle_duration_hrs(mut self, hrs: i64) -> Self {
        self.config.stake_cycle_duration_hrs = hrs;
        self
    }

    pub fn with_fee_basis_points(mut self, fee_basis_points: u16) -> Self {
        self.config.fee_basis_points = fee_basis_points;
        self
    }

    pub fn with_min_yield_threshold(mut self, min_yield: u64) -> Self {
        self.config.min_yield_threshold = min_yield;
        self
    }

    pub fn with_max_yield_basis_points(mut self, max_yield: u16) -> Self {
        self.config.max_yield_basis_points = max_yield;
        self
    }

    pub fn with_payout_timelock_seconds(mut self, timelock: u32) -> Self {
        self.config.payout_timelock_seconds = timelock;
        self
    }

    pub fn with_mints(mut self, token_mint: Pubkey, pst_mint: Pubkey) -> Self {
        self.config.token_mint = token_mint;
        self.config.pst_mint = pst_mint;
        self
    }

    pub fn with_token_mint(mut self, token_mint: Pubkey) -> Self {
        self.config.token_mint = token_mint;
        self
    }

    pub fn with_pst_mint(mut self, pst_mint: Pubkey) -> Self {
        self.config.pst_mint = pst_mint;
        self
    }

    pub fn with_ticket_registry(mut self, ticket_registry: Pubkey) -> Self {
        self.config.ticket_registry = ticket_registry;
        self
    }

    pub fn with_fee_wallet(mut self, fee_wallet: Pubkey) -> Self {
        self.config.fee_wallet = fee_wallet;
        self
    }

    pub fn with_huma_pool_state(mut self, huma_pool_state: Pubkey) -> Self {
        self.config.huma_pool_state = huma_pool_state;
        self
    }

    pub fn with_prize_tiers(mut self, prize_tiers: Vec<anchor::PrizeTier>) -> Self {
        self.config.prize_tiers = prize_tiers;
        self
    }

    pub fn with_token_program(mut self, token_program: Pubkey) -> Self {
        self.config.token_program = token_program;
        self
    }

    pub fn with_pst_token_program(mut self, pst_token_program: Pubkey) -> Self {
        self.config.pst_token_program = pst_token_program;
        self
    }

    pub fn modify_config<F: FnOnce(&mut crate::common::context::TestPoolConfig)>(
        mut self,
        f: F,
    ) -> Self {
        f(&mut self.config);
        self
    }

    pub fn build_ix_with_admin(&self, admin: &Pubkey) -> Instruction {
        let (global_config, _) = global_config_pda();
        let (pool, _) = pool_pda(self.config.pool_id);
        let (pool_vault, _) = pool_vault_pda(self.config.pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(self.config.pool_id);

        Instruction {
            program_id: anchor::id(),
            accounts: anchor::accounts::CreatePool {
                global_config,
                admin: *admin,
                pool,
                ticket_registry: self.config.ticket_registry,
                token_mint: self.config.token_mint,
                pst_mint: self.config.pst_mint,
                pool_vault_account: pool_vault,
                pool_pst_vault,
                fee_wallet: self.config.fee_wallet,
                huma_pool_state: self.config.huma_pool_state,
                system_program: anchor_lang::system_program::ID,
                token_program: self.config.token_program,
                pst_token_program: self.config.pst_token_program,
            }
            .to_account_metas(None),
            data: anchor::instruction::CreatePool {
                pool_id: self.config.pool_id,
                bond_price: self.config.bond_price,
                stake_cycle_duration_hrs: self.config.stake_cycle_duration_hrs,
                fee_basis_points: self.config.fee_basis_points,
                min_yield_threshold: self.config.min_yield_threshold,
                max_yield_basis_points: self.config.max_yield_basis_points,
                payout_timelock_seconds: self.config.payout_timelock_seconds,
                prize_tiers: self.config.prize_tiers.clone(),
            }
            .data(),
        }
    }

    pub fn build_ix(&self) -> Instruction {
        self.build_ix_with_admin(&self.admin)
    }

    pub fn send(&self, svm: &mut LiteSVM, admin: &Keypair) -> TxResult {
        let ix = self.build_ix_with_admin(&admin.pubkey());
        send_user_tx(svm, admin, ix)
    }

    pub fn send_with_signers(
        &self,
        svm: &mut LiteSVM,
        admin: &Keypair,
        additional_signers: &[&Keypair],
    ) -> TxResult {
        let ix = self.build_ix_with_admin(&admin.pubkey());
        send_tx(svm, admin, additional_signers, ix)
    }
}
