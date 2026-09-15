//! Integration tests for winner index swap resilience and full registry fallbacks.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
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
        UserEntryTestBuilder::new()
            .with_owner(user_a)
            .with_active(5)
            .with_cumulative_active(5)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user_b)
            .with_active(5)
            .with_cumulative_active(10)
            .build(),
    ];

    let reg = Keypair::new().pubkey();
    inject_registry_with_entries(&mut svm, reg, 1, 100, &entries);

    // Inject pool and UserWinnings PDAs
    let mint = Keypair::new().pubkey();
    let (pool_pda_addr, _) = pool_pda(1);
    PrizePoolTestBuilder::new(1)
        .with_token_mint(mint)
        .with_ticket_registry(reg)
        .with_principal(10_000_000)
        .with_prizes_allocated(5_000_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    // User A index=0, User B index=1
    inject_user_winnings_with_index(&mut svm, 1, user_a, 0, 0, 0, 0);
    inject_user_winnings_with_index(&mut svm, 1, user_b, 0, 0, 0, 1);

    // Draw Cycle 0 completes: User B wins a prize!
    let winner_b = WinnerTestBuilder::new()
        .with_winner(user_b)
        .with_amount_owed(5_000_000)
        .build();
    PayoutRegistryTestBuilder::new(1, 0)
        .with_winners(vec![winner_b])
        .with_status(anchor::PayoutRegistryStatus::Active)
        .inject(&mut svm);

    // Simulated index swap: User A sells all bonds. User B is moved from index 1 to index 0!
    let swapped_entries = vec![UserEntryTestBuilder::new()
        .with_owner(user_b)
        .with_active(5)
        .with_cumulative_active(5)
        .build()];
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
    let meta = svm
        .send_transaction(tx)
        .expect("reinvest after index swap must succeed");

    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, user_b, "event winner matches swapped user_b");
    assert_eq!(event.winner_index, 0, "event winner_index is 0");
    assert_eq!(event.bonds_bought, 5, "event bonds_bought is 5");
    assert_eq!(event.amount_reinvested, 5_000_000, "event amount_reinvested is 5 USDC");
    assert_eq!(event.new_total_deposited_principal, 15_000_000, "event new_total_deposited_principal is 15 USDC");
    assert_eq!(event.remaining_unclaimed_winnings, 0, "event remaining_unclaimed_winnings is 0");
    assert_eq!(event.crank, crank.pubkey(), "event crank matches caller");

    let winners = read_payout_winners(&svm, 1, 0);
    assert_eq!(winners[0].processed, 1, "winner 0 marked processed");

    let uw_b = read_user_winnings(&svm, 1, &user_b);
    assert_eq!(uw_b.total_reinvested, 5_000_000, "user_b total_reinvested matches 5 USDC");
}
