# Off-Chain Event Indexing, Client SDKs & Testing Integration

## 1. Client Event Parsing Architectures

Off-chain clients and indexers process Solana smart contract events through three main ingestion pipelines:

```
                                  SOLANA EVENT INGESTION PIPELINES
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          ▼                                      ▼                                      ▼
┌──────────────────┐                   ┌──────────────────┐                   ┌──────────────────┐
│  Anchor SDK /    │                   │ Yellowstone      │                   │ Helius / Shyft   │
│  WebSocket RPC   │                   │ Geyser gRPC      │                   │ Webhooks         │
└─────────┬────────┘                   └─────────┬────────┘                   └─────────┬────────┘
          │                                      │                                      │
          ▼                                      ▼                                      ▼
 Parsed Event Listener                  High-Throughput Stream                 HTTP POST JSON Payload
 (`program.addEventListener`)          (Logs & Inner Instructions)             (Filtered by Program ID)
```

---

## 2. Framework-Specific Implementations

### Pipeline A: `@coral-xyz/anchor` `EventParser` & Listeners

Anchor provides built-in mechanisms for subscribing to real-time events over WebSocket or parsing historic events from transaction signatures.

#### 1. Real-time Event Listener (`program.addEventListener`)

```typescript
import { Program } from "@coral-xyz/anchor";
import { MyProtocol } from "../target/types/my_protocol";

export function setupEventListener(program: Program<MyProtocol>) {
  const listenerId = program.addEventListener(
    "BondsPurchased",
    (event, slot, signature) => {
      console.log(`[Slot ${slot}] Purchase detected! Tx: ${signature}`);
      console.log(`User: ${event.user.toBase58()}`);
      console.log(`Amount: ${event.amount.toString()} USDC`);
      console.log(`Bonds Purchased: ${event.bonds}`);
    }
  );

  return async () => {
    await program.removeEventListener(listenerId);
  };
}
```

#### 2. Historic Transaction Log Parser (`EventParser`)

```typescript
import { EventParser, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export async function parseTxEvents(
  connection: Connection,
  program: Program<any>,
  signature: string
) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta || !tx.meta.logMessages) return [];

  const parser = new EventParser(program.programId, program.coder);
  const events = Array.from(parser.parseLogs(tx.meta.logMessages));

  for (const event of events) {
    console.log(`Parsed Event: ${event.name}`, event.data);
  }

  return events;
}
```

---

### Pipeline B: Modern `@solana/client` / `@solana/kit` Discriminator Parsing

When building applications using `@solana/client` or `@solana/kit` without legacy `@coral-xyz/anchor` bundle overhead, parse binary event buffers manually using explicit 8-byte discriminators:

```typescript
import { getBase64Decoder, getBytesEncoder } from "@solana/kit";

// Anchor event discriminator: sha256("event:BondsPurchased")[0..8]
const BONDS_PURCHASED_DISCRIMINATOR = new Uint8Array([
  // First 8 bytes of SHA-256 hash of "event:BondsPurchased"
  0x8d, 0x48, 0xb7, 0x05, 0x82, 0x89, 0xa1, 0x4b,
]);

export function isBondsPurchasedEvent(dataBuffer: Uint8Array): boolean {
  if (dataBuffer.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (dataBuffer[i] !== BONDS_PURCHASED_DISCRIMINATOR[i]) return false;
  }
  return true;
}
```

---

### Pipeline C: Yellowstone Geyser gRPC Indexing (`inner_instructions` for CPI Events)

Yellowstone Geyser provides sub-millisecond gRPC streams directly from Solana validator nodes.

#### Filtering Strategy for `emit_cpi!` (CPI Events):

```rust
// Rust Geyser gRPC Subscription Filter Configuration
use yellowstone_grpc_proto::geyser::SubscribeRequestFilterTransactions;

pub function get_cpi_event_filter(program_id: String) -> SubscribeRequestFilterTransactions {
    SubscribeRequestFilterTransactions {
        vote: Some(false),
        failed: Some(false),
        signature: None,
        account_include: vec![program_id.clone()], // Filter by program account
        account_exclude: vec![],
        account_required: vec![],
    }
}
```

When a transaction update arrives via gRPC, iterate through `tx.meta.inner_instructions`. Filter for inner calls where `instruction.program_id == YOUR_PROGRAM_ID` and check the first 8 bytes of `instruction.data` against your event discriminator table.

---

## 3. Indexing Governance Deltas & Account Closure Finality

### Ingesting Parameter Changes (`FeeBpsUpdated`)
For administrative events (Pillar 2), indexers should store historical time-series diffs to construct protocol audit trails:

```typescript
export function recordGovernanceEvent(event: {
  authority: string;
  config: string;
  oldFeeBps: number;
  newFeeBps: number;
  timestamp: number;
}) {
  console.log(`[Governance] Config ${event.config} updated by ${event.authority}`);
  console.log(`Fee changed from ${event.oldFeeBps} bps -> ${event.newFeeBps} bps`);
  // Insert into historical parameter audit table
}
```

### Ingesting Pre-Closure Finality Events (`PositionClosed`)
When accounts are closed with `close = destination`, on-chain account queries return `null`. Indexers must treat pre-closure events as the definitive tombstone record:

```typescript
export function recordAccountClosure(event: {
  user: string;
  position: string;
  principalReturned: bigint;
  finalRewardPaid: bigint;
  timestamp: number;
}) {
  // Mark position as CLOSED in off-chain database and record final settled payout
  console.log(`Position ${event.position} closed. Final reward: ${event.finalRewardPaid}`);
}
```

---

## 4. Testing Event Emission in Rust Integration Tests (LiteSVM)

In-process testing with **LiteSVM** is the fastest way to verify event emission logic without running local validator nodes.

### LiteSVM Event Verification Patterns in Rust

```rust
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

#[test]
fn test_verify_program_log_and_cpi_event_emission() {
    let mut svm = LiteSVM::new();
    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../target/deploy/my_protocol.so");
    svm.add_program(program_id, program_bytes);

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![], // Add required accounts
        data: vec![/* instruction discriminator + args */],
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        svm.latest_blockhash(),
    );

    let tx_result = svm.send_transaction(tx).expect("Transaction failed");

    // ========================================================================
    // 1. Asserting Standard emit! (Program Log Emission)
    // ========================================================================
    let event_logged = tx_result.logs.iter().any(|line| line.contains("Program data:"));
    assert!(event_logged, "Expected transaction logs to contain emitted event data");

    let event_line = tx_result
        .logs
        .iter()
        .find(|line| line.contains("Program data:"))
        .expect("Event line not found in logs");
    let base64_payload = event_line.replace("Program data: ", "");
    println!("Emitted Event Base64: {}", base64_payload);

    // ========================================================================
    // 2. Asserting Secure emit_cpi! (Inner Instructions Emission)
    // ========================================================================
    let cpi_event_emitted = tx_result.inner_instructions.iter().any(|inner_ix_set| {
        inner_ix_set.iter().any(|ix| ix.instruction.program_id == program_id)
    });
    assert!(cpi_event_emitted, "Expected CPI inner instruction event from target program");
}
```

