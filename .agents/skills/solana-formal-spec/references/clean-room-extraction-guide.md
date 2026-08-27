# Clean-Room Formal Specification Extraction Guide (Mode 1: `clean-room`)

This reference document defines the complete zero-code black-box workflow for extracting formal domain specifications from documentation, ADRs, and PRDs without peeking at program source code.

---

## 1. The Clean-Room Doctrine (Phase 1 Isolation)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CLEAN-ROOM SPECIFICATION CONTEXT BOUNDARY                       │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ INGESTED IN SPEC CONTEXT (PERMITTED)   │ STRICTLY EXCLUDED FROM CONTEXT (FORBIDDEN)    │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ • Architecture Decision Records (ADRs) │ • Smart contract source files                 │
│   (`docs/adr/*.md`)                    │   (`anchor/programs/anchor/src/**`)           │
│ • Domain Context & Specifications      │ • Frontend / client implementation logic      │
│   (`CONTEXT.md`, `README.md`)          │   (`app/**`, `packages/**`)                   │
│ • PRDs, Whitepapers, Math Models       │ • Integration / unit test implementation code │
│ • High-level IDL / Type definitions    │                                               │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Why strict exclusion matters in Mode 1:** If the specification author reads the program implementation code, they risk suffering from **Confirmation Bias**—accepting a developer's mistaken logic or off-by-one arithmetic as the intended business requirement. Clean-room specification ensures that the spec describes **what the protocol SHOULD do**, not what the current code happens to do.

---

## 2. Step-by-Step Clean-Room Execution Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          CLEAN-ROOM EXTRACTION LIFECYCLE                               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ Ingest Docs      │──►│ Gap & Ambiguity        │──►│ Socratic        │──►│ Emit Canonical   │
│ (Zero-Code)      │   │ Identification         │   │ Interview       │   │ Invariant Spec   │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

### Step 1: Ingest Documentation

- Scan and ingest only high-level documentation: `README.md`, `CONTEXT.md`, `docs/adr/*.md`, `docs/agents/domain.md`, PRDs, mathematical whitepapers.
- Enforce the zero-code boundary: never open or search `anchor/programs/**` or `app/**`.

### Step 2: Formulate Invariants & State Machines

Formulate the four core pillars of the specification:

1. **Global Conservation Laws (`GlobalConservationInvariant`):** System-wide mathematical conservation laws (e.g. Solvency: Vault balance $\ge$ Liabilities).
2. **Dual Finite State Machines (FSMs):**
   - High-level Pool Lifecycle FSM (`Draft` $\to$ `Active` $\to$ `Paused` $\to$ `Closed`).
   - Draw / Yield Pipeline FSM (`Draft` $\to$ `AwaitingRandomness` $\to$ `Completed` $\to$ `Voided`).
3. **Instruction State Transition & Boundary Invariants (`InstructionTransitionInvariant`):** Preconditions, actions, postconditions, and expected error variants.
4. **Metamorphic Relations (`MetamorphicRelationInvariant`):** Relational transformations (scale invariance, batch equivalence, commutativity).

### Step 3: Socratic Clarification Interview

For every unstated requirement, rounding decision, or timeout edge case identified:

- Consult [interview-questionnaire-framework.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/interview-questionnaire-framework.md).
- Present structured multiple-choice questions with `(Recommended)` defaults and concise trade-offs.
- In **Headless / Batch Mode**: Apply the `(Recommended)` default and log the decision in the Resolved Architectural Decisions Matrix.

### Step 4: Emit Canonical Specification Catalog

- Format all extracted records using the Discriminated Union schema in [invariant-record-schema.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/invariant-record-schema.md).
- Mark:
  - `provenance: 'docs_canonical'` (or `'user_resolved'` if decided via interview)
  - `codeConformance: 'UNCHECKED'` (since code was not audited)
- Write output to `docs/specs/invariants-<feature>.md`.
