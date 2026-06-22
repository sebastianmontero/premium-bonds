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
/// Formula: `shares = usdc_amount × pst_supply / total_assets`
///
/// Uses u128 intermediate math to avoid overflow.
/// Returns 0 if total_assets is 0 (no deposits yet).
pub fn usdc_to_pst_shares(usdc_amount: u64, pst_supply: u64, total_assets: u128) -> u64 {
    if total_assets == 0 {
        return usdc_amount; // 1:1 if pool is empty
    }
    let shares = (usdc_amount as u128)
        .checked_mul(pst_supply as u128)
        .unwrap()
        .checked_div(total_assets)
        .unwrap();
    shares as u64
}

/// Calculates the USDC value of a given number of $PST shares.
///
/// Formula: `usdc_value = pst_amount × total_assets / pst_supply`
///
/// Uses u128 intermediate math to avoid overflow.
/// Returns 0 if pst_supply is 0.
pub fn pst_shares_to_usdc(pst_amount: u64, pst_supply: u64, total_assets: u128) -> u64 {
    if pst_supply == 0 {
        return pst_amount; // 1:1 if no supply
    }
    let value = (pst_amount as u128)
        .checked_mul(total_assets)
        .unwrap()
        .checked_div(pst_supply as u128)
        .unwrap();
    value as u64
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Wrappers
// ═══════════════════════════════════════════════════════════════════════════════

/// CPI wrapper for Huma `create_lender_accounts_v2`.
///
/// Creates the lender state PDA and associated token accounts required before
/// any deposit or redemption can be made.
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
