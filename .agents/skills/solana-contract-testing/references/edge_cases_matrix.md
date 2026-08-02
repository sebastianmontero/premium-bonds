# Edge Case Matrix for Solana Anchor Smart Contract Testing

| Category | Vulnerability / Edge Case Target | Test Input / Setup Strategy | Expected Result / Assertion |
| :--- | :--- | :--- | :--- |
| **Numeric** | Zero Amount Transfer / Deposit | Set `amount = 0` in instruction data. | Program returns error `ConstraintRaw` or custom `ErrorCode::InvalidAmount`. |
| **Numeric** | Integer Overflow / Checked Math | Set `amount = u64::MAX`, add 1 in protocol math. | Unchecked math panics in SBF or checked math returns `ErrorCode::MathOverflow`. |
| **Numeric** | Dust Amount Fee Evasion | Set `amount = 1`, fee bps = 100 (1%). Calculation: `(1 * 100) / 10,000 = 0`. | Program must round fee UP to 1 unit or enforce minimum transfer threshold. |
| **Numeric** | First Depositor Vault Inflation | 1. Initialize vault. 2. Deposit 1 token. 3. Direct transfer 1M tokens to ATA. 4. User 2 deposits 500k tokens. | User 2 receives non-zero shares proportional to deposit or initial deposit requires minimum burn. |
| **Access** | Missing Signer Check | Replace `Signer<'info>` account with non-signing keypair. | Anchor framework returns `AccountNotSigner` error code (3010). |
| **Access** | Authority Substitution | Pass User A's signature to modify User B's vault struct. | Anchor returns `ConstraintHasOne` (2001) or custom `ErrorCode::Unauthorized`. |
| **Access** | Non-Canonical PDA Bump | Pass bump = canonical_bump - 1 or explicit off-curve bump. | Anchor returns `ConstraintSeeds` (2006) or custom `ErrorCode::InvalidBump`. |
| **Access** | Program Identity Spoofing | Pass a fake token program or fake Pyth oracle pubkey. | Anchor returns `ConstraintExecutable` or `ConstraintAddress` / `InvalidProgramId`. |
| **Lifecycle** | Double Initialization | Invoke `initialize` on an already populated PDA / account. | Anchor returns `AccountDiscriminatorAlreadyInitialized` (3008). |
| **Lifecycle** | Post-Closure Execution | Invoke instruction passing a closed account's pubkey in the same slot. | SVM returns `AccountNotFound` or Anchor returns `AccountDiscriminatorNotFound`. |
| **Lifecycle** | Realloc Memory Leak | Reallocate struct to larger space with `realloc::zero = false`. | Verify trailing data bytes do not contain residual state from previous allocations. |
| **Time/Sysvar** | Retroactive Clock Jump | Set `clock.unix_timestamp = 0` or jump timestamp backward by 1 year. | Protocol lockup checks fail safely or throw `ErrorCode::InvalidTimestamp`. |
| **Time/Sysvar** | Boundary Condition Match | Set `clock.unix_timestamp = lockup_end - 1` vs `lockup_end` vs `lockup_end + 1`. | `lockup_end - 1` fails; `lockup_end` and `lockup_end + 1` succeed. |
| **Token-2022** | Transfer Fee Calculation | Test deposit/withdraw with Token-2022 mint containing transfer fee extension. | Vault balance correctly accounts for net token received after transfer fee subtraction. |
