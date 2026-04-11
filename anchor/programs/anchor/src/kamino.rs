use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke_signed};

pub fn deposit_reserve_liquidity<'info>(
    kamino_program: AccountInfo<'info>,
    owner: AccountInfo<'info>, // Our Pool Vault Authority PDA
    reserve: AccountInfo<'info>,
    lending_market: AccountInfo<'info>,
    lending_market_authority: AccountInfo<'info>,
    reserve_liquidity_supply: AccountInfo<'info>,
    reserve_collateral_mint: AccountInfo<'info>,
    user_source_liquidity: AccountInfo<'info>,
    user_destination_collateral: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    liquidity_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Standard Anchor global discriminator for "global:deposit_reserve_liquidity"
    let mut data = vec![147, 107, 12, 102, 172, 114, 25, 237];
    data.extend_from_slice(&liquidity_amount.to_le_bytes());

    let ix = Instruction {
        program_id: *kamino_program.key,
        accounts: vec![
            AccountMeta::new(*owner.key, true),
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*lending_market.key, false),
            AccountMeta::new_readonly(*lending_market_authority.key, false),
            AccountMeta::new(*reserve_liquidity_supply.key, false),
            AccountMeta::new(*reserve_collateral_mint.key, false),
            AccountMeta::new(*user_source_liquidity.key, false),
            AccountMeta::new(*user_destination_collateral.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            // Kamino technically takes multiple token programs for different extensions depending on reserved, keeping simple fallback
            AccountMeta::new_readonly(spl_token::id(), false), 
            AccountMeta::new_readonly(*system_program.key, false),
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
            reserve_liquidity_supply,
            reserve_collateral_mint,
            user_source_liquidity,
            user_destination_collateral,
            token_program,
            system_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}

pub fn redeem_reserve_collateral<'info>(
    kamino_program: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    reserve: AccountInfo<'info>,
    lending_market: AccountInfo<'info>,
    lending_market_authority: AccountInfo<'info>,
    reserve_liquidity_supply: AccountInfo<'info>,
    reserve_collateral_mint: AccountInfo<'info>,
    user_destination_liquidity: AccountInfo<'info>,
    user_source_collateral: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    collateral_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Standard Anchor global discriminator for "global:redeem_reserve_collateral"
    let mut data = vec![236, 171, 71, 236, 175, 29, 219, 142]; 
    data.extend_from_slice(&collateral_amount.to_le_bytes());

    let ix = Instruction {
        program_id: *kamino_program.key,
        accounts: vec![
            AccountMeta::new(*owner.key, true),
            AccountMeta::new(*reserve.key, false),
            AccountMeta::new_readonly(*lending_market.key, false),
            AccountMeta::new_readonly(*lending_market_authority.key, false),
            AccountMeta::new(*reserve_liquidity_supply.key, false),
            AccountMeta::new(*reserve_collateral_mint.key, false),
            AccountMeta::new(*user_destination_liquidity.key, false),
            AccountMeta::new(*user_source_collateral.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(spl_token::id(), false), 
            AccountMeta::new_readonly(*system_program.key, false),
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
            reserve_liquidity_supply,
            reserve_collateral_mint,
            user_destination_liquidity,
            user_source_collateral,
            token_program,
            system_program,
        ],
        signer_seeds,
    )?;

    Ok(())
}
