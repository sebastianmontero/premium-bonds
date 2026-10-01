//! # Mock Switchboard On-Demand Program
//!
//! **⚠️  TEST-ONLY — DO NOT DEPLOY TO ANY NETWORK ⚠️**
//!
//! This program impersonates Switchboard On-Demand at program ID
//! `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` so that localnet (surfpool)
//! and integration tests can execute the full atomic `[reveal, reveal_and_pick_winners]`
//! transaction bundle with exact slot matching.

use anchor_lang::prelude::*;

declare_id!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

pub const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];
pub const SWITCHBOARD_RANDOMNESS_MIN_DATA_LEN: usize = 408;
pub const SB_REVEAL_SLOT_OFFSET: usize = 144;
pub const SB_VALUE_OFFSET: usize = 152;

#[program]
pub mod mock_switchboard {
    use super::*;

    /// Atomically updates the Switchboard RandomnessAccountData:
    /// - Enforces account ownership (`owner == program_id`) and min length (408 bytes)
    /// - Sets `reveal_slot = Clock::get()?.slot`
    /// - Sets `value` to the provided 32-byte seed (or preserves existing non-zero value / generates pseudo-seed)
    pub fn reveal(ctx: Context<MockReveal>, value: Option<[u8; 32]>) -> Result<()> {
        let clock = Clock::get()?;
        let mut data = ctx.accounts.randomness_account.try_borrow_mut_data()?;
        require!(
            data.len() >= SWITCHBOARD_RANDOMNESS_MIN_DATA_LEN,
            MockSwitchboardError::InvalidAccountDataLength
        );
        require!(
            data[0..8] == SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
            MockSwitchboardError::InvalidAccountDiscriminator
        );

        // Update reveal_slot to current slot in this exact transaction
        data[SB_REVEAL_SLOT_OFFSET..SB_REVEAL_SLOT_OFFSET + 8]
            .copy_from_slice(&clock.slot.to_le_bytes());

        // Update 32-byte randomness value
        if let Some(val) = value {
            data[SB_VALUE_OFFSET..SB_VALUE_OFFSET + 32].copy_from_slice(&val);
        } else if &data[SB_VALUE_OFFSET..SB_VALUE_OFFSET + 32] == &[0u8; 32] {
            // Generate deterministic non-zero seed if unpopulated
            let mut pseudo = [0u8; 32];
            pseudo[0..8].copy_from_slice(&clock.slot.to_le_bytes());
            pseudo[8] = 0x42;
            data[SB_VALUE_OFFSET..SB_VALUE_OFFSET + 32].copy_from_slice(&pseudo);
        }

        msg!("MockSwitchboard: revealed randomness at slot {}", clock.slot);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct MockReveal<'info> {
    #[account(
        mut,
        constraint = randomness_account.owner == &crate::ID @ MockSwitchboardError::IllegalOwner
    )]
    /// CHECK: The Switchboard randomness account being revealed. Must be owned by this mock program.
    pub randomness_account: UncheckedAccount<'info>,
}

#[error_code]
pub enum MockSwitchboardError {
    #[msg("Randomness account data length is less than expected minimum 408 bytes")]
    InvalidAccountDataLength,
    #[msg("Randomness account discriminator mismatch")]
    InvalidAccountDiscriminator,
    #[msg("Randomness account is not owned by the Switchboard program")]
    IllegalOwner,
}
