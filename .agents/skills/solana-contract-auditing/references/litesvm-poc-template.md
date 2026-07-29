# LiteSVM Proof of Concept (PoC) Reproduction Guide & Template

This reference provides a practical guide and boilerplate template for building deterministic Proof of Concept (PoC) unit/integration tests using **LiteSVM** in Rust (`cargo test`).

---

## Why LiteSVM for Vulnerability Reproduction?

1. **Speed**: LiteSVM executes Solana Bytecode (eBPF) directly in-process without spinning up a full `solana-test-validator` cluster.
2. **Determinism**: Slot clock, sysvars, account balances, and signatures can be explicitly manipulated to isolate exact edge cases.
3. **Low Overhead**: Runs directly within `cargo test`, making it easy to run, automate, and check in CI pipelines.

---

## 1. Typical Project Structure for LiteSVM PoC Tests

In an Anchor repository, LiteSVM unit/integration tests reside inside `tests/` or `anchor/tests/`:

```
anchor/
├── Cargo.toml
├── programs/
│   └── my_program/
│       └── src/
└── tests/
    ├── common/
    │   └── mod.rs          # Shared LiteSVM setup helpers
    └── poc_vulnerability.rs # Minimal reproducing test case
```

---

## 2. Standard LiteSVM Test Setup Boilerplate

Here is a standard template for writing a reproducing PoC test case in Rust using LiteSVM and Anchor instruction builders:

```rust
#[cfg(test)]
mod tests {
    use litesvm::LiteSVM;
    use solana_sdk::{
        account::Account,
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::{Keypair, Signer},
        transaction::Transaction,
        system_program,
    };
    use anchor_lang::{InstructionData, ToAccountMetas};

    // Replace with your compiled program ID and Instruction Account Structs
    const PROGRAM_ID: Pubkey = Pubkey::new_from_array([1u8; 32]);

    fn setup_svm() -> (LiteSVM, Keypair) {
        let mut svm = LiteSVM::new();
        let payer = Keypair::new();

        // Airdrop SOL to payer account for transaction fees and rent
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

        // Add compiled program binary to LiteSVM environment
        // Program SBF binary is usually compiled to target/deploy/my_program.so
        let program_bytes = include_bytes!("../../target/deploy/my_program.so");
        svm.add_program(PROGRAM_ID, program_bytes);

        (svm, payer)
    }

    #[test]
    fn test_poc_reproduce_unauthorized_withdraw_vulnerability() {
        let (mut svm, payer) = setup_svm();

        // 1. Setup Victim & Attacker Keypairs
        let victim = Keypair::new();
        let attacker = Keypair::new();

        svm.airdrop(&victim.pubkey(), 2_000_000_000).unwrap();
        svm.airdrop(&attacker.pubkey(), 2_000_000_000).unwrap();

        // 2. Derive PDA / Setup initial vulnerable state
        let (vault_pda, bump) = Pubkey::find_program_address(
            &[b"vault", victim.pubkey().as_ref()],
            &PROGRAM_ID,
        );

        // Execute Initialize Instruction for Victim's Vault...
        // (Build & send initial transaction via svm.send_transaction)

        // 3. Craft Adversarial Instruction (Attacker attempts to drain Victim's Vault)
        // Pass attacker as signer, but victim's vault_pda as target vault
        let attacker_withdraw_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(vault_pda, false),             // Target vault owned by victim
                AccountMeta::new(attacker.pubkey(), true),     // Attacker signs!
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: my_program::instruction::Withdraw { amount: 1_000_000_000 }.data(),
        };

        let tx = Transaction::new_signed_with_payer(
            &[attacker_withdraw_ix],
            Some(&attacker.pubkey()),
            &[&attacker],
            svm.latest_blockhash(),
        );

        // 4. Send Adversarial Transaction
        let res = svm.send_transaction(tx);

        // 5. ASSERT VULNERABILITY STATUS:
        // FOR UNFIXED VULNERABLE CODE: The transaction SUCCEEDS when it should fail!
        // Assert that the attacker was able to drain funds or corrupt state:
        assert!(
            res.is_ok(),
            "Vulnerability PoC Failed: Attack expected to succeed on vulnerable contract!"
        );

        println!("PoC Confirmed: Attacker successfully drained victim vault!");
    }

    #[test]
    fn test_verify_vulnerability_remediated() {
        let (mut svm, payer) = setup_svm();
        // ... (Same setup as above)

        // AFTER APPLYING FIX:
        // The fixed contract must REJECT the adversarial transaction with an explicit Anchor Error Code!
        // Expected Error: ConstraintHasOne or ConstraintRaw
        /*
        let res = svm.send_transaction(tx);
        assert!(res.is_err(), "Fix Verification Passed: Adversarial tx rejected as expected!");
        */
    }
}
```

---

## 3. Step-by-Step PoC Execution Workflow

1. **Step 1: Write the Failing Test (Attacker Wins)**
   - Execute `NO_DNA=1 cargo test test_poc_reproduce_... -- --nocapture`.
   - Confirm that the attack succeeds on unpatched contract code.

2. **Step 2: Apply the Smart Contract Fix in Rust (`anchor/programs/src/lib.rs`)**
   - Update Anchor account constraints (e.g., add `#[account(has_one = authority)]` or `#[account(seeds = [...], bump)]`).

3. **Step 3: Verify Fix with PoC Test (Attacker Fails)**
   - Re-run `NO_DNA=1 cargo test test_poc_reproduce_...`.
   - Verify that the transaction is now **rejected** by the SVM with the exact expected Anchor custom error code.

4. **Step 4: Run Full Test Suite**
   - Execute `NO_DNA=1 cargo test` across all integration tests to ensure valid legitimate workflows continue to work cleanly.
