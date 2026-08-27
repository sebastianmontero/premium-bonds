//! Integration tests for winner index swap resilience and full registry fallbacks.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

mod common;
use common::*;

const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const PAYOUT_SEED: &[u8] = b"payout";

fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PAYOUT_SEED,
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}
fn user_winnings_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"user_winnings",
            pool_id.to_le_bytes().as_ref(),
            user.as_ref(),
        ],
        &anchor::id(),
    )
}

fn inject_payout(svm: &mut LiteSVM, pool_id: u32, cycle_id: u32, winners: Vec<anchor::Winner>) {
    use anchor_lang::Discriminator;
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let default_winner = anchor::Winner {
        winner: Pubkey::default(),
        amount_owed: 0,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: anchor::Winner::CURRENT_VERSION,
        _padding: [0; 1],
        _reserved: [0; 8],
    };
    let mut fixed_winners = [default_winner; 50];
    let count = winners.len().min(50);
    fixed_winners[..count].copy_from_slice(&winners[..count]);
    let pr = anchor::PayoutRegistry {
        pool_id,
        cycle_id,
        winners_count: count as u32,
        payouts_completed: 0,
        revealed_at: 0,
        status: anchor::PayoutRegistryStatus::Active as u8,
        version: anchor::PayoutRegistry::CURRENT_VERSION,
        _padding: [0; 6],
        _reserved: [0; 64],
        winners: fixed_winners,
    };
    let mut d = vec![];
    d.extend_from_slice(&anchor::PayoutRegistry::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pr));
    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn read_payout(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::PayoutRegistry {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let account = svm.get_account(&pda).unwrap();
    *bytemuck::from_bytes::<anchor::PayoutRegistry>(&account.data[8..8 + std::mem::size_of::<anchor::PayoutRegistry>()])
}

fn read_user_winnings(svm: &LiteSVM, pool_id: u32, user: &Pubkey) -> anchor::state::UserWinnings {
    let (pda, _) = user_winnings_pda(pool_id, user);
    anchor::state::UserWinnings::try_deserialize(
        &mut svm.get_account(&pda).unwrap().data.as_slice(),
    )
    .unwrap()
}

#[test]
fn test_winner_swap_resilience_preserves_payout_claim() {
    let (mut svm, _admin) = setup_global_config();

    let user_a = Keypair::new().pubkey();
    let user_b = Keypair::new().pubkey();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    // 1. Initial registry entries: User A at index 0, User B at index 1
    let entries = vec![
        anchor::state::UserEntry {
            owner: user_a,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 5,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: user_b,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 10,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];

    let reg = Keypair::new().pubkey();
    inject_registry_with_entries(&mut svm, reg, 1, 100, &entries);

    // Inject pool and UserWinnings PDAs
    let mint = Keypair::new().pubkey();
    use anchor_lang::Discriminator;
    let (pool_pda_addr, bump) = pool_pda(1);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id: 1,
        token_mint: mint,
        ticket_registry: reg,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 0,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: 10_000_000,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 5_000_000,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: 0,
        current_draw_cycle_id: 1,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
        version: anchor::PrizePool::CURRENT_VERSION,
        _reserved: [0; 128],
    };
    let mut d = vec![];
    d.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_pda_addr,
        Account {
            lamports: 1_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // User A index=0, User B index=1
    inject_user_winnings_with_index(&mut svm, 1, user_a, 0, 0, 0, 0);
    inject_user_winnings_with_index(&mut svm, 1, user_b, 0, 0, 0, 1);

    // Draw Cycle 0 completes: User B wins a prize!
    let winner_b = anchor::Winner {
        winner: user_b,
        amount_owed: 5_000_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: anchor::Winner::CURRENT_VERSION,
        _padding: [0; 1],
        _reserved: [0; 8],
    };
    inject_payout(&mut svm, 1, 0, vec![winner_b]);

    // Simulated index swap: User A sells all bonds. User B is moved from index 1 to index 0!
    let swapped_entries = vec![anchor::state::UserEntry {
        owner: user_b,
        active: 5,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 5,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    inject_registry_with_entries(&mut svm, reg, 1, 100, &swapped_entries);

    // User B's UserWinnings PDA index is updated to 0.
    inject_user_winnings_with_index(&mut svm, 1, user_b, 0, 0, 0, 0);

    // Now User B calls reinvest_winnings for winner slot 0.
    // Even though User B's registry_entry_index is now 0 (swapped), PayoutRegistry holds winner: user_b.
    // reinvest_winnings MUST succeed cleanly for the rightful winner!
    let (user_winnings_b, _) = user_winnings_pda(1, &user_b);
    let (payout_reg, _) = payout_pda(1, 0);

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: crank.pubkey(),
        winner: user_b,
        payout_registry: payout_reg,
        pool: pool_pda_addr,
        user_winnings: user_winnings_b,
        ticket_registry: reg,
        system_program: anchor_lang::solana_program::system_program::id(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 0,
            winner_index: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let meta = svm.send_transaction(tx).expect("reinvest after index swap must succeed");

    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, user_b);
    assert_eq!(event.bonds_bought, 5);

    let pr = read_payout(&svm, 1, 0);
    assert_eq!(pr.winners[0].processed, 1);

    let uw_b = read_user_winnings(&svm, 1, &user_b);
    assert_eq!(uw_b.total_reinvested, 5_000_000);
}
