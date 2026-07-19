---
name: solana-docs
description: Playbook for documenting Solana dApps, including Rust smart contracts (Anchor, doc comments, CHECK comments, PDA seeds, errors) and TypeScript frontend (Codama client codegen, framework-kit custom hooks, TSDoc standards). Use when creating or updating documentation, auditing files for missing comments, or writing docstrings.
user-invocable: true
metadata:
  version: 1.0.0
---

# Solana Documentation Playbook Skill

## What this Skill is for

Use this skill when:

- Writing or updating documentation for a Solana program (Rust / Anchor).
- Documenting React/TypeScript frontend code (framework-kit custom hooks, transaction builders, components).
- Auditing the repository for missing documentation, security-critical `/// CHECK:` comments, or undocumented PDA seeds.
- Aligning domain concepts with the repository glossary (`CONTEXT.md`).
- Creating Architectural Decision Records (ADRs) under `docs/adr/`.

---

## Core Guidelines

### 1. Smart Contract Documentation (Rust & Anchor)

#### A. Anchor IDL Integration

Always use triple-slash (`///`) doc comments for instruction handlers, account structs, struct fields, and custom errors. These are automatically extracted by Anchor v0.30+ into the JSON IDL's `"docs"` array fields for downstream client generation.

```rust
/// Represents the user's registry of purchased raffle tickets.
#[account]
pub struct TicketRegistry {
    /// Owner of the tickets.
    pub owner: Pubkey,
    /// Total number of active tickets purchased.
    pub ticket_count: u32,
    /// Reserved space for future reallocation.
    pub reserved: [u8; 32],
}
```

#### B. Security Annotations (`/// CHECK:`)

Anchor requires a `/// CHECK:` comment above any `UncheckedAccount` or `AccountInfo` field.

> [!CAUTION]
> **A generic comment like `/// CHECK: safe` is a security violation.**
> The comment MUST explain:
>
> 1. Exactly why the account is unchecked.
> 2. What manual checks are performed in the instruction handler (e.g. owner matching, address validation).

```rust
/// CHECK: Verified manually in handler via `pool_signer.key() == state.pool_signer`
pub pool_signer: AccountInfo<'info>,
```

#### C. PDA Seed Documentation

Always document the exact seeds and derivation path above any PDA account constraint:

```rust
/// PDA seeds: [b"ticket-registry", user.key().as_ref()]
#[account(
    init,
    payer = user,
    space = TicketRegistry::SIZE,
    seeds = [b"ticket-registry", user.key().as_ref()],
    bump
)]
pub ticket_registry: Account<TicketRegistry>,
```

---

### 2. TypeScript & Frontend Documentation

#### A. JSDoc/TSDoc for React Hooks and Services

Document all helper functions, transaction builders, and React custom hooks (especially those using `@solana/react-hooks` or framework-kit) with the following elements:

- `@param`: State the address, amount, or signer requirement.
- `@returns`: Describe the transaction signature, state object, or balance returned.
- `@throws`: Document common Solana exceptions (e.g. `SimulationError`, `TransactionExpiredError`).
- `@simulation`: Detail pre-flight validation checks if any.

```typescript
/**
 * Submits a transaction to stake SOL into the pool.
 *
 * @param amount - The amount of SOL to stake (in lamports).
 * @returns The transaction signature as a string.
 * @throws {WalletNotConnectedError} If no active wallet is connected.
 * @throws {SimulationError} If the transaction pre-flight simulation fails.
 */
export async function stakeSol(amount: bigint): Promise<string> {
  // logic...
}
```

#### B. Transaction Safety Documentation

When writing documentation for users or developers:

1. **Explain Pre-flight Simulations**: Document whether and how the client simulates transaction outcomes.
2. **Prioritization Fees**: Document how dynamic compute budgets and priority fees are calculated.

---

### 3. Repository-Level Documentation

#### A. Glossary & Domain terms (`CONTEXT.md`)

- Maintain a single `CONTEXT.md` file at the root containing the project's **Ubiquitous Language** (Glossary).
- Align all code naming (structs, functions, TS hooks) with this glossary. Do not drift to synonyms.

#### B. Architectural Decision Records (ADRs)

- Document resource-constrained design choices (e.g., state size reallocation, Kamino Lending API integrations, transaction chunking) inside `docs/adr/`.
- Format ADRs with Context, Decision, Status, and Consequences.

---

## Operating Procedure (How to Execute Documentation Tasks)

When tasked with documenting, reviewing, or auditing documentation:

### Step 1: Scan for Gaps

1. Search the Rust codebase for `UncheckedAccount` or `AccountInfo` and verify they have descriptive `/// CHECK:` comments.
2. Search for custom `#[error_code]` enums and confirm all variants have `///` doc comments.
3. Verify that all instructions and public account structs in `programs/*/src/` have `///` doc comments.
4. Search client-side code (`app/` or `src/`) for exported React hooks or helper functions and check for JSDoc headers.

### Step 2: Implement Doc Comments

- Add the missing docstrings, following the templates in this playbook.
- _Strict compliance_: Do not delete or modify unrelated code comments during the edit.

### Step 3: Verify the Build

Run the build tools to verify the documentation compiles without errors:

1. Validate Rustdoc builds:
   ```bash
   NO_DNA=1 cargo doc --no-deps
   ```
2. Validate Anchor IDL builds:
   ```bash
   NO_DNA=1 anchor build
   ```
   _Note: Ensure the generated IDL file under `target/idl/_.json` contains the extracted docstrings.\*
3. Validate TypeScript type-checking:
   ```bash
   npx tsc --noEmit
   ```

### Step 4: Deliverables Checklist

When concluding documentation changes, provide the user with:

- Clickable markdown links to modified code files.
- A summary of the added documentation.
- The outcome of the verify commands (`cargo doc` or `anchor build`).
