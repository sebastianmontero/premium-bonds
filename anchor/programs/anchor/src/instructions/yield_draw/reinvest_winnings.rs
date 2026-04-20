use crate::constants::{PAYOUT_SEED, POOL_KTOKENS_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED, USER_PREF_SEED};
use crate::error::PremiumBondsError;
use crate::kamino;
use crate::state::{PayoutRegistry, PoolStatus, PrizePool, TicketRegistry, UserPreference};
use crate::utils::registry_set_ticket;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[derive(Accounts)]
#[instruction(cycle_id: u32, winner_index: u32)]
pub struct ReinvestWinnings<'info> {
    /// Permissionless crank — any signer can execute this instruction.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// CHECK: The winner's pubkey. Validated against the payout registry entry in the handler.
    pub winner: UncheckedAccount<'info>,

    /// Optional user preference account. When present, its `auto_reinvest` flag takes priority
    /// over the pool's `auto_reinvest_default`. When absent, the pool default is used.
    #[account(
        seeds = [USER_PREF_SEED, pool.pool_id.to_le_bytes().as_ref(), winner.key().as_ref()],
        bump,
    )]
    pub user_preference: Option<Account<'info, UserPreference>>,

    #[account(
        mut,
        seeds = [PAYOUT_SEED, pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_registry: Account<'info, PayoutRegistry>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// The winner's token account (ATA) for receiving dust remainder.
    #[account(
        init_if_needed,
        payer = crank,
        associated_token::mint = token_mint,
        associated_token::authority = winner,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POOL_KTOKENS_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = reserve_collateral_mint,
        token::token_program = ktokens_token_program
    )]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    // Kamino Accounts
    /// CHECK: Validated by address constraint
    #[account(address = crate::constants::KAMINO_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Validated by Kamino CPI
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: Validated by Kamino CPI
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Validated by Kamino CPI
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Validated by Kamino CPI
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(
        mut,
        mint::token_program = ktokens_token_program
    )]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub ktokens_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: Solana instructions sysvar required by Kamino as a flash-loan guard.
    #[account(address = crate::constants::INSTRUCTIONS_SYSVAR_ID)]
    pub instruction_sysvar_account: UncheckedAccount<'info>,
}

pub fn handle(
    ctx: Context<ReinvestWinnings>,
    _cycle_id: u32,
    winner_index: u32,
    max_bonds: u32,
) -> Result<()> {
    require!(max_bonds > 0, PremiumBondsError::InvalidBondQuantity);

    // ── 1. Resolve auto-reinvest flag ────────────────────────────────────────
    let auto_reinvest = match &ctx.accounts.user_preference {
        Some(pref) => pref.auto_reinvest,
        None => ctx.accounts.pool.auto_reinvest_default,
    };
    require!(auto_reinvest, PremiumBondsError::AutoReinvestNotEnabled);

    // ── 2. Validate winner entry ─────────────────────────────────────────────
    let payout_registry = &mut ctx.accounts.payout_registry;
    let winner = payout_registry.validate_winner(winner_index, &ctx.accounts.winner.key())?;

    // ── 3. Calculate remaining amount and bonds for this batch ────────────────
    let remaining = winner.claimable_amount();
    let already_reinvested = winner.amount_reinvested;
    let _ = winner;

    let pool = &mut ctx.accounts.pool;

    // How many total bonds can be bought with the remaining amount?
    let total_remaining_bonds = (remaining / pool.bond_price) as u32;
    // Cap this batch at max_bonds
    let bonds_this_batch = total_remaining_bonds.min(max_bonds);
    let reinvest_amount = (bonds_this_batch as u64).checked_mul(pool.bond_price).unwrap();

    // After this batch, determine if we're done
    let new_amount_reinvested = already_reinvested.checked_add(reinvest_amount).unwrap();
    let is_final_batch = bonds_this_batch == total_remaining_bonds;

    // Dust only matters on the final batch (leftover that can't buy a whole bond)
    let dust = if is_final_batch {
        remaining.checked_sub(reinvest_amount).unwrap()
    } else {
        0
    };

    // ── 4. Reinvest: deposit into Kamino + register tickets ──────────────────
    if bonds_this_batch > 0 {
        require!(
            pool.status == PoolStatus::Active,
            PremiumBondsError::PoolNotActive
        );
        require!(
            !pool.is_frozen_for_draw,
            PremiumBondsError::AwaitingRandomnessFreeze
        );

        let pool_id_bytes = pool.pool_id.to_le_bytes();
        let authority_bump = pool.vault_authority_bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

        // CPI into Kamino to deposit the reinvested amount
        kamino::deposit_reserve_liquidity(
            ctx.accounts.kamino_program.to_account_info(),
            pool.to_account_info(),
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.pool_vault_account.to_account_info(),
            ctx.accounts.pool_ktokens_vault.to_account_info(),
            ctx.accounts.ktokens_token_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.instruction_sysvar_account.to_account_info(),
            reinvest_amount,
            signer_seeds,
        )?;

        // Update principal
        pool.total_deposited_principal = pool
            .total_deposited_principal
            .checked_add(reinvest_amount)
            .unwrap();

        // Register new tickets (same 3-phase logic as buy_bonds)
        let insert_start;
        {
            let registry = ctx.accounts.ticket_registry.load()?;
            let current_total =
                registry.active_tickets_count + registry.pending_tickets_count;
            require!(
                current_total + bonds_this_batch <= registry.capacity,
                PremiumBondsError::RegistryFull
            );
            insert_start =
                (registry.active_tickets_count + registry.pending_tickets_count) as usize;
        }

        {
            let registry_ai = ctx.accounts.ticket_registry.to_account_info();
            let mut data = registry_ai.try_borrow_mut_data()?;
            let winner_key = ctx.accounts.winner.key();
            for i in 0..bonds_this_batch as usize {
                registry_set_ticket(&mut data, insert_start + i, &winner_key);
            }
        }

        {
            let mut registry = ctx.accounts.ticket_registry.load_mut()?;
            registry.pending_tickets_count += bonds_this_batch;
        }
    }

    // ── 5. Update reinvestment progress ──────────────────────────────────────
    payout_registry.winners[winner_index as usize].amount_reinvested = new_amount_reinvested;

    if is_final_batch {
        payout_registry.mark_paid(winner_index);

        // Transfer dust remainder to winner's ATA
        if dust > 0 {
            let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
            let authority_bump = ctx.accounts.pool.vault_authority_bump;
            let signer_seeds: &[&[&[u8]]] =
                &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.pool_vault_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    cpi_accounts,
                    signer_seeds,
                ),
                dust,
                ctx.accounts.token_mint.decimals,
            )?;
        }
    }

    // ── 6. Log for off-chain indexing ─────────────────────────────────────────
    msg!(
        "ReinvestWinnings: winner={}, bonds={}, reinvested_this_batch={}, total_reinvested={}, dust={}, final={}",
        ctx.accounts.winner.key(),
        bonds_this_batch,
        reinvest_amount,
        new_amount_reinvested,
        dust,
        is_final_batch,
    );

    Ok(())
}
