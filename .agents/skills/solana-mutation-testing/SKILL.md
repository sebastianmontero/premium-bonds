---
name: solana-mutation-testing
description: Automated fault injection and mutation testing execution skill for Solana Anchor smart contracts and Web3 TypeScript apps. Orchestrates cargo-mutants, triages surviving mutants against domain invariants, detects pseudo-coverage, and synthesizes mutant-killing test assertions.
user-invocable: true
license: MIT
compatibility: Requires cargo-mutants, Rust toolchain, Anchor / LiteSVM, TypeScript / Node.js
metadata:
  author: Solana Security & Testing Team
  version: 1.0.0
---

# Solana Mutation Testing & Fault Injection Skill (`solana-mutation-testing`)

## What this Skill is for

Use this Skill when:

- **Empirically proving test suite sensitivity**: Proving whether existing tests actually catch semantic defects or merely pass due to loose assertions.
- **Executing Heavy-Duty Mutation Sweeps with `cargo-mutants`**: Running compilation-intensive mutation passes against targeted Anchor instructions (`anchor/programs/anchor/tests/*.rs`).
- **Triaging Surviving Mutants**: Analyzing why a mutated contract (e.g. flipped `<` to `<=`, deleted check, altered fee basis points) didn't cause tests to fail.
- **Synthesizing Mutant-Killing Test Patches**: Writing specific, high-precision assertions that kill surviving mutants without bloating the test suite.

---

## The Mutation Testing Concept

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              MUTATION TESTING CONCEPTS                                 │
├───────────────────────────────────┬────────────────────────────────────────────────────┤
│ KILLED MUTANT (Desired)           │ SURVIVING MUTANT (Defect Blindspot)                │
├───────────────────────────────────┼────────────────────────────────────────────────────┤
│ • Code mutation is injected       │ • Code mutation is injected                        │
│ • Test suite fails (catches bug)  │ • Test suite PASSES (green CI on buggy code!)      │
│ • Proves test validates intent    │ • Proves test is missing assertion or is coupled   │
└───────────────────────────────────┴────────────────────────────────────────────────────┘
```

---

## Step-by-Step Mutation Testing Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MUTATION TESTING EXECUTION LIFECYCLE                            │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ Select Target &  │──►│ Execute                │──►│ Triage          │──►│ Synthesize       │
│ Configure Filters│   │ cargo-mutants          │   │ Surviving       │   │ Mutant-Killing   │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

### Step 1: Select Target & Configure Filters

Avoid running mutation sweeps across the entire repository at once (which may take hours). Target specific instruction modules:

```bash
cd anchor
# Target a specific instruction file and its corresponding integration test
cargo mutants --file programs/anchor/src/instructions/yield_draw/harvest_yield_and_commit.rs \
              --test test_harvest_yield_and_commit
```

### Step 2: Execute `cargo-mutants`

`cargo-mutants` automatically:

1. Replaces operators (`+` $\rightarrow$ `-`, `>` $\rightarrow$ `>=`, `==` $\rightarrow$ `!=`).
2. Replaces return values (`Ok(())` $\rightarrow$ `Err(...)` or `0` $\rightarrow$ `1`).
3. Deletes guard statements (`require!(...)` removed).
4. Runs `cargo test` for each mutation.

### Step 3: Triage Surviving Mutants

Read `mutants.out/outcomes.json` or console log. Classify each surviving mutant into:

- **🔴 Critical Intent Blindspot:** Mutation violates a core business invariant (e.g. fee calculation skipped, pause check removed), but tests passed! $\rightarrow$ **Fix immediately**.
- **🟡 Equivalent Mutant:** Mutation alters code in a way that produces mathematically identical output (e.g. `x * 0` vs `0`). $\rightarrow$ **Ignore / add `#[mutants::skip]` comment**.

### Step 4: Synthesize Mutant-Killing Assertions

Write the minimal high-value assertion in the test suite that catches the surviving mutant (see [surviving-mutant-triage.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-mutation-testing/references/surviving-mutant-triage.md)).

---

## Progressive Disclosure References

- [cargo-mutants Configuration & Execution Guide](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-mutation-testing/references/cargo-mutants-configuration.md): Complete instructions for configuring `.cargo/mutants.toml`, timeout calibration, and job parallelization for Anchor/LiteSVM.
- [Surviving Mutant Triage & Patch Synthesis Playbook](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-mutation-testing/references/surviving-mutant-triage.md): Diagnostic matrix for classifying surviving mutants and generating mutant-killing test patches.
