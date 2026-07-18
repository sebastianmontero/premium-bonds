use crate::constants::{DISCRIMINATOR, PENDING_REDEMPTION_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::BondsSold;
use crate::huma;
use crate::state::{PendingRedemption, PrizePool, TicketRegistry, UserWinnings};
use crate::utils::{registry_get_entry, registry_set_entry};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct SellBonds<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user_winnings", pool.pool_id.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = user_winnings.bump,
    )]
    pub user_winnings: Box<Account<'info, UserWinnings>>,

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
    /// CHECK: Validated by Huma CPI and owner check
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID
    )]
    pub huma_pool_state: UncheckedAccount<'info>,
    /// CHECK: Validated by Huma CPI
    pub huma_mode_config: UncheckedAccount<'info>,
    #[account(
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,
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

pub fn handle(ctx: Context<SellBonds>, active_to_sell: u32, pending_to_sell: u32) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let bonds_to_sell = active_to_sell + pending_to_sell;
    require!(bonds_to_sell > 0, PremiumBondsError::InvalidBondQuantity);

    let expected_principal = (bonds_to_sell as u64)
        .checked_mul(pool.bond_price)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let user_key = ctx.accounts.user.key();
    let user_winnings = &mut ctx.accounts.user_winnings;
    let registry_loader = &ctx.accounts.ticket_registry;
    let user_entry_idx = user_winnings.registry_entry_index;

    require!(
        user_entry_idx != u32::MAX,
        PremiumBondsError::InvalidUserEntryHint
    );

    let (current_cycle, last_entry_idx) = {
        let registry = registry_loader.load()?;
        let last_idx = if registry.user_count > 0 {
            registry.user_count - 1
        } else {
            0
        };
        (registry.draw_cycle_id, last_idx)
    };

    let registry_ai = registry_loader.to_account_info();

    let mut swapped_owner = Pubkey::default();
    let will_exit;

    // 1. First scope: read, validate, merge, check exit status, write entries.
    {
        let mut data = registry_ai.try_borrow_mut_data()?;
        let mut entry = registry_get_entry(&data, user_entry_idx as usize);
        require!(
            entry.owner == user_key,
            PremiumBondsError::InvalidUserEntryHint
        );

        entry.lazy_merge(current_cycle)?;

        require!(
            entry.active >= active_to_sell,
            PremiumBondsError::InsufficientActiveTickets
        );
        require!(
            entry.pending >= pending_to_sell,
            PremiumBondsError::InsufficientPendingTickets
        );

        entry.active -= active_to_sell;
        entry.pending -= pending_to_sell;

        will_exit = entry.active == 0 && entry.pending == 0;

        if will_exit {
            user_winnings.registry_entry_index = u32::MAX;
            if user_entry_idx != last_entry_idx {
                let last_entry = registry_get_entry(&data, last_entry_idx as usize);
                swapped_owner = last_entry.owner;
                registry_set_entry(&mut data, user_entry_idx as usize, &last_entry);
            }
            registry_set_entry(
                &mut data,
                last_entry_idx as usize,
                &crate::state::UserEntry::default(),
            );
        } else {
            registry_set_entry(&mut data, user_entry_idx as usize, &entry);
        }
    }

    // 2. Second scope: update global counters, decrement user count, handle swapped winnings pda.
    {
        let mut registry = registry_loader.load_mut()?;
        registry.total_active_tickets -= active_to_sell;
        registry.total_pending_tickets -= pending_to_sell;

        if will_exit {
            if user_entry_idx != last_entry_idx {
                let swapped_user_winnings_info = ctx
                    .remaining_accounts
                    .first()
                    .ok_or(PremiumBondsError::MissingSwappedUserWinnings)?;

                // Verify PDA seeds & ownership on remaining account
                let pool_id_bytes = pool.pool_id.to_le_bytes();
                let expected_seeds = &[
                    b"user_winnings",
                    pool_id_bytes.as_ref(),
                    swapped_owner.as_ref(),
                ];
                let (expected_pda, _) =
                    Pubkey::find_program_address(expected_seeds, ctx.program_id);
                require_keys_eq!(
                    swapped_user_winnings_info.key(),
                    expected_pda,
                    PremiumBondsError::InvalidUserEntryHint
                );

                let mut swapped_winnings =
                    Account::<UserWinnings>::try_from(swapped_user_winnings_info)?;
                swapped_winnings.registry_entry_index = user_entry_idx;
                swapped_winnings.exit(ctx.program_id)?; // serialize changes back to account
            }
            registry.user_count -= 1;
        }
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
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
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
