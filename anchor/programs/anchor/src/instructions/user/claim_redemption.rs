use crate::constants::{PENDING_REDEMPTION_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::RedemptionClaimed;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts required for a user to claim their settled USDC redemption.
#[derive(Accounts)]
pub struct ClaimRedemption<'info> {
    /// The user claiming the settled USDC. Receives the refunded rent of the closed pending redemption PDA.
    #[account(mut)]
    pub user: Signer<'info>,

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

    /// The PendingRedemption PDA representing the user's withdrawal request.
    /// Closes and refunds its rent to `user` upon successful completion.
    ///
    /// PDA seeds: `[PENDING_REDEMPTION_SEED, pending_redemption.pool_id.to_le_bytes().as_ref(), pending_redemption.redemption_id.to_le_bytes().as_ref()]`.
    #[account(
        mut,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pending_redemption.pool_id.to_le_bytes().as_ref(),
            pending_redemption.redemption_id.to_le_bytes().as_ref()
        ],
        bump = pending_redemption.bump,
        constraint = pending_redemption.pool_id == pool.load()?.pool_id,
        constraint = pending_redemption.user == user.key() @ PremiumBondsError::InvalidRedemptionOwner,
        close = user
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The pool's underlying token vault (receives disbursed USDC from Huma program).
    ///
    /// PDA seeds: `[POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_vault"` + pool_id).
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user's underlying token account (receives the claimed USDC).
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
        token::token_program = token_program
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

    /// CHECK: This is the Huma lender state account. It is unchecked here because its structure,
    /// ownership, and authorization are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool authority PDA. It is unchecked here because its validity as the
    /// pool's authority is fully validated by the Huma program during the CPI call.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: This is the Huma pool's underlying token vault. It is unchecked here because its address
    /// and token authority are fully validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Claims settled USDC from a completed Huma redemption request.
///
/// Flow:
/// 1. CPI → Huma `disburse` to pull settled USDC into pool vault.
/// 2. Transfer the owed amount from pool vault to the user.
/// 3. Close the PendingRedemption PDA, returning rent to user.
///
/// # Parameters
/// * `ctx` - The context of the claim redemption instruction.
pub fn handle(ctx: Context<ClaimRedemption>) -> Result<()> {
    let (pool_id_bytes, authority_bump, pool_id) = {
        let pool = ctx.accounts.pool.load()?;
        require!(
            pool.status != (crate::state::PoolStatus::Paused as u8),
            PremiumBondsError::PoolPaused
        );
        let id = pool.pool_id;
        (id.to_le_bytes(), pool.vault_authority_bump, id)
    };

    // Copy pending values locally to avoid borrow conflicts and correctly report amounts in events/logs
    let (redemption_amount, redemption_id, huma_request_id) = {
        let p = &ctx.accounts.pending_redemption;
        (p.amount, p.redemption_id, p.huma_request_id)
    };

    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    // CPI → Huma disburse: pull settled USDC into pool vault
    huma::disburse(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.pool.to_account_info(), // lender (pool PDA)
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_lender_state.to_account_info(),
        ctx.accounts.token_mint.to_account_info(), // underlying_mint
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.huma_pool_underlying_token.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(), // lender_underlying_token
        ctx.accounts.token_program.to_account_info(),
        signer_seeds,
    )?;

    // Read updated next_request_id from the queue after Huma disburse
    let (next_request_id, _) =
        huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // Verify Huma queue has progressed past our request ID (meaning ours is settled/disbursed)
    require!(
        next_request_id > huma_request_id,
        PremiumBondsError::HumaRedemptionNotSettled
    );

    // Prevent re-entrancy: zero out the redemption amount and update pool state before token transfer CPI
    ctx.accounts.pending_redemption.amount = 0;

    {
        let mut pool_mut = ctx.accounts.pool.load_mut()?;
        pool_mut.total_pending_redemptions = pool_mut
            .total_pending_redemptions
            .checked_sub(redemption_amount)
            .ok_or(PremiumBondsError::MathOverflow)?;
    }

    // Transfer owed USDC to user
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.pool_vault_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        redemption_amount,
        ctx.accounts.token_mint.decimals,
    )?;

    #[cfg(feature = "debug-logs")]
    msg!(
        "ClaimRedemption: user={}, amount={}, redemption_id={}, huma_request_id={}",
        ctx.accounts.user.key(),
        redemption_amount,
        redemption_id,
        huma_request_id,
    );

    emit_cpi!(RedemptionClaimed {
        user: ctx.accounts.user.key(),
        pool_id,
        amount: redemption_amount,
        redemption_id,
    });

    // PendingRedemption is closed automatically via `close = user` constraint

    Ok(())
}
