# Solana Anchor Smart Contract Efficiency: Micro & Macro Best Practices

## 1. Micro-Optimizations (Storage & Field Layout)

### Field Ordering & Explicit Padding

In Rust `repr(C)` structs, fields are laid out in memory in the exact order they are declared. Aligning fields from largest byte size to smallest byte size eliminates implicit compiler-inserted padding bytes.

```rust
// ❌ UNOPTIMIZED LAYOUT (Consumes 32 Bytes due to implicit padding)
#[account]
pub struct BadLayout {
    pub active: bool,     // 1 byte (+7 bytes implicit padding)
    pub amount: u64,      // 8 bytes
    pub tier: u8,         // 1 byte (+7 bytes implicit padding)
    pub authority: Pubkey,// 32 bytes
    pub count: u32,       // 4 bytes (+4 bytes implicit padding)
}

// ✅ OPTIMIZED LAYOUT (Consumes 48 Bytes tightly packed with zero waste)
#[account(zero_copy)]
#[repr(C)]
pub struct EfficientLayout {
    pub authority: Pubkey,// 32 bytes (8-byte aligned)
    pub amount: u64,      // 8 bytes  (8-byte aligned)
    pub count: u32,       // 4 bytes  (4-byte aligned)
    pub tier: u8,         // 1 byte   (1-byte aligned)
    pub active: u8,       // 1 byte   (1-byte aligned, 1 = true, 0 = false)
    pub _reserved: [u8; 2],// 2 bytes explicit padding to reach multiple of 8
}
```

### Bit-Packing Flags

Instead of allocating multiple 1-byte `bool` fields, pack up to 8 boolean flags into a single `u8` (or 64 flags into a `u64`) using bitwise masks.

```rust
pub const FLAG_ACTIVE: u8    = 1 << 0; // 0b0000_0001
pub const FLAG_FROZEN: u8    = 1 << 1; // 0b0000_0010
pub const FLAG_VERIFIED: u8  = 1 << 2; // 0b0000_0100

// Check flag:
let is_active = (user_state.flags & FLAG_ACTIVE) != 0;

// Set flag:
user_state.flags |= FLAG_ACTIVE;

// Unset flag:
user_state.flags &= !FLAG_ACTIVE;
```

### Pubkey Indexing (Replacing 32-Byte Keys with Integer IDs)

If an account stores an array or list of referenced entities (e.g., token pools, whitelisted users, market assets), do NOT store repeated 32-byte `Pubkey`s. Instead:

- Store a single master lookup array mapping `u16` or `u32` index IDs to `Pubkey`s.
- Store `u16` (2 bytes) or `u32` (4 bytes) index IDs in item records.
- **Savings**: Reduces storage overhead per record from 32 bytes down to 2 or 4 bytes (87.5% reduction!).

---

## 2. Compute Unit (CU) Reduction Best Practices

### Lazy State Evaluation

Do not process active state transitions or interest calculations for every user on every block. Instead, compute state delta lazily whenever a user initiates an instruction.

```rust
impl UserEntry {
    /// Lazy merge pending balances only when user performs an action
    pub fn lazy_merge(&mut self, current_cycle_id: u32) -> Result<()> {
        if self.merged_through_cycle < current_cycle_id {
            self.active = self.active.checked_add(self.pending)
                .ok_or(error!(ErrorCode::MathOverflow))?;
            self.pending = 0;
            self.merged_through_cycle = current_cycle_id;
        }
        Ok(())
    }
}
```

### Cheap-Check Reordering & Fail-Fast Validation

Arrange account checks and assertions in order of compute complexity:

1. Cheap bitmask / signer / bump checks first.
2. Moderate key matching and `has_one` constraints second.
3. Heavy Borsh deserialization / zero-copy loads / math checks last.

```rust
// ✅ Fail fast before executing costly logic:
require!(ctx.accounts.signer.is_signer, ErrorCode::Unauthorized);
require!(ctx.accounts.vault.is_active != 0, ErrorCode::VaultFrozen);

// Only now load heavy zero-copy state or execute math:
let mut state = ctx.accounts.registry.load_mut()?;
state.process_transaction(amount)?;
```

### Log Stripping & Static Strings

- Each `msg!("User balance: {}", balance)` call invokes dynamic string formatting engines, costing 100–300 CUs.
- Use static string literals `msg!("TX_SUCCESS")` or strip logs in production builds using cargo features (`#[cfg(feature = "debug-logs")]`).

---

## 3. High-Throughput Macro Architectural Patterns

### Header-Only Struct + Raw Byte Dynamic Expansion

For registry or ticket accounts that exceed 10 KB or grow dynamically, combine a zero-copy fixed header struct with raw byte slice access.

```rust
/// Header struct occupying byte offsets 0..96 (8 discriminator + 88 fields)
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct RegistryHeader {
    pub pool_id: u32,
    pub capacity: u32,
    pub user_count: u32,
    pub version: u8,
    pub _reserved: [u8; 75],
}

// User records start at offset 96 in raw data bytes:
// Byte Offset = 96 + (index * 64)
```

### Batched Crank Transactions

When updating global protocol state across thousands of users (e.g. prize distribution, liquidations, epoch yields), process updates in chunked crank transactions:

- Define `draw_prepared_up_to` or `processed_index` state counters in the header.
- Allow crank callers (bots/relayers) to process $N$ entries per instruction call within the 1.4M CU limit until the entire batch is completed.
