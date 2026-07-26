# YieldBonds (based on Premium Bonds) Protocol

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
- Deploys the main smart contract (`CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx`) and the Mock Huma Lending program (`XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw`).
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

---

## Devnet Orchestrator CLI (`scripts/devnet.ts`)

The devnet orchestrator manages building, deploying, initializing, and simulating operations on Solana Devnet.

### Core Commands

#### 1. Deploy Programs

```bash
npm run devnet deploy
```

- Checks and generates local keypairs for the YieldBonds program and Mock Huma program if they do not exist.
- Synchronizes program IDs across `Cargo.toml`, `Anchor.toml`, `constants.rs`, and `bonds-sdk.ts`.
- Compiles the Anchor workspace and deploys programs to Solana Devnet.

#### 2. Initialize Devnet State

```bash
npm run devnet init [path_to_admin_keypair]
```

- Loads the admin authority keypair (defaults to your local Solana CLI configuration `~/.config/solana/id.json`).
- Initializes on-chain state: Huma Pool State, Mock USDC Mint (via SPL Token CLI), Huma Pool token vaults, and admin fee wallet.
- Initializes YieldBonds `GlobalConfig` and registers the initial Prize Pool 1.
- Generates/updates the devnet environment variables inside `.env.local` and saves addresses to `scripts/devnet-state/addresses.json`.

#### 3. Fund Wallets

```bash
npm run devnet fund <wallet_address> <amount>
```

- Requests a devnet SOL airdrop to the target wallet.
- Mints the specified amount of mock USDC to the target wallet's ATA using the local USDC mint keypair.

#### 4. Simulate Yield

```bash
npm run devnet yield <amount_usdc>
```

- Invokes the mock Huma program's `simulate_yield` instruction to accumulate yield for testing on devnet.

#### 5. Settle Requests

```bash
npm run devnet settle [count]
```

- Invokes the `settle_requests` instruction to process and settle pending ticket redemptions on devnet.

---

## YieldBonds Crank CLI (`scripts/pb-cli.ts`)

A utility crank CLI to manage the draw cycle, query on-chain state, and trigger administrative functions. It dynamically resolves program and vault addresses for both localnet and devnet depending on the target RPC URL.

### Commands

- **`harvest`**: Harvests yield from the Huma pool and commits it as the prize pot for the current draw cycle.
- **`prepare-draw`**: Prepares ticket checkpoints for the draw cycle in batches.
- **`reveal`**: Submits the random seed and picks winners. On localnet, automatically mocks resolved randomness on the Switchboard account.
- **`reinvest`**: Reinvests draw winnings for winners back into principal.
- **`query-config`**: Displays the on-chain `GlobalConfig` state.
- **`query-pool`**: Displays the current `PrizePool` details, vault balances, and parameters.
- **`query-draw`**: Displays the target/current `DrawCycle` state, including status and locked ticket counts.
- **`query-payout`**: Displays details about the payout registry.
- **`query-winnings [usr]`**: Queries user winnings for a specific address or lists all.
- **`query-redemption [id]`**: Queries pending redemptions.
- **`query-registry`**: Displays the ticket registry users and checkpoint state.

### Options

Specify options after `--` when running via `npm run`:

| Option                | Description                               | Default                         |
| --------------------- | ----------------------------------------- | ------------------------------- |
| `--pool <number>`     | Target Pool ID                            | `1`                             |
| `--keypair <path>`    | Path to the authority keypair file        | `scripts/admin-key.json`        |
| `--rpc <url>`         | Solana RPC endpoint URL                   | `http://127.0.0.1:8899`         |
| `--seed <hex>`        | 32-byte hex seed for the `reveal` command | Randomly generated              |
| `--cycle <number>`    | Targeted Draw Cycle ID                    | `pool's currentDrawCycleId - 1` |
| `--winner <idx/addr>` | Target winner to reinvest                 | All unprocessed winners         |
| `--max-bonds <num>`   | Max bonds to purchase in one transaction  | `1000`                          |
| `--batch-size <num>`  | Max users to process per `prepare-draw`   | `1000`                          |
| `--user <pubkey>`     | Filter query commands by user address     | None                            |

### Examples

**Localnet (Default):**

```bash
npm run pb-cli query-pool
```

**Devnet:**

```bash
# Query devnet pool state
npm run pb-cli query-pool -- --rpc https://api.devnet.solana.com

# Harvest yield on devnet using a custom keypair
npm run pb-cli harvest -- --rpc https://api.devnet.solana.com --keypair ~/.config/solana/id.json
```
