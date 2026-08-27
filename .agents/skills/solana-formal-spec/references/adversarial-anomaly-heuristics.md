# Adversarial Anomaly Heuristics & Socratic Sifting Taxonomy

This reference document defines the 7-vector heuristic ruleset used by `solana-formal-spec` during brownfield code mining and reconciliation to detect suspicious logic, security flaws, and domain gaps.

---

## 1. The 3-Tier Impact Severity Rubric

To prevent alert fatigue while catching critical vulnerabilities, every code anomaly is classified by its objective impact:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               3-TIER SEVERITY RUBRIC                                   │
├──────────────┬──────────────────────────────────────────┬──────────────────────────────┤
│ Severity     │ Impact Criteria                          │ Socratic & Headless Action   │
├──────────────┼──────────────────────────────────────────┼──────────────────────────────┤
│ `CRITICAL`   │ • Direct vault deficit or solvency loss  │ • Interactive: Immediate     │
│              │ • Permanent state lockup / fund freeze   │   blocking Socratic prompt.  │
│              │ • Unauthorized administrative bypass     │ • Headless: Log UNRESOLVED,  │
│              │ • Arbitrary CPI program injection        │   apply Recommended safe fix.│
├──────────────┼──────────────────────────────────────────┼──────────────────────────────┤
│ `WARN`       │ • Zero-amount transaction silent accept  │ • Interactive: Batched in    │
│              │ • Missing oracle staleness window check  │   summary questionnaire.     │
│              │ • Unzeroed realloc / swap-and-pop memory │ • Headless: Log WARN, apply  │
│              │ • Missing custom error variant           │   recommended error code.    │
├──────────────┼──────────────────────────────────────────┼──────────────────────────────┤
│ `CODE_QUIRK` │ • Non-standard error naming              │ • Silent annotation in       │
│              │ • Harmless redundancy / dead variable    │   reconciliation report;     │
│              │ • Deprecated Anchor macro usage          │   no user interruption.      │
└──────────────┴──────────────────────────────────────────┴──────────────────────────────┘
```

---

## 2. The 7-Vector Anomaly Taxonomy

### Vector 1: Financial Math, Rounding & Solvency

| Code Pattern Detected                                             | Vulnerability / Domain Risk                                             |  Severity  | Socratic Translation Heuristic                                          |
| :---------------------------------------------------------------- | :---------------------------------------------------------------------- | :--------: | :---------------------------------------------------------------------- |
| `amount * fee_bps / 10000`                                        | Integer division truncation: small transactions pay 0 fees (`fee = 0`). | `CRITICAL` | Prompt user to enforce `ceil_div` or minimum 1-unit fee.                |
| `(gross_yield - fee)` with integer pot split                      | Truncation dust remainder unaccounted for, causing vault deficit drift. | `CRITICAL` | Prompt user to enforce dust retention in vault accounting.              |
| Unchecked arithmetic in balance updates (`balance - amount`)      | Math overflow / underflow panics or wrapping exploits.                  | `CRITICAL` | Prompt user to mandate `checked_sub` with custom error.                 |
| Modifying pricing while deposits exist (`bond_price = new_price`) | Dilutes or inflates existing ticket holders' principal backing.         | `CRITICAL` | Prompt user to strictly reject price modifications when deposits exist. |

---

### Vector 2: Finite State Machine & Lifecycle

| Code Pattern Detected                                                                  | Vulnerability / Domain Risk                                             |  Severity  | Socratic Translation Heuristic                                    |
| :------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :--------: | :---------------------------------------------------------------- |
| Draw frozen with external VRF commit but no expiration check                           | If oracle fails or hangs, deposits and withdrawals are frozen forever.  | `CRITICAL` | Prompt user to specify a permissionless 24h timeout unlock crank. |
| State transition lacking guard check (`pool.status = Active` without checking `Draft`) | Out-of-order state transitions (e.g. unpausing an already closed pool). | `CRITICAL` | Prompt user to enforce strict precondition status guards.         |
| Closing state account without checking zero active obligations                         | Funds or pending claims left orphaned upon account deallocation.        | `CRITICAL` | Prompt user to mandate `total_active == 0 && total_pending == 0`. |

---

### Vector 3: Access Control & Signer Delegation

| Code Pattern Detected                                                               | Vulnerability / Domain Risk                                                      |  Severity  | Socratic Translation Heuristic                                                 |
| :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :--------: | :----------------------------------------------------------------------------- |
| `pause_pool` allows Guardian, but `unpause_pool` lacks `admin_authority` constraint | Guardian could unpause without admin consensus, or arbitrary signer can unpause. | `CRITICAL` | Prompt user to confirm asymmetric access control (Admin strictly for unpause). |
| Admin instruction uses raw `Signer<'info>` without `key() == config.admin`          | Any wallet can execute privileged protocol operations.                           | `CRITICAL` | Prompt user to mandate explicit authority key constraint.                      |
| User winnings payout without verifying `beneficiary == signer.key()`                | Attacker claims another user's settled winnings or redemption.                   | `CRITICAL` | Prompt user to mandate beneficiary signer matching.                            |

---

### Vector 4: Boundary Conditions & Zero-Value Operations

| Code Pattern Detected                                                      | Vulnerability / Domain Risk                                                  | Severity | Socratic Translation Heuristic                                     |
| :------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :------: | :----------------------------------------------------------------- |
| Handler checks `if amount == 0 { return Ok(()); }`                         | Silent success on zero amount; risks indexer confusion and transaction spam. |  `WARN`  | Prompt user to enforce strict rejection (`ErrorCode::ZeroAmount`). |
| Fee percentage accepted up to `u64::MAX` without `<= 10000` (100%) check   | Admin can accidentally configure 1000% fee, draining all funds.              |  `WARN`  | Prompt user to mandate upper bound `fee_bps <= 10000`.             |
| Winner index parameter not checked against `payout_registry.total_winners` | Out-of-bounds array access or uninitialized slot claim.                      |  `WARN`  | Prompt user to mandate `require_gt!(total_winners, idx)`.          |

---

### Vector 5: Time, Oracles & Monotonicity

| Code Pattern Detected                                       | Vulnerability / Domain Risk                                              |   Severity   | Socratic Translation Heuristic                                        |
| :---------------------------------------------------------- | :----------------------------------------------------------------------- | :----------: | :-------------------------------------------------------------------- |
| Relying on `unix_timestamp` for sub-minute draw commits     | Timestamp drift (validators can drift unix timestamp by minutes).        |    `WARN`    | Prompt user to evaluate slot-based monotonicity for critical lockups. |
| Oracle query lacking `max_age` or confidence interval check | Stale or manipulated price feeds accepted during network congestion.     |    `WARN`    | Prompt user to mandate staleness bound (e.g. `max_age = 60s`).        |
| Timelock elapsed check using `>` instead of `>=`            | 1-second edge-case mismatch between on-chain execution and off-chain UI. | `CODE_QUIRK` | Align specification to `>=` boundary.                                 |

---

### Vector 6: Storage, Realloc & Memory Safety

| Code Pattern Detected                                                             | Vulnerability / Domain Risk                                   |  Severity  | Socratic Translation Heuristic                                            |
| :-------------------------------------------------------------------------------- | :------------------------------------------------------------ | :--------: | :------------------------------------------------------------------------ |
| Full exit via swap-and-pop decrements `user_count` without zeroing tail memory    | Dirty byte resurrection if registry is resized or re-indexed. |   `WARN`   | Prompt user to mandate zeroing out tail entry bytes.                      |
| `realloc` with `zero = false` on zero-copy user entries                           | Uninitialized memory reads exposing stale buffer bytes.       |   `WARN`   | Prompt user to mandate zero-initialization or verified write-before-read. |
| Custom account closure transferring lamports without setting closed discriminator | Same-slot revival attack bypasses initialization check.       | `CRITICAL` | Prompt user to mandate `CLOSED_ACCOUNT_DISCRIMINATOR` write.              |

---

### Vector 7: CPI & Signer Forwarding

| Code Pattern Detected                                        | Vulnerability / Domain Risk                                                           |  Severity  | Socratic Translation Heuristic                                          |
| :----------------------------------------------------------- | :------------------------------------------------------------------------------------ | :--------: | :---------------------------------------------------------------------- |
| CPI to `token_program` accepted as raw `UncheckedAccount`    | Attacker passes fake token program that returns success without transferring tokens.  | `CRITICAL` | Prompt user to mandate `token_program.key() == spl_token::ID`.          |
| PDA signer seeds forwarded to untrusted external program CPI | Untrusted target program can invoke third-party programs with vault signer authority. | `CRITICAL` | Prompt user to isolate PDA signers strictly to trusted target programs. |
| Missing remaining account validation in multi-account cranks | Attacker substitutes attacker-owned PDA for victim's account during batching.         | `CRITICAL` | Prompt user to mandate address derivation check on remaining accounts.  |
