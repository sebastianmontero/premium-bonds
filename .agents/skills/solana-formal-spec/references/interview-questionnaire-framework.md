# Interactive Interview Questionnaire Framework

This reference document defines standard multiple-choice decision templates for the interactive interview mode in `solana-formal-spec`.

---

## 1. Interview Principles & Guidelines

When conducting a clarification interview with the user:

1. **Never ask open-ended or ambiguous questions without structure.** Always provide concrete options with explicit trade-offs.
2. **Always list the `(Recommended)` option first**, explaining why it adheres to Solana security standards, protocol solvency, or industry best practices.
3. **Format options as direct user responses** so the user can easily choose by selecting or typing the option number/letter.
4. **Group related questions logically** into batches of 2–3 questions to prevent cognitive overload.

---

## 2. Standard Questionnaire Templates by Vector

### A. Financial Math, Rounding & Solvency

#### Question: Integer Division & Rounding Direction

> **Context:** When splitting gross harvested yield between protocol fees and the net prize pool, integer division may produce non-zero dust remainders (e.g. `100 * 500 / 10000`). How should rounding be handled?
>
> 1. `(Recommended) Round user payout down and round protocol fee up` — Guarantees that total payouts never exceed available vault balance, preserving protocol solvency.
> 2. `Round half up (standard arithmetic rounding)` — Symmetric rounding; requires dust tolerance buffering in vault accounting.
> 3. `Round protocol fee down and credit remainder to prize pool` — Maximize user prize payouts at the expense of minor treasury truncation.

#### Question: Zero & Dust Amount Handling

> **Context:** A user attempts to submit a deposit, bond purchase, or withdrawal with an amount of `0` or `1` atomic token unit.
>
> 1. `(Recommended) Strictly reject zero-amount transactions with ErrorCode::InvalidBondQuantity / ZeroAmount` — Eliminates zero-share minting exploits, state bloat, and no-op transaction spam.
> 2. `Treat zero-amount as a successful no-op (return Ok(()))` — Silent success; risks confusing client indexers and consuming block space.
> 3. `Allow 1 atomic unit deposits but enforce minimum fee rounding of 1 unit` — Prevents fee evasion on dust deposits.

---

### B. Time Windows, Randomness & Oracles

#### Question: Crank Randomness Timeout & Pool Unlocking

> **Context:** A prize draw commits to an external randomness feed (e.g. Switchboard), freezing pool deposits. If the oracle goes offline or fails to fulfill randomness within the expected window, how should the system recover?
>
> 1. `(Recommended) Permissionless crank timeout after 24 hours allowing pool re-binding / draw unlock` — Any user can crank an unlock transaction once the deadline expires, preventing permanent fund freeze.
> 2. `Admin multisig force-unlock only (privileged emergency instruction)` — Only protocol authority can unfreeze; introduces centralized trust dependency.
> 3. `Automatic roll-over to next draw cycle without unlocking` — Skips the draw and adds accrued yield to the subsequent cycle.

#### Question: Draw Commit-to-Reveal Lockup Window

> **Context:** To prevent frontrunning and MEV manipulation of ticket positions after randomness is requested:
>
> 1. `(Recommended) Strictly freeze all bond deposits and redemptions immediately upon draw commit until winners are finalized` — Eliminates ticket sniping and ensures a deterministic snapshot of active tickets.
> 2. `Allow deposits during draw commit but exclude new tickets from the current cycle (mark as pending)` — Users can deposit continuously, but tickets only activate in cycle $N+1$.
> 3. `Allow instant unfreeze if draw is canceled before reveal` — Fast rollback if oracle is unavailable.

---

### C. Access Control & Authority Delegation

#### Question: Admin Fee Extraction & Multisig Delegation

> **Context:** When withdrawing accrued protocol fees from the fee treasury:
>
> 1. `(Recommended) Require designated fee_authority signer with direct transfer to pre-configured fee_wallet token account` — Prevents arbitrary destination account injection and limits compromised key impact.
> 2. `Allow global admin to withdraw fees to any arbitrary recipient token account` — Flexible treasury management; higher security risk if admin key is compromised.

---

### D. Emergency Circuit Breakers & Invariant Violations

#### Question: Automated Solvency Circuit Breaker

> **Context:** During yield harvesting, the on-chain instruction queries the external lending venue (e.g. Huma / Kamino). If the venue's reported token balance is less than the protocol's book value (deficit > dust tolerance):
>
> 1. `(Recommended) Automatically halt the pool, mark draw cycle as HaltedInsolvent, and emit EmergencyInsolvencyDetected` — Protects user principal by immediately stopping further operations.
> 2. `Emit a warning event but continue normal draw execution` — Prioritizes liveness over safety; risks distributing unbacked yield.

---

## 3. Spec-Code Discrepancy & Code Anomaly Question Templates

When the Adversarial Sifter flags a suspicious pattern during brownfield mining or reconciliation, use these templates to format the user interview:

### Template 1: Critical Arithmetic / Truncation Anomaly

> **Context:** In `[harvest_yield_and_commit.rs#L42](file:///path/to/file#L42)`, protocol fee calculation uses integer division `amount * fee_bps / 10000`. For small yield amounts ($< \$1.00$), this evaluates to `0` fee, allowing fee evasion.
>
> 1. `(Recommended) Mandate ceil_div / minimum 1-unit fee in spec and log bug issue for contract` — Ensures mathematical solvency and fee integrity across all transaction sizes.
> 2. `Accept current code behavior (zero-fee on dust) as intentional domain design` — Document that small yield amounts are exempt from protocol fees.
> 3. `Specify minimum gross yield threshold before harvesting is permitted` — Only allow harvesting if gross yield exceeds threshold.

### Template 2: Asymmetric Access Control Discrepancy

> **Context:** In `[pool_lifecycle.rs#L85](file:///path/to/file#L85)`, `pause_pool` allows Guardian or Admin, but `unpause_pool` only checks `signer.is_signer` without validating `admin_authority`.
>
> 1. `(Recommended) Mandate strict Admin authority check for unpause_pool in spec and flag code vulnerability` — Prevents arbitrary callers or compromised guardians from unpausing halted pools.
> 2. `Accept symmetric Guardian unpause permission as intended` — Update spec to allow Guardian to unpause.

### Template 3: Memory Safety / Unzeroed Realloc Slot

> **Context:** In `[sell_bonds.rs#L120](file:///path/to/file#L120)`, complete exit via swap-and-pop decrements `user_count` but leaves vacated tail entry memory intact.
>
> 1. `(Recommended) Mandate explicit zeroing of vacated tail entry bytes in spec and log remediation` — Eliminates dirty byte resurrection risks when new users occupy vacated slots.
> 2. `Accept non-zeroed tail memory with verified overwrite-on-allocate invariant` — Document that new user allocation must completely overwrite entry bytes.
