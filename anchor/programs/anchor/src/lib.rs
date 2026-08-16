#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod huma;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx");

/// The YieldBonds smart contract program.
///
/// Implements a lossless, yield-generating prize savings protocol built on Solana
/// and integrated with Huma Finance. Users deposit USDC to buy bonds, earning tickets for
/// periodic prize drawings powered by Switchboard VRF randomness. Protocol yield is harvested
/// to fund the prize pots.
#[program]
pub mod anchor {
    use super::*;

    /// Initializes the protocol-wide global configuration.
    ///
    /// Sets up the administrative wallet address and the cranking jobs bot wallet address.
    pub fn initialize_global(ctx: Context<InitializeGlobal>) -> Result<()> {
        instructions::admin::initialize_global::handle(ctx)
    }

    /// Updates the protocol-wide global configuration.
    ///
    /// Allows the admin to change the admin wallet address, the guardian address, or the cranking bot address.
    pub fn update_global_config(
        ctx: Context<UpdateGlobalConfig>,
        new_admin: Option<Pubkey>,
        new_guardian: Option<Pubkey>,
        new_jobs_account: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::update_global_config::handle(
            ctx,
            new_admin,
            new_guardian,
            new_jobs_account,
        )
    }

    /// Immediately pauses deposits, sales, claims, and harvests for a prize pool.
    ///
    /// Callable by either the emergency guardian bot or the admin multisig.
    pub fn pause_pool(ctx: Context<PausePool>) -> Result<()> {
        instructions::admin::emergency_pause::handle_pause_pool(ctx)
    }

    /// Unpauses a paused prize pool, resuming normal protocol operations.
    ///
    /// Callable strictly by the admin multisig.
    pub fn unpause_pool(ctx: Context<UnpausePool>) -> Result<()> {
        instructions::admin::emergency_pause::handle_unpause_pool(ctx)
    }

    /// Permanently closes a prize pool for orderly sunset.
    ///
    /// Callable strictly by the admin multisig.
    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        instructions::admin::emergency_pause::handle_close_pool(ctx)
    }

    /// Voids a completed draw and rolls back prize and fee accounting.
    ///
    /// Can only be called before any winner payouts have been cranked.
    /// Callable strictly by the admin multisig.
    pub fn admin_void_payout_registry(ctx: Context<AdminVoidPayoutRegistry>) -> Result<()> {
        instructions::yield_draw::admin_void_payout_registry::handle(ctx)
    }

    /// Creates a new prize pool and initializes its zero-copy TicketRegistry.
    ///
    /// Sets the ticket price, yield cycle duration, protocol fee rate, and connects it to the
    /// appropriate token vaults.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_id: u32,
        bond_price: u64,
        stake_cycle_duration_hrs: i64,
        fee_basis_points: u16,
        min_yield_threshold: u64,
        max_yield_basis_points: u16,
        payout_timelock_seconds: u32,
    ) -> Result<()> {
        instructions::admin::create_pool::handle(
            ctx,
            pool_id,
            bond_price,
            stake_cycle_duration_hrs,
            fee_basis_points,
            min_yield_threshold,
            max_yield_basis_points,
            payout_timelock_seconds,
        )
    }

    /// One-time admin setup to initialize the Huma lender state and vaults for a pool.
    ///
    /// Pre-creates the lender state accounts and the lender's $PST associated token accounts on the Huma program.
    pub fn initialize_huma_lender(ctx: Context<InitializeHumaLender>) -> Result<()> {
        instructions::admin::initialize_huma_lender::handle(ctx)
    }

    /// Purchases bonds for a user.
    ///
    /// Deposits the user's USDC into the pool vault, routes the liquidity to Huma Finance
    /// to earn yield, and registers the newly purchased tickets in the TicketRegistry.
    pub fn buy_bonds(ctx: Context<BuyBonds>, tickets_to_buy: u32) -> Result<()> {
        instructions::user::buy_bonds::handle(ctx, tickets_to_buy)
    }

    /// Increases the capacity of the zero-copy TicketRegistry account.
    ///
    /// Allocates additional memory/space on-chain to accommodate more users in the pool.
    pub fn resize_registry(ctx: Context<ResizeRegistry>) -> Result<()> {
        instructions::admin::resize_registry::handle(ctx)
    }

    /// Requests the sale of tickets.
    ///
    /// Initiates an asynchronous redemption of Huma yield-bearing assets ($PST) back to USDC.
    /// Creates a pending redemption tracking account.
    pub fn sell_bonds(
        ctx: Context<SellBonds>,
        active_to_sell: u32,
        pending_to_sell: u32,
    ) -> Result<()> {
        instructions::user::sell_bonds::handle(ctx, active_to_sell, pending_to_sell)
    }

    /// Claims a settled pending redemption.
    ///
    /// Disburses the underlying USDC from the pool vault to the user's wallet
    /// after Huma has settled the redemption queue.
    pub fn claim_redemption(ctx: Context<ClaimRedemption>) -> Result<()> {
        instructions::user::claim_redemption::handle(ctx)
    }

    /// Configures the prize payout distribution tier ratios and winner allocations for a pool.
    pub fn set_prize_tiers(ctx: Context<SetPrizeTiers>, tiers: Vec<PrizeTier>) -> Result<()> {
        instructions::admin::set_prize_tiers::handle(ctx, tiers)
    }

    /// Freezes deposits and withdrawals to prepare the pool state for a drawing.
    ///
    /// Queries the current value of the pool's assets on Huma to capture generated yield,
    /// allocates the protocol fee, and initiates a request to Switchboard for fresh VRF randomness.
    pub fn harvest_yield_and_commit(ctx: Context<HarvestYieldAndCommit>) -> Result<()> {
        instructions::yield_draw::harvest_yield_and_commit::handle(ctx)
    }

    /// Prepares user entries in the TicketRegistry for a drawing.
    ///
    /// Runs as a batched crank instruction to merge pending tickets and build cumulative
    /// sum offsets required for binary search winner selection.
    pub fn prepare_draw(ctx: Context<PrepareDraw>, batch_size: u32) -> Result<()> {
        instructions::yield_draw::prepare_draw::handle(ctx, batch_size)
    }

    /// Resolves the Switchboard randomness and draws winning tickets.
    ///
    /// Maps the randomness seed onto the registry entries using deterministic VRF derivations,
    /// selects the winners for each tier, and registers payouts in a PayoutRegistry.
    pub fn reveal_and_pick_winners(ctx: Context<RevealAndPickWinners>) -> Result<()> {
        instructions::yield_draw::reveal_and_pick_winners::handle(ctx)
    }

    /// Administrative unlock in case randomness resolution is stuck.
    ///
    /// Allows the admin to reset the drawing status and unfreeze the pool manually.
    pub fn admin_force_unlock_draw(ctx: Context<AdminForceUnlockDraw>) -> Result<()> {
        instructions::yield_draw::admin_force_unlock_draw::handle(ctx)
    }

    /// Cranks the renewal or re-binding of stale/expired randomness requests.
    pub fn crank_rebind_expired_randomness(
        ctx: Context<CrankRebindExpiredRandomness>,
    ) -> Result<()> {
        instructions::yield_draw::crank_rebind_expired_randomness::handle(ctx)
    }

    /// Claims non-reinvested cash winnings.
    ///
    /// Converts a user's cash prize balance from the PayoutRegistry into a pending redemption request.
    pub fn claim_non_reinvested_winnings(ctx: Context<ClaimNonReinvestedWinnings>) -> Result<()> {
        instructions::yield_draw::claim_non_reinvested_winnings::handle(ctx)
    }

    /// Updates configuration parameters for an individual pool.
    pub fn update_pool_config(
        ctx: Context<UpdatePoolConfig>,
        new_fee_basis_points: Option<u16>,
        new_bond_price: Option<u64>,
        new_fee_wallet: Option<Pubkey>,
        new_min_yield_threshold: Option<u64>,
        new_stake_cycle_duration_hrs: Option<i64>,
        new_max_yield_basis_points: Option<u16>,
        new_payout_timelock_seconds: Option<u32>,
    ) -> Result<()> {
        instructions::admin::update_pool_config::handle(
            ctx,
            new_fee_basis_points,
            new_bond_price,
            new_fee_wallet,
            new_min_yield_threshold,
            new_stake_cycle_duration_hrs,
            new_max_yield_basis_points,
            new_payout_timelock_seconds,
        )
    }

    /// Reinvests won prize balances back into purchase tickets.
    ///
    /// Can be triggered by the user or permissionlessly cranked on behalf of the winner
    /// to buy new bonds, compounding their yield-earning power.
    pub fn reinvest_winnings(
        ctx: Context<ReinvestWinnings>,
        cycle_id: u32,
        winner_index: u32,
    ) -> Result<()> {
        instructions::yield_draw::reinvest_winnings::handle(ctx, cycle_id, winner_index)
    }

    /// Withdraws accrued protocol fees from the pool state.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_fees::handle(ctx, amount)
    }
}
