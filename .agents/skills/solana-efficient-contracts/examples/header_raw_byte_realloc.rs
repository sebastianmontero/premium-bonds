use anchor_lang::prelude::*;

declare_id!("HeaderRawByteExample11111111111111111111111");

pub const HEADER_OFFSET: usize = 8 + std::mem::size_of::<RegistryHeader>(); // 8 discriminator + 64 struct = 72
pub const USER_ENTRY_SIZE: usize = 64;

#[program]
pub mod header_raw_byte_example {
    use super::*;

    pub fn resize_registry(ctx: Context<ResizeRegistry>, additional_users: u32) -> Result<()> {
        let registry_info = ctx.accounts.registry.to_account_info();
        let current_len = registry_info.data_len();
        let bytes_to_add = (additional_users as usize)
            .checked_mul(USER_ENTRY_SIZE)
            .ok_or(error!(ErrorCode::MathOverflow))?;

        let new_len = current_len
            .checked_add(bytes_to_add)
            .ok_or(error!(ErrorCode::MathOverflow))?;

        // Reallocate account memory (max +10KB per instruction)
        registry_info.realloc(new_len, false)?;

        // Top up rent lamports
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(new_len);
        let lamport_diff = required_lamports.saturating_sub(registry_info.lamports());

        if lamport_diff > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: registry_info.clone(),
                    },
                ),
                lamport_diff,
            )?;
        }

        // Update header capacity
        let mut header = ctx.accounts.registry.load_mut()?;
        header.capacity = header
            .capacity
            .checked_add(additional_users)
            .ok_or(error!(ErrorCode::MathOverflow))?;

        msg!("Registry expanded to new capacity: {}", header.capacity);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ResizeRegistry<'info> {
    #[account(mut)]
    pub registry: AccountLoader<'info, RegistryHeader>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account(zero_copy)]
#[repr(C)]
pub struct RegistryHeader {
    pub pool_id: u32,       // 4 bytes
    pub capacity: u32,      // 4 bytes
    pub user_count: u32,    // 4 bytes
    pub version: u8,        // 1 byte
    pub _reserved: [u8; 51],// 51 bytes padding to reach 64 bytes total struct size
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
