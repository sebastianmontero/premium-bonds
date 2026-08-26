---
name: solana-formal-spec
description: Single source of truth domain specification and formal invariant extraction skill for Solana & Web3 protocols. Extracts invariants, state transitions, conservation laws, and metamorphic relations from ADRs, PRDs, specs, and docs without reading implementation code, and interactively resolves gaps with user-friendly multiple-choice interviews.
user-invocable: true
license: MIT
compatibility: Requires markdown environment, Node.js / Rust toolchain
metadata:
  author: Solana Security & Testing Team
  version: 1.0.0
---

# Solana Formal Specification & Invariant Extraction Skill (`solana-formal-spec`)

## What this Skill is for

Use this Skill when:

- **Extracting a formal Single Source of Truth (SSOT)** domain specification from `docs/adr/`, `CONTEXT.md`, PRDs, whitepapers, mathematical formulas, or GitHub issues.
- **Enforcing strict Zero-Code Isolation (Clean-Room Phase 1)**: Formulating domain expectations, state transitions, and invariants _without_ peeking at program source code (`anchor/programs/` or `app/`) to eliminate implementation confirmation bias.
- **Conducting User-Friendly Clarification Interviews**: Resolving domain ambiguities, unstated edge cases, and architectural trade-offs using structured multiple-choice questions with recommended defaults.
- **Generating Machine-Verifiable Invariant Records**: Producing standardized markdown invariant catalogs (`docs/specs/invariants-<feature>.md`) tagged with 7-Vector Edge Case categories for downstream consumption by `solana-test-auditor` and property-testing suites.

---

## Operating Modes

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPERATING MODES                                          │
├───────────────────────────────────┬────────────────────────────────────────────────────┤
│ INTERACTIVE INTERVIEW MODE        │ HEADLESS / BATCH MODE                              │
├───────────────────────────────────┼────────────────────────────────────────────────────┤
│ • Used during interactive chat    │ • Used in automated CI, scripts, or batch agents   │
│ • Detects ambiguities in docs     │ • Emits formal spec with known rules               │
│ • Presents multiple-choice prompts│ • Logs unresolved ambiguities as structured issues │
│ • User selects preferred behavior │ • Writes questions to `CONTEXT.md` open items      │
└───────────────────────────────────┴────────────────────────────────────────────────────┘
```

---

## Step-by-Step Execution Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SPECIFICATION EXTRACTION LIFECYCLE                              │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ Ingest Specs     │──►│ Gap & Ambiguity        │──►│ User-Friendly   │──►│ Emit Canonical   │
│ (Zero-Code)      │   │ Identification         │   │ Interview       │   │ Invariant Spec   │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

### Step 1: Ingest Documentation (Zero-Code Black-Box Rule)

- **Ingest ONLY:** `README.md`, `CONTEXT.md`, `docs/adr/*.md`, `docs/agents/domain.md`, PRDs, math specifications, and interface definitions (IDL / type definitions only).
- **STRICT RULE:** Do **NOT** read `anchor/programs/**` or `app/**` implementation logic. The specification must describe _what should happen_, not _what the current code happens to do_.

### Step 2: Identify Invariants, State Transitions, and Ambiguities

Scan the documentation and formulate:

1. **Global Conservation Laws:** System-wide equations that must hold across all transactions (e.g., Solvency: $\text{VaultBalance} \ge \sum \text{Principal} + \text{UnclaimedPrizes}$).
2. **State Transition Rules:** Preconditions, actions, and postconditions for every lifecycle state (`Draft` $\rightarrow$ `Active` $\rightarrow$ `Frozen` $\rightarrow$ `Harvested` $\rightarrow$ `Completed`).
3. **Negative Boundary Conditions:** What must fail when inputs are out of range, callers are unauthorized, or time windows expire.
4. **Ambiguity Gaps:** Underspecified requirements (e.g. integer rounding direction, crank timeout fallback, dust balance handling).

### Step 3: Interactive Clarification Interview

For every identified ambiguity or gap:

- Use the **Multiple-Choice Interview Framework** (see [interview-questionnaire-framework.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/interview-questionnaire-framework.md)).
- Always provide:
  - Concise problem context.
  - 2–4 clear options formatted as direct user choices.
  - Prefix the safest/standard pattern with `(Recommended)`.
  - Concise trade-off explanation for each option.

_Example Prompt Format:_

> **Question:** In the yield harvesting instruction, if gross harvested yield calculation produces an odd atomic unit with a 5% fee (e.g. 15 atomic units), how should integer division truncation be handled?
>
> 1. `(Recommended) Round down user prize payout and round up protocol fee` — Guarantees protocol solvency and prevents vault dust undercollateralization.
> 2. `Standard integer truncation (round down both)` — Leaves 1 atomic unit of unclaimed dust in the vault.
> 3. `Round down protocol fee and credit remainder to prize pool` — Favors participants over treasury.

### Step 4: Emit Canonical Invariant Specification

Write the final structured specification to `docs/specs/invariants-<feature>.md` using the canonical Invariant Record schema.

---

## Canonical Invariant Schema

Every extracted invariant must conform to the 8-tuple Invariant Record:

```typescript
interface InvariantRecord {
  id: string; // Unique ID: INV-<DOMAIN>-<NUMBER> (e.g. INV-POOL-001)
  domain: string; // Subsystem / Module (e.g. "Yield Draw / Commitment")
  vectorTag: VectorCategory; // 'Boundary' | 'Lifecycle' | 'Access' | 'Math' | 'Realloc' | 'Time' | 'CPI'
  precondition: string; // System state required prior to invocation
  action: string; // Instruction or operation invoked
  postcondition: string; // Observable state mutation upon success
  conservationLaw?: string; // Algebraic invariant that must remain balanced
  metamorphicRelation?: string; // Relational property across multiple inputs/runs
  expectedErrors: string[]; // Specific custom error codes for negative boundary inputs
}
```

---

## Downstream Skill Integration

- **`solana-test-auditor`**: Consumes `docs/specs/invariants-*.md` to build the Clean-Room Traceability Matrix, flag missing test coverage, and generate LiteSVM test stubs.
- **`solana-test-smells`**: Audits test code quality to ensure test assertions verify the postconditions and conservation laws specified here, rather than internal implementation scratchpads.
- **`solana-mutation-testing`**: Uses the invariant boundaries to evaluate whether surviving mutants violate core domain rules.

---

## Progressive Disclosure References

- [Canonical Invariant Record Schema & Catalog Template](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/invariant-record-schema.md): Complete schema definitions, markdown catalog template, and sample Solana invariants.
- [Interactive Interview Questionnaire Framework](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/interview-questionnaire-framework.md): Pre-built decision questionnaires for Solana/DeFi edge cases (rounding, time windows, fee structures, circuit breakers).
