---
name: solana-formal-spec
description: Single source of truth domain specification, code mining, and formal invariant extraction skill for Solana & Web3 protocols. Extracts and reconciles invariants, state transitions, conservation laws, and metamorphic relations across Greenfield (Clean-Room docs-only), Brownfield (Two-Pass Code Mining), and Reconciliation (Spec-Code Sync & Drift Detection) workflows.
user-invocable: true
license: MIT
compatibility: Requires markdown environment, Node.js / Rust toolchain
metadata:
  author: Solana Security & Testing Team
  version: 2.0.0
---

# Solana Formal Specification & Invariant Extraction Skill (`solana-formal-spec`)

## Overview & Operational Modes

`solana-formal-spec` is the protocol's Single Source of Truth (SSOT) specification engine. It operates in **three distinct modes** depending on project maturity and developer intent:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPERATIONAL MODES ROUTER                                 │
├──────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ Mode                 │ Input Context                 │ Primary Output Target           │
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 1. `clean-room`      │ Docs, ADRs, PRDs ONLY         │ `docs/specs/invariants-*.md`    │
│    (Greenfield)      │ (Strict Zero-Code Isolation)  │                                 │
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 2. `brownfield-mining`│ Smart contracts + partial docs│ `docs/specs/invariants-*.md`    │
│    (Reverse Engine)  │ (Two-Pass Socratic Sifting)   │ `docs/qa/spec-reconciliation-*.md`│
├──────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 3. `reconciliation`  │ Existing spec + updated code  │ `docs/specs/invariants-*.md`    │
│    (Sync & Drift)    │ (3-Way Spec-Code Diff Matrix) │ `docs/qa/spec-reconciliation-*.md`│
└──────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

---

## Fast Mode Selection Matrix

When triggered, select or prompt for the operational mode based on user intent:

| User Request / Trigger Context                                                                    |          Selected Mode          | Execution Playbook                                                                                                                                                     |
| :------------------------------------------------------------------------------------------------ | :-----------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Specify new feature from PRD/ADR", "Clean-room spec extraction", "Before code is written"        |    **Mode 1: `clean-room`**     | [clean-room-extraction-guide.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/clean-room-extraction-guide.md)       |
| "Extract spec from existing code", "Mature project reverse-engineering", "Mine invariants"        | **Mode 2: `brownfield-mining`** | [code-to-spec-mining-guide.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/code-to-spec-mining-guide.md)           |
| "Check spec against code", "Audit spec drift", "Update spec after code changes", "Reconcile spec" |  **Mode 3: `reconciliation`**   | [spec-code-reconciliation-guide.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/spec-code-reconciliation-guide.md) |

> [!IMPORTANT]
> If mode is not explicitly specified and intent is ambiguous, prompt the user with a multiple-choice question to pick between Mode 1 (Clean-Room), Mode 2 (Brownfield Mining), or Mode 3 (Reconciliation). Never blindly auto-select without confirming intent.

---

## Socratic Adversarial Sifting & Anomaly Detection

In Modes 2 and 3, `solana-formal-spec` runs the **Two-Pass Socratic Sifter** to inspect code without adopting bugs:

1. **Pass 1 (Intent & Conservation Extraction):** Extracts global solvency conservation laws and FSMs from docs and account structs _before_ reading handler bodies.
2. **Pass 2 (Adversarial Code Conformance):** Audits instruction handlers against the [adversarial-anomaly-heuristics.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/adversarial-anomaly-heuristics.md) 7-Vector taxonomy:
   - **`CRITICAL` Anomalies** (solvency deficits, access bypasses, deadlocks): Triggers an immediate blocking multiple-choice prompt.
   - **`WARN` Anomalies** (zero-amount accepts, stale oracle windows): Batched into a summary questionnaire.
   - **`CODE_QUIRK`**: Silently annotated in the reconciliation report.

---

## Downstream Skill Integration

- **`solana-test-auditor`**: Consumes `docs/specs/invariants-*.md` to build the Clean-Room Traceability Matrix, flag missing test coverage, and generate LiteSVM test stubs.
- **`solana-mutation-testing`**: Uses formal invariant boundaries to evaluate whether surviving mutants violate core protocol rules.
- **`solana-adversarial-review`**: Targets flagged anomalies in `docs/qa/spec-reconciliation-*.md` to synthesize empirical LiteSVM exploit PoCs.

---

## Progressive Disclosure References

- [Discriminated Union Invariant Schema & Catalog Template](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/invariant-record-schema.md): Complete schema types (`GlobalConservationInvariant`, `InstructionTransitionInvariant`, `MetamorphicRelationInvariant`) and markdown template.
- [Clean-Room Extraction Guide (Mode 1)](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/clean-room-extraction-guide.md): Phase 1 zero-code isolation protocol for greenfield specifications.
- [Brownfield Code-to-Spec Mining Guide (Mode 2)](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/code-to-spec-mining-guide.md): Two-Pass reverse-engineering playbook for existing smart contract codebases.
- [Spec-Code Reconciliation & Drift Guide (Mode 3)](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/spec-code-reconciliation-guide.md): 3-Way spec-code drift detection, coverage matrix, and QA reporting.
- [Adversarial Anomaly Heuristics Taxonomy](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/adversarial-anomaly-heuristics.md): 7-vector code smells and 3-tier severity classification.
- [Interactive Interview Questionnaire Framework](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/interview-questionnaire-framework.md): Pre-built decision questionnaires for domain edge cases and code anomaly resolution.
