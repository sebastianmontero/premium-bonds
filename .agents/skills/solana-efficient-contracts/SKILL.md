---
name: solana-efficient-contracts
description: Master playbook and reference guide for writing high-efficiency (storage and compute units CU) Solana smart contracts using the Anchor framework. Details required expert skillset, storage & CU micro-optimization techniques, zero-copy & realloc patterns, and deep architectural trade-off evaluations.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, Solana SVM runtime
metadata:
  author: Solana Architecture & Security Team
  version: 1.0.0
---

# Solana Efficient Smart Contract Architecture & Optimization Skill

## What this Skill is for

Use this Skill when:
- Designing or refactoring **Solana smart contracts** (Rust / Anchor) for maximum compute unit (CU) efficiency and minimal rent/storage footprint.
- Evaluating architectural trade-offs such as **Monolithic Zero-Copy vs. Multi-PDA**, **Borsh Deserialization vs. Zero-Copy Pointer Casting**, or **Upfront Pre-Allocation vs. Dynamic Reallocation (`realloc`)**.
- Resolving **SVM runtime bottlenecks**, BPF stack overflows (4 KB limit), heap pressure (32 KB limit), or unaligned memory access panics.
- Implementing zero-copy structs with `bytemuck`, `AccountLoader`, bit-packed flags, or header-only raw byte payload expansion.

---

## Executive Efficiency Matrix & Decision Tree

```
                                  DATA SIZE & CONCURRENCY REQUIREMENT?
                                                   │
                ┌──────────────────────────────────┴──────────────────────────────────┐
                ▼                                                                     ▼
     < 256 Bytes / High Parallelism                                       > 256 Bytes / Global Lookup
    (e.g., User Vaults, Staking States)                                (e.g., Registries, Orderbooks)
                │                                                                     │
                ▼                                                                     ▼
     ┌──────────────────────┐                                              ┌──────────────────────┐
     │  Multi-PDA Pattern   │                                              │ Zero-Copy Monolithic │
     │  `Account<'info, T>` │                                              │ `AccountLoader`      │
     └──────────────────────┘                                              └──────────┬───────────┘
                                                                                      │
                                                                 DYNAMICALLY GROWING PAYLOAD (> 10 KB)?
                                                                                      │
                                                                   ┌──────────────────┴──────────────────┐
                                                                   ▼                                     ▼
                                                             NO (Fixed Size)                     YES (Pay-as-you-grow)
                                                                   │                                     │
                                                                   ▼                                     ▼
                                                        ┌─────────────────────┐               ┌─────────────────────┐
                                                        │ `#[account(zero_copy)]│               │ Header Struct +     │
                                                        │ `bytemuck::Pod`     │               │ Raw Bytes & Realloc │
                                                        └─────────────────────┘               └─────────────────────┘
```

---

## Core Efficiency Checklist

Before deploying any Anchor smart contract to production, audit code against this checklist:

- [ ] **Deserialization Strategy**: Are state structs larger than 256 bytes using `AccountLoader<'info, T>` instead of `Account<'info, T>`?
- [ ] **Struct Memory Alignment**: Are fields ordered strictly from largest byte alignment (`Pubkey`, `u64`) down to smallest (`u8`), with explicit padding bytes to prevent unaligned memory access?
- [ ] **Bit-Packing Flags**: Are multiple boolean flags packed into a single `u8` or `u64` bitfield instead of using individual `bool` fields (1 byte each)?
- [ ] **Pubkey Deduplication**: Are repeated `Pubkey` references inside arrays replaced with `u16` or `u32` integer indices mapped to a central lookup table?
- [ ] **Fail-Fast Validation**: Are cheap validation checks (signers, bitmasks, bumps) executed BEFORE heavy deserialization, zero-copy loading, or math calculations?
- [ ] **Lazy State Merging**: Are state updates computed lazily when users interact rather than looping over all accounts during global state changes?
- [ ] **Log Stripping**: Are dynamic `msg!` string formatting calls stripped or gated behind `#[cfg(feature = "debug-logs")]` to save 100–300 CUs per call?
- [ ] **Stack Overflow Prevention**: Are large local buffer arrays eliminated from stack frames in favor of zero-copy references or direct byte slices?

---

## Detailed Research References & Playbooks

For deep technical specifications, mathematical cost breakdowns, and architectural trade-off evaluations, refer to the following sub-documents:

1. 📖 **[Expert Knowledge Matrix](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-efficient-contracts/references/expert-knowledge-matrix.md)**
   - SVM Execution Engine & Memory Architecture (4 KB stack, 32 KB heap, 1.4M CU transaction limit).
   - Borsh Serialization CU Tax vs. Zero-Copy Pointer Casting.
   - Rent Exemption Overhead (128-byte header + 8-byte discriminator) and `realloc` rules.

2. 📖 **[Efficiency Best Practices](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-efficient-contracts/references/efficiency-best-practices.md)**
   - Micro-Optimizations: Field ordering, explicit padding, bit-packing, and pubkey index mapping.
   - CU Reduction: Lazy state updates, fail-fast validation, and log stripping.
   - Macro Patterns: Header-only + raw byte dynamic payload and batched crank transactions.

3. 📖 **[Architectural Trade-Off Analysis](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-efficient-contracts/references/architectural-tradeoffs.md)**
   - Monolithic Zero-Copy vs. Multi-PDA Architecture (Write concurrency vs. Bulk lookup).
   - Deserialization Framework Comparison Table (Borsh vs. Zero-Copy vs. Raw Byte Slicing).
   - Upfront Pre-Allocation vs. Dynamic Reallocation (`realloc`).
   - On-Chain Math vs. Off-Chain Merkle / ZK Proof Verification.

---

## Code Examples

- 🛠️ **[Zero-Copy Struct with Bytemuck](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-efficient-contracts/examples/zero_copy_pattern.rs)**: Complete Anchor program demonstrating `#[account(zero_copy)]`, `AccountLoader`, field alignment, and explicit padding bytes.
- 🛠️ **[Header-Only Struct with Raw Byte Slicing & Realloc](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-efficient-contracts/examples/header_raw_byte_realloc.rs)**: Complete Anchor code demonstrating dynamic account reallocation (`realloc`), rent top-up, and header-only access.
