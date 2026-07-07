# Premium Bonds Protocol

Next.js starter with Tailwind CSS and `@solana/kit` for wallet connection and Solana hooks.

---

## Getting Started

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Run Local Development Environment**:
   To start the entire offline-first orchestrator (Surfpool, state initialization, and the Next.js frontend):
   ```bash
   npm run localnet
   ```

---

## Local Development Orchestrator CLI (`scripts/localnet.ts`)

The orchestrator script manages the offline localnet development cycle. It automates environment initialization, manages the local blockchain daemon, creates mock accounts, and provides handy blockchain cheatcodes.

### Core Commands

#### 1. Start Environment

```bash
npm run localnet start
# or simply:
npm run localnet
```

- **Surfpool Check & Startup**: Checks if a local Surfpool cluster is running on `127.0.0.1:8899`. If not, it automatically spawns the Surfpool daemon process and monitors it until healthy.
- **Auto-Initialization**: Detects if the on-chain `GlobalConfig` is initialized. If not, it executes the complete initialization sequence (`init`).
- **Dynamic Env Generation**: Generates and writes `.env.local` containing all derived program, config, and mint addresses.
- **Frontend Startup**: Starts the Next.js development server (`npm run dev`).
- **Graceful Shutdown**: Automatically intercepts termination signals (`SIGINT`, `SIGTERM`, etc.) to cleanly kill the Surfpool daemon and the Next.js process.

#### 2. Run Manual State Initialization

```bash
npm run localnet init
```

- Loads/generates an admin keypair (`scripts/admin-key.json`).
- Funds the admin wallet with SOL.
- Deploys the main smart contract (`CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx`) and the Mock Huma Lending program (`ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj`).
- Injects mock state accounts (USDC Mint, Huma Pool State, PST Mint, Ticket Registry, Huma Pool Token Accounts, Fee Wallet).
- Submits on-chain transactions to initialize the `GlobalConfig` and create the initial liquidity pool.
- Generates/updates `.env.local`.

#### 3. Fund Developer Wallets

```bash
npm run localnet fund <wallet_address> <amount>
```

Seeds local developer wallets with gas (SOL) and deposit liquidity (USDC) for testing.

- **Parameters**:
  - `<wallet_address>`: The base58-encoded wallet public key.
  - `<amount>`: Positive decimal number representing the amount to fund (e.g., `100`).
- **Mechanism**:
  - Attempts a standard RPC SOL airdrop. If it fails or is restricted, it falls back to a direct account-state injection.
  - Derives the USDC Associated Token Account (ATA) for the wallet.
  - Injects or updates the USDC token account state.
  - **Additive Support**: If the wallet already has SOL or USDC on-chain, the CLI fetches the existing balances and adds the new amount to it.

_Example:_

```bash
npm run localnet fund EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 250
```

#### 4. Time Travel (Warp Time)

```bash
npm run localnet warp <seconds>
```

Warps the local chain clock forward relatively to test time-dependent logic (e.g. ticket lockups, interest accumulation, redemption windows).

- **Parameters**:
  - `<seconds>`: Relative time jump in seconds (must be a positive number).
- **Mechanism**:
  - Queries the current block time and slot from Surfpool.
  - Computes the new absolute Unix timestamp.
  - Submits a `surfnet_timeTravel` JSON-RPC cheatcode request to warp the blockchain clock forward.
  - Output displays the time jump with UTC and local timezone representations.

_Example (Warp 1 day forward):_

```bash
npm run localnet warp 86400
```
