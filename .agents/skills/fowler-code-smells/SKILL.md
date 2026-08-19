---
name: fowler-code-smells
description: Martin Fowler's 12 classic code smells taxonomy, language-specific detection heuristics (Rust/Anchor, TypeScript/React), and paired refactoring playbooks. Use when auditing implementation plans, reviewing code diffs or PRs, designing clean architecture, or refactoring codebases.
user-invocable: true
license: MIT
metadata:
  version: 1.0.0
---

# Martin Fowler Code Smells & Refactoring Playbook

A comprehensive guide for detecting and refactoring code smells across software design, implementation plans, pull request diffs, and codebase audits.

---

## The 12 Fowler Code Smells Taxonomy

Every code smell pairing defines precisely **what it is** $\rightarrow$ **how to fix it**:

|   #    | Code Smell                 | What It Is                                                                            | How To Fix                                              |
| :----: | :------------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------ |
| **1**  | **Mysterious Name**        | A function, variable, or type whose name doesn't reveal what it does or holds.        | Rename it; if no honest name comes, the design's murky. |
| **2**  | **Duplicated Code**        | The same logic shape appears in more than one hunk or file.                           | Extract the shared shape, call it from both.            |
| **3**  | **Feature Envy**           | A method that reaches into another object's data more than its own.                   | Move the method onto the data it envies.                |
| **4**  | **Data Clumps**            | The same few fields or params keep travelling together (a type wanting to be born).   | Bundle them into one type, pass that.                   |
| **5**  | **Primitive Obsession**    | A primitive or string standing in for a domain concept that deserves its own type.    | Give the concept its own small type.                    |
| **6**  | **Repeated Switches**      | The same `switch`/`if`-cascade on the same type recurs.                               | Replace with polymorphism, or one map both sites share. |
| **7**  | **Shotgun Surgery**        | One logical change forces scattered edits across many files (primarily in diff mode). | Gather what changes together into one module.           |
| **8**  | **Divergent Change**       | One file or module is edited for several unrelated reasons.                           | Split so each module changes for one reason.            |
| **9**  | **Speculative Generality** | Abstraction, parameters, or hooks added for needs that do not exist.                  | Delete it; inline back until a real need shows.         |
| **10** | **Message Chains**         | Long `a.b().c().d()` navigation the caller shouldn't depend on.                       | Hide the walk behind one method on the first object.    |
| **11** | **Middle Man**             | A class or function that mostly just delegates onward.                                | Cut it, call the real target direct.                    |
| **12** | **Refused Bequest**        | A subclass or implementer that ignores or overrides most of what it inherits.         | Drop the inheritance, use composition.                  |

---

## Detailed Smell Breakdown & Refactoring Recipes

### 1. Mysterious Name

- **What it is:** Identifiers such as `data`, `info`, `temp`, `flag`, `manager`, `process_stuff()`, `handle_req()`, or vague single-letter variables outside tight mathematical loops.
- **Why it hurts:** Obscures intent and forces developers to read the implementation to understand what a symbol represents.
- **How to fix:**
  - Rename to reflect intent and domain concepts (e.g. `process_stuff()` $\rightarrow$ `distribute_yield_to_vault()`).
  - If a clear, concise name cannot be found, it is a signal that the function or type has multiple unrelated responsibilities and should be split.

### 2. Duplicated Code

- **What it is:** Identical or near-identical logic blocks appearing across multiple functions, files, or branches.
- **Why it hurts:** Bug fixes in one copy leave the others unpatched; increases maintenance burden.
- **How to fix:**
  - _Extract Function / Method_: Pull identical code into a shared helper function.
  - _Form Template Method / Parameterize_: If logic shapes match with minor variation, pass the varying element as a parameter or closure.
  - _Pull Up Method_: Move shared logic to a shared module or base trait.

### 3. Feature Envy

- **What it is:** A function or method that repeatedly queries getters or fields of a different object/struct to do calculations, rather than doing work on its own data.
- **Why it hurts:** Violates encapsulation and increases coupling between modules.
- **How to fix:**
  - _Move Method_: Relocate the function onto the object/struct whose data it accesses most.
  - _Extract and Move_: If only part of the function envies the other object, extract that specific chunk into a method on the target object.

### 4. Data Clumps

- **What it is:** Groups of 3+ fields or parameters that frequently appear together across function signatures, struct definitions, or component props (e.g., `startDate, endDate`, `street, city, zip, country`, `mint, authority, bump, amount`).
- **Why it hurts:** Creates parameter-heavy signatures and obscures cohesive domain concepts.
- **How to fix:**
  - _Introduce Parameter Object / Struct_: Group the clumped variables into a dedicated, meaningful type (e.g. `DateRange`, `Address`, `TransferParams`).
  - _Preserve Whole Object_: Instead of extracting fields and passing them individually, pass the whole domain object.

### 5. Primitive Obsession

- **What it is:** Using raw primitive types (`string`, `u64`, `number`, `Pubkey`, `boolean`) to represent domain concepts with specific rules, invariants, or units (e.g. raw `string` for an email or wallet address, raw `u64` for basis points or unix timestamps).
- **Why it hurts:** Loss of type safety, accidental mixing of incompatible units (e.g. seconds vs milliseconds, lamports vs USDC units), and duplication of validation logic across call sites.
- **How to fix:**
  - _Replace Primitive with Value Object / Newtype_: Wrap the primitive in a dedicated type (e.g. `struct BasisPoints(u16)`, `type WalletAddress = string & { readonly __brand: unique symbol }`).
  - _Replace Type Code with Class / Enum_: Replace string flags with typed enums.

### 6. Repeated Switches

- **What it is:** Multiple `switch` statements or `if-else` chains switching on the exact same type/enum across different parts of the codebase.
- **Why it hurts:** Adding a new case requires hunting down every switch statement, risking missed cases.
- **How to fix:**
  - _Replace Conditional with Polymorphism / Traits_: Implement a common trait/interface so each variant handles its own behavior.
  - _Replace with Lookup Map / Strategy Record_: Define a single mapping table or dictionary shared by all consumers.

### 7. Shotgun Surgery

- **What it is:** Making a single conceptual change (e.g., adding a new fee type, changing an error format) forces small edits across dozens of different files and modules.
- **Why it hurts:** High cognitive load, prone to missing updates, high merge conflict risk.
- **How to fix:**
  - _Move Method & Move Field_: Consolidate all behavior that changes together into a single module.
  - _Inline Class / Combine Functions_: Merge overly fragmented micro-abstractions into a cohesive domain service.

### 8. Divergent Change

- **What it is:** A single file, struct, or module is repeatedly modified for several completely unrelated business reasons (e.g., database schema changes, UI styling changes, and validation logic all touch `UserManager.ts`).
- **Why it hurts:** Violates the Single Responsibility Principle (SRP) and creates frequent merge conflicts.
- **How to fix:**
  - _Extract Class / Module_: Split the module into distinct modules, each having a single reason to change.
  - _Separate Domain from Infrastructure_: Decouple business rules from serialization, storage, and transport.

### 9. Speculative Generality

- **What it is:** Unused generic parameters, over-abstracted interfaces, unused hooks, or pass-through configuration options added "just in case" future requirements need them.
- **Why it hurts:** Adds mental friction and indirection with zero immediate business value.
- **How to fix:**
  - _Collapse Hierarchy / Inline Function_: Delete unused abstraction layers; collapse single-implementation interfaces.
  - _Remove Parameter_: Strip unused parameters, configuration flags, or dead callbacks.
  - _YAGNI (You Aren't Gonna Need It)_: Wait for a concrete second use case before creating an abstraction.

### 10. Message Chains

- **What it is:** Long navigation chains of the form `a.b().c().d().getValue()` traversing multiple object relationships.
- **Why it hurts:** Violates the Law of Demeter. Any structural change in intermediate objects breaks all callers.
- **How to fix:**
  - _Hide Delegate_: Provide a high-level method on the root object `a.getFinalValue()` that performs the navigation internally.
  - _Extract and Move_: Move the calling logic closer to the object that actually holds the needed data.

### 11. Middle Man

- **What it is:** A class, module, or function where more than half the methods do nothing but forward calls directly to another object without adding logic or value.
- **Why it hurts:** Useless indirection that clutters the call stack and code navigation.
- **How to fix:**
  - _Remove Middle Man_: Have the caller interact directly with the underlying object/service.
  - _Inline Method / Delegate_: Eliminate the wrapper layer.

### 12. Refused Bequest

- **What it is:** A subclass or trait implementer that leaves inherited methods unimplemented, throws `UnsupportedOperationException`, panics with `unimplemented!()`, or overrides methods with empty no-ops because it doesn't need them.
- **Why it hurts:** Signals a flawed type hierarchy where the implementer is not a true subtype.
- **How to fix:**
  - _Replace Inheritance with Composition / Delegation_: Include the former parent as a field rather than inheriting/implementing bloated interfaces.
  - _Interface Segregation_: Break large traits/interfaces into smaller, focused traits so implementers only take what they need.

---

## Language-Specific Smells & Patterns

### TypeScript & React (Next.js App Router)

#### 1. Data Clumps in Props & Hooks

```typescript
// ❌ Smelly (Data Clump in props)
function BondCard({ bondId, name, apy, lockupDays, totalValue }: {
  bondId: string;
  name: string;
  apy: number;
  lockupDays: number;
  totalValue: number;
}) { ... }

// ✅ Refactored (Cohesive Domain Type)
interface BondSummary {
  id: BondId;
  name: string;
  apy: BasisPoints;
  lockup: LockupDuration;
  totalValue: TokenAmount;
}

function BondCard({ bond }: { bond: BondSummary }) { ... }
```

#### 2. Primitive Obsession in Financial Math & State

```typescript
// ❌ Smelly (Raw primitives prone to unit confusion)
function calculateYield(
  amount: number,
  apy: number,
  durationDays: number
): number {
  return amount * (apy / 100) * (durationDays / 365);
}

// ✅ Refactored (Branded / Value Types)
type Lamports = bigint & { readonly __brand: unique symbol };
type BasisPoints = number & { readonly __brand: unique symbol };

function calculateYield(
  principal: Lamports,
  apy: BasisPoints,
  duration: DurationDays
): Lamports {
  // Safe checked calculation
}
```

#### 3. Feature Envy in Component Helpers

```typescript
// ❌ Smelly (UI component computes foreign business logic inline)
function UserDashboard({ account }: { account: UserAccount }) {
  const isEligibleForBonus =
    account.tier === "GOLD" &&
    account.activeBonds.length > 3 &&
    account.totalDeposited > 10_000;
  // ...
}

// ✅ Refactored (Moved onto Domain Model or Custom Hook)
function UserDashboard({ account }: { account: UserAccount }) {
  const isEligible = account.isEligibleForBonus();
  // ...
}
```

---

### Rust & Solana / Anchor

#### 1. Primitive Obsession vs. Typed Newtypes

```rust
// ❌ Smelly (Raw u64 everywhere - easy to mix up USDC vs Lamports vs BasisPoints)
pub fn calculate_interest(principal: u64, rate: u64, elapsed_seconds: u64) -> Result<u64> { ... }

// ✅ Refactored (Explicit Domain Types & Checked Arithmetic)
pub struct TokenAmount(pub u64);
pub struct BasisPoints(pub u16);
pub struct Seconds(pub i64);

impl TokenAmount {
    pub fn calculate_interest(&self, rate: BasisPoints, elapsed: Seconds) -> Result<TokenAmount> {
        // Checked calculation with clear domain semantics
    }
}
```

#### 2. Feature Envy in Instruction Handlers

```rust
// ❌ Smelly (Instruction helper interrogates vault state fields manually)
pub fn verify_vault_capacity(vault: &VaultState, deposit_amount: u64) -> Result<()> {
    require!(vault.total_deposited + deposit_amount <= vault.max_capacity, ErrorCode::VaultFull);
    require!(!vault.is_paused, ErrorCode::VaultPaused);
    Ok(())
}

// ✅ Refactored (Encapsulated on VaultState struct)
impl VaultState {
    pub fn ensure_can_deposit(&self, amount: u64) -> Result<()> {
        require!(!self.is_paused, ErrorCode::VaultPaused);
        let new_total = self.total_deposited.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        require!(new_total <= self.max_capacity, ErrorCode::VaultFull);
        Ok(())
    }
}
```

#### 3. Refused Bequest in Rust Traits

```rust
// ❌ Smelly (Trait too wide, forcing implementer to panic)
pub trait YieldProvider {
    fn deposit(&mut self, amount: u64) -> Result<()>;
    fn harvest(&mut self) -> Result<u64>;
    fn leverage_borrow(&mut self, amount: u64) -> Result<()>; // Not supported by all providers!
}

impl YieldProvider for SimpleStaking {
    fn leverage_borrow(&mut self, _amount: u64) -> Result<()> {
        Err(ErrorCode::FeatureNotSupported.into()) // Refused bequest!
    }
}

// ✅ Refactored (Segregated Traits / Composition)
pub trait YieldDepositor {
    fn deposit(&mut self, amount: u64) -> Result<()>;
    fn harvest(&mut self) -> Result<u64>;
}

pub trait LeveragedBorrower {
    fn leverage_borrow(&mut self, amount: u64) -> Result<()>;
}
```

---

## False-Positive Guardrails (Do NOT Flag)

When reviewing Solana and TypeScript code, distinguish necessary framework patterns from genuine smells:

1. **Anchor `Accounts` Structs**:
   - _Not a Data Clump_: Solana's execution engine requires explicit account lists in context structs (e.g. `#[derive(Accounts)] pub struct Initialize<'info>`). This is an architectural requirement of the SVM.
2. **Exhaustive `match` on Closed Rust Enums**:
   - _Not Repeated Switches_: Using `match` on internal domain state enums in 1 or 2 state transition functions is idiomatic Rust, verified at compile-time. Only flag when the exact same branch cascade is copy-pasted across many unrelated modules.
3. **Adapter & Wallet Boundaries**:
   - _Not a Middle Man_: A wrapper adapting legacy wallet adapters to modern `@solana/client` interfaces serves a boundary isolation purpose.
4. **Checked Arithmetic Encodings**:
   - _Not Duplication_: Explicit `checked_add` / `checked_mul` or `try_into()` guards across financial calculations are safety requirements, not boilerplate duplication.

---

## Smell Audit Diagnostic Format

When reporting detected code smells, always provide:

1. **Target Symbol / Location** (`file:line` or struct/method name).
2. **Smell Name** (from the 12 Fowler smells).
3. **What It Is** (concrete observation of the anti-pattern).
4. **How To Fix** (prescribed refactoring technique).
5. **Before $\rightarrow$ After Refactoring Diff**.
