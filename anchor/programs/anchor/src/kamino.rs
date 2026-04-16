use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke_signed};

/// CPI wrapper for Kamino `deposit_reserve_liquidity`.
///
/// Account order (must match Kamino's on-chain DepositReserveLiquidity struct exactly):
///  1. owner                      — mut, signer
///  2. reserve                    — mut
///  3. lending_market             — readonly
///  4. lending_market_authority   — readonly (PDA)
///  5. reserve_liquidity_mint     — readonly  ← underlying token mint
///  6. reserve_liquidity_supply   — mut       ← reserve supply vault
///  7. reserve_collateral_mint    — mut       ← cToken mint
///  8. user_source_liquidity      — mut       ← pool vault (underlying tokens out)
///  9. user_destination_collateral — mut      ← pool kTokens vault (cTokens in)
/// 10. collateral_token_program   — readonly  ← SPL Token (for cTokens)
/// 11. liquidity_token_program    — readonly  ← SPL Token or Token-2022 (for underlying)
/// 12. instruction_sysvar_account — readonly  ← Kamino flash-loan guard
pub fn deposit_reserve_liquidity<'info>(
    kamino_program: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    reserve: AccountInfo<'info>,
    lending_market: AccountInfo<'info>,
    lending_market_authority: AccountInfo<'info>,
    reserve_liquidity_mint: AccountInfo<'info>,
    reserve_liquidity_supply: AccountInfo<'info>,
    reserve_collateral_mint: AccountInfo<'info>,
    user_source_liquidity: AccountInfo<'info>,
    user_destination_collateral: AccountInfo<'info>,
    collateral_token_program: AccountInfo<'info>,
    liquidity_token_program: AccountInfo<'info>,
    instruction_sysvar_account: AccountInfo<'info>,
    liquidity_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Anchor discriminator for "global:deposit_reserve_liquidity"
    let mut data = vec![147, 107, 12, 102, 172, 114, 25, 237];
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let ix = Instruction {
        program_id: *kamino_program.key,
        accounts: vec![
            AccountMeta::new(*owner.key, true),
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*lending_market.key, false),
            AccountMeta::new_readonly(*lending_market_authority.key, false),
            AccountMeta::new_readonly(*reserve_liquidity_mint.key, false),
            AccountMeta::new(*reserve_liquidity_supply.key, false),
            AccountMeta::new(*reserve_collateral_mint.key, false),
            AccountMeta::new(*user_source_liquidity.key, false),
            AccountMeta::new(*user_destination_collateral.key, false),
            AccountMeta::new_readonly(*collateral_token_program.key, false),
            AccountMeta::new_readonly(*liquidity_token_program.key, false),
            AccountMeta::new_readonly(*instruction_sysvar_account.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            owner,
            reserve,
            lending_market,
            lending_market_authority,
            reserve_liquidity_mint,
            reserve_liquidity_supply,
            reserve_collateral_mint,
            user_source_liquidity,
            user_destination_collateral,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
        ],
        signer_seeds,
    )?;

    Ok(())
}

/// CPI wrapper for Kamino `redeem_reserve_collateral`.
///
/// Account order (must match Kamino's on-chain RedeemReserveCollateral struct exactly).
/// NOTE: lending_market comes BEFORE reserve here — opposite of deposit!
///  1. owner                      — mut, signer
///  2. lending_market             — readonly
///  3. reserve                    — mut
///  4. lending_market_authority   — readonly (PDA)
///  5. reserve_liquidity_mint     — readonly  ← underlying token mint
///  6. reserve_collateral_mint    — mut       ← cToken mint
///  7. reserve_liquidity_supply   — mut       ← reserve supply vault
///  8. user_source_collateral     — mut       ← pool kTokens vault (cTokens burned)
///  9. user_destination_liquidity — mut       ← pool vault (underlying tokens in)
/// 10. collateral_token_program   — readonly  ← SPL Token (for cTokens)
/// 11. liquidity_token_program    — readonly  ← SPL Token or Token-2022 (for underlying)
/// 12. instruction_sysvar_account — readonly  ← Kamino flash-loan guard
pub fn redeem_reserve_collateral<'info>(
    kamino_program: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    lending_market: AccountInfo<'info>,
    reserve: AccountInfo<'info>,
    lending_market_authority: AccountInfo<'info>,
    reserve_liquidity_mint: AccountInfo<'info>,
    reserve_collateral_mint: AccountInfo<'info>,
    reserve_liquidity_supply: AccountInfo<'info>,
    user_source_collateral: AccountInfo<'info>,
    user_destination_liquidity: AccountInfo<'info>,
    collateral_token_program: AccountInfo<'info>,
    liquidity_token_program: AccountInfo<'info>,
    instruction_sysvar_account: AccountInfo<'info>,
    collateral_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Anchor discriminator for "global:redeem_reserve_collateral"
    let mut data = vec![236, 171, 71, 236, 175, 29, 219, 142];
    data.extend_from_slice(&collateral_amount.to_le_bytes());

    let ix = Instruction {
        program_id: *kamino_program.key,
        accounts: vec![
            AccountMeta::new(*owner.key, true),
            AccountMeta::new_readonly(*lending_market.key, false),
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*lending_market_authority.key, false),
            AccountMeta::new_readonly(*reserve_liquidity_mint.key, false),
            AccountMeta::new(*reserve_collateral_mint.key, false),
            AccountMeta::new(*reserve_liquidity_supply.key, false),
            AccountMeta::new(*user_source_collateral.key, false),
            AccountMeta::new(*user_destination_liquidity.key, false),
            AccountMeta::new_readonly(*collateral_token_program.key, false),
            AccountMeta::new_readonly(*liquidity_token_program.key, false),
            AccountMeta::new_readonly(*instruction_sysvar_account.key, false),
        ],
        data,
    };

    invoke_signed(
        &ix,
        &[
            owner,
            lending_market,
            reserve,
            lending_market_authority,
            reserve_liquidity_mint,
            reserve_collateral_mint,
            reserve_liquidity_supply,
            user_source_collateral,
            user_destination_liquidity,
            collateral_token_program,
            liquidity_token_program,
            instruction_sysvar_account,
        ],
        signer_seeds,
    )?;

    Ok(())
}
