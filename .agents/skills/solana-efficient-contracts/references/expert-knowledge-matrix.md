# Expert Knowledge Matrix: SVM Runtime & Anchor Memory Mechanics

## 1. SVM Core Execution Architecture & BPF/SBF Constraints

An expert in writing efficient Solana smart contracts must understand the low-level execution characteristics of the Solana Virtual Machine (SVM) and the Solana Bytecode Format (SBF).

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      SVM INSTRUCTION EXECUTION BOUNDS                     │
├──────────────────────────┬────────────────────────────────────────────────┤
│ Constraint               │ Limit & Behavior                               │
├──────────────────────────┼────────────────────────────────────────────────┤
│ Max Transaction CU       │ 1,400,000 Compute Units (requested via ALT/IX) │
│ Default Instruction CU   │ 200,000 Compute Units                          │
│ Stack Memory Frame       │ 4,096 Bytes (4 KB) per stack frame             │
│ Heap Memory Allocation   │ 32,768 Bytes (32 KB) fixed heap per execution  │
│ Account Data Max Size    │ 10,485,760 Bytes (10 MB)                       │
│ Max Realloc Increase     │ 10,240 Bytes (10 KB) per instruction call      │
│ Max Call Depth           │ 64 frames (CPI stack limit)                    │
│ Max Accounts per TX      │ 64 accounts (with Versioned TX / ALT v0)       │
└──────────────────────────┴────────────────────────────────────────────────┘
```

### Stack & Heap Limits (4 KB Stack / 32 KB Heap)

- **Stack Spills & Overflow**: Declaring large fixed arrays (e.g. `let buf = [0u8; 4096];`) directly inside instruction stack frames causes immediate BPF stack overflow crashes.
- **Heap Allocations**: The heap allocator is a fast bump-allocator with 32 KB space. Dynamic allocations (`Vec::new()`, `Box::new()`, `String`) consume heap space. Allocations cannot be freed to re-use heap memory within the same instruction frame!
- **Mitigation**: Use zero-copy pointer casting (`AccountLoader`) to reference account bytes in-place on the SVM input buffer without copying data to stack or heap.

### 8-Byte Memory Alignment & Unaligned Access

- SBF architecture requires 64-bit (8-byte) alignment for integer primitives (`u64`, `i64`, `f64`, `Pubkey`, pointers).
- Accessing unaligned memory addresses (e.g. reading a `u64` starting at byte index 3) triggers an unaligned memory access error or severely penalizes execution CU.
- Anchor's `#[account(zero_copy)]` requires structures to implement `bytemuck::Pod` and `bytemuck::Zeroable`, enforcing strict byte alignment and zeroing out implicit compiler padding bytes.

---

## 2. Serialization & Deserialization Costs (Borsh vs. Zero-Copy)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                 SERIALIZATION STRATEGY CU COST COMPARISON                 │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
      ┌────────────────────────────┼────────────────────────────┐
      ▼                            ▼                            ▼
┌─────────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────────┐
│ Borsh Deserialization   │  │ Zero-Copy (`bytemuck`)   │  │ Raw Byte Slice Access   │
│ `Account<'info, T>`     │  │ `AccountLoader<'info, T>`│  │ `UncheckedAccount`      │
├─────────────────────────┤  ├──────────────────────────┤  ├─────────────────────────┤
│ • CU: ~5,000 - 50,000+  │  │ • CU: ~100 - 300 CU      │  │ • CU: ~20 - 80 CU       │
│ • Copies to Heap/Stack  │  │ • Zero memory copy       │  │ • Direct byte slicing   │
│ • Deserializes fields   │  │ • Direct pointer cast    │  │ • Manual offset layout  │
│ • O(N) cost with size   │  │ • O(1) constant CU       │  │ • O(1) constant CU       │
└─────────────────────────┘  └──────────────────────────┘  └─────────────────────────┘
```

### Borsh Tax (`Account<'info, T>`)

- Anchor's default account wrapper `Account<'info, T>` executes Borsh deserialization on instruction entry:
  1. Verifies the 8-byte SHA256 discriminator (`sha256("account:<StructName>")[..8]`).
  2. Allocates stack/heap space and unpacks byte-by-byte into the Rust struct fields.
- **Cost**: A struct with 1 KB of nested data costs ~5,000–12,000 CUs just to deserialize on entry and re-serialize on exit. A 10 KB struct can consume over 50,000 CUs!

### Zero-Copy (`AccountLoader<'info, T>`)

- `AccountLoader<'info, T>` maps the underlying account payload directly to a Rust struct reference via pointer dereferencing (`Ref<'info, T>` or `RefMut<'info, T>`).
- **Cost**: Fixed ~100 CU cost regardless of whether the struct is 100 bytes or 10 MB.
- **Requirement**: Struct must use `#[account(zero_copy)]` or `#[account(zero_copy(unsafe))]`, represent fixed byte sizes, be `repr(C)`, and have zero implicit padding gaps.

### Raw Byte Access (`RefCell<&mut [u8]>`)

- For dynamically sized or growing payload structures (e.g. ticket registries, orderbooks exceeding 10 KB), raw byte offset parsing bypasses struct deserialization entirely.
- Access via `UncheckedAccount` or `AccountInfo::data.borrow_mut()` allows manual offset indexing: `&data[offset..offset+LEN]`.

---

## 3. Storage & Rent Economics

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        ACCOUNT RENT CALCULATIONS                          │
├───────────────────────────────────────────────────────────────────────────┤
│ Rent Exemption Overhead = 128 Bytes (Header) + 8 Bytes (Discriminator)    │
│ Total Account Storage Bytes = Data Bytes + 136 Bytes                      │
│ Rent Cost (Lamports) ≈ Total Storage Bytes × 6,960 Lamports/Byte          │
├───────────────────────────────────────────────────────────────────────────┤
│ Example: 1,000 Byte Account Data                                          │
│ Total Bytes = 1,000 + 136 = 1,136 Bytes                                   │
│ Rent Exempt SOL = 1,136 × 6,960 = 7,906,560 Lamports (~0.0079 SOL)        │
└───────────────────────────────────────────────────────────────────────────┘
```

### Rent Exemption Mechanics

- Accounts on Solana must maintain a minimum lamport balance proportional to their byte allocation to remain rent-exempt.
- Reclaiming rent via `#[account(close = destination)]` transfers all lamports out of the account and zeroes out the account discriminator to prevent revival.

### Reallocation (`realloc`) Rules

- An account's data size can be increased or decreased dynamically using `account.realloc(new_len, zero_init)`.
- **Per-Instruction Limit**: A single instruction can grow an account by a maximum of 10,240 bytes (10 KB).
- **Rent Top-Up**: Expanding data size requires transferring lamports from the payer to the account to maintain rent exemption. Reducing data size allows transferring excess rent back to the user.

---

## 4. Sysvar & CPI Cost Metrics

- **Cross-Program Invocations (CPI)**:
  - Base `invoke` or `invoke_signed` overhead: ~1,000 CUs per CPI call (for context switching and account validation).
  - Target program execution CUs add directly to the total instruction budget.
- **Sysvar Access**:
  - Passing Sysvar accounts via `Accounts` (e.g. `Sysvar<'info, Clock>`) is optimized in modern Anchor, but reading sysvar via direct getter `Clock::get()?` is even cleaner and consumes minimal CUs via native SVM syscalls.
