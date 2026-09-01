use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::WinningsClaimed;
use crate::huma;
use crate::state::{PendingRedemption, PoolStatus, PrizePool, RedemptionType, UserWinnings};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Async claim_non_reinvested_winnings: instead of instant USDC transfer, creates a PendingRedemption
/// and submits a Huma redemption request. The user calls `claim_redemption` after settlement.
/// Accounts required for the `claim_non_reinvested_winnings` instruction.
///
/// This instruction is called by a user to withdraw their non-reinvested winnings from
/// the prize pool. Instead of transferring USDC immediately, it requests an asynchronous
/// redemption from Huma, creating a `PendingRedemption` state account that the user can
/// claim once Huma settles the request.
///
/// # Accounts
///
/// * `user`: The user claiming their winnings. Must be the signer and payer.
/// * `pool`: The prize pool account.
/// * `user_winnings`: The user winnings account containing their unclaimed non-reinvested winnings.
/// * `pool_pst_vault`: The pool's $PST token vault.
/// * `pending_redemption`: The new pending redemption account initialized to track the withdrawal.
/// * `huma_program`: The Huma Finance program.
/// * `huma_config`: The Huma configuration account.
/// * `huma_pool_config`: The Huma pool configuration account.
/// * `huma_pool_state`: The Huma pool state account containing assets and queue.
/// * `huma_mode_config`: The Huma mode configuration account.
/// * `huma_mode_mint`: The Huma mode mint ($PST mint).
/// * `huma_redemption_request`: The Huma redemption request account to initialize.
/// * `huma_lender_state`: The Huma lender state account for the pool PDA.
/// * `huma_pool_authority`: The Huma pool authority.
/// * `huma_pool_mode_token`: The Huma pool mode token vault.
/// * `token_program`: The SPL Token interface.
/// * `pst_token_program`: The SPL Token interface for the PST mint/vault.
/// * `system_program`: The Solana System program.
///
/// # PDA Derivations
///
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`.
/// * `user_winnings`: PDA derived with seeds `[b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()]` and bump `user_winnings.bump`.
/// * `pool_pst_vault`: PDA derived with seeds `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"pool_pst_vault"`) and a dynamic bump.
/// * `pending_redemption`: PDA initialized with seeds `[PENDING_REDEMPTION_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.next_redemption_id.to_le_bytes().as_ref()]` (i.e. `b"pending_redemption"`) and a dynamic bump.
#[derive(Accounts)]
pub struct ClaimNonReinvestedWinnings<'info> {
    /// The user claiming the non-reinvested winnings. Must be signer and payer.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The prize pool state account, validated to match the vault authority bump.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The user's winnings metadata account.
    #[account(
        mut,
        seeds = [b"user_winnings", pool.load()?.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = user_winnings.bump,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

    /// Pool's $PST vault — shares are redeemed from here.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// PendingRedemption PDA created for this async withdrawal.
    #[account(
        init,
        payer = user,
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
    /// CHECK: This is the Huma Finance program account. It is unchecked because we only need to verify its address against the official `HUMA_PROGRAM_ID` constant. This ensures that any CPI calls made during this instruction are safely routed to the legitimate Huma program.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,
    /// CHECK: This is the Huma configuration account. It is unchecked because it is fully validated and verified by the Huma program during the CPI call to request redemption.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: This is the Huma pool configuration account. It is unchecked because it is passed directly to the Huma program via CPI, which performs all necessary verification and validation.
    pub huma_pool_config: UncheckedAccount<'info>,
    /// CHECK: This is the Huma pool state account containing assets and queue information. It is unchecked because we deserialize it manually inside the handler to read mode assets and the redemption queue. To prevent spoofing, we enforce an ownership constraint that it must be owned by the Huma program. The Huma CPI also validates this account.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: This is the Huma mode configuration account. It is unchecked because it is passed directly to the Huma program via CPI, which performs all necessary validation on it.
    pub huma_mode_config: UncheckedAccount<'info>,
    /// The Huma mode mint ($PST mint).
    #[account(
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: This is the Huma redemption request account to be modified or initialized by Huma. It is unchecked because the Huma program performs all validation and initialization checks on it during the CPI call.
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,
    /// CHECK: This is the Huma lender state account for the pool PDA. It is unchecked because the Huma program performs all state verification and validation during the CPI call.
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,
    /// CHECK: This is the Huma pool authority account. It is unchecked because the Huma program validates it during the CPI call.
    pub huma_pool_authority: UncheckedAccount<'info>,
    /// CHECK: This is the Huma pool mode token vault. It is unchecked because it is validated by the Huma program during the CPI call.
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    /// The standard Token program interface.
    pub token_program: Interface<'info, TokenInterface>,
    /// The SPL Token interface for the PST mint/vault.
    pub pst_token_program: Interface<'info, TokenInterface>,
    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Initiates an asynchronous redemption of non-reinvested winnings.
///
/// It resets the user's unclaimed non-reinvested winnings to zero and decreases the pool's allocated
/// prizes. It then calculates the corresponding amount of Huma $PST shares for the claimable USDC amount.
///
/// A CPI call is made to Huma to enqueue a redemption request for the derived $PST shares.
/// A `PendingRedemption` receipt is created on-chain to record this request and the Huma queue request ID,
/// allowing the user to eventually call `claim_redemption` after the redemption is settled.
pub fn handle(ctx: Context<ClaimNonReinvestedWinnings>) -> Result<()> {
    let user_winnings = &mut ctx.accounts.user_winnings;
    user_winnings.ensure_current_version()?;
    let claimable = user_winnings.unclaimed_non_reinvested_winnings;

    require!(claimable > 0, PremiumBondsError::NoWinningsToClaim);

    // Reset unclaimed winnings and increase total claimed
    user_winnings.unclaimed_non_reinvested_winnings = 0;
    user_winnings.total_claimed = user_winnings
        .total_claimed
        .checked_add(claimable)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let (pool_id, pool_id_bytes, authority_bump, current_redemption_id) = {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;

        require!(
            pool.status() != PoolStatus::Paused,
            PremiumBondsError::PoolPaused
        );

        require!(
            !pool.is_frozen(),
            PremiumBondsError::AwaitingRandomnessFreeze
        );

        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_sub(claimable)
            .ok_or(PremiumBondsError::MathOverflow)?;

        let current_redemption_id = pool.next_redemption_id;
        pool.next_redemption_id = pool
            .next_redemption_id
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;

        pool.total_pending_redemptions = pool
            .total_pending_redemptions
            .checked_add(claimable)
            .ok_or(PremiumBondsError::MathOverflow)?;

        let pool_id = pool.pool_id;
        let pool_id_bytes = pool_id.to_le_bytes();
        let authority_bump = pool.vault_authority_bump;
        (pool_id, pool_id_bytes, authority_bump, current_redemption_id)
    };

    // Verify that the huma_mode_mint matches the pool_pst_vault mint
    require!(
        ctx.accounts.pool_pst_vault.mint == ctx.accounts.huma_mode_mint.key(),
        PremiumBondsError::InvalidModeMint
    );

    // Calculate $PST shares for the claimable USDC amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let pst_shares = huma::usdc_to_pst_shares(claimable, pst_supply, total_assets)?;

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
        ctx.accounts.user.to_account_info(), // payer
        ctx.accounts.pool.to_account_info(), // lender (pool PDA)
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

    let clock = Clock::get()?;

    // Create PendingRedemption receipt
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool_id;
    pending.redemption_id = current_redemption_id;
    pending.user = ctx.accounts.user.key();
    pending.amount = claimable;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = clock.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;
    pending.version = PendingRedemption::CURRENT_VERSION;
    pending.redemption_type = RedemptionType::PrizeClaim;

    #[cfg(feature = "debug-logs")]
    msg!(
        "ClaimNonReinvestedWinnings: user={}, claimable={}, pst_shares={}, redemption_id={}",
        ctx.accounts.user.key(),
        claimable,
        pst_shares,
        pending.redemption_id,
    );

    emit_cpi!(WinningsClaimed {
        user: ctx.accounts.user.key(),
        pool_id,
        amount: claimable,
        redemption_id: pending.redemption_id,
        pst_shares,
        huma_request_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
