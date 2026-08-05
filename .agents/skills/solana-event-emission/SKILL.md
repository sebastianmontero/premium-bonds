---
name: solana-event-emission
description: Best practices playbook and reference guide for designing, emitting, securing, and indexing events in Solana smart contracts (Anchor & Rust). Details emission paradigms (`emit!`, `emit_cpi!`, `spl-noop`, `sol_log_data`), CU benchmarks, 10KB log buffer limits, anti-spoofing security via Event Authority PDAs, vector batching, and off-chain indexing with Anchor EventParser, Yellowstone Geyser gRPC, Helius Webhooks, and LiteSVM test assertions.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, Solana SVM runtime
metadata:
  author: Solana Architecture & Security Team
  version: 1.0.0
---

# Solana Event Emission & Indexing Best Practices Skill

## What this Skill is for

Use this Skill when:

- Designing or refactoring **event emission architecture** in Solana smart contracts (Anchor / Rust).
- Choosing between **Program Log Emission (`emit!`)**, **Cryptographic CPI Emission (`emit_cpi!`)**, **SPL No-Op CPI (`spl-noop`)**, or direct **Syscall Emission (`sol_log_data`)**.
- Resolving **10 KB transaction log buffer limits**, `LogTruncated` runtime panics, or Compute Unit (CU) exhaustion caused by event logging.
- Securing event streams against **Event Spoofing Attacks** where malicious contracts attempt to fake event output in transaction logs.
- Implementing **Vector Batching** for high-frequency iteration loops (DEX order fills, crank drawings, liquidations).
- Setting up off-chain indexers (**Anchor EventParser**, **Yellowstone Geyser gRPC**, **Helius Webhooks**, or `@solana/kit` listeners).
- Writing **LiteSVM Rust unit/integration test assertions** for event emission verification.

---

## Executive Decision Tree & Paradigm Selection Matrix

```
                                  EVENT EMISSION DESIGN DECISION TREE
                                                   │
                 ┌─────────────────────────────────┴─────────────────────────────────┐
                 ▼                                                                   ▼
       FINANCIAL / SECURITY CRITICAL                                      STANDARD APP EVENT / AUDIT TRAIL
  (e.g., Vault Deposits, Liquidations)                                 (e.g., User Profile Updates, Settings)
                 │                                                                   │
                 ▼                                                                   ▼
    NEEDS SPOOFING IMMUNITY?                                               INSTRUCTION ACCOUNT CAPACITY?
                 │                                                                   │
        ┌────────┴────────┐                                                 ┌────────┴────────┐
        ▼                 ▼                                                 ▼                 ▼
   YES (Anchor)       YES (Native)                                      CONSTRAINED       UNCONSTRAINED
        │                 │                                                 │                 │
        ▼                 ▼                                                 ▼                 ▼
 ┌─────────────┐   ┌─────────────┐                                   ┌─────────────┐   ┌─────────────┐
 │ `emit_cpi!` │   │ `spl-noop`  │                                   │   `emit!`   │   │ `emit_cpi!` │
 │ (Event PDA) │   │ (No-Op CPI) │                                   │ (Log-based) │   │ (Event PDA) │
 └─────────────┘   └─────────────┘                                   └─────────────┘   └─────────────┘
```

### Paradigm Comparison Summary

| Metric / Requirement | `emit!` (Anchor Log) | `emit_cpi!` (Anchor CPI) | `spl-noop` (No-Op CPI) | `sol_log_data` (Syscall) |
| :--- | :--- | :--- | :--- | :--- |
| **Compute Units (CU)** | ~1,200 – 2,200 CUs | ~2,500 – 4,500 CUs | ~1,800 – 2,800 CUs | ~600 – 1,200 CUs |
| **Log Buffer (10 KB Limit)** | Consumes log buffer | **Bypasses log buffer** | **Bypasses log buffer** | Consumes log buffer |
| **Extra Accounts Needed** | 0 extra accounts | 2 extra accounts (`event_authority`, `program`) | 1 extra account (`noop_program`) | 0 extra accounts |
| **Anti-Spoofing Immunity** | Low (Text parsing) | **Cryptographic (Event PDA)** | **High (CPI Target Check)** | Low (Text parsing) |
| **Off-Chain Indexability** | Log Filter / IDL | Inner Instructions / gRPC | Inner Instructions / gRPC | Log Filter |

---

## Core Event Emission Checklist

Before deploying any Solana program to production, audit event implementation against this checklist:

- [ ] **Spoofing Resistance**: Are critical financial events (vault deposits, token claims, liquidations) emitted via `emit_cpi!` or verified with program-level log context tracking to prevent fake event injection?
- [ ] **Account Budget**: If using `emit_cpi!`, are `event_authority` (`[b"__event_authority"]`) and `program` (Self) included in the instruction's `Accounts` struct?
- [ ] **Log Buffer Limit**: Is total transaction log output strictly under **10,240 bytes (10 KB)**? If emitting inside loops, is batching implemented?
- [ ] **Vector Batching**: Are high-frequency events inside loops (e.g. order fills, drawings) aggregated into a single `Vec<T>` struct payload rather than emitted individually?
- [ ] **Numeric Precision**: Are `u64` / `u128` token amounts serialized as explicit 64-bit integer fields (not JS numbers) to preserve precision off-chain?
- [ ] **Data Privacy & Confidentiality**: Are PII, unhashed commitment seeds, or VRF randomness inputs excluded from event payloads?
- [ ] **Testing Coverage**: Is there a LiteSVM or Bankrun integration test asserting that event log outputs or inner instructions fire correctly during execution?

---

## Detailed Research References & Playbooks

For complete architectural deep-dives, mathematical cost breakdowns, and integration guides, refer to:

1. 📖 **[Event Emission Paradigms & Benchmark Specifications](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/event-paradigms-and-benchmarks.md)**
   - Detailed analysis of `emit!`, `emit_cpi!`, `spl-noop`, and `sol_log_data`.
   - CU usage benchmarks, Base64 payload bloat calculations, and 10 KB log buffer constraints.
   - High-throughput vector aggregation and zero-copy memory slicing patterns.

2. 📖 **[Security, Anti-Spoofing & Privacy in Event Emission](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/security-and-anti-spoofing.md)**
   - Analysis of log spoofing attack vectors and cross-program invocation risks.
   - Cryptographic event authentication via Event Authority PDAs (`__event_authority`).
   - Stateful off-chain log parsing algorithms for log-based `emit!`.
   - Data privacy standards and commit-reveal randomness rules.

3. 📖 **[Off-Chain Event Indexing, Client SDKs & Testing Integration](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/offchain-indexing-and-clients.md)**
   - Off-chain integration patterns with Anchor `EventParser` and `@coral-xyz/anchor` listeners.
   - Modern `@solana/client` / `@solana/kit` manual discriminator decoding.
   - Yellowstone Geyser gRPC inner instruction filtering for CPI events.
   - LiteSVM Rust integration test patterns for asserting event emissions.

---

## Code Examples

- 🛠️ **[Anchor Events Showcase](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/examples/anchor-events-showcase.rs)**: Complete Anchor program demonstrating standard `emit!`, secure `emit_cpi!`, batched vector event emission, and direct low-level `sol_log_data` syscalls.
