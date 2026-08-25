use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, HUMA_PROGRAM_ID, PENDING_REDEMPTION_SEED, POOL_PST_SEED,
    POOL_VAULT_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::FeesWithdrawn;
use crate::huma;
use crate::state::{GlobalConfig, PendingRedemption, PrizePool, RedemptionType};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required to withdraw accrued protocol fees.
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// The admin authority executing the fee withdrawal.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    /// Bump is verified from the pool's initialized authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// Pool's $PST vault holding Huma shares. Protocol fees are redeemed from here.
    ///
    /// PDA seeds: `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_pst"` + pool_id).
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PendingRedemption PDA created to track this async fee withdrawal.
    ///
    /// PDA seeds: `[PENDING_REDEMPTION_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.next_redemption_id.to_le_bytes().as_ref()]`
    /// (i.e., `b"pending_redemption"` + pool_id + next_redemption_id).
    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            pool.load()?.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    // ── Huma Finance accounts ───────────────────────────────────────────────
    /// CHECK: This is the Huma Finance program account. It is validated via the address constraint
    /// to ensure it matches the hardcoded `HUMA_PROGRAM_ID`. It is used to target the CPI call.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,

    /// CHECK: This is the Huma global configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_pool_config: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool state account. It is validated via the owner constraint
    /// to ensure it is owned by the Huma program, and its internal structures/amounts (assets, redemption queues)
    /// are read manually via Huma state parsers in the handler and further validated during the Huma CPI.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma mode configuration account. It is unchecked here because its
    /// structure and validity are fully validated by the Huma program during the CPI call.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// The Huma mode token mint ($PST token mint).
    #[account(
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: This is the Huma redemption request PDA that will be initialized. It is unchecked here because
    /// its initialization and ownership are fully managed and validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,

    /// CHECK: This is the Huma lender state account. It is unchecked here because its structure,
    /// ownership, and authorization are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool authority PDA. It is unchecked here because its validity as the
    /// pool's authority is fully validated by the Huma program during the CPI call.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool's mode token account (holding underlying mode tokens). It is unchecked
    /// here because its address and token authority are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The designated fee wallet. Verified to match the fee wallet configured on the prize pool.
    #[account(
        token::mint = token_mint,
        token::token_program = token_program,
        constraint = fee_wallet.key() == pool.load()?.fee_wallet @ PremiumBondsError::InvalidFeeWallet
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// The SPL Token program interface for $PST tokens.
    pub pst_token_program: Interface<'info, TokenInterface>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Admin instruction to withdraw accrued protocol fees via Huma async redemption.
///
/// Creates a PendingRedemption PDA for the fee amount, which the fee wallet
/// owner later claims via `claim_redemption`.
///
/// # Parameters
/// * `ctx` - The context of the withdraw fees instruction.
/// * `amount` - The amount of accrued USDC fees to withdraw.
pub fn handle(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let (pool_id, pool_id_bytes, authority_bump, current_redemption_id, fee_wallet) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;

        require!(
            pool.status != (crate::state::PoolStatus::Paused as u8),
            PremiumBondsError::PoolPaused
        );

        require!(
            pool.is_frozen_for_draw == 0,
            PremiumBondsError::AwaitingRandomnessFreeze
        );

        // Validate there are enough accrued fees to withdraw
        let available_fees = pool
            .total_fees_accrued
            .saturating_sub(pool.total_fees_withdrawn);
        require!(
            amount > 0 && amount <= available_fees,
            PremiumBondsError::InsufficientFeeBalance
        );

        let current_redemption_id = pool.next_redemption_id;
        pool.total_fees_withdrawn = pool
            .total_fees_withdrawn
            .checked_add(amount)
            .ok_or(PremiumBondsError::MathOverflow)?;
        pool.next_redemption_id = pool
            .next_redemption_id
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;
        pool.total_pending_redemptions = pool
            .total_pending_redemptions
            .checked_add(amount)
            .ok_or(PremiumBondsError::MathOverflow)?;

        let pool_id = pool.pool_id;
        let pool_id_bytes = pool_id.to_le_bytes();
        let authority_bump = pool.vault_authority_bump;
        let fee_wallet = pool.fee_wallet;
        (pool_id, pool_id_bytes, authority_bump, current_redemption_id, fee_wallet)
    };

    // Verify that the huma_mode_mint matches the pool_pst_vault mint
    require!(
        ctx.accounts.pool_pst_vault.mint == ctx.accounts.huma_mode_mint.key(),
        PremiumBondsError::InvalidModeMint
    );

    // Calculate $PST shares for the fee amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let pst_shares = huma::usdc_to_pst_shares(amount, pst_supply, total_assets)?;

    // Read current last_request_id from the queue before Huma increments it.
    // Huma assigns the new request ID as the pre-increment `last_request_id` (0-indexed).
    // When Huma settles request M, `next_request_id` becomes M + 1, making `next_request_id > M` true.
    let (_, huma_request_id) =
        huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // CPI: request async redemption from Huma
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.admin.to_account_info(), // payer
        ctx.accounts.pool.to_account_info(),  // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_redemption_request.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_mode_token.to_account_info(),
        ctx.accounts.pool_pst_vault.to_account_info(), // lender_mode_token
        ctx.accounts.pst_token_program.to_account_info(), // token_program
        ctx.accounts.system_program.to_account_info(),
        pst_shares,
        signer_seeds,
    )?;

    // Create PendingRedemption receipt — fee_wallet is the beneficiary
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool_id;
    pending.redemption_id = current_redemption_id;
    pending.user = ctx.accounts.fee_wallet.owner; // Fee wallet owner receives the USDC on disburse
    pending.amount = amount;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = Clock::get()?.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;
    pending.version = PendingRedemption::CURRENT_VERSION;
    pending.redemption_type = RedemptionType::FeeWithdrawal;

    #[cfg(feature = "debug-logs")]
    msg!(
        "WithdrawFees: amount={}, pst_shares={}, redemption_id={}, fee_wallet={}",
        amount,
        pst_shares,
        pending.redemption_id,
        fee_wallet,
    );

    emit_cpi!(FeesWithdrawn {
        pool_id,
        admin: ctx.accounts.admin.key(),
        fee_wallet,
        amount,
        pst_shares,
        redemption_id: current_redemption_id,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
