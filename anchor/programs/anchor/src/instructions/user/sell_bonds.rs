use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::BondsSold;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool, TicketRegistry};
use crate::utils::{swap_and_pop_active, swap_and_pop_pending};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct SellBonds<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool's $PST vault — $PST shares are redeemed from here.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The PendingRedemption PDA created for this async withdrawal.
    #[account(
        init,
        payer = user,
        space = DISCRIMINATOR + PendingRedemption::INIT_SPACE,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pool.pool_id.to_le_bytes().as_ref(),
            pool.next_redemption_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    // ── Huma Finance accounts ───────────────────────────────────────────────
    /// CHECK: Validated by address constraint
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_config: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_mint: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_redemption_request: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_lender_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_pool_authority: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    #[account(mut)]
    pub huma_pool_mode_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<SellBonds>,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let bonds_to_sell = active_indices.len() as u32 + pending_indices.len() as u32;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondQuantity);

    let expected_principal = (bonds_to_sell as u64)
        .checked_mul(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Phase 1: load counts via zero-copy (read-only borrow)
    let (active_count, pending_count);
    {
        let registry = ctx.accounts.ticket_registry.load()?;
        active_count = registry.active_tickets_count;
        pending_count = registry.pending_tickets_count;
    }

    // Phase 2: swap-and-pop via raw bytes
    let new_pending;
    let new_active;
    {
        let registry_ai = ctx.accounts.ticket_registry.to_account_info();
        let mut data = registry_ai.try_borrow_mut_data()?;
        let user_key = ctx.accounts.user.key();

        new_pending = swap_and_pop_pending(
            &mut data,
            active_count,
            pending_count,
            &pending_indices,
            &user_key,
        )?;

        (new_active, _) = swap_and_pop_active(
            &mut data,
            active_count,
            new_pending,
            &active_indices,
            &user_key,
        )?;
    }

    // Phase 3: commit updated counts
    {
        let mut registry = ctx.accounts.ticket_registry.load_mut()?;
        registry.active_tickets_count = new_active;
        registry.pending_tickets_count = new_pending;
    }

    // Update pool principal
    pool.total_deposited_principal = pool
        .total_deposited_principal
        .checked_sub(expected_principal)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // Verify that the huma_mode_mint matches the pool_pst_vault mint
    require!(
        ctx.accounts.pool_pst_vault.mint == ctx.accounts.huma_mode_mint.key(),
        PremiumBondsError::InvalidModeMint
    );

    // Calculate $PST shares to redeem for the principal amount
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = {
        // Read supply from the huma_mode_mint (SPL Mint)
        let mint_info = ctx.accounts.huma_mode_mint.to_account_info();
        let mint_data_borrowed = mint_info.try_borrow_data()?;
        // SPL Mint supply is at offset 36 (after mint_authority option (36 bytes))
        let supply_bytes: [u8; 8] = mint_data_borrowed[36..44].try_into().unwrap();
        u64::from_le_bytes(supply_bytes)
    };
    let pst_shares = huma::usdc_to_pst_shares(expected_principal, pst_supply, total_assets);

    // Read current last_request_id from the queue before Huma increments it
    let (_, huma_request_id) =
        huma::read_huma_redemption_queue(&ctx.accounts.huma_pool_state.to_account_info())?;

    // CPI: request async redemption from Huma
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    huma::add_redemption_request(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.user.to_account_info(), // payer
        pool.to_account_info(),              // lender (pool PDA)
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

    // Create PendingRedemption receipt
    let pending = &mut ctx.accounts.pending_redemption;
    pending.pool_id = pool.pool_id;
    pending.redemption_id = pool.next_redemption_id;
    pending.user = ctx.accounts.user.key();
    pending.amount = expected_principal;
    pending.pst_shares_locked = pst_shares;
    pending.requested_at = Clock::get()?.unix_timestamp;
    pending.huma_request_id = huma_request_id;
    pending.bump = ctx.bumps.pending_redemption;

    pool.next_redemption_id = pool
        .next_redemption_id
        .checked_add(1)
        .ok_or(PremiumBondsError::MathOverflow)?;

    pool.total_pending_redemptions = pool
        .total_pending_redemptions
        .checked_add(expected_principal)
        .ok_or(PremiumBondsError::MathOverflow)?;

    msg!(
        "SellBonds: user={}, bonds={}, principal={}, pst_shares={}, redemption_id={}",
        ctx.accounts.user.key(),
        bonds_to_sell,
        expected_principal,
        pst_shares,
        pending.redemption_id,
    );

    emit!(BondsSold {
        user: ctx.accounts.user.key(),
        pool_id: pool.pool_id,
        bonds: bonds_to_sell,
        principal: expected_principal,
        redemption_id: pending.redemption_id,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
