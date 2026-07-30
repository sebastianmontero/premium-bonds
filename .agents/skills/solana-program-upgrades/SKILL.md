---
name: solana-program-upgrades
description: Playbook, best practices, architectural trade-offs, and execution guide for making Solana/Anchor smart contracts easily upgradeable and executing safe on-chain upgrades. Use when designing upgradeable Anchor state structs, evaluating upgrade trade-offs (padding vs realloc, lazy vs batch migration, proxy vs in-place), managing Squads multisig upgrade authority, verifying deterministic builds with solana-verify, or planning/performing program upgrade proposals.
user-invocable: true
license: MIT
metadata:
  author: Premium Bonds Core Engineering Team
  version: 1.1.0
---

# Solana & Anchor Smart Contract Upgradeability Skill

## What this Skill is for

Use this skill when:

- **Evaluating architectural trade-offs** for Solana/Anchor program upgradeability (In-Place vs Dual Deployment, Struct Padding vs Realloc, Lazy vs Batch Migration).
- **Designing upgradeable Anchor programs** in Rust with future-proof account layouts.
- **Implementing state migration logic** using account versioning (`version: u8`), struct padding, or Anchor's `realloc` attribute.
- **Auditing upgrade risks** (e.g. struct discriminator mismatch, broken PDA derivations, field offset shifts, missing rent lamports).
- **Managing upgrade authority governance** with Squads Protocol (v3/v4 multisig) or making a program immutable.
- **Building & verifying program binaries** deterministically using `solana-verify`.
- **Executing production upgrade SOPs** (buffer creation, hash digest verification, Squads proposal creation, state migration, buffer rent recovery).

---

## Architectural Trade-Off Analysis & Selection Framework

### 1. Bytecode Deployment Architecture Trade-Offs

| Pattern                                      | Mechanism                                                                                                    | Advantages                                                                                                                                            | Disadvantages                                                                                                                                                                               | Selection Guidelines                                                                                           |
| :------------------------------------------- | :----------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------- |
| **Native In-Place Upgrade (Standard)**       | Bytecode overwritten in `ProgramData` PDA (`BPFLoaderUpgradeable`). `ProgramID` unchanged.                   | • Preserves all PDAs, token mint authorities & CPI integrators.<br>• **0 Compute Unit penalty**.<br>• Simple CLI / Squads workflow.                   | • Hot-swap: immediate global effect.<br>• Requires strict backward compatibility in account layouts or active state migration.                                                              | **Default choice** for 95%+ of Solana programs.                                                                |
| **Parallel Dual Deployment (V1 + V2)**       | Deploy new code under a fresh `ProgramID`. Users migrate assets via bridge instruction (`drain_v1_into_v2`). | • Zero risk of corrupting V1 accounts.<br>• Complete freedom to redesign account layouts & instructions.<br>• Side-by-side canary testing on mainnet. | • **Breaks external integrators** (DEXs, wallets, SDKs).<br>• All derived PDAs change.<br>• Requires manual user action to migrate liquidity.                                               | **Major architectural rewrites**, paradigm shifts in state models, or un-migratable legacy layouts.            |
| **Proxy / Dispatcher Pattern**               | Light Proxy router holds state & PDAs, delegating logic via CPI to versioned implementation programs.        | • Modular sub-module swapping.<br>• Per-market or per-user version routing.                                                                           | • **High Compute Unit (CU) penalty** (~1,000+ CUs per CPI call).<br>• High transaction complexity & account stack limits.<br>• Increased attack surface (malicious implementation binding). | **Complex multi-tenant protocols** (e.g. modular DEX engines, isolated lending pools with custom risk models). |
| **Immutable Transition (Authority Burning)** | Revoke upgrade authority (`solana program set-upgrade-authority <PROGRAM_ID> --final`).                      | • Maximum trustlessness & auditability.<br>• Eliminates admin rugpull / key compromise vectors completely.                                            | • Unfixable bugs or vulnerabilities forever.<br>• Cannot adapt to Solana runtime breaking changes.                                                                                          | **Mature, audited core primitives** (e.g., Token Program, System Program, fixed pool invariants).              |

---

### 2. Account Layout & Schema Evolution Trade-Offs

| Layout Strategy                           | Description                                                                | Pros                                                                                                                                       | Cons                                                                                                                                             | Selection Guidelines                                                                                        |
| :---------------------------------------- | :------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Struct Padding (`_reserved: [u8; N]`)** | Pre-allocate extra unused bytes in struct layout upfront.                  | • **0 CU cost** when adding new fields.<br>• Instant field carving without `realloc` instructions.<br>• Ideal for `#[account(zero_copy)]`. | • Users pay rent upfront for unallocated bytes.<br>• Wasteful if padding is never used.                                                          | **Mandatory** for zero-copy structs, high-frequency state, or predictable V1->V2 evolution.                 |
| **Dynamic Reallocation (`realloc`)**      | Expand account data size on demand via Anchor `#[account(realloc = ...)]`. | • **Pay-as-you-grow** rent model.<br>• Unconstrained long-term account growth.                                                             | • Consumes CUs for memory reallocation & rent transfers.<br>• Requires managing rent payer accounts.<br>• **10 KiB limit per instruction call**. | Variable-sized lists (`Vec<T>`), unpredictable growth, or post-padding expansion in non-zero-copy accounts. |
| **Header-Only + Raw Byte Payload**        | Fixed header struct + raw byte slice `[u8]` appended at end of account.    | • Maximum memory efficiency & raw byte slicing.<br>• Bypasses Borsh struct limits.<br>• Lowest CU deserialization overhead.                | • Manual byte offset calculations (`bytemuck`).<br>• High risk of developer alignment/out-of-bounds errors.                                      | **Large registries** (e.g., orderbooks, ticket registries, bitmaps, liquidity pools).                       |

---

### 3. State Migration Execution Models

| Execution Model              | Trigger Mechanism                                                                             | Cost Distribution                                                                    | UX Impact                                                                              | Best Fit                                                                                                         |
| :--------------------------- | :-------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **Lazy On-Demand Migration** | Check `if account.version < CURRENT_VERSION` on every instruction call; migrate in-place.     | Users pay minimal realloc rent as they interact with the protocol. Protocol pays $0. | Users pay slightly higher CU cost on their first post-upgrade interaction.             | Default for **User-Owned Accounts** (Vaults, User Positions, Profiles).                                          |
| **Admin Batch Migration**    | Off-Chain script iterates through indexed accounts and invokes `migrate_v1_to_v2` in batches. | Protocol/Admin team pays 100% of transaction fees and realloc rent top-ups.          | Zero CU penalty or surprise rent charges on users. Clean protocol-wide state boundary. | **Global Protocol State**, Market Pools, Liquidity Vaults, or when legacy code paths must be purged immediately. |

---

## Architectural Decision Framework

```
                               ┌────────────────────────────────────────┐
                               │  Is the upgrade a major overhaul that  │
                               │   changes fundamental PDA derivation   │
                               │        or breaks instruction API?      │
                               └───────────────────┬────────────────────┘
                                                   │
                            ┌──────────────────────┴──────────────────────┐
                            YES                                           NO
                            │                                             │
                            ▼                                             ▼
             [Parallel Dual Deployment]                    [Native In-Place Upgrade]
             - Deploy as Program_V2                        - Upgrade ProgramData under same ID
             - Bridge V1 -> V2 state                       - Maintain struct discriminators
             - Third-party SDK update                      - Select Account Migration Model
                                                                          │
                                                ┌─────────────────────────┴─────────────────────────┐
                                                │                                                   │
                                                ▼                                                   ▼
                                   [Zero-Copy / Fixed Struct]                       [Variable-Sized Struct]
                                   - Use Struct Padding (`_reserved`)               - Use Anchor `realloc`
                                   - Carve new fields from padding                  - Lazy or Batch Migration
```

---

## Core Principles & Architecture

### 1. BPF Upgradeable Loader Storage Model

Solana handles program code and program state separately. Executable code resides in a `ProgramData` PDA owned by `BPFLoaderUpgradeab1e11111111111111111111111`.

```
┌─────────────────────────────────┐
│     Executable Program ID       │
└────────────────┬────────────────┘
                 │ Points to
                 ▼
┌─────────────────────────────────┐
│       ProgramData Account       │
│  - upgrade_authority: Option    │
│  - slot: u64                    │
│  - data: Vec<u8> (ELF Bytecode) │
└─────────────────────────────────┘
```

### 2. Golden Rules of Solana Program Upgrades

1. **Preserve Program ID**: Upgrading replaces bytecode under the existing `ProgramID`. Never change `declare_id!(...)` as it breaks all derived PDAs, token mint authorities, and CPI callers.
2. **Preserve Struct Names**: Anchor derives account discriminators as `sha256("account:<StructName>")[..8]`. Renaming a struct breaks deserialization of all existing on-chain accounts.
3. **Never Shift Field Offsets**: Always append new fields to the end of a struct or consume reserved padding bytes (`_reserved`).
4. **Never Upgrade Without Verifiable Hash Verification**: Match local Docker build hashes with on-chain buffer hashes byte-for-byte using `solana-verify`.
5. **Always Use Multisig Upgrade Authority**: Transfer program upgrade authority to a Squads multisig vault before deploying to mainnet.

---

## Designing Upgradeable Anchor State

### 1. Versioning & Padding Pattern (Recommended for Fixed / Zero-Copy Accounts)

Always include a `version: u8` field and a `_reserved` byte buffer in state structs.

```rust
use anchor_lang::prelude::*;

#[account]
pub struct UserVault {
    pub version: u8,          // 1 byte: 1 = V1, 2 = V2
    pub authority: Pubkey,    // 32 bytes
    pub balance: u64,         // 8 bytes
    pub _reserved: [u8; 64],  // Reserved space for future upgrades
}

impl UserVault {
    pub const INIT_SPACE: usize = 1 + 32 + 8 + 64; // 105 bytes
}
```

When upgrading to V2, carve out space from `_reserved` without changing struct size:

```rust
#[account]
pub struct UserVault {
    pub version: u8,          // 1 byte: set to 2
    pub authority: Pubkey,    // 32 bytes
    pub balance: u64,         // 8 bytes
    pub tier: u8,             // 1 byte (New field)
    pub points: u64,          // 8 bytes (New field)
    pub _reserved: [u8; 55],  // Reduced 64 -> 55 (64 - 1 - 8 = 55)
}
```

---

### 2. Dynamic Account Reallocation (`realloc`)

For accounts that expand beyond reserved space:

```rust
#[account]
pub struct GlobalConfig {
    pub version: u8,
    pub admin: Pubkey,
    pub is_paused: bool,
    pub allowed_mints: Vec<Pubkey>,
}

#[derive(Accounts)]
pub struct MigrateConfigV2<'info> {
    #[account(
        mut,
        realloc = 8 + GlobalConfig::size_for_v2(),
        realloc::payer = payer,
        realloc::zero = false,
        has_one = admin,
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateConfigV2>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.version == 1, ProtocolError::AlreadyMigrated);
    config.version = 2;
    // Perform state updates for V2
    Ok(())
}
```

- **Max Realloc Limit**: 10,240 bytes (10 KiB) per instruction call. For larger expansions, execute multiple sequential realloc instructions.
- **Rent Exemption**: `realloc::payer` must supply SOL lamports when expanding space. When shrinking space, excess lamports return to `realloc::payer`.

---

### 3. Lazy Migration vs Admin Batch Migration

```
                               ┌────────────────────────────────┐
                               │   State Migration Approaches   │
                               └───────────────┬────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
           [Lazy On-Demand Migration]                     [Admin Batch Migration]
       - Triggered during normal user IX              - Called by admin script/crons
       - User/Program pays realloc rent                - Admin pays transaction/rent costs
       - Ideal for User Vaults / Accounts              - Ideal for Global Protocol Configs
```

- **Lazy Migration Pattern**:
  ```rust
  pub fn process_user_action(ctx: Context<UserAction>) -> Result<()> {
      let vault = &mut ctx.accounts.user_vault;
      if vault.version < 2 {
          vault.version = 2;
          vault.points = 0;
      }
      // Continue normal instruction execution
      Ok(())
  }
  ```

---

## Required Developer Knowledge & Skills

### 1. Essential Tooling Competencies

| Tool / CLI                    | Purpose & Usage                                                               |
| :---------------------------- | :---------------------------------------------------------------------------- |
| `solana-verify`               | Deterministic build verification against git commits using Docker containers. |
| `solana program write-buffer` | Uploads binary ELF bytecode to an unexecutable buffer account.                |
| `solana program extend`       | Expands `ProgramData` capacity if bytecode exceeds original allocation.       |
| `solana program close`        | Reclaims temporary buffer SOL lamports back to fee payer treasury.            |
| `Squads Protocol (v3/v4)`     | Multisig upgrade authority management and proposal signing.                   |
| `LiteSVM`                     | Fast Rust in-process testing for program upgrades and migration verification. |

### 2. Economic & Security Best Practices

- **Calculate Buffer Capital Requirements**:
  ```bash
  NO_DNA=1 solana rent <PROGRAM_ELF_SIZE_BYTES>
  ```
  Ensure the fee payer account has sufficient SOL for temporary buffer rent before deployment.
- **Verifiable Build Check**:
  Always verify binary hashes prior to proposal creation:
  ```bash
  solana-verify get-executable-hash target/deploy/my_program.so
  solana-verify get-program-hash -u m <BUFFER_PUBKEY>
  ```
- **Circuit Breakers**:
  Pause protocol interactions (`is_paused = true`) during critical upgrades and state migrations.

---

## Production Upgrade Standard Operating Procedure (SOP)

```
   Step 1: Test Upgrade on LiteSVM
     │
   Step 2: Build Verifiable ELF (`solana-verify build`)
     │
   Step 3: Upload Bytecode to Buffer (`solana program write-buffer`)
     │
   Step 4: Expand Program Capacity if needed (`solana program extend`)
     │
   Step 5: Verify Hashes (`solana-verify get-program-hash`)
     │
   Step 6: Submit & Execute Squads Multisig Upgrade Proposal
     │
   Step 7: Execute State Migrations & Upgrade IDL (`anchor idl upgrade`)
     │
   Step 8: Reclaim Buffer Rent (`solana program close`)
```

### Command Execution Reference

```bash
# 1. Verifiable Build
solana-verify build

# 2. Upload ELF to Buffer Account
NO_DNA=1 solana program write-buffer target/deploy/my_program.so \
  --keypair /path/to/payer.json \
  --buffer /path/to/buffer_keypair.json

# 3. Extend Program Capacity (if new binary > ProgramData space)
NO_DNA=1 solana program extend <PROGRAM_ID> 20480

# 4. Verify Hashes Match
solana-verify get-executable-hash target/deploy/my_program.so
solana-verify get-program-hash -u m <BUFFER_PUBKEY>

# 5. Set Buffer Authority to Squads Multisig Vault
NO_DNA=1 solana program set-buffer-authority <BUFFER_PUBKEY> \
  --new-buffer-authority <SQUADS_VAULT_PDA>

# 6. Propose Upgrade via Squads CLI/SDK, collect signatures & execute on-chain

# 7. Upgrade On-Chain IDL
anchor idl upgrade --provider.cluster mainnet <PROGRAM_ID> target/idl/my_program.json

# 8. Reclaim Rent from Buffer
NO_DNA=1 solana program close <BUFFER_PUBKEY> --recipient <TREASURY_PUBKEY>
```

---

## Upgrade Verification & Safety Checklist

- [ ] Program ID (`declare_id!`) remains unchanged.
- [ ] Account struct names preserved (discriminator match verified).
- [ ] Struct fields extended without shifting relative offsets.
- [ ] Struct padding (`_reserved`) or `realloc` payer configured.
- [ ] Upgrade tested on LiteSVM (V1 -> V2 transition & state migration verified).
- [ ] Deterministic binary built with `solana-verify`.
- [ ] Local build SHA256 digest matches on-chain buffer hash.
- [ ] Upgrade authority managed by Squads Multisig.
- [ ] Protocol paused during critical migration steps.
- [ ] On-chain IDL upgraded.
- [ ] Rent lamports recovered via `solana program close`.
