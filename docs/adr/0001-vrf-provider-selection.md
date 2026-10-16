# ADR 0001: Selection of ORAO VRF as Verifiable Randomness Provider

> **Status**: Accepted  
> **Date**: 2026-10-15  
> **Deciders**: Protocol Engineering Team  
> **Related Issues**: #10 (Grinding mitigations), #19 (Provider selection), #20 (Implementation)  
> **Supersedes**: Prior reliance on Switchboard On-Demand VRF (shut down 2026-09-25)  
> **Research Document**: [`docs/research/vrf-provider-selection.md`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/research/vrf-provider-selection.md)

---

## Context and Problem Statement

YieldBonds operates automated, provably fair prize draws funded by yield harvested from underlying tokenized real-world assets (Huma Finance $PST). Each draw cycle locks eligible participant tickets, harvests yield, commits to a random seed, and evaluates winners across tiered prize distributions.

Prior to September 2026, the protocol integrated Switchboard On-Demand for verifiable randomness. On 2026-09-19, Switchboard Technology Labs announced the immediate deprecation of all its oracle deployments, terminating all oracle services across all chains on 2026-09-25. Consequently, all draws dependent on Switchboard become permanently blocked in `AwaitingRandomness`.

YieldBonds must adopt a reliable, actively maintained, and cryptographically sound verifiable randomness source on Solana prior to mainnet launch.

---

## Decision

We adopt **ORAO VRF** (`VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`) as the protocol's primary verifiable randomness provider.

YieldBonds will implement a **decoupled commit-reveal integration**:
1. **Commit Phase (`harvest_yield_and_commit`)**:
   - The draw cycle calculates accrued yield, locks eligible ticket snapshots, and derives a unique, tamper-resistant request seed from `(pool_id, cycle_id, clock.slot)`.
   - The program invokes `orao_solana_vrf::cpi::request_v2` via Cross-Program Invocation (CPI), paying the 0.0003 SOL protocol fee.
   - The draw state binds `randomness_account = request_pda` and transitions to `DrawStatus::AwaitingRandomness`.
2. **Autonomous Fulfillment Phase**:
   - ORAO's decentralized off-chain validator network monitors new request PDAs and submits threshold Ed25519 signature responses.
   - Upon achieving Byzantine quorum (3-of-4 on devnet, 4-of-5 on mainnet), the ORAO program XORs the contributions, writes the final 64-byte randomness into the PDA, and downscales the account from 452 bytes to 137 bytes (refunding excess rent).
3. **Reveal & Winner Selection Phase (`reveal_and_pick_winners`)**:
   - The YieldBonds crank worker detects that the randomness account is fulfilled.
   - The transaction passes `randomness_account`, validates its ownership by `ORAO_VRF_PROGRAM_ID`, verifies the `RandomnessV2` discriminator and matching seed, extracts the 64-byte random output, derives the 32-byte draw seed via `SHA-256`, and evaluates winning tickets across all tiers.
4. **Emergency Recovery (`admin_force_unlock_draw`)**:
   - If an oracle outage leaves a request unfulfilled after a freshness window ($T > 1000$ slots), the admin multisig can force-unlock the cycle, resetting `current_cycle_end_at` to allow an immediate fresh harvest. Hot crank keys cannot cancel or re-roll.

---

## Alternatives Considered and Rejected

### 1. MagicBlock Solana VRF (`Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`)
- **Architecture**: RFC 9381 ECVRF with a synchronous CPI callback pattern (`ProvideRandomness` invokes caller callback).
- **Reasons for Rejection**:
  - *Single-Oracle Vulnerability*: Each queue belongs to a single oracle public key. Because ECVRF is deterministic, the oracle can evaluate the outcome off-chain before submitting. An adversary colluding with the oracle could selectively withhold submissions until the 120s TTL expires.
  - *Compute Unit & Account Bottleneck*: The oracle transaction must execute both cryptographic proof verification and the caller callback within a single transaction. In YieldBonds, winner picking performs binary searches across the ticket registry and initializes the payout registry (up to 180 winners). Packing these operations and accounts into an oracle callback exceeds queue limits (`MAX_CALLBACK_ACCOUNTS = 25`) and risks transaction abortion.
  - *Ephemeral State*: Request queue entries are deleted immediately upon fulfillment, leaving no persistent on-chain account for the client dApp's `ProvableFairnessVerifier.tsx`.

### 2. Pyth Entropy
- **Status**: Checked and confirmed to be **unavailable on Solana**. Pyth Entropy only supports EVM chains (Arbitrum, Optimism, Base, Blast) and Aptos. Pyth on Solana is restricted to price feeds.

### 3. Supra dVRF & Chainlink VRF
- **Status**: Neither provider deploys native VRF programs on Solana mainnet or devnet.

### 4. Drand / League of Entropy (tlock)
- **Architecture**: Public threshold beacon producing randomness every 3s via BLS12-381 signatures.
- **Reasons for Rejection**: Solana lacks native BLS precompiles. On-chain pairing checks consume >1.2M CU in software, and no production-grade Anchor SDK or maintained Solana contract exists.

### 5. Baseline: Oracle-Free Randomness (`SlotHashes` / Commit-Reveal)
- **Architecture**: Deriving draw entropy from future slot hashes or participant hashes.
- **Reasons for Rejection**:
  - *Slot Leader Grinding (MEV)*: On Solana, slot leaders produce blocks and know candidate slot hashes in advance. A validator participating in a draw can calculate the outcome and intentionally skip producing the block if they lose. The cost of skipping a block is only ~0.05–0.10 SOL in forfeited rewards, which is vastly lower than a multi-thousand-dollar prize pot.
  - *1-Bit Withholding*: In participant commit-reveal schemes, the final party to reveal can withhold their secret if the outcome is disadvantageous.

---

## Residual Trust Assumptions

1. **Byzantine Quorum Honesty**: ORAO relies on a Byzantine quorum ($2/3 + 1$) of independent nodes. We assume that at least 1 node in the fulfilling quorum is honest and non-colluding. Because signatures are combined via bitwise XOR, a single honest signature guarantees that the combined output is uniformly random and unpredictably distributed.
2. **Program Upgrade Authority**: The ORAO VRF program is upgradeable via its configuration authority. We mitigate foreign contract upgrade risk by verifying account discriminators, pinning program IDs, and maintaining strict bounds checking on deserialized data.
3. **Liveness SLA**: The ORAO oracle network is expected to fulfill requests within seconds under normal Solana network conditions. If the network experiences extended downtime, funds remain unallocated until the 1,000-slot timeout permits an admin multisig force-unlock.

---

## Fallback Plan (Vendor Durability & Exit Strategy)

If ORAO Network faces operational disruption, regulatory action, or service discontinuation (as occurred with Switchboard):

1. **Independent Oracle Hosting**:
   - The ORAO Solana VRF program and node daemon are open-source (Apache-2.0).
   - If the public ORAO node network degrades, the YieldBonds protocol team or community validators can deploy and operate dedicated fulfillment nodes using standard Ed25519 signing keys.
2. **Modular Architecture & Adapter Isolation**:
   - In accordance with Issue #20 architecture, all VRF logic is isolated behind the `IVrfProvider` interface in the crank (`services/crank/vrf/randomness-provider.ts`) and a dedicated verification helper in the smart contract (`anchor/programs/anchor/src/vrf.rs`).
   - If a migration to another provider becomes necessary in the future, only the boundary adapter and the on-chain seed verification helper need to be replaced.
3. **Admin Force-Unlock Recovery**:
   - The protocol includes `admin_force_unlock_draw` with an enforced delay check (`clock.slot > request_slot + 1000`).
   - If any draw becomes trapped due to oracle failure, the multisig can safely unlock the draw without risking loss of principal or user funds.
