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
        PremiumBondsError::MathOverflow
    );
    let vec_len = u32::from_le_bytes(
        data[MODE_STATES_OFFSET..MODE_STATES_OFFSET + 4]
            .try_into()
            .unwrap(),
    ) as usize;

    require!(vec_len > 0, PremiumBondsError::MathOverflow);

    // First ModeState starts right after the 4-byte length prefix.
    // `assets` is the first field (u128, 16 bytes).
    let assets_start = MODE_STATES_OFFSET + 4;
    require!(
        data.len() >= assets_start + 16,
        PremiumBondsError::MathOverflow
    );
    let assets = u128::from_le_bytes(data[assets_start..assets_start + 16].try_into().unwrap());

    Ok(assets)
}

use crate::error::PremiumBondsError;

/// Calculates the number of $PST shares equivalent to a given USDC amount.
///
/// Formula: `shares = usdc_amount × pst_supply / total_assets` (rounds up to avoid dust creation).
/// Uses u128 intermediate math to avoid overflow.
///
/// # Parameters
/// * `usdc_amount` - Amount of USDC to convert.
/// * `pst_supply` - Total outstanding supply of the Huma Pool's $PST token.
/// * `total_assets` - Total assets deposited inside the Huma pool.
///
/// # Returns
/// * `u64` - Equivalent amount of $PST shares.
pub fn usdc_to_pst_shares(usdc_amount: u64, pst_supply: u64, total_assets: u128) -> u64 {
    if total_assets == 0 {
        return usdc_amount; // 1:1 if pool is empty
    }
    let numerator = (usdc_amount as u128)
        .checked_mul(pst_supply as u128)
        .unwrap()
        .checked_add(total_assets)
        .unwrap()
        .checked_sub(1)
        .unwrap();
    let shares = numerator.checked_div(total_assets).unwrap();
    shares.try_into().unwrap()
}

/// Calculates the USDC value of a given number of $PST shares.
///
/// Formula: `usdc_value = pst_amount × total_assets / pst_supply`
/// Uses u128 intermediate math to avoid overflow.
///
/// # Parameters
/// * `pst_amount` - Amount of $PST shares to convert.
/// * `pst_supply` - Total outstanding supply of the Huma Pool's $PST token.
/// * `total_assets` - Total assets deposited inside the Huma pool.
///
/// # Returns
/// * `u64` - Equivalent USDC amount in base units.
pub fn pst_shares_to_usdc(pst_amount: u64, pst_supply: u64, total_assets: u128) -> u64 {
    if pst_supply == 0 {
        return pst_amount; // 1:1 if no supply
    }
    let value = (pst_amount as u128)
        .checked_mul(total_assets)
        .unwrap()
        .checked_div(pst_supply as u128)
        .unwrap();
    value.try_into().unwrap()
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

/// Safely deserializes the next_request_id and last_request_id from the Huma PoolState account.
///
/// Layout:
/// - discriminator: [u8; 8]
/// - bump: u8
/// - status: enum (u8)
/// - disbursement_reserve: u128 (16 bytes)
/// - mode_states: `Vec<ModeState>` (4-byte length prefix + N * 216 bytes)
/// - mode_config_keys: `Vec<Pubkey>` (4-byte length prefix + M * 32 bytes)
/// - redemption: Redemption (next_request_id: u128, last_request_id: u128, ...)
///
/// # Parameters
/// * `pool_state_info` - AccountInfo of Huma's PoolState account.
///
/// # Returns
/// * `Result<(u128, u128)>` - Tuple of (next_request_id, last_request_id).
pub fn read_huma_redemption_queue(pool_state_info: &AccountInfo) -> Result<(u128, u128)> {
    let data = pool_state_info.try_borrow_data()?;

    // Read mode_states length prefix (u32 LE) at offset 26
    require!(
        data.len() >= MODE_STATES_OFFSET + 4,
        PremiumBondsError::MathOverflow
    );
    let num_modes = u32::from_le_bytes(
        data[MODE_STATES_OFFSET..MODE_STATES_OFFSET + 4]
            .try_into()
            .unwrap(),
    ) as usize;

    // Locate mode_config_keys length prefix offset
    let mode_config_keys_offset = 30 + num_modes * 216;
    require!(
        data.len() >= mode_config_keys_offset + 4,
        PremiumBondsError::MathOverflow
    );

    // Read mode_config_keys length prefix (u32 LE)
    let num_config_keys = u32::from_le_bytes(
        data[mode_config_keys_offset..mode_config_keys_offset + 4]
            .try_into()
            .unwrap(),
    ) as usize;

    // Locate redemption offset
    let redemption_offset = mode_config_keys_offset + 4 + num_config_keys * 32;
    require!(
        data.len() >= redemption_offset + 32,
        PremiumBondsError::MathOverflow
    );

    // Read next_request_id and last_request_id
    let next_request_id = u128::from_le_bytes(
        data[redemption_offset..redemption_offset + 16]
            .try_into()
            .unwrap(),
    );
    let last_request_id = u128::from_le_bytes(
        data[redemption_offset + 16..redemption_offset + 32]
            .try_into()
            .unwrap(),
    );

    Ok((next_request_id, last_request_id))
}
