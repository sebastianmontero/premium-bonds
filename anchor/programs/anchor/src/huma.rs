#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Huma PoolState deserialization helpers (for reading $PST price on-chain)
// ═══════════════════════════════════════════════════════════════════════════════

// Minimal representation of Huma's ModeState (per-mode entry inside PoolState).
//
// Layout from IDL:
//   assets: u128, losses: u128, cumulative_yields: u128, assets_refreshed_at: u64, padding: [u8; 160]
//
// Total size: 16 + 16 + 16 + 8 + 160 = 216 bytes per ModeState entry.

/// Byte offset of the `mode_states` Vec inside PoolState, after the 8-byte Anchor discriminator.
///
/// PoolState layout (from IDL):
///   discriminator: [u8; 8]  (8 bytes)
///   bump: u8                (1 byte)
///   status: enum            (1 byte — single-variant Borsh enum)
///   disbursement_reserve: u128 (16 bytes)
///   mode_states: Vec<ModeState> (4-byte length prefix + N × 216 bytes)
///
/// Offset to mode_states length prefix = 8 + 1 + 1 + 16 = 26
const MODE_STATES_OFFSET: usize = 26;
const MODE_STATE_SIZE: usize = 216;
const PUBKEY_SIZE: usize = 32;

use crate::error::PremiumBondsError;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct HumaPoolSnapshot {
    pub mode_assets: u128,
    pub next_request_id: u128,
    pub last_request_id: u128,
}

impl HumaPoolSnapshot {
    /// Returns the request ID assigned to the next queued redemption (Huma uses pre-increment 0-indexed IDs).
    #[inline]
    pub fn pending_request_id(&self) -> u128 {
        self.last_request_id
    }

    /// Returns true if the given Huma redemption request has been settled and disbursed.
    #[inline]
    pub fn is_redemption_settled(&self, request_id: u128) -> bool {
        self.next_request_id > request_id
    }

    /// Calculates the number of $PST shares equivalent to a given USDC amount.
    #[inline]
    pub fn usdc_to_pst_shares(&self, usdc_amount: u64, pst_supply: u64) -> Result<u64> {
        usdc_to_pst_shares(usdc_amount, pst_supply, self.mode_assets)
    }

    /// Calculates the USDC value of a given number of $PST shares.
    #[inline]
    pub fn pst_shares_to_usdc(&self, pst_amount: u64, pst_supply: u64) -> Result<u64> {
        pst_shares_to_usdc(pst_amount, pst_supply, self.mode_assets)
    }
}

/// Reads the `assets` field (u128) from the first ModeState entry in a Huma PoolState account.
///
/// This is used to calculate `price_per_pst = assets / pst_supply`.
///
/// # Safety
/// The caller must ensure `pool_state_info` is owned by the Huma program and is a valid PoolState.
///
/// # Parameters
/// * `pool_state_info` - The AccountInfo of the Huma PoolState account.
///
/// # Returns
/// * `Result<u128>` - The current total assets in Huma for ModeState 0.
pub fn read_mode_assets(pool_state_info: &AccountInfo) -> Result<u128> {
    let data = pool_state_info.try_borrow_data()?;

    // Read Vec length (u32 LE) at MODE_STATES_OFFSET
    require!(
        data.len() >= MODE_STATES_OFFSET + 4,
        PremiumBondsError::InvalidHumaPoolData
    );
    let vec_len_bytes: [u8; 4] = data[MODE_STATES_OFFSET..MODE_STATES_OFFSET + 4]
        .try_into()
        .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?;
    let vec_len = u32::from_le_bytes(vec_len_bytes) as usize;

    require!(vec_len > 0, PremiumBondsError::InvalidHumaPoolData);

    // First ModeState starts right after the 4-byte length prefix.
    // `assets` is the first field (u128, 16 bytes).
    let assets_start = MODE_STATES_OFFSET + 4;
    require!(
        data.len() >= assets_start + 16,
        PremiumBondsError::InvalidHumaPoolData
    );
    let assets_bytes: [u8; 16] = data[assets_start..assets_start + 16]
        .try_into()
        .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?;
    let assets = u128::from_le_bytes(assets_bytes);

    Ok(assets)
}

/// Reads both mode assets and the redemption queue in a single borrow.
pub fn read_huma_assets_and_queue(pool_state_info: &AccountInfo) -> Result<HumaPoolSnapshot> {
    let data = pool_state_info.try_borrow_data()?;

    // 1. Read mode_assets length prefix & first ModeState.assets (using MODE_STATES_OFFSET = 26)
    require!(
        data.len() >= MODE_STATES_OFFSET + 4,
        PremiumBondsError::InvalidHumaPoolData
    );
    let num_modes = u32::from_le_bytes(
        data[MODE_STATES_OFFSET..MODE_STATES_OFFSET + 4]
            .try_into()
            .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?,
    ) as usize;
    require!(num_modes > 0, PremiumBondsError::InvalidHumaPoolData);

    let assets_start = MODE_STATES_OFFSET
        .checked_add(4)
        .ok_or(PremiumBondsError::MathOverflow)?;
    require!(
        data.len() >= assets_start + 16,
        PremiumBondsError::InvalidHumaPoolData
    );
    let mode_assets = u128::from_le_bytes(
        data[assets_start..assets_start + 16]
            .try_into()
            .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?,
    );

    // 2. Read redemption queue offsets with checked math
    let mode_states_len = num_modes
        .checked_mul(MODE_STATE_SIZE)
        .ok_or(PremiumBondsError::MathOverflow)?;
    let mode_config_keys_offset = assets_start
        .checked_add(mode_states_len)
        .ok_or(PremiumBondsError::MathOverflow)?;
    require!(
        data.len() >= mode_config_keys_offset + 4,
        PremiumBondsError::InvalidHumaPoolData
    );

    let num_config_keys = u32::from_le_bytes(
        data[mode_config_keys_offset..mode_config_keys_offset + 4]
            .try_into()
            .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?,
    ) as usize;

    let config_keys_len = num_config_keys
        .checked_mul(PUBKEY_SIZE)
        .ok_or(PremiumBondsError::MathOverflow)?;
    let redemption_offset = mode_config_keys_offset
        .checked_add(4)
        .ok_or(PremiumBondsError::MathOverflow)?
        .checked_add(config_keys_len)
        .ok_or(PremiumBondsError::MathOverflow)?;
    require!(
        data.len() >= redemption_offset + 32,
        PremiumBondsError::InvalidHumaPoolData
    );

    let next_request_id = u128::from_le_bytes(
        data[redemption_offset..redemption_offset + 16]
            .try_into()
            .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?,
    );
    let last_request_id = u128::from_le_bytes(
        data[redemption_offset + 16..redemption_offset + 32]
            .try_into()
            .map_err(|_| error!(PremiumBondsError::InvalidHumaPoolData))?,
    );

    Ok(HumaPoolSnapshot {
        mode_assets,
        next_request_id,
        last_request_id,
    })
}

/// Calculates the number of $PST shares equivalent to a given USDC amount.
///
/// Formula: `shares = usdc_amount × pst_supply / total_assets` (strict ceiling division).
/// Uses u128 intermediate math to avoid overflow.
///
/// # Parameters
/// * `usdc_amount` - Amount of USDC to convert.
/// * `pst_supply` - Total outstanding supply of the Huma Pool's $PST token.
/// * `total_assets` - Total assets deposited inside the Huma pool.
///
/// # Returns
/// * `Result<u64>` - Equivalent amount of $PST shares.
pub fn usdc_to_pst_shares(usdc_amount: u64, pst_supply: u64, total_assets: u128) -> Result<u64> {
    if usdc_amount == 0 {
        return Ok(0);
    }
    // 1:1 initial parity applies strictly when both supply and assets are zero (or supply is 0)
    if pst_supply == 0 {
        return Ok(usdc_amount);
    }
    require!(total_assets > 0, PremiumBondsError::YieldVenueInsolvent);

    let numerator = (usdc_amount as u128)
        .checked_mul(pst_supply as u128)
        .ok_or(PremiumBondsError::MathOverflow)?
        .checked_add(total_assets.checked_sub(1).ok_or(PremiumBondsError::MathOverflow)?)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let shares = numerator
        .checked_div(total_assets)
        .ok_or(PremiumBondsError::MathOverflow)?;

    shares
        .try_into()
        .map_err(|_| error!(PremiumBondsError::MathOverflow))
}

/// Calculates the USDC value of a given number of $PST shares.
///
/// Formula: `usdc_value = pst_amount × total_assets / pst_supply` (strict floor division).
/// Uses u128 intermediate math to avoid overflow.
///
/// # Parameters
/// * `pst_amount` - Amount of $PST shares to convert.
/// * `pst_supply` - Total outstanding supply of the Huma Pool's $PST token.
/// * `total_assets` - Total assets deposited inside the Huma pool.
///
/// # Returns
/// * `Result<u64>` - Equivalent USDC amount in base units.
pub fn pst_shares_to_usdc(pst_amount: u64, pst_supply: u64, total_assets: u128) -> Result<u64> {
    if pst_amount == 0 || total_assets == 0 {
        return Ok(0);
    }
    if pst_supply == 0 {
        return Ok(pst_amount);
    }
    let value = (pst_amount as u128)
        .checked_mul(total_assets)
        .ok_or(PremiumBondsError::MathOverflow)?
        .checked_div(pst_supply as u128)
        .ok_or(PremiumBondsError::MathOverflow)?;

    value
        .try_into()
        .map_err(|_| error!(PremiumBondsError::MathOverflow))
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Wrappers
// ═══════════════════════════════════════════════════════════════════════════════

/// CPI wrapper for Huma `create_lender_accounts_v2`.
///
/// Creates the lender state PDA and associated token accounts required before
/// any deposit or redemption can be made.
///
/// # Parameters
/// * `huma_program` - AccountInfo of the Huma Finance program.
/// * `payer` - AccountInfo of the signer funding the transaction.
/// * `lender` - AccountInfo of the lender (the pool PDA).
/// * `huma_config` - AccountInfo of the Huma global config.
/// * `pool_config` - AccountInfo of the Huma pool configuration.
/// * `pool_state` - AccountInfo of the Huma pool state.
/// * `mode_config` - AccountInfo of Huma mode config.
/// * `mode_mint` - AccountInfo of the Huma mode mint ($PST mint).
/// * `lender_state` - AccountInfo of the Huma lender state to be initialized.
/// * `lender_mode_token` - AccountInfo of the lender's token account for the mode mint.
/// * `token_program` - AccountInfo of the SPL token program.
/// * `associated_token_program` - AccountInfo of the associated token program.
/// * `system_program` - AccountInfo of the Solana system program.
/// * `signer_seeds` - Signer seeds for the pool PDA authority.
pub fn create_lender_accounts<'info>(
    huma_program: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    lender: AccountInfo<'info>,
    huma_config: AccountInfo<'info>,
    pool_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    mode_config: AccountInfo<'info>,
    mode_mint: AccountInfo<'info>,
    lender_state: AccountInfo<'info>,
    lender_mode_token: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    associated_token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Discriminator: sha256("global:create_lender_accounts_v2")[0..8]
    let data = vec![203, 52, 185, 231, 192, 74, 121, 108];

    let ix = Instruction {
        program_id: *huma_program.key,
        accounts: vec![
            AccountMeta::new(*payer.key, true),
            AccountMeta::new_readonly(*lender.key, false),
            AccountMeta::new_readonly(*huma_config.key, false),
            AccountMeta::new_readonly(*pool_config.key, false),
            AccountMeta::new_readonly(*pool_state.key, false),
            AccountMeta::new_readonly(*mode_config.key, false),
            AccountMeta::new_readonly(*mode_mint.key, false),
            AccountMeta::new(*lender_state.key, false),
            AccountMeta::new(*lender_mode_token.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*associated_token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            payer,
            lender,
            huma_config,
            pool_config,
            pool_state,
            mode_config,
            mode_mint,
            lender_state,
            lender_mode_token,
            token_program,
            associated_token_program,
            system_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}

/// CPI wrapper for Huma `deposit`.
///
/// Deposits USDC into a Huma pool and mints $PST to the depositor's mode token account.
///
/// # Parameters
/// * `huma_program` - AccountInfo of the Huma Finance program.
/// * `depositor` - AccountInfo of the pool PDA depositing assets.
/// * `huma_config` - AccountInfo of the Huma global config.
/// * `pool_config` - AccountInfo of the Huma pool configuration.
/// * `pool_state` - AccountInfo of the Huma pool state.
/// * `mode_config` - AccountInfo of Huma mode config.
/// * `mode_mint` - AccountInfo of the Huma mode mint ($PST mint).
/// * `pool_authority` - AccountInfo of the Huma pool authority.
/// * `underlying_mint` - AccountInfo of the underlying USDC token mint.
/// * `pool_underlying_token` - AccountInfo of the Huma pool USDC vault.
/// * `depositor_underlying_token` - AccountInfo of the depositor's underlying USDC vault.
/// * `depositor_mode_token` - AccountInfo of the depositor's $PST token account.
/// * `underlying_token_program` - AccountInfo of the SPL token program for the underlying mint.
/// * `mode_token_program` - AccountInfo of the SPL token program for the mode mint.
/// * `assets` - The amount of USDC to deposit (in base units).
/// * `signer_seeds` - Signer seeds for the pool PDA.
pub fn deposit<'info>(
    huma_program: AccountInfo<'info>,
    depositor: AccountInfo<'info>,
    huma_config: AccountInfo<'info>,
    pool_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    mode_config: AccountInfo<'info>,
    mode_mint: AccountInfo<'info>,
    pool_authority: AccountInfo<'info>,
    underlying_mint: AccountInfo<'info>,
    pool_underlying_token: AccountInfo<'info>,
    depositor_underlying_token: AccountInfo<'info>,
    depositor_mode_token: AccountInfo<'info>,
    underlying_token_program: AccountInfo<'info>,
    mode_token_program: AccountInfo<'info>,
    assets: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Discriminator: sha256("global:deposit")[0..8]
    let mut data = vec![242, 35, 198, 137, 82, 225, 242, 182];

    // Borsh: assets (u64)
    data.extend_from_slice(&assets.to_le_bytes());

    // Borsh: commitment (String — "NO_COMMIT")
    let commitment = b"NO_COMMIT";
    data.extend_from_slice(&(commitment.len() as u32).to_le_bytes());
    data.extend_from_slice(commitment);

    // Borsh: commitment_auto_renewal (bool — false)
    data.push(0);

    let ix = Instruction {
        program_id: *huma_program.key,
        accounts: vec![
            AccountMeta::new(*depositor.key, true),
            AccountMeta::new_readonly(*huma_config.key, false),
            AccountMeta::new_readonly(*pool_config.key, false),
            AccountMeta::new(*pool_state.key, false),
            AccountMeta::new_readonly(*mode_config.key, false),
            AccountMeta::new(*mode_mint.key, false),
            AccountMeta::new_readonly(*pool_authority.key, false),
            AccountMeta::new_readonly(*underlying_mint.key, false),
            AccountMeta::new(*pool_underlying_token.key, false),
            AccountMeta::new(*depositor_underlying_token.key, false),
            AccountMeta::new(*depositor_mode_token.key, false),
            AccountMeta::new_readonly(*underlying_token_program.key, false),
            AccountMeta::new_readonly(*mode_token_program.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            depositor,
            huma_config,
            pool_config,
            pool_state,
            mode_config,
            mode_mint,
            pool_authority,
            underlying_mint,
            pool_underlying_token,
            depositor_underlying_token,
            depositor_mode_token,
            underlying_token_program,
            mode_token_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}

/// CPI wrapper for Huma `add_redemption_request_v2`.
///
/// Locks $PST shares and registers an asynchronous redemption request.
/// The request must be settled by Huma before `disburse` can be called.
///
/// # Parameters
/// * `huma_program` - AccountInfo of the Huma Finance program.
/// * `payer` - AccountInfo of the transaction fee payer.
/// * `lender` - AccountInfo of the pool PDA.
/// * `huma_config` - AccountInfo of the Huma global config.
/// * `pool_config` - AccountInfo of the Huma pool configuration.
/// * `pool_state` - AccountInfo of the Huma pool state.
/// * `mode_config` - AccountInfo of Huma mode config.
/// * `mode_mint` - AccountInfo of the Huma mode mint ($PST mint).
/// * `redemption_request` - AccountInfo of Huma's redemption request PDA to initialize.
/// * `lender_state` - AccountInfo of the Huma lender state.
/// * `pool_authority` - AccountInfo of the Huma pool authority.
/// * `pool_mode_token` - AccountInfo of Huma's pool token vault.
/// * `lender_mode_token` - AccountInfo of the lender's $PST token vault.
/// * `token_program` - AccountInfo of the SPL token program.
/// * `system_program` - AccountInfo of the Solana system program.
/// * `shares` - The amount of $PST shares to redeem.
/// * `signer_seeds` - Signer seeds for the pool PDA.
pub fn add_redemption_request<'info>(
    huma_program: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    lender: AccountInfo<'info>,
    huma_config: AccountInfo<'info>,
    pool_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    mode_config: AccountInfo<'info>,
    mode_mint: AccountInfo<'info>,
    redemption_request: AccountInfo<'info>,
    lender_state: AccountInfo<'info>,
    pool_authority: AccountInfo<'info>,
    pool_mode_token: AccountInfo<'info>,
    lender_mode_token: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    shares: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Discriminator: sha256("global:add_redemption_request_v2")[0..8]
    let mut data = vec![96, 173, 49, 36, 201, 46, 244, 189];

    // Borsh: shares (u64)
    data.extend_from_slice(&shares.to_le_bytes());

    let ix = Instruction {
        program_id: *huma_program.key,
        accounts: vec![
            AccountMeta::new(*payer.key, true),
            AccountMeta::new(*lender.key, true),
            AccountMeta::new_readonly(*huma_config.key, false),
            AccountMeta::new_readonly(*pool_config.key, false),
            AccountMeta::new(*pool_state.key, false),
            AccountMeta::new_readonly(*mode_config.key, false),
            AccountMeta::new_readonly(*mode_mint.key, false),
            AccountMeta::new(*redemption_request.key, false),
            AccountMeta::new(*lender_state.key, false),
            AccountMeta::new_readonly(*pool_authority.key, false),
            AccountMeta::new(*pool_mode_token.key, false),
            AccountMeta::new(*lender_mode_token.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            payer,
            lender,
            huma_config,
            pool_config,
            pool_state,
            mode_config,
            mode_mint,
            redemption_request,
            lender_state,
            pool_authority,
            pool_mode_token,
            lender_mode_token,
            token_program,
            system_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}

/// CPI wrapper for Huma `disburse`.
///
/// Claims settled USDC from the Huma disbursement reserve.
/// Must be called after Huma has processed the redemption request.
///
/// # Parameters
/// * `huma_program` - AccountInfo of the Huma Finance program.
/// * `lender` - AccountInfo of the pool PDA.
/// * `huma_config` - AccountInfo of the Huma global config.
/// * `pool_config` - AccountInfo of the Huma pool configuration.
/// * `pool_state` - AccountInfo of the Huma pool state.
/// * `mode_config` - AccountInfo of Huma mode config.
/// * `lender_state` - AccountInfo of the Huma lender state.
/// * `underlying_mint` - AccountInfo of the underlying USDC token mint.
/// * `pool_authority` - AccountInfo of the Huma pool authority.
/// * `pool_underlying_token` - AccountInfo of the Huma pool underlying token vault.
/// * `lender_underlying_token` - AccountInfo of the lender's underlying USDC vault to receive disbursed funds.
/// * `token_program` - AccountInfo of the SPL token program.
/// * `signer_seeds` - Signer seeds for the pool PDA.
pub fn disburse<'info>(
    huma_program: AccountInfo<'info>,
    lender: AccountInfo<'info>,
    huma_config: AccountInfo<'info>,
    pool_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    mode_config: AccountInfo<'info>,
    lender_state: AccountInfo<'info>,
    underlying_mint: AccountInfo<'info>,
    pool_authority: AccountInfo<'info>,
    pool_underlying_token: AccountInfo<'info>,
    lender_underlying_token: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Discriminator: sha256("global:disburse")[0..8]
    let data = vec![68, 250, 205, 89, 217, 142, 13, 44];

    let ix = Instruction {
        program_id: *huma_program.key,
        accounts: vec![
            AccountMeta::new(*lender.key, true),
            AccountMeta::new_readonly(*huma_config.key, false),
            AccountMeta::new_readonly(*pool_config.key, false),
            AccountMeta::new(*pool_state.key, false),
            AccountMeta::new_readonly(*mode_config.key, false),
            AccountMeta::new(*lender_state.key, false),
            AccountMeta::new_readonly(*underlying_mint.key, false),
            AccountMeta::new_readonly(*pool_authority.key, false),
            AccountMeta::new(*pool_underlying_token.key, false),
            AccountMeta::new(*lender_underlying_token.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            lender,
            huma_config,
            pool_config,
            pool_state,
            mode_config,
            lender_state,
            underlying_mint,
            pool_authority,
            pool_underlying_token,
            lender_underlying_token,
            token_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}

/// Retained standalone helper for claim_redemption: delegates to read_huma_assets_and_queue
/// to eliminate unchecked integer math while maintaining backwards compatibility.
pub fn read_huma_redemption_queue(pool_state_info: &AccountInfo) -> Result<(u128, u128)> {
    let snapshot = read_huma_assets_and_queue(pool_state_info)?;
    Ok((snapshot.next_request_id, snapshot.last_request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usdc_to_pst_shares_zero_amount() {
        assert_eq!(usdc_to_pst_shares(0, 1_000_000, 1_000_000).unwrap(), 0);
    }

    #[test]
    fn test_usdc_to_pst_shares_initial_parity() {
        assert_eq!(usdc_to_pst_shares(1_000_000, 0, 0).unwrap(), 1_000_000);
    }

    #[test]
    fn test_usdc_to_pst_shares_zero_assets_with_supply_fails() {
        assert!(usdc_to_pst_shares(1_000_000, 1_000_000, 0).is_err());
    }

    #[test]
    fn test_usdc_to_pst_shares_ceiling_rounding() {
        // 100 USDC, supply 1000, assets 300 -> 100 * 1000 / 300 = 333.333 -> ceil = 334
        assert_eq!(usdc_to_pst_shares(100, 1000, 300).unwrap(), 334);
    }

    #[test]
    fn test_pst_shares_to_usdc_zero_inputs() {
        assert_eq!(pst_shares_to_usdc(0, 1_000_000, 1_000_000).unwrap(), 0);
        assert_eq!(pst_shares_to_usdc(1_000_000, 1_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn test_pst_shares_to_usdc_zero_assets_returns_zero() {
        assert_eq!(pst_shares_to_usdc(1_000_000, 0, 0).unwrap(), 0);
        assert_eq!(pst_shares_to_usdc(1_000_000, 1_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn test_pst_shares_to_usdc_floor_rounding() {
        // 334 shares, supply 1000, assets 300 -> 334 * 300 / 1000 = 100.2 -> floor = 100
        assert_eq!(pst_shares_to_usdc(334, 1000, 300).unwrap(), 100);
    }

    fn build_mock_huma_pool_data(
        num_modes: u32,
        mode_assets_list: &[u128],
        num_config_keys: u32,
        next_request_id: u128,
        last_request_id: u128,
    ) -> Vec<u8> {
        let mut data = vec![0u8; 8 + 1 + 1 + 16]; // discriminator(8) + bump(1) + status(1) + reserve(16) = 26 bytes
        data.extend_from_slice(&num_modes.to_le_bytes()); // mode_states len
        for &assets in mode_assets_list {
            data.extend_from_slice(&assets.to_le_bytes()); // assets: u128
            data.extend_from_slice(&[0u8; 200]); // rest of ModeState (216 - 16 = 200)
        }
        data.extend_from_slice(&num_config_keys.to_le_bytes()); // mode_config_keys len
        for _ in 0..num_config_keys {
            data.extend_from_slice(&[0u8; 32]); // pubkeys
        }
        data.extend_from_slice(&next_request_id.to_le_bytes());
        data.extend_from_slice(&last_request_id.to_le_bytes());
        data
    }

    #[test]
    fn test_huma_pool_snapshot_methods() {
        let snapshot = HumaPoolSnapshot {
            mode_assets: 2000,
            next_request_id: 5,
            last_request_id: 10,
        };

        assert_eq!(snapshot.pending_request_id(), 10);
        assert!(snapshot.is_redemption_settled(4));
        assert!(!snapshot.is_redemption_settled(5));
        assert!(!snapshot.is_redemption_settled(6));

        // 100 USDC with supply 1000 and assets 2000 -> 100 * 1000 / 2000 = 50 shares
        assert_eq!(snapshot.usdc_to_pst_shares(100, 1000).unwrap(), 50);
        // 50 shares with supply 1000 and assets 2000 -> 50 * 2000 / 1000 = 100 USDC
        assert_eq!(snapshot.pst_shares_to_usdc(50, 1000).unwrap(), 100);
    }

    #[test]
    fn test_read_huma_assets_and_queue_multi_mode() {
        let mut lamports = 0u64;
        let mut data = build_mock_huma_pool_data(2, &[500_000_000, 250_000_000], 1, 42, 88);
        let owner = Pubkey::default();
        let key = Pubkey::default();
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
        );

        let snapshot = read_huma_assets_and_queue(&account_info).unwrap();
        assert_eq!(snapshot.mode_assets, 500_000_000);
        assert_eq!(snapshot.next_request_id, 42);
        assert_eq!(snapshot.last_request_id, 88);
    }

    #[test]
    fn test_read_huma_assets_and_queue_truncated_buffer() {
        let mut lamports = 0u64;
        let mut data = vec![0u8; 20]; // Truncated
        let owner = Pubkey::default();
        let key = Pubkey::default();
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
        );

        let err = read_huma_assets_and_queue(&account_info).unwrap_err();
        assert_eq!(err, PremiumBondsError::InvalidHumaPoolData.into());
    }

    #[test]
    fn test_read_huma_assets_and_queue_zero_modes_rejected() {
        let mut lamports = 0u64;
        let mut data = build_mock_huma_pool_data(0, &[], 0, 0, 0);
        let owner = Pubkey::default();
        let key = Pubkey::default();
        let account_info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
        );

        let err = read_huma_assets_and_queue(&account_info).unwrap_err();
        assert_eq!(err, PremiumBondsError::InvalidHumaPoolData.into());
    }
}
