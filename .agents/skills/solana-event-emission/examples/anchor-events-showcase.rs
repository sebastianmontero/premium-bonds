//! Anchor Event Emission & Missing Event Prevention Showcase
//!
//! Demonstrates best practices for:
//! 1. `#[event_cpi]` macro configuration for Anchor 0.29+.
//! 2. Pillar 1 (Financial Flow): Self-healing deposit with delta + post-vault snapshot.
//! 3. Pillar 2 (Governance Mutation): Admin fee update recording `old_value` -> `new_value`.
//! 4. Pillar 3 (Lifecycle Finality): Account closure event immediately prior to `close = destination`.
//! 5. Pillar 4 (Crank/Keeper Action): Vector batched liquidation event to avoid 10KB log limits.
//! 6. Secure Cryptographic CPI Event Emission (`emit_cpi!`) with `__event_authority` PDA.

use anchor_lang::prelude::*;

declare_id!("EventShowcase1111111111111111111111111111111");

#[event_cpi]
#[program]
pub mod anchor_events_showcase {
    use super::*;

    /// 1. Pillar 1: Financial Deposit with Self-Healing Snapshot
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let clock = Clock::get()?;

        vault.total_deposited = vault.total_deposited.checked_add(amount).unwrap();

        // Emit self-healing telemetry: delta + post-state aggregate snapshot
        emit!(TokensDeposited {
            user: ctx.accounts.user.key(),
            vault: vault.key(),
            delta_amount: amount,
            new_total_vault_deposits: vault.total_deposited,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// 2. Pillar 2: Governance Parameter Mutation (Old vs. New Values)
    pub fn update_fee_bps(ctx: Context<UpdateFeeBps>, new_fee_bps: u16) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let old_fee_bps = config.fee_bps;
        config.fee_bps = new_fee_bps;

        // Emit complete audit trail with authority, old value, and new value
        emit!(FeeBpsUpdated {
            authority: ctx.accounts.authority.key(),
            config: config.key(),
            old_fee_bps,
            new_fee_bps,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// 3. Pillar 3: Lifecycle Finality & Account Closure Event
    /// Emitted immediately prior to Anchor zeroing account memory via `close = user`.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &ctx.accounts.position;
        let final_payout = position.principal.checked_add(position.accrued_yield).unwrap();

        // Final immutable proof of account state before memory wipe
        emit!(PositionClosed {
            user: ctx.accounts.user.key(),
            position: position.key(),
            principal_returned: position.principal,
            yield_paid: position.accrued_yield,
            final_payout,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// 4. Pillar 4: Vector Batched Keeper Liquidations
    /// Aggregates multiple liquidation actions into a single event to avoid 10KB log limits.
    pub fn liquidate_batch(ctx: Context<LiquidateBatch>, liquidations: Vec<LiquidationSummary>) -> Result<()> {
        require!(!liquidations.is_empty(), EventErrorCode::EmptyBatch);
        require!(liquidations.len() <= 50, EventErrorCode::BatchTooLarge);

        emit!(BatchLiquidationsExecuted {
            keeper: ctx.accounts.keeper.key(),
            count: liquidations.len() as u32,
            liquidations,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// 5. Secure Cryptographic Event Emission using `emit_cpi!`
    /// Requires `event_authority` PDA and `program` (Self) in context accounts.
    pub fn emit_secure_vault_transfer(ctx: Context<EmitSecure>, amount: u64) -> Result<()> {
        emit_cpi!(SecureVaultTransferred {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNT CONTEXT DEFINITIONS
// ============================================================================

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,
}

#[derive(Accounts)]
pub struct UpdateFeeBps<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority,
    )]
    pub config: Account<'info, ConfigAccount>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        has_one = user,
        close = user, // Anchor zeroes memory and reclaims rent
    )]
    pub position: Account<'info, UserPosition>,
}

#[derive(Accounts)]
pub struct LiquidateBatch<'info> {
    pub keeper: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmitSecure<'info> {
    pub user: Signer<'info>,

    /// CHECK: Event authority PDA validated automatically by `emit_cpi!` macro
    #[account(
        seeds = [b"__event_authority"],
        bump,
    )]
    pub event_authority: AccountInfo<'info>,

    /// CHECK: Self program account validated automatically by `emit_cpi!` macro
    pub program: Program<'info, AnchorEventsShowcase>,
}

// ============================================================================
// STATE ACCOUNT STRUCTS
// ============================================================================

#[account]
pub struct VaultAccount {
    pub total_deposited: u64,
}

#[account]
pub struct ConfigAccount {
    pub authority: Pubkey,
    pub fee_bps: u16,
}

#[account]
pub struct UserPosition {
    pub user: Pubkey,
    pub principal: u64,
    pub accrued_yield: u64,
}

// ============================================================================
// EVENT STRUCT DEFINITIONS
// ============================================================================

/// Pillar 1: Financial Deposit Event (Self-Healing)
#[event]
pub struct TokensDeposited {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub delta_amount: u64,
    pub new_total_vault_deposits: u64,
    pub timestamp: i64,
}

/// Pillar 2: Governance Parameter Mutation Event
#[event]
pub struct FeeBpsUpdated {
    pub authority: Pubkey,
    pub config: Pubkey,
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
    pub timestamp: i64,
}

/// Pillar 3: Account Closure Finality Event
#[event]
pub struct PositionClosed {
    pub user: Pubkey,
    pub position: Pubkey,
    pub principal_returned: u64,
    pub yield_paid: u64,
    pub final_payout: u64,
    pub timestamp: i64,
}

/// Pillar 4: Batched Crank Liquidation Event
#[event]
pub struct BatchLiquidationsExecuted {
    pub keeper: Pubkey,
    pub count: u32,
    pub liquidations: Vec<LiquidationSummary>,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LiquidationSummary {
    pub borrower: Pubkey,
    pub collateral_seized: u64,
    pub debt_repaid: u64,
}

/// Secure CPI Event
#[event]
pub struct SecureVaultTransferred {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================================
// ERROR CODES
// ============================================================================

#[error_code]
pub enum EventErrorCode {
    #[msg("Cannot emit empty batch event.")]
    EmptyBatch,
    #[msg("Batch event size exceeds 50 liquidation limit.")]
    BatchTooLarge,
}
