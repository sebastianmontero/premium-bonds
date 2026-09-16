use {
    crate::common::{constants::*, dispatch::TxResult, readers::read_ticket_registry},
    anchor_lang::{AnchorDeserialize, Discriminator},
    litesvm::LiteSVM,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{
        message::{Message, VersionedMessage},
        signature::Keypair,
        signer::Signer,
        transaction::VersionedTransaction,
    },
};

pub struct DecodedInstructionError {
    pub instruction_index: u8,
    pub error: solana_program::instruction::InstructionError,
    pub custom_code: Option<u32>,
}

pub fn extract_detailed_error(
    err: &litesvm::types::FailedTransactionMetadata,
) -> Option<DecodedInstructionError> {
    match &err.err {
        solana_sdk::transaction::TransactionError::InstructionError(index, ix_err) => {
            let custom_code = match ix_err {
                solana_program::instruction::InstructionError::Custom(code) => Some(*code),
                _ => None,
            };
            Some(DecodedInstructionError {
                instruction_index: *index,
                error: ix_err.clone(),
                custom_code,
            })
        }
        _ => None,
    }
}

pub fn extract_instruction_error(
    err: &litesvm::types::FailedTransactionMetadata,
) -> Option<solana_program::instruction::InstructionError> {
    match &err.err {
        solana_sdk::transaction::TransactionError::InstructionError(_, ix_err) => {
            Some(ix_err.clone())
        }
        _ => None,
    }
}

#[track_caller]
pub fn assert_custom_code_at(
    res: TxResult,
    expected_ix_index: u8,
    expected_code: u32,
    error_label: &str,
) {
    let err = match res {
        Ok(meta) => panic!(
            "\n❌ Expected transaction to fail with '{}' (code {}), but it succeeded!\nTransaction Logs:\n{:#?}\n",
            error_label, expected_code, meta.logs
        ),
        Err(failed) => failed,
    };
    let decoded = extract_detailed_error(&err).unwrap_or_else(|| {
        panic!(
            "Expected InstructionError, got: {:?}\nTransaction Logs:\n{:#?}",
            err.err, err.meta.logs
        )
    });

    assert_eq!(
        decoded.instruction_index, expected_ix_index,
        "Instruction index mismatch! Expected error on ix {}, occurred on {}",
        expected_ix_index, decoded.instruction_index
    );
    assert_eq!(
        decoded.custom_code, Some(expected_code),
        "\n❌ Error Code mismatch!\nExpected: {} (Code: {})\nActual Code: {:?}\nTransaction Logs:\n{:#?}\n",
        error_label, expected_code, decoded.custom_code, err.meta.logs
    );
}

#[track_caller]
pub fn assert_custom_error_msg(
    res: TxResult,
    expected_error: anchor::error::PremiumBondsError,
    msg: &str,
) {
    let expected_code = (expected_error as u32) + anchor_lang::error::ERROR_CODE_OFFSET;
    let label = format!("{:?} - {}", expected_error, msg);
    assert_custom_code_at(res, 0, expected_code, &label);
}

#[track_caller]
pub fn assert_custom_error(res: TxResult, expected_error: anchor::error::PremiumBondsError) {
    assert_custom_error_at(res, 0, expected_error);
}

#[track_caller]
pub fn assert_custom_error_at(
    res: TxResult,
    expected_ix_index: u8,
    expected_error: anchor::error::PremiumBondsError,
) {
    let expected_code = (expected_error as u32) + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_custom_code_at(
        res,
        expected_ix_index,
        expected_code,
        &format!("{:?}", expected_error),
    );
}

#[track_caller]
pub fn assert_anchor_error(res: TxResult, expected_error: anchor_lang::error::ErrorCode) {
    assert_anchor_error_at(res, 0, expected_error);
}

#[track_caller]
pub fn assert_anchor_error_at(
    res: TxResult,
    expected_ix_index: u8,
    expected_error: anchor_lang::error::ErrorCode,
) {
    assert_custom_code_at(
        res,
        expected_ix_index,
        expected_error as u32,
        &format!("{:?}", expected_error),
    );
}

#[track_caller]
pub fn assert_token_error(
    res: TxResult,
    expected_error: anchor_spl::token::spl_token::error::TokenError,
) {
    assert_token_error_at(res, 0, expected_error);
}

#[track_caller]
pub fn assert_token_error_at(
    res: TxResult,
    expected_ix_index: u8,
    expected_error: anchor_spl::token::spl_token::error::TokenError,
) {
    let error_label = format!("{:?}", expected_error);
    assert_custom_code_at(res, expected_ix_index, expected_error as u32, &error_label);
}

#[track_caller]
pub fn assert_mock_huma_error(res: TxResult, expected_error: mock_huma::MockHumaError) {
    let expected_code = (expected_error as u32) + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_custom_code_at(res, 0, expected_code, &format!("{:?}", expected_error));
}

#[track_caller]
pub fn assert_instruction_error(
    res: TxResult,
    expected_error: solana_program::instruction::InstructionError,
) {
    assert_instruction_error_at(res, 0, expected_error);
}

#[track_caller]
pub fn assert_instruction_error_at(
    res: TxResult,
    expected_ix_index: u8,
    expected_error: solana_program::instruction::InstructionError,
) {
    let err = res.expect_err("Expected transaction to fail, but it succeeded");
    let decoded = extract_detailed_error(&err).unwrap_or_else(|| {
        panic!(
            "Expected InstructionError, got: {:?}\nTransaction Logs:\n{:#?}",
            err.err, err.meta.logs
        )
    });

    assert_eq!(
        decoded.instruction_index, expected_ix_index,
        "Instruction index mismatch! Expected error on ix {}, occurred on {}",
        expected_ix_index, decoded.instruction_index
    );
    assert_eq!(
        decoded.error, expected_error,
        "\n❌ InstructionError mismatch!\nExpected: {:?}\nActual: {:?}\nTransaction Logs:\n{:#?}\n",
        expected_error, decoded.error, err.meta.logs
    );
}

#[track_caller]
pub fn assert_program_error(
    res: TxResult,
    expected_error: solana_program::program_error::ProgramError,
) {
    let custom_code = match &expected_error {
        solana_program::program_error::ProgramError::Custom(code) => *code,
        other => u64::from(other.clone()) as u32,
    };
    assert_custom_code_at(res, 0, custom_code, &format!("{:?}", expected_error));
}

pub fn assert_error_contains(res: TxResult, expected_substrings: &[&str]) {
    let err = res.expect_err("Expected transaction to fail, but it succeeded");
    let err_str = format!("{err:?}");
    let matched = expected_substrings.iter().any(|s| err_str.contains(s));
    assert!(
        matched,
        "\n❌ Error substring mismatch!\nExpected one of: {:?}\nActual TransactionError: {:?}\nTransaction Logs:\n{:#?}\n",
        expected_substrings,
        err.err,
        err.meta.logs
    );
}

// ─── Signer Verification Helpers ─────────────────────────────────────────────

pub fn assert_signer_required_explicit(
    svm: &mut LiteSVM,
    mut ix: Instruction,
    signer_index: usize,
    expected_signer: &Pubkey,
    other_signers: &[&Keypair],
    instruction_name: &str,
    account_name: &str,
) {
    assert!(
        signer_index < ix.accounts.len(),
        "[{instruction_name}] signer_index {signer_index} out of bounds (len: {})",
        ix.accounts.len()
    );
    assert_eq!(
        &ix.accounts[signer_index].pubkey, expected_signer,
        "[{instruction_name}::{account_name}] Account at index {signer_index} did not match expected signer pubkey"
    );
    assert!(
        ix.accounts[signer_index].is_signer,
        "[{instruction_name}::{account_name}] Target account at index {signer_index} was not configured as a signer"
    );

    let fee_payer = Keypair::new();
    svm.airdrop(&fee_payer.pubkey(), 1_000_000_000).unwrap();
    assert_ne!(
        ix.accounts[signer_index].pubkey,
        fee_payer.pubkey(),
        "[{instruction_name}::{account_name}] fee_payer cannot be identical to target signer"
    );

    ix.accounts[signer_index].is_signer = false;
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&fee_payer.pubkey()), &bh);
    let mut signers = vec![&fee_payer];
    signers.extend_from_slice(other_signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .expect("Failed to build test transaction");
    let res = svm.send_transaction(tx);
    match res {
        Ok(_) => panic!(
            "\n❌ Signer Verification Failure!\n[{instruction_name}::{account_name}] Expected transaction to fail with AccountNotSigner (3010), but transaction succeeded!\n"
        ),
        Err(e) => assert_anchor_error(Err(e), anchor_lang::error::ErrorCode::AccountNotSigner),
    }
}

pub fn assert_signer_required(
    svm: &mut LiteSVM,
    ix: Instruction,
    signer_index: usize,
    expected_signer: &Pubkey,
    other_signers: &[&Keypair],
    instruction_name: &str,
    account_name: &str,
) {
    assert_signer_required_explicit(
        svm,
        ix,
        signer_index,
        expected_signer,
        other_signers,
        instruction_name,
        account_name,
    );
}

pub fn assert_signer_required_dynamic(
    svm: &mut LiteSVM,
    ix: Instruction,
    expected_signer: &Pubkey,
    instruction_name: &str,
) {
    let signer_index = ix
        .accounts
        .iter()
        .position(|acc| acc.pubkey == *expected_signer)
        .unwrap_or_else(|| {
            panic!(
                "[{instruction_name}] expected signer {expected_signer} not found in account metas"
            )
        });

    assert_signer_required_explicit(
        svm,
        ix,
        signer_index,
        expected_signer,
        &[],
        instruction_name,
        "signer",
    );
}

// ─── Event Verification Helpers ──────────────────────────────────────────────

/// Extract and decode all CPI events of type T (emitted via `emit_cpi!`) from transaction metadata.
pub fn parse_all_cpi_events<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> Vec<T> {
    let disc = T::DISCRIMINATOR;
    meta.inner_instructions
        .iter()
        .flat_map(|set| set.iter())
        .filter_map(|inner| {
            let data = &inner.instruction.data;
            if data.len() >= 16 && data[0..8] == ANCHOR_EVENT_IX_TAG && data[8..16] == disc[..] {
                let mut slice = &data[16..];
                T::deserialize(&mut slice).ok()
            } else {
                None
            }
        })
        .collect()
}

/// Extract and decode the first CPI event of type T from transaction metadata.
pub fn parse_cpi_event<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> Option<T> {
    parse_all_cpi_events::<T>(meta).into_iter().next()
}

/// Extract and decode all log events of type T (emitted via `emit!`) from transaction metadata.
pub fn parse_all_log_events<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> Vec<T> {
    let disc = T::DISCRIMINATOR;
    use anchor_lang::__private::base64::prelude::*;
    meta.logs
        .iter()
        .filter_map(|log| log.strip_prefix("Program data: "))
        .filter_map(|b64| BASE64_STANDARD.decode(b64.trim()).ok())
        .filter_map(|bytes| {
            if bytes.len() >= 8 && bytes[0..8] == disc[..] {
                let mut slice = &bytes[8..];
                T::deserialize(&mut slice).ok()
            } else {
                None
            }
        })
        .collect()
}

/// Extract and decode the first log event of type T from transaction metadata.
pub fn parse_log_event<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> Option<T> {
    parse_all_log_events::<T>(meta).into_iter().next()
}

/// Assert that a CPI event of type T was emitted and return its deserialized payload.
pub fn assert_cpi_event<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> T {
    parse_cpi_event::<T>(meta).unwrap_or_else(|| {
        panic!(
            "Expected CPI event '{}' in transaction metadata, but none was found.\nTransaction logs:\n{:#?}",
            std::any::type_name::<T>(),
            meta.logs
        )
    })
}

/// Assert that a Log event of type T was emitted and return its deserialized payload.
pub fn assert_log_event<T: Discriminator + AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> T {
    parse_log_event::<T>(meta).unwrap_or_else(|| {
        panic!(
            "Expected Log event '{}' in transaction metadata, but none was found.\nTransaction logs:\n{:#?}",
            std::any::type_name::<T>(),
            meta.logs
        )
    })
}

// ─── Math & Invariant Assertion Helpers ─────────────────────────────────────

/// Asserts that protocol fee and prize pot form a mathematically exact floor partition
/// of raw yield without duplicating integer division logic in test code.
pub fn assert_fee_partition_conserved(
    raw_yield: u64,
    fee_bps: u16,
    fee_collected: u64,
    prize_pot: u64,
) {
    // 1. Global Mass Conservation
    assert_eq!(
        fee_collected + prize_pot,
        raw_yield,
        "INV-SOLV-008 broken: fee ({fee_collected}) + prize_pot ({prize_pot}) != raw_yield ({raw_yield})"
    );

    // 2. Exact Floor Bounding via Cross-Multiplication: 0 <= (Y * B) - (F * 10_000) < 10_000
    let total_scaled_fee = (raw_yield as u128) * (fee_bps as u128);
    let collected_scaled_fee = (fee_collected as u128) * 10_000u128;
    assert!(
        collected_scaled_fee <= total_scaled_fee,
        "Fee overcharged: collected {fee_collected} but nominal share is {fee_bps} bps of {raw_yield}"
    );
    let fee_truncation_remainder = total_scaled_fee - collected_scaled_fee;
    assert!(
        fee_truncation_remainder < 10_000,
        "Fee undercharged: truncation remainder {fee_truncation_remainder} >= 10,000 (lost whole base unit)"
    );
}

/// Asserts that prize payout registry distribution matches configured prize tiers
/// with intra-tier equality, non-negative payouts, and bounded remainder dust.
pub fn assert_prize_tier_distribution(
    prize_pot: u64,
    tiers: &[anchor::PrizeTier],
    winners: &[anchor::Winner],
    winners_count: usize,
) {
    let mut total_distributed = 0u64;
    let mut winner_cursor = 0;

    for (tier_idx, tier) in tiers.iter().enumerate() {
        let n_winners = tier.num_winners as usize;
        assert!(
            winner_cursor + n_winners <= winners_count,
            "Winner count mismatch: cursor {winner_cursor} + tier winners {n_winners} > total winners {winners_count}"
        );
        let tier_slice = &winners[winner_cursor..winner_cursor + n_winners];
        winner_cursor += n_winners;

        let first_amount = tier_slice[0].amount_owed;

        // 1. Intra-Tier Homogeneity: Every winner in tier gets identical payout
        for (i, w) in tier_slice.iter().enumerate() {
            let actual_amount = w.amount_owed;
            assert_eq!(
                w.tier_index, tier_idx as u8,
                "Winner {i} has incorrect tier_index"
            );
            assert_eq!(
                actual_amount, first_amount,
                "Tier {tier_idx} winner {i} payout {actual_amount} != expected {first_amount}"
            );
        }

        let tier_total = first_amount * (n_winners as u64);
        total_distributed += tier_total;

        // 2. Cross-Multiplied Tier Remainder Bounding (No Division Mirroring):
        // 0 <= (prize_pot * bps * num_winners) - (tier_total * 10_000) < n_winners * 10_000
        let nominal_winner_pot = (prize_pot as u128) * (tier.basis_points as u128);
        let nominal_tier_pot = nominal_winner_pot * (n_winners as u128);
        let allocated_tier_pot = (tier_total as u128) * 10_000u128;
        assert!(
            allocated_tier_pot <= nominal_tier_pot,
            "Tier {tier_idx} over-allocated funds"
        );
        let tier_remainder = nominal_tier_pot - allocated_tier_pot;
        assert!(
            tier_remainder < (n_winners as u128) * 10_000u128,
            "Tier {tier_idx} truncation remainder {tier_remainder} exceeded per-winner unit bound"
        );
    }

    // 3. Global Conservation: Distributed + Dust == Prize Pot
    assert!(
        total_distributed <= prize_pot,
        "Total distributed ({total_distributed}) exceeds prize pot ({prize_pot})"
    );
    let dust = prize_pot - total_distributed;
    assert!(
        dust < 10_000,
        "Dust remainder ({dust}) exceeded 10,000 basis point limit"
    );
}

pub fn assert_ticket_registry_integrity(
    svm: &LiteSVM,
    registry_pda: Pubkey,
    expected_user_count: u32,
    expected_active_tickets: u32,
    expected_pending_tickets: u32,
) {
    let reg = read_ticket_registry(svm, registry_pda);

    assert_eq!(
        reg.user_count, expected_user_count,
        "Registry integrity: user_count mismatch"
    );
    assert_eq!(
        reg.total_active_tickets, expected_active_tickets,
        "Registry integrity: total_active mismatch"
    );
    assert_eq!(
        reg.total_pending_tickets, expected_pending_tickets,
        "Registry integrity: total_pending mismatch"
    );
    assert!(
        reg.user_count <= reg.capacity,
        "Registry integrity: user_count ({}) exceeds capacity ({})",
        reg.user_count,
        reg.capacity
    );
}
