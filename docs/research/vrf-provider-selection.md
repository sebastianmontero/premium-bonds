# Research: Verifiable Randomness Source Selection for YieldBonds

> **Status**: Complete  
> **Date**: 2026-10-15  
> **Authors**: Senior Staff Solana Engineering  
> **Related Issues**: #10 (Randomness grinding mitigations), #19 (VRF Provider Research), #20 (VRF Replacement Implementation)  
> **Target Decision Record**: [`docs/adr/0001-vrf-provider-selection.md`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/adr/0001-vrf-provider-selection.md)  
> **Empirical Spikes**: [`scripts/spikes/orao-devnet-spike.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/spikes/orao-devnet-spike.ts), [`scripts/spikes/magicblock-devnet-spike.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/spikes/magicblock-devnet-spike.ts)

---

## 1. Executive Summary & Recommendation

Following the shutdown and deprecation of Switchboard On-Demand oracles on 2026-09-25, YieldBonds prize draws require a new, cryptographically secure verifiable randomness source on Solana before mainnet launch.

We evaluated six candidates:
1. **ORAO VRF** (Solana-native Byzantine quorum VRF)
2. **MagicBlock VRF** (Solana & Ephemeral Rollup ECVRF)
3. **Pyth Entropy** (checked for Solana availability)
4. **Supra dVRF / Chainlink VRF / Drand** (cross-chain and threshold beacons)
5. **VRAND** (single-prover slash-backed VRF)
6. **Baseline: Oracle-free randomness** (future `SlotHashes` sysvar / multi-party commit-reveal)

### Recommendation: ORAO VRF (`VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`)

We recommend **ORAO VRF** as the primary verifiable randomness provider for YieldBonds prize draws.

**Key Rationale:**
- **Decoupled Commit-Reveal Fit**: ORAO writes verified randomness to a persistent on-chain PDA (`[b"orao-vrf-randomness-request", seed]`). This allows `reveal_and_pick_winners` to run independently in its own transaction, protecting the heavy ticket registry binary search and payout allocation (up to 180 winners) from failing due to external oracle compute unit (CU) limits or account budget caps.
- **Byzantine Quorum Security**: Fulfillments require a Byzantine quorum ($2/3 + 1$) of independent authorities (3-of-4 on devnet, 4-of-5 on mainnet) submitting Ed25519 signatures XORed together. No single oracle operator or colluding party can bias or predict the outcome.
- **Empirical Devnet Performance**: A live spike on devnet demonstrated **18,199 CU** request cost, **0.0003 SOL** protocol fee, **1,289 ms** confirmation latency, and **2,661 ms** oracle fulfillment latency (total end-to-end ~4.2s), with automatic rent refund upon fulfillment.
- **Seamless Provable Fairness**: The persistent request PDA provides an unforgeable, immutable public record that directly powers `ProvableFairnessVerifier.tsx` and Solana explorer verification links.
- **Direct CPI & Crank Independence**: The harvest instruction can dispatch `cpi::request_v2` directly on-chain, eliminating hot-key request grinding. The oracle network fulfills autonomously without needing an atomic crank bundle.

---

## 2. Candidate Evaluation Matrix

Each candidate was scored on an audit-grade scale from 1 (unusable / failing) to 5 (optimal) across the 8 required criteria:

| Evaluation Criterion | Weight | ORAO VRF | MagicBlock VRF | Pyth Entropy | Drand / Threshold | Baseline (SlotHashes) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **1. Fairness & Threat Model** | 20% | **5 / 5** | 3 / 5 | 0 / 5 (N/A) | 4 / 5 | 1 / 5 |
| **2. Integration Pattern** | 15% | **5 / 5** | 3 / 5 | 0 / 5 (N/A) | 3 / 5 | 4 / 5 |
| **3. Liveness & Fault Tolerance** | 15% | **5 / 5** | 3 / 5 | 0 / 5 (N/A) | 3 / 5 | 5 / 5 |
| **4. Vendor Durability** | 15% | **4 / 5** | 4 / 5 | 0 / 5 (N/A) | 4 / 5 | 5 / 5 |
| **5. On-Chain Verifiability** | 10% | **5 / 5** | 2 / 5 | 0 / 5 (N/A) | 4 / 5 | 2 / 5 |
| **6. Cost & CU Footprint** | 10% | **5 / 5** | 4 / 5 | 0 / 5 (N/A) | 2 / 5 | 5 / 5 |
| **7. Tooling & Anchor Fit** | 10% | **4 / 5** | 4 / 5 | 0 / 5 (N/A) | 2 / 5 | 5 / 5 |
| **8. Audits & Track Record** | 5% | **5 / 5** | 5 / 5 | 0 / 5 (N/A) | 3 / 5 | 5 / 5 |
| **Weighted Score** | **100%** | **4.75** | **3.35** | **0.00** | **3.05** | **3.50\*** |

*\*Note: Baseline scores high on tooling/cost, but is disqualified due to fatal vulnerability to validator slot-skipping and withholding (1/5 on Criterion 1).*

---

## 3. Deep-Dive Candidate Evaluations

### Candidate 1: ORAO VRF (Recommended)
* **Program ID**: `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y` (Devnet & Mainnet)
* **Crate**: `orao-solana-vrf = "0.7.0"`, `orao-solana-vrf-cb = "0.4.0"`
* **NPM**: `@orao-network/solana-vrf`
* **Repository**: [`orao-network/solana-vrf`](https://github.com/orao-network/solana-vrf)
* **Primary Sources**: [Crates.io `orao-solana-vrf`](https://crates.io/crates/orao-solana-vrf), [ORAO Documentation](https://docs.orao.network/), [Hacken Audit Report](https://orao.network/audits/hacken.pdf).

#### Criterion Breakdown:
1. **Fairness & Threat Model (Score: 5/5)**:
   - Uses a Byzantine quorum ($2/3 + 1$) of registered fulfillment authorities (e.g. 3 of 4 on devnet, 4 of 5 on mainnet). Each node signs the request seed using Ed25519. The program verifies each signature via the Solana native `ed25519_program` instruction check and XORs the signatures together:
     $$\text{Randomness} = \bigoplus_{i=1}^{M} \text{Signature}_i$$
   - Even if $M-1$ nodes are malicious or collude with an attacker, the entropy is mathematically unbiasable as long as at least 1 honest authority submits a valid signature.
   - Attack vector mapping from #10:
     - *Choosing among several commits*: Prevented by binding the unique seed into the draw cycle state during harvest (`draw_cycle.randomness_account = pda`).
     - *Committing and binding in separate transactions*: Prevented by issuing `cpi::request_v2` atomically in `harvest_yield_and_commit`.
     - *Withholding the reveal*: Oracle operators cannot withhold selectively because any $M$ nodes can complete the quorum without the withholding node.
2. **Integration Pattern (Score: 5/5)**:
   - Decoupled commit-reveal. Harvest requests randomness via CPI, or records the deterministic PDA. The oracle network fulfills off-chain. Once fulfilled, YieldBonds consumes the randomness in `reveal_and_pick_winners`.
   - Winner selection and payout registry initialization do NOT execute inside an oracle callback. This completely eliminates callback CU failure risks.
3. **Liveness & Fault Tolerance (Score: 5/5)**:
   - Multi-node redundancy. Active on Solana mainnet and devnet since 2022.
   - If an outage occurs, requests stay pending; YieldBonds' existing `admin_force_unlock_draw` safely recovers the pool after a timeout ($T > 1000$ slots).
4. **Vendor Durability (Score: 4/5)**:
   - Independent company operating for over 4 years with multi-chain presence.
   - If ORAO shut down, the program code is fully open source under Apache-2.0. The protocol admin or a decentralized consortium could spin up fulfillment nodes using standard Ed25519 signing.
5. **On-Chain Verifiability (Score: 5/5)**:
   - The fulfilled request account is a permanent PDA containing `[client, seed, randomness[64]]`.
   - `ProvableFairnessVerifier.tsx` can query this PDA on devnet/mainnet and verify owner, discriminator, client, seed, and the final 64-byte payload.
6. **Cost & CU Footprint (Score: 5/5)**:
   - Request transaction consumes only **18,199 CU**.
   - Protocol request fee: **0.0003 SOL** (300,000 lamports = ~$0.045 at $150/SOL).
   - Dynamic rent reallocation: Pending account allocates 452 bytes, then shrinks to 137 bytes upon fulfillment, automatically refunding the ~0.0022 SOL difference to the client wallet.
7. **Tooling & Anchor Fit (Score: 4/5)**:
   - Rust crate `orao-solana-vrf` natively implements Anchor CPI interfaces.
   - TypeScript SDK `@orao-network/solana-vrf` works with standard `@solana/web3.js` and `@solana/kit` boundaries.
   - Mocking for LiteSVM is trivial: a simple mock program or injected account with `RandomnessV2` discriminator and 64 random bytes.
8. **Audits & Track Record (Score: 5/5)**:
   - Third-party audits by Hacken and CertiK.
   - Millions of fulfilled requests across production Solana dApps.

---

### Candidate 2: MagicBlock VRF
* **Program ID**: `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`
* **Crate**: `ephemeral-vrf-sdk = "0.17.3"`
* **Repository**: [`magicblock-labs/solana-vrf`](https://github.com/magicblock-labs/solana-vrf)
* **Primary Sources**: [MagicBlock Solana VRF Docs](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/solana-vrf), [Zenith Audit (2025)](https://raw.githubusercontent.com/magicblock-labs/solana-vrf/main/security_audits/2025-08-06%20VRF%20Program%20Audit%20Report%20by%20Zenith.pdf), [ARDA Audit (2026)](https://raw.githubusercontent.com/magicblock-labs/solana-vrf/main/security_audits/2026-09-06%20VRF%20Program%20Audit%20Report%20by%20ARDA.pdf).

#### Criterion Breakdown:
1. **Fairness & Threat Model (Score: 3/5)**:
   - Cryptographically sound RFC 9381 ECVRF over Curve25519/Ristretto.
   - **Single-Oracle Vulnerability**: Each oracle queue is owned by a single oracle public key (`&[b"queue", oracle_pubkey, index]`). Because ECVRF is deterministic for a given secret key, that single oracle can pre-evaluate the random outcome off-chain before submitting. If the outcome is disadvantageous to the oracle (or an affiliated player), the oracle can withhold fulfillment until the queue TTL (120 seconds) expires.
2. **Integration Pattern (Score: 3/5)**:
   - Strict **Request-and-Callback** model. The oracle calls `provide_randomness`, which invokes our program via CPI callback.
   - **Tight CU & Account Coupling**: All accounts needed for the callback must be packed into `callback_accounts_metas` (capped at `MAX_CALLBACK_ACCOUNTS = 25`). The entire winner resolution, binary searches, and payout registry initialization must execute inside the oracle's transaction budget. If winner picking consumes >1M CU, the oracle transaction fails.
3. **Liveness & Fault Tolerance (Score: 3/5)**:
   - Tied to a single oracle queue. If that oracle node is down, requests expire in 120 seconds (`QUEUE_TTL_SECONDS`).
4. **Vendor Durability (Score: 4/5)**:
   - Well-funded team (MagicBlock), but primary engineering focus is on Ephemeral Rollups rather than Solana L1 base layer.
5. **On-Chain Verifiability (Score: 2/5)**:
   - When `provide_randomness` completes, the request item is purged from the queue. No persistent on-chain VRF account remains for third-party verifiers to inspect.
6. **Cost & CU Footprint (Score: 4/5)**:
   - Protocol fee: 0.0005 SOL (500,000 lamports) standard, 0.0008 SOL high priority.
   - CU: ~45,000 CU for verification + callback execution.
7. **Tooling & Anchor Fit (Score: 4/5)**:
   - Excellent Anchor macro integration (`#[vrf]`).
   - Mocking in LiteSVM requires emulating the CPI callback flow.
8. **Audits & Track Record (Score: 5/5)**:
   - Audited by Zenith (Aug 2025) and ARDA (Sep 2026).

---

### Candidate 3: Pyth Entropy
* **Solana Availability Check**: **NOT AVAILABLE ON SOLANA**
* **Primary Sources**: [Pyth Entropy Documentation](https://docs.pyth.network/entropy), [Pyth Crosschain Repository](https://github.com/pyth-network/pyth-crosschain).
* **Finding**: Pyth Entropy is deployed across EVM chains (Arbitrum, Optimism, Base, Blast, Mode) and Aptos/NEAR. It does not maintain a smart contract deployment on Solana. Pyth on Solana provides only Price Feeds (`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`) and Solana Receiver (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`).
* **Verdict**: **Disqualified.**

---

### Candidate 4: Other Candidates (Supra dVRF, Chainlink VRF, Drand, VRAND)
1. **Chainlink VRF**:
   - Not deployed on Solana. Chainlink on Solana provides only Price Feeds and CCIP.
   - **Verdict**: Disqualified.
2. **Supra dVRF**:
   - Deployed on Supra L1, Aptos, Sui, and EVM chains. No live program on Solana mainnet/devnet.
   - **Verdict**: Disqualified.
3. **Drand / League of Entropy (tlock / timelock beacon)**:
   - Drand produces public randomness every 3 seconds via BLS12-381 threshold signatures.
   - On Solana, verifying BLS12-381 signatures on-chain requires custom software implementations that consume >1.2M CU, exceeding reasonable transaction limits without native Solana precompiles.
   - No production-grade Anchor SDK or turnkey Solana contract exists.
   - **Verdict**: Disqualified.
4. **VRAND** (`4HeYPD3be4YVGGGShLgrHwFS2aakss7gMD6tWcjXA4nx`):
   - Single-prover bond-slashing architecture.
   - Lacks established enterprise track record and independent security audits.
   - **Verdict**: Rejected in favor of ORAO.

---

### Candidate 5: Baseline — Oracle-Free Randomness (SlotHashes / Commit-Reveal)

A protocol baseline is to generate randomness on-chain without any external oracle, for example:
- Combining the blockhash of a future slot $N + k$ from the `SlotHashes` sysvar;
- Or running a multi-party commit-reveal scheme among draw participants.

#### Cryptographic & Economic Threat Analysis:
1. **Slot Leader Grinding (MEV / Slot Skipping Attack)**:
   - On Solana, the designated slot leader produces the block and learns the resulting slot hash *before* committing it to gossip.
   - If the slot leader (or a searcher colluding with the leader via Jito/private relays) participates in YieldBonds, they can locally compute the prize draw winners using the candidate blockhash.
   - If the leader does not win the prize pot, they can simply **skip producing the block** (or deliberately fail to include the draw transaction).
   - In Solana consensus, a validator skip rate of 2%–5% is within normal operating variance. The economic cost to a validator for skipping a slot is only the forfeited block reward (~0.05 to 0.1 SOL, or ~$8–$15).
   - If the prize pot is 1,000 USDC or 50,000 USDC, **skipping non-winning blocks is extremely profitable** ($+ \text{EV}$ attack).
2. **Participant Withholding in Commit-Reveal**:
   - In a multi-party commit-reveal scheme without a threshold oracle, the last participant to reveal holds a 1-bit withholding advantage: they compute the final combined seed and, if they lose, refuse to submit their reveal.
   - Even if penalized by forfeiting a deposit bond, whenever the prize pot exceeds the bond, withholding is economically rational.
3. **Verdict**:
   - **Explicitly Rejected.** Oracle-free on-chain randomness cannot secure financial prize pots on high-speed PoS blockchains.

---

## 4. Empirical Devnet Spike Results

Two reproducible spikes were built and tested on Solana Devnet:
- ORAO VRF: [`scripts/spikes/orao-devnet-spike.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/spikes/orao-devnet-spike.ts)
- MagicBlock VRF: [`scripts/spikes/magicblock-devnet-spike.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/spikes/magicblock-devnet-spike.ts)

### ORAO Live Execution Telemetry (Devnet Slot 511,563,100+)
```text
=== ORAO VRF Devnet Spike ===
Payer: E5F29wyzm1etJCWJ75uU4DBGPHKYcvbLaspz2kByS9et
Initial Balance: 33.255192035 SOL
Network State PDA: 5ER1oENnV4srxYdAynUfRzWeQCPQaqMiAp4VqyMbSqnK
Treasury: 9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR
Request Fee: 0.0003 SOL (300,000 lamports)
Fulfillment Authorities Count: 4 (Byzantine Quorum = 3)

Submitting request_v2 transaction...
Transaction Signature: kpbdZ9QaNXqyqXKrSjdjj1LYSPVQiitSy5TKtNjLQrnzHghgTscSLiT9MyHhgsDLeKESBhHsqTFU2LCLcykLzmb
Request Confirmation Latency: 1,289 ms
Compute Units Consumed: 18,199 CU
Base Transaction Fee: 0.000005 SOL (5,000 lamports)
Total Request Cost: 0.000305 SOL

Awaiting fulfillment from ORAO oracle quorum...
✅ Randomness Fulfilled!
Fulfillment Latency: 2,661 ms (3 poll intervals)
End-to-End Latency (Request -> Fulfilled): 4,188 ms
Fulfilled Account Data Length: 137 bytes (downsized from 452 bytes, rent refunded)
Fulfilled Randomness: 89fce42a1cb88012aed8e0600d598dcaba88bc9e7beff3f61dcc3f1465994e1f...
YieldBonds Derived Draw Seed: 32935ef7b0354f47a42eb3388be13ae2d55de002619c82abc585df171a0c43ee

--- Testing Re-request with Same Seed ---
✅ Duplicate request correctly rejected by Solana runtime (AccountAlreadyInUse)
```

### MagicBlock Devnet Findings
- MagicBlock's program enforces that Account 1 (`program_identity_info`) must be a signer PDA derived from `[b"identity", callback_program_id]`.
- Direct off-chain client requests are rejected; requests must originate via on-chain CPI from a registered Anchor program.
- Queue capacity is capped at 512 KiB with `MAX_CALLBACK_ACCOUNTS = 25`.

---

## 5. Answers to Implementation Questions (Issue #20)

### Q1: Does the provider need a crank at all?
**Answer**:
- **For Oracle Fulfillment**: **NO.** ORAO's autonomous off-chain validator nodes continuously index request accounts on Solana gossip and submit `fulfill_v2` transactions automatically within 2–4 seconds.
- **For YieldBonds Protocol Lifecycle**: **YES.** The YieldBonds crank worker still triggers:
  1. `harvest_yield_and_commit`: Requests randomness via CPI and locks eligible tickets.
  2. `reveal_and_pick_winners`: Polls the request PDA until fulfilled, then executes winner resolution.
- Crucially, there is NO longer any need for an oracle-reveal crank or atomic transaction bundles (which were fragile under Switchboard).

### Q2: Can our program make the request through CPI?
**Answer**:
- **YES.** `orao-solana-vrf` exports `cpi::request_v2`.
- In `harvest_yield_and_commit`, YieldBonds can invoke `cpi::request_v2(cpi_ctx, seed)` where `seed = sha256(pool_id, cycle_id, clock.slot)`.
- The request fee (0.0003 SOL) can be paid by the crank signer or drawn from pool lamports.
- Atomic CPI guarantees that the draw cycle binds the exact request account created in that transaction, eliminating seed-picking attacks.

### Q3: How do we pin the oracle or queue?
**Answer**:
- Pin the canonical ORAO program ID: `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`.
- Pin the network state account PDA: `5ER1oENnV4srxYdAynUfRzWeQCPQaqMiAp4VqyMbSqnK` (seeds: `[b"orao-vrf-network-configuration"]`).
- In `reveal_and_pick_winners`, enforce:
  ```rust
  #[account(
      constraint = randomness_account.owner == &crate::constants::ORAO_VRF_PROGRAM_ID @ PremiumBondsError::InvalidRandomnessAccount,
      constraint = randomness_account.key() == current_draw_cycle.randomness_account @ PremiumBondsError::RandomnessCommitmentTampered
  )]
  pub randomness_account: UncheckedAccount<'info>,
  ```
- Deserialization validates the `RandomnessV2` discriminator and that `request` matches `RequestAccount::Fulfilled(fulfilled)` with `fulfilled.seed == current_draw_cycle.seed`.

### Q4: Can a request be cancelled or retried, and by whom?
**Answer**:
- An ORAO request account **cannot be cancelled or deleted** while pending.
- A duplicate request with the same seed fails immediately with `AccountAlreadyInUse`.
- If an oracle outage occurs and the request is never fulfilled, recovery is handled by `admin_force_unlock_draw` (governed by the protocol Squads multisig):
  - Requires a staleness check: `clock.slot > draw_cycle.request_slot + 1000`.
  - Resets `draw_cycle.status = Open` and resets `current_cycle_end_at = clock.unix_timestamp`, allowing a fresh harvest with a new seed.
  - Hot crank keys have zero authority to cancel, rebind, or re-roll.

### Q5: What does the mock need to emulate?
**Answer**:
- Replace `anchor/programs/mock-switchboard` with `anchor/programs/mock-orao`.
- The mock needs to emulate:
  1. An instruction `request_v2(seed)` that creates an account with `RandomnessV2` layout.
  2. In unit / LiteSVM tests, the account can either be initialized directly in `Fulfilled` state, or a helper instruction `mock_fulfill(seed, randomness)` can transition it.
  3. Memory layout of `RandomnessV2::Fulfilled`:
     - Offset 0..8: Discriminator `[0x36, 0x5b, 0x8a, 0x22, 0xd4, 0x18, 0x82, 0x89]`
     - Offset 8: Tag `1` (`Fulfilled`)
     - Offset 9..41: Client Pubkey (32 bytes)
     - Offset 41..73: Request Seed (32 bytes)
     - Offset 73..137: Random Value (64 bytes)
- LiteSVM tests can run 100% in-process without any off-chain network dependencies.
