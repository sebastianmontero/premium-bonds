# Anchor Smart Contract Error Design Best Practices

This guide outlines best practices for defining on-chain errors in Rust using the Anchor framework to guarantee high-quality error resolution on the client side.

---

## 1. Defining `#[error_code]` Enums

Always declare errors using the `#[error_code]` attribute in your program crate.

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ProtocolError {
    #[msg("Deposit amount must be strictly greater than zero.")]
    InvalidDepositAmount,

    #[msg("User has insufficient bond tickets for this action.")]
    InsufficientBondTickets,

    #[msg("Slippage tolerance exceeded. Minimum expected yield not met.")]
    SlippageExceeded,

    #[msg("Calculation overflow occurred during prize distribution.")]
    MathOverflow,

    #[msg("Vault is currently paused by governance.")]
    VaultPaused,
}
```

### Best Practices:

1. **Descriptive `#[msg("...")]` Strings**: Provide complete, grammatically correct English sentences. Avoid cryptic abbreviations.
2. **One Cause per Error Code**: Do not reuse `InvalidInput` across multiple validation checks. Define separate enum variants so client decoders can pin down the exact failing check.
3. **UpperCamelCase Naming**: Enum variant names should clearly reflect the domain violation (e.g. `TicketAlreadyClaimed`).

---

## 2. Emitting Errors in Instructions

Use Anchor's `require!` and `require_gt!` macros to enforce invariant checks.

```rust
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ProtocolError::InvalidDepositAmount);

    let vault = &ctx.accounts.vault;
    require!(!vault.is_paused, ProtocolError::VaultPaused);

    // Proceed with logic...
    Ok(())
}
```

---

## 3. Verifying IDL Generation

When Anchor compiles your Rust program, it produces an IDL JSON file containing an `errors` array:

```json
{
  "errors": [
    {
      "code": 6000,
      "name": "InvalidDepositAmount",
      "msg": "Deposit amount must be strictly greater than zero."
    },
    {
      "code": 6001,
      "name": "InsufficientBondTickets",
      "msg": "User has insufficient bond tickets for this action."
    }
  ]
}
```

### Verification Step:

Ensure `idl-build` feature is enabled in your program's `Cargo.toml`:

```toml
[features]
default = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

When building, execute:

```bash
NO_DNA=1 anchor build
```

And verify that `target/idl/<program_name>.json` contains all custom error definitions with matching messages.
