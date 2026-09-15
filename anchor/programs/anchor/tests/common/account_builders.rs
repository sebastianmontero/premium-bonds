use {
    crate::common::*,
    anchor_lang::{InstructionData, ToAccountMetas},
    solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
    },
    solana_sdk::signature::{Keypair, Signer},
};

// ─── 1. BuyBondsBuilder ──────────────────────────────────────────────────────

pub struct BuyBondsBuilder {
    pub accounts: anchor::accounts::BuyBonds,
}

impl BuyBondsBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
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
        }
    }

    pub fn with_user(mut self, user: &Pubkey, user_token_account: Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_token_account = user_token_account;
        self.accounts.user_winnings = user_winnings_pda(1, user).0;
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
}

// ─── 2. SellBondsBuilder ─────────────────────────────────────────────────────

pub struct SellBondsBuilder {
    pub accounts: anchor::accounts::SellBonds,
    pub remaining_accounts: Vec<AccountMeta>,
}

impl SellBondsBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, pool.next_redemption_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
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
        }
    }

    pub fn with_user(mut self, user: &Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_winnings = user_winnings_pda(1, user).0;
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
}

// ─── 3. ClaimRedemptionBuilder ───────────────────────────────────────────────

pub struct ClaimRedemptionBuilder {
    pub accounts: anchor::accounts::ClaimRedemption,
}

impl ClaimRedemptionBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
        let (pool_vault, _) = pool_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
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
}

// ─── 4. WithdrawFeesBuilder ──────────────────────────────────────────────────

pub struct WithdrawFeesBuilder {
    pub accounts: anchor::accounts::WithdrawFees,
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
                fee_wallet: ctx.user_usdc_account,
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
        }
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
}

// ─── 5. HarvestYieldAndCommitBuilder ─────────────────────────────────────────

pub struct HarvestYieldAndCommitBuilder {
    pub accounts: anchor::accounts::HarvestYieldAndCommit,
}

impl HarvestYieldAndCommitBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (global_config, _) = global_config_pda();
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let dummy = Keypair::new().pubkey();

        Self {
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
}

// ─── 6. PrepareDrawBuilder ───────────────────────────────────────────────────

pub struct PrepareDrawBuilder {
    pub accounts: anchor::accounts::PrepareDraw,
}

impl PrepareDrawBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);

        Self {
            accounts: anchor::accounts::PrepareDraw {
                crank: ctx.admin.pubkey(),
                pool: pool_pda_addr,
                draw_cycle,
                ticket_registry: ctx.ticket_registry,
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
}

// ─── 7. RevealAndPickWinnersBuilder ──────────────────────────────────────────

pub struct RevealAndPickWinnersBuilder {
    pub accounts: anchor::accounts::RevealAndPickWinners,
}

impl RevealAndPickWinnersBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (current_draw_cycle, _) = draw_cycle_pda(pool_id, pool.current_draw_cycle_id);
        let (payout_registry, _) = payout_pda(pool_id, pool.current_draw_cycle_id);
        let dummy = Keypair::new().pubkey();

        Self {
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
}

// ─── 8. ReinvestWinningsBuilder ──────────────────────────────────────────────

pub struct ReinvestWinningsBuilder {
    pub accounts: anchor::accounts::ReinvestWinnings,
}

impl ReinvestWinningsBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let (payout_registry, _) = payout_pda(pool_id, 0);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());

        Self {
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

    pub fn with_winner(mut self, winner: &Pubkey) -> Self {
        self.accounts.winner = *winner;
        self.accounts.user_winnings = user_winnings_pda(1, winner).0;
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
}

// ─── 9. ClaimNonReinvestedWinningsBuilder ─────────────────────────────────────

pub struct ClaimNonReinvestedWinningsBuilder {
    pub accounts: anchor::accounts::ClaimNonReinvestedWinnings,
}

impl ClaimNonReinvestedWinningsBuilder {
    pub fn new(ctx: &E2eContext) -> Self {
        let pool_id = 1;
        let (pool_pda_addr, _) = pool_pda(pool_id);
        let pool = read_pool_state(&ctx.svm, pool_id);
        let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
        let (pending_redemption, _) = pending_redemption_pda(pool_id, pool.next_redemption_id);
        let (user_winnings, _) = user_winnings_pda(pool_id, &ctx.user.pubkey());
        let dummy = Keypair::new().pubkey();

        Self {
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

    pub fn with_user(mut self, user: &Pubkey) -> Self {
        self.accounts.user = *user;
        self.accounts.user_winnings = user_winnings_pda(1, user).0;
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
}
