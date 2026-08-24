# Security, Anti-Spoofing & Privacy in Solana Event Emission

## 1. The Event Spoofing Vulnerability Vector

### How Log Spoofing Works

On Solana, any program executed within a transaction can invoke `sol_log_data` or print arbitrary text to the execution log. Standard Anchor `emit!` log outputs appear in the RPC log stream as:

```text
Program 11111111111111111111111111111111 invoke [1]
Program log: Instruction: Deposit
Program data: 8mZ+8+9w1bY... (Base64 Anchor event payload)
Program 11111111111111111111111111111111 success
```

#### The Exploit Scenario:

1. An attacker deploys a malicious program (`EvilProgram`).
2. `EvilProgram` calculates the exact 8-byte Anchor event discriminator for your program's `TokensDeposited` event (`sha256("event:TokensDeposited")[..8]`).
3. `EvilProgram` constructs a fake `TokensDeposited { user: attacker, amount: 1_000_000_USDC }` event, base64-encodes it, and logs `Program data: <fake_payload>`.
4. If an off-chain indexer, backend service, or webhook naive parser listens for `Program data:` string matches **without strict Program ID contextual validation**, the indexer will interpret the fake event as a valid deposit and grant the attacker unearned off-chain credits or trigger unauthorized API actions!

---

## 2. Spoofing Mitigation Strategies

### Strategy A: Cryptographic Verification via `emit_cpi!` (Recommended for Financial Events)

Anchor's `emit_cpi!` macro provides native, runtime-enforced event verification via an **Event Authority PDA**.

#### Architectural Mechanics:

1. **Event Authority PDA Derivation**:
   ```rust
   // Seed constraint enforced by Anchor compiler
   pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";
   ```
2. **CPI Stack Trace Integrity**:
   When `emit_cpi!` is called, the Solana runtime records an inner instruction invocation (`Call`) in the transaction execution trace:
   ```json
   {
     "programId": "YourProgram1111111111111111111111111111111",
     "accounts": ["EventAuthorityPDA1111111111111111111111111"],
     "data": "Base58OrBase64BorshEventPayload"
   }
   ```
3. **Immutability Guarantee**:
   The Solana runtime runtime system populates `inner_instructions` directly from the call stack. An attacker program `EvilProgram` **cannot** generate an inner instruction trace where the invoking program is reported as `YourProgram`. Indexers filtering by `inner_instructions` targeting `YourProgram` are 100% immune to log spoofing.

#### Anchor Rust Implementation:

> [!IMPORTANT]
> In Anchor 0.29+, the program module **MUST** be decorated with `#[event_cpi]` above `#[program]` to generate the required CPI event dispatcher and authority verification hooks.

```rust
use anchor_lang::prelude::*;

#[event_cpi]
#[program]
pub mod my_protocol {
    use super::*;

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // ... process deposit ...

        // Emit CPI event securely
        emit_cpi!(TokensDeposited {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Event authority PDA validated by emit_cpi! macro
    pub event_authority: AccountInfo<'info>,
    /// CHECK: Self program account validated by emit_cpi! macro
    pub program: Program<'info, MyProtocol>,
}
```

---

### Strategy B: Protecting Governance & Administrative Telemetry

Governance actions (e.g. updating fees, changing multisig authorities, emergency pausing) are prime targets for log spoofing. Malicious actors could emit fake `FeeUpdated` or `EmergencyPaused` logs to trigger fake off-chain liquidation freezes or front-run user reactions.

1. **Prefer `emit_cpi!` for Governance**: Use `emit_cpi!` for any instruction that changes protocol-wide configuration.
2. **Strict Verification on Log Indexers**: If using log-based `emit!`, indexers must strictly verify the program execution stack depth (Strategy C below) and cross-reference the `authority` signer key.

---

### Strategy C: Strict Program Context Validation (For Log-Based `emit!`)

If `emit!` is used due to account constraints or CU budget limits, off-chain indexers **MUST** implement stateful log context parsing:

#### Defensive Log Parsing Logic (TypeScript / Node.js):

```typescript
interface LogContext {
  currentProgramId: string | null;
  programStack: string[];
}

function parseVerifiedEvents(logs: string[], targetProgramId: string) {
  const context: LogContext = { currentProgramId: null, programStack: [] };
  const verifiedEvents: string[] = [];

  for (const log of logs) {
    // 1. Track Program Invocation
    const invokeMatch = log.match(/^Program ([1-9A-HJ-NP-Za-km-z39]+) invoke/);
    if (invokeMatch) {
      const progId = invokeMatch[1];
      context.programStack.push(progId);
      context.currentProgramId = progId;
      continue;
    }

    // 2. Track Program Exit/Success
    if (
      log.startsWith("Program ") &&
      (log.includes("success") || log.includes("failed"))
    ) {
      context.programStack.pop();
      context.currentProgramId =
        context.programStack[context.programStack.length - 1] || null;
      continue;
    }

    // 3. Process Program Data ONLY if top of execution stack matches target program
    if (
      log.startsWith("Program data: ") &&
      context.currentProgramId === targetProgramId
    ) {
      const base64Data = log.replace("Program data: ", "").trim();
      verifiedEvents.push(base64Data);
    }
  }

  return verifiedEvents;
}
```

> [!WARNING]
> Do NOT rely on simple string match `log.includes("Program data:")` without tracking `invoke` / `success` stack depth! Cross-Program Invocations (CPIs) temporarily delegate control to external programs, which can output malicious log lines while inside a CPI frame.

---

## 3. Data Privacy & Confidentiality Best Practices

### Rule 1: Never Log PII or Unhashed Secrets

On-chain events are immutably stored across hundreds of validator nodes and RPC archival providers.

- **Never log**: Private keys, recovery phrases, user email addresses, IP hashes, or unhashed passwords.
- **Commit-Reveal Schemes**: When generating randomness or executing private draws (e.g., yield draw lotteries), emit only the **hash of the commitment** (`sha256(secret || seed)`) in preliminary events. Emit the unmasked seed only AFTER the commitment window has closed.

### Rule 2: Precision & Numeric Safe Boundaries

JavaScript numbers lose precision above $2^{53} - 1$ (`9,007,199,254,740,991`).

- When emitting `u64` or `u128` amounts in events (e.g. SPL Token base units), off-chain indexers and client SDKs must parse them as `BigInt` or `BN` strings.
- Never cast `u64` token amounts to standard JSON numbers in events; ensure IDL parsers treat integer fields as 64-bit unsigned representations.
