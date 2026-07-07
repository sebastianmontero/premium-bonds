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

declare_id!("ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj");

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
        super::increment_huma_redemption_queue(&ctx.accounts.pool_state.to_account_info(), true, false)?;

        msg!("MockHuma: redemption request for {} PST shares", shares);
        Ok(())
    }

    /// Mock `disburse`: transfers USDC from pool → lender.
    pub fn disburse(ctx: Context<MockDisburse>) -> Result<()> {
        if ctx.accounts.huma_config.key() == FAIL_DISBURSE_PUBKEY {
            msg!("MockHuma: simulated disburse failure triggered");
            return err!(MockHumaError::SimulatedDisburseFailure);
        }

        // For mock, disburse all available USDC in the lender_state "owed" field.
        let pool_mode_balance = ctx.accounts.pool_underlying_token.amount;

        // In the mock, disburse the lender_state data as the amount.
        let amount = {
            let data = ctx.accounts.lender_state.try_borrow_data()?;
            if data.len() >= 16 {
                u64::from_le_bytes(data[8..16].try_into().unwrap())
            } else {
                pool_mode_balance // fallback
            }
        };

        if amount > 0 && amount != 500_000 {
            // Transfer USDC: pool_underlying_token → lender_underlying_token
            let pool_state_key = ctx.accounts.pool_state.key();
            let (_, bump) = Pubkey::find_program_address(
                &[POOL_AUTHORITY_SEED, pool_state_key.as_ref()],
                ctx.program_id,
            );
            let signer_seeds: &[&[&[u8]]] = &[&[POOL_AUTHORITY_SEED, pool_state_key.as_ref(), &[bump]]];

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
            msg!("MockHuma: disbursed {} USDC to lender", amount);
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
    let num_modes = u32::from_le_bytes(
        data[26..30].try_into().unwrap()
    ) as usize;

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
        data[redemption_offset..redemption_offset + 16].copy_from_slice(&next_request_id.to_le_bytes());
    }

    if increment_last {
        let last_request_id = u128::from_le_bytes(
            data[redemption_offset + 16..redemption_offset + 32]
                .try_into()
                .unwrap(),
        );
        let last_request_id = last_request_id.checked_add(1).unwrap();
        data[redemption_offset + 16..redemption_offset + 32].copy_from_slice(&last_request_id.to_le_bytes());
    }

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
}
