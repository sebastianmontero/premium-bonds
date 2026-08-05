//! Anchor Event Emission Showcase
//!
//! Demonstrates best practices for:
//! 1. Standard Anchor `emit!` log-based events.
//! 2. Secure `emit_cpi!` events (Anchor 0.29+) with Event Authority PDA.
//! 3. Vector batched event emission for loop efficiency.
//! 4. Direct low-CU `sol_log_data` syscall emission.

use anchor_lang::prelude::*;

declare_id!("EventShowcase1111111111111111111111111111111");

#[program]
pub mod anchor_events_showcase {
    use super::*;

    /// 1. Standard Log Event Emission using `emit!`
    pub fn emit_standard_deposit(ctx: Context<EmitStandard>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;

        emit!(TokensDeposited {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// 2. Secure Cryptographic Event Emission using `emit_cpi!`
    /// Requires `event_authority` PDA and `program` (Self) in context accounts.
    pub fn emit_secure_deposit(ctx: Context<EmitSecure>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;

        emit_cpi!(SecureTokensDeposited {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// 3. Batched Event Emission for high-frequency iteration loops
    pub fn emit_batched_fills(ctx: Context<EmitBatched>, fills: Vec<FillSummary>) -> Result<()> {
        require!(!fills.is_empty(), EventErrorCode::EmptyBatch);
        require!(fills.len() <= 50, EventErrorCode::BatchTooLarge);

        emit!(BatchOrdersFilled {
            pool_id: 1,
            fill_count: fills.len() as u32,
            fills,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// 4. Direct Syscall Zero-Copy Emission (`sol_log_data`) for ultra-low CU budget
    pub fn emit_zero_copy_sys_log(_ctx: Context<EmitZeroCopy>, user: Pubkey, amount: u64) -> Result<()> {
        // Custom 8-byte discriminator for event identification
        const CUSTOM_DISCRIMINATOR: [u8; 8] = [0xFE, 0xED, 0xFA, 0xCE, 0x01, 0x02, 0x03, 0x04];

        let mut payload = [0u8; 48];
        payload[0..8].copy_from_slice(&CUSTOM_DISCRIMINATOR);
        payload[8..40].copy_from_slice(user.as_ref());
        payload[40..48].copy_from_slice(&amount.to_le_bytes());

        // Syscall directly logging raw binary slices (runtime base64-encodes)
        anchor_lang::solana_program::log::sol_log_data(&[&payload]);

        Ok(())
    }
}

// ============================================================================
// ACCOUNT CONTEXT DEFINITIONS
// ============================================================================

#[derive(Accounts)]
pub struct EmitStandard<'info> {
    pub user: Signer<'info>,
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

#[derive(Accounts)]
pub struct EmitBatched<'info> {
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmitZeroCopy<'info> {
    pub user: Signer<'info>,
}

// ============================================================================
// EVENT STRUCT DEFINITIONS
// ============================================================================

/// Standard Log Event Struct
#[event]
pub struct TokensDeposited {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Secure CPI Event Struct
#[event]
pub struct SecureTokensDeposited {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Batched Event Struct
#[event]
pub struct BatchOrdersFilled {
    pub pool_id: u32,
    pub fill_count: u32,
    pub fills: Vec<FillSummary>,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FillSummary {
    pub order_id: u64,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub price: u64,
    pub quantity: u64,
}

// ============================================================================
// ERROR CODES
// ============================================================================

#[error_code]
pub enum EventErrorCode {
    #[msg("Cannot emit empty batch event.")]
    EmptyBatch,
    #[msg("Batch event size exceeds 50 fill limit.")]
    BatchTooLarge,
}
