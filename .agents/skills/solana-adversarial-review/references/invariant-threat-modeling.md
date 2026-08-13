# Invariant Threat Modeling & Protocol Attack Surface Mapping

This guide provides a formal framework for identifying protocol invariants, mapping attack surfaces, and executing adversarial threat models on Solana protocols.

---

## 1. Defining Protocol Invariants

A **Protocol Invariant** is a condition that must ALWAYS hold true across every state transition and every transaction slot. If an attacker can force a state transition where an invariant is broken, a security flaw exists.

### Common Protocol Invariant Types

| Invariant Category         | Description                                                                                             | Formal Statement                                                                                              |
| :------------------------- | :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| **Solvency Invariant**     | Total assets held in protocol vaults must equal or exceed total liabilities owed to users.              | $\text{VaultBalance} \ge \sum \text{UserDeposits}$                                                            |
| **Authority Invariant**    | Critical protocol configuration or admin functions can only be invoked by designated authority signers. | $\text{ctx.accounts.authority.key} == \text{config.admin} \land \text{is\_signer}$                            |
| **Monotonicity Invariant** | Sequence counters, reward accumulators, and global nonces must only move monotonically upwards.         | $\text{state.nonce}_{t+1} > \text{state.nonce}_t$                                                             |
| **Conservation of Value**  | The total mint/burn of shares must strictly reflect proportional underlying collateral changes.         | $\frac{\Delta \text{Shares}}{\text{TotalShares}} \le \frac{\Delta \text{Collateral}}{\text{TotalCollateral}}$ |
| **Domain Separation**      | PDAs generated for purpose A must never collide with or be usable as PDAs for purpose B.                | $\text{PDA}_A \neq \text{PDA}_B \quad \forall \, \text{inputs}$                                               |

---

## 2. Adversarial Hypothesis Matrix Formulation

To uncover non-obvious vulnerabilities, systematically invert assumptions for each instruction:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          INVARIANT THREAT INVERSION MATRIX                             │
├───────────────────┬──────────────────────────────────┬─────────────────────────────────┤
│ Standard Assumption│ Adversarial Inversion             │ Potential Exploit Vector        │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ "User passes 2    │ "What if user passes the SAME    │ Duplicate Account Injection     │
│ distinct accounts"│ account twice?"                  │ (Double withdrawal/crediting)   │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ "Account close    │ "What if user refunds the account│ Account Revival in same slot    │
│ erases state"     │ in the same slot?"               │ bypassing initialization checks │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ "CPI targets SPL  │ "What if target program is a     │ Signer Forwarding Leakage /     │
│ Token program"    │ malicious custom contract?"      │ Fake Program Injection          │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ "Token transfer   │ "What if Token-2022 Transfer Hook│ CPI Reentrancy / State Mutation │
│ is instantaneous" │ executes external code?"         │ before internal state updates   │
├───────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ "Math division    │ "What if input is micro-amount   │ Truncation to zero / Fee bypass │
│ truncates slightly"│ causing result to be 0?"         │ or dust extraction              │
└───────────────────┴──────────────────────────────────┴─────────────────────────────────┘
```

---

## 3. Systematic Attack Surface Mapping Steps

1. **Parse `#[derive(Accounts)]` Contexts**:
   - Verify every account type (`Account`, `Signer`, `Program`, `UncheckedAccount`).
   - Flag any `UncheckedAccount` lacking manual owner, key, or discriminator check.
   - Flag any `mut` account lacking authority ownership checks (`has_one` or `seeds`).

2. **Inspect Cross-Program Invocations (CPIs)**:
   - Identify all `invoke` and `invoke_signed` calls.
   - Ensure target program keys are hard-checked against constant program IDs.
   - Verify whether PDA signers are passed to user-controlled programs.

3. **Inspect Financial Math & State Transitions**:
   - Check every arithmetic operator (`+`, `-`, `*`, `/`). Ensure safe checked arithmetic or math libraries (e.g. `spl-math`) are used.
   - Verify rounding directions: **Fees round UP**, **Payouts round DOWN**.
   - Check for ERC4626 vault share inflation / first-depositor attack surface.

4. **Verify Oracle Integrations**:
   - Verify Pyth/Switchboard timestamp/slot staleness checks (`max_age`).
   - Verify confidence interval threshold validation (`confidence / price`).
   - Check for price manipulation via flash loans or low-liquidity spot pools.
