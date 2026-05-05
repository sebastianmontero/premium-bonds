//! # Mock Kamino Lending Program
//!
//! **⚠️  TEST-ONLY — DO NOT DEPLOY TO ANY NETWORK ⚠️**
//!
//! This program impersonates Kamino's `deposit_reserve_liquidity` and
//! `redeem_reserve_collateral` instructions at the same program ID
//! (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`) so that LiteSVM
//! integration tests can exercise the full CPI path through `buy_bonds`
//! and `sell_bonds`.
//!
//! ## How it works
//!
//! - Accepts the exact same 12 accounts and discriminator as real Kamino.
//! - **Deposit**: performs a real SPL `transfer_checked` (pool vault → mock
//!   supply vault), then `mint_to` (cToken mint → pool kTokens vault) at 1:1.
//! - **Redeem**: performs a real SPL `burn` (kTokens from pool kTokens vault),
//!   then `transfer_checked` (mock supply vault → pool vault) at 1:1.
//! - Supports a **fail mode**: if `reserve.data[0] == 0xFF`, returns an error
//!   to test CPI failure propagation without touching token state.
//!
//! ## Lending Market Authority
//!
//! The mock derives its mint/transfer authority PDA from:
//!   `seeds = [b"lma", lending_market.key()]` at this program's ID.
//!
//! Test setup must create the cToken mint with this PDA as `mint_authority`,
//! and the reserve supply vault with this PDA as its owner.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

/// Seed used to derive the lending market authority PDA (matches real Kamino convention).
pub const LMA_SEED: &[u8] = b"lma";

#[program]
pub mod mock_kamino {
    use super::*;

    /// Mock implementation of Kamino's `deposit_reserve_liquidity`.
    ///
    /// Account order matches the real Kamino struct exactly (see
    /// `handler_deposit_reserve_liquidity.rs` in Kamino-Finance/klend @ 95d694b).
    pub fn deposit_reserve_liquidity(
        ctx: Context<DepositReserveLiquidity>,
        liquidity_amount: u64,
    ) -> Result<()> {
        // ── Fail mode ────────────────────────────────────────────────────
        // If the reserve account's first byte is 0xFF, simulate a Kamino
        // failure. This lets tests verify CPI error propagation and
        // transaction atomicity (no partial state updates).
        {
            let reserve_data = ctx.accounts.reserve.try_borrow_data()?;
            if !reserve_data.is_empty() && reserve_data[0] == 0xFF {
                msg!("MockKamino: fail mode triggered (reserve.data[0] == 0xFF)");
                return err!(MockKaminoError::SimulatedDepositFailure);
            }
        }

        // ── Transfer underlying tokens: pool vault → reserve supply ─────
        // The `owner` (pool PDA) is already a signer because our main
        // program called us via `invoke_signed`.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.liquidity_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_source_liquidity.to_account_info(),
                    mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
                    to: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            liquidity_amount,
            ctx.accounts.reserve_liquidity_mint.decimals,
        )?;

        // ── Mint cTokens 1:1 into pool kTokens vault ────────────────────
        // The lending_market_authority PDA signs via invoke_signed.
        let lending_market_key = ctx.accounts.lending_market.key();
        let (_, bump) = Pubkey::find_program_address(
            &[LMA_SEED, lending_market_key.as_ref()],
            ctx.program_id,
        );
        let signer_seeds: &[&[&[u8]]] =
            &[&[LMA_SEED, lending_market_key.as_ref(), &[bump]]];

        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.collateral_token_program.key(),
                MintTo {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    to: ctx
                        .accounts
                        .user_destination_collateral
                        .to_account_info(),
                    authority: ctx.accounts.lending_market_authority.to_account_info(),
                },
                signer_seeds,
            ),
            liquidity_amount, // 1:1 exchange rate for test simplicity
        )?;

        msg!(
            "MockKamino: deposited {} liquidity, minted {} cTokens",
            liquidity_amount,
            liquidity_amount
        );
        Ok(())
    }

    /// Mock implementation of Kamino's `redeem_reserve_collateral`.
    ///
    /// Account order matches the CPI wrapper in `kamino.rs` → `redeem_reserve_collateral`.
    pub fn redeem_reserve_collateral(
        ctx: Context<RedeemReserveCollateral>,
        collateral_amount: u64,
    ) -> Result<()> {
        // ── Fail mode ────────────────────────────────────────────────────
        {
            let reserve_data = ctx.accounts.reserve.try_borrow_data()?;
            if !reserve_data.is_empty() && reserve_data[0] == 0xFF {
                msg!("MockKamino: redeem fail mode triggered (reserve.data[0] == 0xFF)");
                return err!(MockKaminoError::SimulatedRedeemFailure);
            }
        }

        // ── Burn kTokens from pool kTokens vault ─────────────────────────
        // The `owner` (pool PDA) is already a signer (passed through from
        // the main program's invoke_signed). It is the authority on the
        // pool kTokens vault, so a regular CPI (no invoke_signed) suffices.
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.collateral_token_program.key(),
                Burn {
                    mint: ctx.accounts.reserve_collateral_mint.to_account_info(),
                    from: ctx.accounts.user_source_collateral.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            collateral_amount,
        )?;

        // ── Transfer underlying tokens: reserve supply → pool vault ─────
        // The lending_market_authority PDA owns the reserve supply vault
        // and signs via invoke_signed.
        let lending_market_key = ctx.accounts.lending_market.key();
        let (_, bump) = Pubkey::find_program_address(
            &[LMA_SEED, lending_market_key.as_ref()],
            ctx.program_id,
        );
        let signer_seeds: &[&[&[u8]]] =
            &[&[LMA_SEED, lending_market_key.as_ref(), &[bump]]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.liquidity_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.reserve_liquidity_supply.to_account_info(),
                    mint: ctx.accounts.reserve_liquidity_mint.to_account_info(),
                    to: ctx.accounts.user_destination_liquidity.to_account_info(),
                    authority: ctx.accounts.lending_market_authority.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_amount, // 1:1 exchange rate for test simplicity
            ctx.accounts.reserve_liquidity_mint.decimals,
        )?;

        msg!(
            "MockKamino: redeemed {} cTokens, returned {} liquidity",
            collateral_amount,
            collateral_amount
        );
        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────
//
// Field order MUST match the AccountMeta order in our CPI wrapper
// (`programs/anchor/src/kamino.rs` → `deposit_reserve_liquidity`).

#[derive(Accounts)]
pub struct DepositReserveLiquidity<'info> {
    /// 1. owner — pool PDA, signed via invoke_signed by our main program.
    pub owner: Signer<'info>,

    /// 2. reserve — In real Kamino this is `AccountLoader<Reserve>`.
    ///    Mock reads `data[0]` for fail-mode signal only.
    /// CHECK: Mock does not validate reserve layout.
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,

    /// 3. lending_market — Used to derive the lending_market_authority PDA.
    /// CHECK: Mock uses key only for PDA derivation.
    pub lending_market: UncheckedAccount<'info>,

    /// 4. lending_market_authority — PDA = `[b"lma", lending_market.key()]`.
    ///    Serves as mint authority for the cToken mint.
    /// CHECK: Validated implicitly by mint_to CPI (will fail if wrong PDA).
    pub lending_market_authority: UncheckedAccount<'info>,

    /// 5. reserve_liquidity_mint — The underlying token mint (e.g., USDC).
    pub reserve_liquidity_mint: InterfaceAccount<'info, Mint>,

    /// 6. reserve_liquidity_supply — Kamino's supply vault for underlying tokens.
    #[account(mut)]
    pub reserve_liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// 7. reserve_collateral_mint — The cToken mint (kTokens).
    #[account(mut)]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    /// 8. user_source_liquidity — Source of underlying tokens (pool vault).
    #[account(mut)]
    pub user_source_liquidity: InterfaceAccount<'info, TokenAccount>,

    /// 9. user_destination_collateral — Destination for minted cTokens (pool kTokens vault).
    #[account(mut)]
    pub user_destination_collateral: InterfaceAccount<'info, TokenAccount>,

    /// 10. collateral_token_program — Token program for cTokens.
    pub collateral_token_program: Interface<'info, TokenInterface>,

    /// 11. liquidity_token_program — Token program for underlying tokens.
    pub liquidity_token_program: Interface<'info, TokenInterface>,

    /// 12. instruction_sysvar_account — Kamino's flash-loan guard sysvar.
    /// CHECK: Mock accepts but does not validate.
    pub instruction_sysvar_account: UncheckedAccount<'info>,
}

// Field order MUST match the AccountMeta order in our CPI wrapper
// (`programs/anchor/src/kamino.rs` → `redeem_reserve_collateral`).

#[derive(Accounts)]
pub struct RedeemReserveCollateral<'info> {
    /// 1. owner — pool PDA, signed via invoke_signed by our main program.
    pub owner: Signer<'info>,

    /// 2. lending_market — Used to derive the lending_market_authority PDA.
    /// CHECK: Mock uses key only for PDA derivation.
    pub lending_market: UncheckedAccount<'info>,

    /// 3. reserve — fail-mode trigger (data[0] == 0xFF).
    /// CHECK: Mock does not validate reserve layout.
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,

    /// 4. lending_market_authority — PDA that owns the reserve supply vault.
    /// CHECK: Validated implicitly by transfer_checked CPI.
    pub lending_market_authority: UncheckedAccount<'info>,

    /// 5. reserve_liquidity_mint — The underlying token mint.
    pub reserve_liquidity_mint: InterfaceAccount<'info, Mint>,

    /// 6. reserve_collateral_mint — The cToken mint (kTokens burned from here).
    #[account(mut)]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    /// 7. reserve_liquidity_supply — Source of underlying tokens (Kamino's vault).
    #[account(mut)]
    pub reserve_liquidity_supply: InterfaceAccount<'info, TokenAccount>,

    /// 8. user_source_collateral — Pool kTokens vault (kTokens burned).
    #[account(mut)]
    pub user_source_collateral: InterfaceAccount<'info, TokenAccount>,

    /// 9. user_destination_liquidity — Pool vault (receives underlying tokens).
    #[account(mut)]
    pub user_destination_liquidity: InterfaceAccount<'info, TokenAccount>,

    /// 10. collateral_token_program — Token program for cTokens.
    pub collateral_token_program: Interface<'info, TokenInterface>,

    /// 11. liquidity_token_program — Token program for underlying tokens.
    pub liquidity_token_program: Interface<'info, TokenInterface>,

    /// 12. instruction_sysvar_account — Kamino's flash-loan guard sysvar.
    /// CHECK: Mock accepts but does not validate.
    pub instruction_sysvar_account: UncheckedAccount<'info>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum MockKaminoError {
    #[msg("MockKamino: simulated deposit failure (fail mode active)")]
    SimulatedDepositFailure,
    #[msg("MockKamino: simulated redeem failure (fail mode active)")]
    SimulatedRedeemFailure,
}
