use anchor_lang::prelude::*;

#[constant]
pub const SEED: &str = "anchor";

pub const DISCRIMINATOR: usize = 8;

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";
pub const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
pub const PAYOUT_SEED: &[u8] = b"payout";
