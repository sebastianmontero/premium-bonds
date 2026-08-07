# Solana Event Emission Paradigms & Benchmark Specifications

## Overview of Solana Event Architecture

On Solana, there is no native EVM-style `LOG` opcode or dedicated event log storage in the transaction receipt. Events are produced during transaction execution and stored in transaction metadata. Off-chain indexers (Geyser, RPC nodes, Helius webhooks) reconstruct event streams by parsing transaction execution traces.

There are four main paradigms for emitting events in Solana smart contracts:

1. **Program Log Emission (`emit!`)**
2. **CPI-Based Event Emission (`emit_cpi!`)**
3. **SPL No-Op Program CPI (`spl-noop`)**
4. **Direct Sycall Emission (`sol_log_data`)**

---

## 1. Paradigm Breakdown

### Paradigm A: Program Log Emission (`emit!`)

Anchor's standard `emit!` macro serializes event structs using Borsh, prepends an 8-byte discriminator computed via `sha256("event:<EventName>")[..8]`, base64-encodes the buffer, and outputs a formatted string via `sol_log_data`.

#### Emission Pipeline:

```
┌──────────────┐    Borsh     ┌──────────────┐   Base64    ┌─────────────────┐   Syscall   ┌────────────────────────┐
│ Event Struct │ ───────────► │ 8-Byte Disc  │ ──────────► │ Base64 String   │ ───────────►│ Log Buffer             │
│ (Rust Struct)│              │ + Payload    │             │ "Program data:" │             │ "Program data: Qm..."  │
└──────────────┘              └──────────────┘             └─────────────────┘             └────────────────────────┘
```

- **CU Footprint**: ~1,200 – 2,200 CUs per emission.
- **Log Bloat**: Base64 encoding inflates the raw byte payload size by **33%** (4 bytes generated for every 3 binary bytes).
- **Log Buffer Capacity**: Solana limits total log messages per transaction to **10,240 bytes (10 KB)**. Exceeding this limit causes transaction failure (`LogTruncated` or simulation error).
- **Account Requirements**: None. Does not require passing additional accounts in the instruction context.

### Paradigm B: CPI-Based Event Emission (`emit_cpi!`)

Anchor 0.29 introduced `emit_cpi!`. Instead of printing base64 text to program logs, the program executes a Self-CPI (or CPI to an Event Authority PDA `__event_authority`), passing the raw Borsh-serialized event directly inside instruction data.

#### Emission Pipeline:

```
┌──────────────┐    Borsh     ┌────────────────────────────┐    Self-CPI    ┌───────────────────────────┐
│ Event Struct │ ───────────► │ 8-Byte Disc + Raw Payload   │ ─────────────► │ Inner Instruction Trace   │
│ (Rust Struct)│              │ (Binary Instruction Data)  │                │ `Call event_authority...` │
└──────────────┘              └────────────────────────────┘                └───────────────────────────┘
```

- **CU Footprint**: ~2,500 – 4,500 CUs per emission (due to CPI stack frame pushing and account validation).
- **Log Bloat**: 0% bloat (raw binary instruction payload).
- **Log Buffer Impact**: Completely bypasses the 10 KB transaction log string buffer.
- **Account Requirements**: Requires passing `event_authority` PDA (`[b"__event_authority"]`) and `program` (Self Program account) in the instruction context.

### Paradigm C: SPL No-Op CPI (`spl-noop`)

Used primarily in non-Anchor native programs (Pinocchio, Steel, Shank). Emits events by executing a CPI to the SPL No-Op Program (`noop111111111111111111111111111111111111111`).

- **CU Footprint**: ~1,800 – 2,800 CUs per emission.
- **Log Buffer Impact**: Bypasses 10 KB log string buffer.
- **Account Requirements**: Requires passing `spl_noop` program account (`noop111111111111111111111111111111111111111`).

### Paradigm D: Direct Syscall (`sol_log_data`)

Direct call to the Solana SVM native C-binding syscall `sol_log_data(&[&binary_slice])`.

- **CU Footprint**: ~600 – 1,200 CUs per emission.
- **Log Bloat**: +33% base64 text bloat (runtime base64 encodes slices automatically into `Program data:`).
- **Account Requirements**: None.

---

## 2. Comprehensive Benchmark & Feature Matrix

| Feature / Metric                | `emit!` (Anchor Log)         | `emit_cpi!` (Anchor CPI)                          | `spl-noop` CPI                      | `sol_log_data` (Native)      |
| :------------------------------ | :--------------------------- | :------------------------------------------------ | :---------------------------------- | :--------------------------- |
| **Compute Units (CU)**          | 1,200 – 2,200 CUs            | 2,500 – 4,500 CUs                                 | 1,800 – 2,800 CUs                   | 600 – 1,200 CUs              |
| **Log Buffer Limit (10 KB)**    | Consumes log buffer          | **Bypasses log buffer**                           | **Bypasses log buffer**             | Consumes log buffer          |
| **Payload Encoding**            | Base64 (+33% bloat)          | Raw Binary (0% bloat)                             | Raw Binary (0% bloat)               | Base64 (+33% bloat)          |
| **Instruction Accounts Needed** | 0 extra accounts             | 2 extra accounts (`event_authority`, `program`)   | 1 extra account (`noop_program`)    | 0 extra accounts             |
| **Spoofing Resistance**         | Low (Text parsing ambiguity) | **Cryptographically High** (CPI Program ID check) | **High** (CPI Target Program check) | Low (Text parsing ambiguity) |
| **IDL Auto-Generation**         | Fully Supported              | Fully Supported                                   | Manual Schema                       | Manual Schema                |
| **Geyser gRPC Filter**          | Log Filter (`Program data:`) | Inner Instruction Filter                          | Inner Instruction Filter            | Log Filter (`Program data:`) |

---

## 3. High-Throughput & Batched Event Patterns

When emitting events inside high-frequency loops (such as DEX order fills, crank liquidations, or batch prize drawings), emitting individual events per iteration quickly causes CU exhaustion or log buffer truncation.

### Pattern 1: Event Aggregation (Vector Batching)

Instead of emitting N separate events:

```rust
// ❌ BAD: Emitting in a loop consumes N * 2,000 CUs and hits 10KB log limit
for fill in fills {
    emit!(OrderFilled { fill_id: fill.id, amount: fill.amount });
}
```

Aggregate into a single vector-backed event:

```rust
// ✅ GOOD: Emits 1 event with single discriminator and batch payload
#[event]
pub struct BatchOrdersFilled {
    pub pool_id: u32,
    pub fills: Vec<OrderFillSummary>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OrderFillSummary {
    pub fill_id: u64,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
}
```

### Pattern 2: Zero-Copy Memory Slicing for Heavy Events

For ultra-large event payloads, avoid Rust stack frame allocation and heap re-allocations during serialization. Use pre-allocated slices or write binary fields directly into fixed-size byte buffers before passing to `sol_log_data`.

```rust
// Direct zero-copy slice emission to save heap CUs
let mut buffer = [0u8; 128];
buffer[0..8].copy_from_slice(&EVENT_DISCRIMINATOR);
buffer[8..40].copy_from_slice(user.as_ref());
buffer[40..48].copy_from_slice(&amount.to_le_bytes());

anchor_lang::solana_program::log::sol_log_data(&[&buffer]);
```
