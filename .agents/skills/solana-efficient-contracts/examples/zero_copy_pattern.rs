use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

declare_id!("ZeroCopyExample1111111111111111111111111111111");

#[program]
pub mod zero_copy_example {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, pool_id: u32) -> Result<()> {
        let mut pool = ctx.accounts.pool.load_init()?;
        pool.pool_id = pool_id;
        pool.authority = ctx.accounts.authority.key();
        pool.total_staked = 0;
        pool.flags = 1; // Active flag
        pool._reserved = [0u8; 6];
        msg!("Pool initialized via zero-copy");
        Ok(())
    }

    pub fn update_staked(ctx: Context<UpdateStaked>, amount: u64) -> Result<()> {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(error!(ErrorCode::MathOverflow))?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<PoolState>()
    )]
    pub pool: AccountLoader<'info, PoolState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStaked<'info> {
    #[account(mut, has_one = authority)]
    pub pool: AccountLoader<'info, PoolState>,
    pub authority: Signer<'info>,
}

/// Zero-copy pool state. Must implement Pod and Zeroable, use repr(C),
/// and align fields strictly from largest to smallest to avoid implicit padding.
#[account(zero_copy)]
#[repr(C)]
pub struct PoolState {
    pub authority: Pubkey, // 32 bytes (8-byte aligned)
    pub total_staked: u64, // 8 bytes  (8-byte aligned)
    pub pool_id: u32,      // 4 bytes  (4-byte aligned)
    pub flags: u8,         // 1 byte   (1-byte aligned)
    pub _reserved: [u8; 3],// 3 bytes explicit padding to reach 48 bytes (multiple of 8)
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow in math operation")]
    MathOverflow,
}
