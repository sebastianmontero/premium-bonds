//! # Mock Huma Finance Program
//!
//! **⚠️  TEST-ONLY — DO NOT DEPLOY TO ANY NETWORK ⚠️**
//!
//! This program impersonates Huma Finance at the same program ID
//! (`ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj`) so that LiteSVM
//! integration tests can exercise the full CPI path through `buy_bonds`,
//! `sell_bonds`, `claim_prize`, `claim_redemption`, `withdraw_fees`,
//! and `initialize_huma_lender`.
//!
//! ## How it works
//!
//! Uses **raw entrypoint processing** (not Anchor `#[program]`) to match
//! the exact discriminator bytes sent by our CPI wrappers in `huma.rs`.
//!
//! ### Supported Instructions
//!
//! | Instruction | Discriminator | Behavior |
//! |---|---|---|
//! | `deposit` | `[242,35,198,137,82,225,242,182]` | SPL transfer (pool vault → Huma supply), mint $PST 1:1 |
//! | `add_redemption_request_v2` | `[96,173,49,36,201,46,244,189]` | Transfer $PST from lender → pool escrow |
//! | `disburse` | `[68,250,205,89,217,142,13,44]` | SPL transfer (Huma supply → pool vault) |
//! | `create_lender_accounts_v2` | `[203,52,185,231,192,74,121,108]` | No-op (returns Ok) |
//!
//! ### Pool Authority PDA
//!
//! The mock derives its mint/transfer authority PDA from:
//!   `seeds = [b"pool_authority", pool_state.key()]` at this program's ID.
//!
//! Test setup must create the $PST mint with this PDA as `mint_authority`,
//! and the pool underlying token account with this PDA as its owner.

#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw");

/// Seed used to derive the pool authority PDA.
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";

// ─── Trigger Pubkeys ─────────────────────────────────────────────────────────

pub const FAIL_DEPOSIT_PUBKEY: Pubkey = Pubkey::new_from_array([1; 32]);
pub const FAIL_REDEMPTION_PUBKEY: Pubkey = Pubkey::new_from_array([2; 32]);
pub const FAIL_DISBURSE_PUBKEY: Pubkey = Pubkey::new_from_array([3; 32]);
pub const FAIL_CREATE_LENDER_PUBKEY: Pubkey = Pubkey::new_from_array([4; 32]);

// ═══════════════════════════════════════════════════════════════════════════════
// Instruction Handlers
// ═══════════════════════════════════════════════════════════════════════════════

#[program]
pub mod mock_huma {
    use super::*;

    /// Mock `deposit`: transfers USDC from depositor → pool underlying,
    /// then mints $PST 1:1 to depositor's mode token account.
    pub fn deposit(ctx: Context<MockDeposit>, assets: u64) -> Result<()> {
        if ctx.accounts.huma_config.key() == FAIL_DEPOSIT_PUBKEY {
            msg!("MockHuma: simulated deposit failure triggered");
            return err!(MockHumaError::SimulatedDepositFailure);
        }

        // 1. Transfer USDC: depositor_underlying_token → pool_underlying_token
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.underlying_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.depositor_underlying_token.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.pool_underlying_token.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            assets,
            ctx.accounts.underlying_mint.decimals,
        )?;

        // 2. Mint $PST 1:1 to depositor's mode token account
        let pool_state_key = ctx.accounts.pool_state.key();
        let (_, bump) = Pubkey::find_program_address(
            &[POOL_AUTHORITY_SEED, pool_state_key.as_ref()],
            ctx.program_id,
        );
        let signer_seeds: &[&[&[u8]]] = &[&[POOL_AUTHORITY_SEED, pool_state_key.as_ref(), &[bump]]];

        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.mode_token_program.key(),
                MintTo {
                    mint: ctx.accounts.mode_mint.to_account_info(),
                    to: ctx.accounts.depositor_mode_token.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer_seeds,
            ),
            assets, // 1:1 for test simplicity
        )?;

        // 3. Update total_assets in PoolState to reflect the new capital
        update_pool_total_assets(&ctx.accounts.pool_state.to_account_info(), assets as i128)?;

        msg!("MockHuma: deposited {} USDC, minted {} PST", assets, assets);
        Ok(())
    }

    /// Mock `add_redemption_request_v2`: transfers $PST from lender → pool escrow.
    pub fn add_redemption_request_v2(
        ctx: Context<MockAddRedemptionRequest>,
        shares: u64,
    ) -> Result<()> {
        if ctx.accounts.huma_config.key() == FAIL_REDEMPTION_PUBKEY {
            msg!("MockHuma: simulated redemption failure triggered");
            return err!(MockHumaError::SimulatedRedemptionFailure);
        }

        // Transfer $PST: lender_mode_token → pool_mode_token
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.lender_mode_token.to_account_info(),
                    mint: ctx.accounts.mode_mint.to_account_info(),
                    to: ctx.accounts.pool_mode_token.to_account_info(),
                    authority: ctx.accounts.lender.to_account_info(),
                },
            ),
            shares,
            ctx.accounts.mode_mint.decimals,
        )?;

        // Increment last_request_id in mock queue
        super::increment_huma_redemption_queue(
            &ctx.accounts.pool_state.to_account_info(),
            true,
            false,
        )?;

        msg!("MockHuma: redemption request for {} PST shares", shares);
        Ok(())
    }

    /// Mock `disburse`: transfers USDC from pool → lender.
    ///
    /// The amount is read from `lender_state[8..16]` (the "owed" field), but
    /// capped to the available `pool_underlying_token` balance so that
    /// sequential disburse calls against a shared funding pool never fail
    /// with SPL-Token InsufficientFunds.
    ///
    /// After each transfer, `lender_state` is decremented by the disbursed
    /// amount so that subsequent calls see the reduced remaining balance.
    pub fn disburse(ctx: Context<MockDisburse>) -> Result<()> {
        if ctx.accounts.huma_config.key() == FAIL_DISBURSE_PUBKEY {
            msg!("MockHuma: simulated disburse failure triggered");
            return err!(MockHumaError::SimulatedDisburseFailure);
        }

        let available = ctx.accounts.pool_underlying_token.amount;

        // Read the owed amount from lender_state.
        let owed = {
            let data = ctx.accounts.lender_state.try_borrow_data()?;
            if data.len() >= 16 {
                u64::from_le_bytes(data[8..16].try_into().unwrap())
            } else {
                available // fallback
            }
        };

        // Cap to available balance so sequential disburse calls don't over-draw.
        let amount = owed.min(available);

        if amount > 0 && amount != 500_000 {
            // Transfer USDC: pool_underlying_token → lender_underlying_token
            let pool_state_key = ctx.accounts.pool_state.key();
            let (_, bump) = Pubkey::find_program_address(
                &[POOL_AUTHORITY_SEED, pool_state_key.as_ref()],
                ctx.program_id,
            );
            let signer_seeds: &[&[&[u8]]] =
                &[&[POOL_AUTHORITY_SEED, pool_state_key.as_ref(), &[bump]]];

            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.pool_underlying_token.to_account_info(),
                        mint: ctx.accounts.underlying_mint.to_account_info(),
                        to: ctx.accounts.lender_underlying_token.to_account_info(),
                        authority: ctx.accounts.pool_authority.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                ctx.accounts.underlying_mint.decimals,
            )?;

            // Decrement lender_state owed amount so next disburse sees the remainder.
            {
                let mut data = ctx.accounts.lender_state.try_borrow_mut_data()?;
                if data.len() >= 16 {
                    let remaining = owed.saturating_sub(amount);
                    data[8..16].copy_from_slice(&remaining.to_le_bytes());
                }
            }

            msg!(
                "MockHuma: disbursed {} USDC to lender (remaining owed: {})",
                amount,
                owed.saturating_sub(amount)
            );
        } else {
            msg!("MockHuma: disburse 0 or insufficient (500_000), nothing to transfer");
        }

        Ok(())
    }

    /// Mock `create_lender_accounts_v2`: no-op, just returns Ok.
    pub fn create_lender_accounts_v2(ctx: Context<MockCreateLenderAccounts>) -> Result<()> {
        if ctx.accounts.huma_config.key() == FAIL_CREATE_LENDER_PUBKEY {
            msg!("MockHuma: simulated create lender failure triggered");
            return err!(MockHumaError::SimulatedCreateLenderFailure);
        }
        msg!("MockHuma: create_lender_accounts_v2 (no-op)");
        Ok(())
    }

    /// Exposes a setup instruction to initialize a mock pool state account on-chain for devnet testing.
    pub fn initialize_mock_pool_state(ctx: Context<InitializeMockPoolState>) -> Result<()> {
        let pool_state_info = ctx.accounts.pool_state.to_account_info();
        let mut data = pool_state_info.try_borrow_mut_data()?;
        if data.len() >= 30 {
            data[26..30].copy_from_slice(&1u32.to_le_bytes()); // mode array length = 1
        }
        msg!("MockHuma: Initialized mock pool state successfully.");
        Ok(())
    }

    /// Simulates yield generated by Huma for a pool by updating total assets on-chain.
    /// Reuses the existing `update_pool_total_assets` helper to perform interest updates safely.
    pub fn simulate_yield(ctx: Context<MockSimulateYield>, yield_amount: u64) -> Result<()> {
        super::update_pool_total_assets(
            &ctx.accounts.pool_state.to_account_info(),
            yield_amount as i128,
        )?;
        msg!("MockHuma: Simulated yield. Added {} total assets.", yield_amount);
        Ok(())
    }

    /// Settles pending redemption requests on-chain by advancing the queue, burning PST, and updating assets.
    pub fn settle_requests(ctx: Context<MockSettleRequests>, count: u32) -> Result<()> {
        let pool_state_info = ctx.accounts.pool_state.to_account_info();
        let mut data = pool_state_info.try_borrow_mut_data()?;
        if data.len() < 30 {
            return Ok(());
        }
        let num_modes = u32::from_le_bytes(data[26..30].try_into().unwrap()) as usize;
        
        let mode_config_keys_offset = 30usize
            .checked_add(
                num_modes
                    .checked_mul(216)
                    .ok_or(error!(MockHumaError::MathOverflow))?,
            )
            .ok_or(error!(MockHumaError::MathOverflow))?;
            
        if data.len() < mode_config_keys_offset.checked_add(4).ok_or(error!(MockHumaError::MathOverflow))? {
            return Ok(());
        }
        
        let num_config_keys = u32::from_le_bytes(
            data[mode_config_keys_offset..mode_config_keys_offset.checked_add(4).ok_or(error!(MockHumaError::MathOverflow))?]
                .try_into()
                .unwrap(),
        ) as usize;

        let redemption_offset = mode_config_keys_offset
            .checked_add(4)
            .ok_or(error!(MockHumaError::MathOverflow))?
            .checked_add(
                num_config_keys
                    .checked_mul(32)
                    .ok_or(error!(MockHumaError::MathOverflow))?,
            )
            .ok_or(error!(MockHumaError::MathOverflow))?;
            
        if data.len() < redemption_offset.checked_add(32).ok_or(error!(MockHumaError::MathOverflow))? {
            return Ok(());
        }

        // Read next and last request ids
        let next_low = u64::from_le_bytes(
            data[redemption_offset..redemption_offset.checked_add(8).ok_or(error!(MockHumaError::MathOverflow))?]
                .try_into()
                .unwrap(),
        );
        let next_high = u64::from_le_bytes(
            data[redemption_offset.checked_add(8).ok_or(error!(MockHumaError::MathOverflow))?
                ..redemption_offset.checked_add(16).ok_or(error!(MockHumaError::MathOverflow))?]
                .try_into()
                .unwrap(),
        );
        let next = ((next_high as u128) << 64) | (next_low as u128);

        let last_low = u64::from_le_bytes(
            data[redemption_offset.checked_add(16).ok_or(error!(MockHumaError::MathOverflow))?
                ..redemption_offset.checked_add(24).ok_or(error!(MockHumaError::MathOverflow))?]
                .try_into()
                .unwrap(),
        );
        let last_high = u64::from_le_bytes(
            data[redemption_offset.checked_add(24).ok_or(error!(MockHumaError::MathOverflow))?
                ..redemption_offset.checked_add(32).ok_or(error!(MockHumaError::MathOverflow))?]
                .try_into()
                .unwrap(),
        );
        let last = ((last_high as u128) << 64) | (last_low as u128);

        let pending_count = last.checked_sub(next).ok_or(error!(MockHumaError::MathOverflow))? as u32;
        let count_to_settle = if count == 0 { pending_count } else { count.min(pending_count) };

        if count_to_settle == 0 {
            msg!("MockHuma: No pending requests to settle.");
            return Ok(());
        }

        let new_next = next.checked_add(count_to_settle as u128).ok_or(error!(MockHumaError::MathOverflow))?;
        let new_last = last.max(new_next);

        // Write new next and last ids
        data[redemption_offset..redemption_offset.checked_add(16).ok_or(error!(MockHumaError::MathOverflow))?]
            .copy_from_slice(&new_next.to_le_bytes());
        data[redemption_offset.checked_add(16).ok_or(error!(MockHumaError::MathOverflow))?
            ..redemption_offset.checked_add(32).ok_or(error!(MockHumaError::MathOverflow))?]
            .copy_from_slice(&new_last.to_le_bytes());

        // Epoch simulation: burn escrowed PST
        let escrowed_pst = ctx.accounts.pool_mode_token.amount;
        if escrowed_pst > 0 {
            let pst_supply = ctx.accounts.mode_mint.supply;
            let total_assets = u128::from_le_bytes(data[30..46].try_into().unwrap());

            let usdc_value = if pst_supply > 0 && total_assets > 0 {
                (escrowed_pst as u128)
                    .checked_mul(total_assets)
                    .ok_or(error!(MockHumaError::MathOverflow))?
                    .checked_add(pst_supply as u128)
                    .ok_or(error!(MockHumaError::MathOverflow))?
                    .checked_sub(1)
                    .ok_or(error!(MockHumaError::MathOverflow))?
                    .checked_div(pst_supply as u128)
                    .ok_or(error!(MockHumaError::MathOverflow))?
            } else {
                escrowed_pst as u128
            };

            let new_total_assets = total_assets.saturating_sub(usdc_value);
            data[30..46].copy_from_slice(&new_total_assets.to_le_bytes());

            // Burn the PST tokens
            let pool_state_key = ctx.accounts.pool_state.key();
            let (_, bump) = Pubkey::find_program_address(
                &[POOL_AUTHORITY_SEED, pool_state_key.as_ref()],
                ctx.program_id,
            );
            let signer_seeds: &[&[&[u8]]] = &[&[POOL_AUTHORITY_SEED, pool_state_key.as_ref(), &[bump]]];

            // Burn PST tokens from pool vault
            anchor_spl::token_interface::burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    anchor_spl::token_interface::Burn {
                        mint: ctx.accounts.mode_mint.to_account_info(),
                        from: ctx.accounts.pool_mode_token.to_account_info(),
                        authority: ctx.accounts.pool_authority.to_account_info(),
                    },
                    signer_seeds,
                ),
                escrowed_pst,
            )?;

            msg!(
                "MockHuma: Settled {} requests, burned {} PST (worth {} USDC). New total assets: {}",
                count_to_settle, escrowed_pst, usdc_value, new_total_assets
            );
        }

        // Set Huma Lender State owed amount to a large amount (1M USDC) to support disbursal
        drop(data); // drop data mut borrow before borrowing lender_state
        let mut lender_state_data = ctx.accounts.lender_state.try_borrow_mut_data()?;
        if lender_state_data.len() >= 16 {
            lender_state_data[8..16].copy_from_slice(&1_000_000_000_000u64.to_le_bytes());
        }

        Ok(())
    }
}

pub fn increment_huma_redemption_queue(
    pool_state_info: &AccountInfo,
    increment_last: bool,
    increment_next: bool,
) -> Result<()> {
    let mut data = pool_state_info.try_borrow_mut_data()?;
    if data.len() < 30 {
        return Ok(());
    }
    let num_modes = u32::from_le_bytes(data[26..30].try_into().unwrap()) as usize;

    let mode_config_keys_offset = 30 + num_modes * 216;
    if data.len() < mode_config_keys_offset + 4 {
        return Ok(());
    }

    let num_config_keys = u32::from_le_bytes(
        data[mode_config_keys_offset..mode_config_keys_offset + 4]
            .try_into()
            .unwrap(),
    ) as usize;

    let redemption_offset = mode_config_keys_offset + 4 + num_config_keys * 32;
    if data.len() < redemption_offset + 32 {
        return Ok(());
    }

    if increment_next {
        let next_request_id = u128::from_le_bytes(
            data[redemption_offset..redemption_offset + 16]
                .try_into()
                .unwrap(),
        );
        let next_request_id = next_request_id.checked_add(1).unwrap();
        data[redemption_offset..redemption_offset + 16]
            .copy_from_slice(&next_request_id.to_le_bytes());
    }

    if increment_last {
        let last_request_id = u128::from_le_bytes(
            data[redemption_offset + 16..redemption_offset + 32]
                .try_into()
                .unwrap(),
        );
        let last_request_id = last_request_id.checked_add(1).unwrap();
        data[redemption_offset + 16..redemption_offset + 32]
            .copy_from_slice(&last_request_id.to_le_bytes());
    }

    Ok(())
}

/// Read/write the u128 `total_assets` field at offset 30 in the mock PoolState.
/// `delta` is signed: positive for deposits, negative for withdrawals.
pub fn update_pool_total_assets(pool_state_info: &AccountInfo, delta: i128) -> Result<()> {
    let mut data = pool_state_info.try_borrow_mut_data()?;
    if data.len() < 46 {
        return Ok(());
    }
    let current = u128::from_le_bytes(data[30..46].try_into().unwrap());
    let updated = if delta >= 0 {
        current.checked_add(delta as u128).unwrap_or(u128::MAX)
    } else {
        current.saturating_sub((-delta) as u128)
    };
    data[30..46].copy_from_slice(&updated.to_le_bytes());
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Account Structs
// ═══════════════════════════════════════════════════════════════════════════════

/// Accounts for mock `deposit`.
#[derive(Accounts)]
pub struct MockDeposit<'info> {
    pub depositor: Signer<'info>,
    /// CHECK: Mock config validator.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Mock uses key for pool_authority PDA derivation.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub mode_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Validated by mint_to CPI.
    pub pool_authority: UncheckedAccount<'info>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub pool_underlying_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub depositor_underlying_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub depositor_mode_token: InterfaceAccount<'info, TokenAccount>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub mode_token_program: Interface<'info, TokenInterface>,
}

/// Accounts for mock `add_redemption_request_v2`.
#[derive(Accounts)]
pub struct MockAddRedemptionRequest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub lender: Signer<'info>,
    /// CHECK: Mock config validator.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_config: UncheckedAccount<'info>,
    pub mode_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Mock does not create/validate.
    #[account(mut)]
    pub redemption_request: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    #[account(mut)]
    pub lender_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool_mode_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub lender_mode_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Accounts for mock `disburse`.
#[derive(Accounts)]
pub struct MockDisburse<'info> {
    pub lender: Signer<'info>,
    /// CHECK: Mock config validator.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Mock uses key for pool_authority PDA derivation.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_config: UncheckedAccount<'info>,
    /// CHECK: Mock reads raw bytes.
    #[account(mut)]
    pub lender_state: UncheckedAccount<'info>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Validated by transfer CPI.
    pub pool_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool_underlying_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub lender_underlying_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Accounts for mock `create_lender_accounts_v2`.
#[derive(Accounts)]
pub struct MockCreateLenderAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Mock does not validate.
    pub lender: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_mint: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    #[account(mut)]
    pub lender_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    #[account(mut)]
    pub lender_mode_token: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub associated_token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Accounts for mock `initialize_mock_pool_state`.
#[derive(Accounts)]
pub struct InitializeMockPoolState<'info> {
    #[account(
        init,
        payer = payer,
        space = 512,
        owner = crate::ID,
    )]
    /// CHECK: This is a raw mock state account owned by the Mock Huma Program
    pub pool_state: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MockSimulateYield<'info> {
    #[account(
        mut,
        owner = crate::ID @ MockHumaError::InvalidAccountOwner
    )]
    /// CHECK: Target pool state account owned by Mock Huma
    pub pool_state: UncheckedAccount<'info>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct MockSettleRequests<'info> {
    pub lender: Signer<'info>,
    /// CHECK: Mock config validator.
    pub huma_config: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub pool_config: UncheckedAccount<'info>,
    #[account(
        mut,
        owner = crate::ID @ MockHumaError::InvalidAccountOwner
    )]
    /// CHECK: Mock uses key for pool_authority PDA derivation.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: Mock does not validate.
    pub mode_config: UncheckedAccount<'info>,
    #[account(
        mut,
        owner = crate::ID @ MockHumaError::InvalidAccountOwner
    )]
    /// CHECK: Mock reads/writes raw bytes.
    pub lender_state: UncheckedAccount<'info>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub mode_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Validated by transfer/burn CPI.
    pub pool_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool_underlying_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub pool_mode_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum MockHumaError {
    #[msg("MockHuma: simulated deposit failure")]
    SimulatedDepositFailure,
    #[msg("MockHuma: simulated redemption failure")]
    SimulatedRedemptionFailure,
    #[msg("MockHuma: simulated disburse failure")]
    SimulatedDisburseFailure,
    #[msg("MockHuma: simulated create lender failure")]
    SimulatedCreateLenderFailure,
    #[msg("MockHuma: Math overflow occurred")]
    MathOverflow,
    #[msg("MockHuma: Account has an invalid owner")]
    InvalidAccountOwner,
}
