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

#### 2. Bootstrap Base State (For pb-cli Admin Testing)

```bash
# Start Surfpool in pre-global bootstrap mode:
npm run localnet start -- --bootstrap-only

# Or bootstrap against an already running localnet node:
npm run localnet bootstrap
```

- Injects compiled program binaries (`anchor.so`, `mock_huma.so`).
- Generates and funds admin & randomness keypairs with SOL.
- Injects mock state accounts (USDC Mint, Switchboard Randomness, Huma Pool State, PST Mint, Ticket Registry buffer, Huma Pool Token Accounts, Fee Wallet).
- Writes `.env.local` with all mock and derived addresses.
- **Leaves `GlobalConfig` and pools uninitialized**, allowing manual execution and testing of `npm run pb-cli init-global`, `create-pool`, `initialize-huma-lender`, and `set-prize-tiers`.

#### 3. Run Full State Initialization

```bash
npm run localnet init
```

- Runs base state bootstrapping.
- Submits on-chain transactions to initialize `GlobalConfig` and create the initial prize pool (`PrizePool #1`) with configured prize tiers.
- Generates/updates `.env.local`.

#### 4. Fund Developer Wallets

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

## YieldBonds Crank & Admin CLI (`scripts/pb-cli.ts`)

A unified operator, crank, query, and multisig governance CLI for managing YieldBonds on Solana. It dynamically resolves program and vault addresses for both localnet and devnet depending on the target RPC URL and environment state files (`localnet-state/addresses.json` or `devnet-state/addresses.json`).

### Command Categories (38 Commands)

#### 1. Crank & Draw Operations (5 Commands)

| Command                 | Description                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `harvest`               | Harvests yield from Huma Protocol for the pool and commits it to the current draw cycle, freezing the pool for draw processing.                |
| `prepare-draw`          | Prepares tickets for the draw cycle in batches, merging pending tickets into active tickets and computing prefix sums.                         |
| `reveal`                | Submits the random seed and deterministically derives winners. Automatically runs `prepare-draw` if preparation is incomplete.                 |
| `reinvest`              | Reinvests whole bond winnings back into principal/tickets for unprocessed draw winners.                                                        |
| `claim-redemption [id]` | Claims settled USDC redemptions from Huma for a specific redemption ID or all settled redemptions in a pool (optionally filtered by `--user`). |

#### 2. Admin & Emergency Governance (17 Commands)

| Command                   | Description                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `init-global`             | Initializes global program configuration specifying admin authority, emergency guardian, and crank jobs account.         |
| `update-global-config`    | Updates global configuration parameters including emergency guardian and jobs account.                                   |
| `nominate-admin`          | Sets the `pendingAdmin` candidate address in the two-step governance transfer workflow.                                  |
| `cancel-admin-nomination` | Cancels an active pending admin nomination, clearing `pendingAdmin` back to the zero address.                            |
| `accept-admin`            | Finalizes the two-step admin transfer. Must be signed by the nominated pending admin keypair.                            |
| `create-pool`             | Creates a new Prize Pool with bond price, duration, fees, velocity ceilings, timelocks, and prize tiers.                 |
| `initialize-huma-lender`  | Initializes the Huma lender state account and PST vault for a prize pool.                                                |
| `resize-registry`         | Expands the zero-copy ticket registry storage account by 10 KB increments to add user capacity.                          |
| `set-prize-tiers`         | Configures prize tier distribution rules and basis points allocations for a pool.                                        |
| `update-pool-config`      | Updates pool parameters (fees, bond price, fee wallet, cycle duration, min yield, max yield velocity, payout timelock).  |
| `withdraw-fees`           | Withdraws accrued protocol yield fees from the pool vault to the designated fee wallet (requires `--confirm`).           |
| `pause-pool`              | Emergency pause for a prize pool (halts deposits, withdrawals, and draws). Executable by Guardian panic button or Admin. |
| `unpause-pool`            | Resumes normal operations for a paused pool (strictly Admin cold multisig with `--confirm`).                             |
| `close-pool`              | Permanently closes and decommissions a prize pool for sunset (strictly Admin cold multisig with `--confirm`).            |
| `void-draw`               | Emergency void of an active draw cycle if no winner payouts have occurred (strictly Admin with `--confirm`).             |
| `force-unlock-draw`       | Admin emergency force unlock of a frozen/stuck draw cycle, resetting pool freeze status (requires `--confirm`).          |
| `rebind-randomness`       | Rebinds an expired draw cycle to a new Switchboard randomness account.                                                   |

#### 3. State Queries (8 Commands)

| Command                      | Description                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `query-config`               | Displays on-chain `GlobalConfig` state (admin, pending admin, guardian, jobs account).               |
| `query-pool`                 | Displays `PrizePool` details, vault PDAs, deposited principal, status, and fee stats.                |
| `query-draw`                 | Displays `DrawCycle` state, status, locked ticket counts, prize pot, and harvest slot.               |
| `query-payout`               | Displays `PayoutRegistry` state and winner distribution list for a draw cycle.                       |
| `query-winnings [usr]`       | Displays `UserWinnings` PDA state for a specific user or lists all winnings in a pool.               |
| `query-redemption [id]`      | Displays `PendingRedemption` state for a specific redemption ID or lists all redemptions.            |
| `query-registry`             | Displays zero-copy `TicketRegistry` header, registered users, and active/pending ticket checkpoints. |
| `query-mock-huma-pool-state` | Displays Mock Huma Pool state (total assets, mode, PDA authority) and redemption queue status.       |

#### 4. Squads V4 Multisig Governance Suite (8 Commands)

| Command             | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `squads-status`     | Queries and displays Squads V4 Multisig status, threshold, members, timelocks, and default vault PDA. |
| `squads-proposals`  | Lists recent proposal history with voting status, approvals, and execution readiness.                 |
| `squads-inspect-tx` | Decodes and inspects inner instruction payloads of a Squads vault transaction.                        |
| `squads-approve`    | Submits a member approval vote for a pending Squads proposal (with optional `--memo`).                |
| `squads-reject`     | Submits a member rejection vote for a pending Squads proposal (with optional `--memo`).               |
| `squads-cancel`     | Cancels a pending proposal (authorized by proposal creator or multisig authority).                    |
| `squads-close`      | Reclaims rent lamports from executed or cancelled Squads proposal and transaction accounts.           |
| `squads-execute`    | Executes an approved Squads proposal on-chain against the target program with timelock verification.  |

---

### Command Options Reference

Specify options after `--` when running via `npm run pb-cli`:

| Flag                          | Type     | Description                                                  | Default / Requirement                    |
| ----------------------------- | -------- | ------------------------------------------------------------ | ---------------------------------------- |
| `--rpc <url>`                 | Global   | Solana RPC endpoint URL                                      | `http://127.0.0.1:8899`                  |
| `--keypair <path>`            | Global   | Path to signer keypair file                                  | `scripts/admin-key.json`                 |
| `--pool <number>`             | Global   | Target Prize Pool ID                                         | `1`                                      |
| `--admin <pubkey>`            | Admin    | Initial or target admin authority public key                 | Signer address                           |
| `--guardian <pubkey>`         | Admin    | Emergency guardian public key (panic pause role)             | Admin address                            |
| `--new-admin <pubkey>`        | Admin    | Candidate admin public key for nomination                    | **Required** for `nominate-admin`        |
| `--jobs <pubkey>`             | Admin    | Crank bot / jobs account public key                          | Admin address                            |
| `--token-mint <pubkey>`       | Pool     | Underlying deposit token mint address (USDC, 6 decimals)     | Resolved from state                      |
| `--pst-mint <pubkey>`         | Pool     | Huma PST token mint address (6 decimals)                     | Resolved from state                      |
| `--fee-wallet <pubkey>`       | Pool     | Protocol fee wallet token account address                    | Resolved from state                      |
| `--huma-pool-state <pubkey>`  | Pool     | Huma pool state account address                              | Resolved from state                      |
| `--bond-price <num>`          | Pool     | Bond price in base units ($1.00 = 1,000,000$)                | `1000000`                                |
| `--stake-duration <hrs>`      | Pool     | Staking cycle duration in hours                              | `24`                                     |
| `--fee-bps <num>`             | Pool     | Protocol fee rate in basis points ($100 = 1\%$)              | `100`                                    |
| `--min-yield-threshold <num>` | Pool     | Minimum yield threshold in base units                        | `0` (uncapped)                           |
| `--max-yield-bps <num>`       | Pool     | Maximum yield velocity limit in basis points                 | `0` (uncapped)                           |
| `--payout-timelock <secs>`    | Pool     | Payout settlement delay timelock in seconds                  | `300`                                    |
| `--tiers <string>`            | Pool     | Prize tier distribution rules (e.g. `"1:5000,5:1000"`)       | `1:10000`                                |
| `--amount <num\|all>`         | Action   | Token amount in base units or `'all'`                        | **Required** for `withdraw-fees`         |
| `--confirm`                   | Safety   | Explicit confirmation flag for destructive/emergency actions | **Required** for unpause/close/void/fees |
| `--cycle <number>`            | Action   | Targeted Draw Cycle ID                                       | `pool.currentDrawCycleId - 1`            |
| `--seed <hex>`                | Action   | 32-byte hex string seed for the `reveal` command             | Randomly generated                       |
| `--winner <idx\|addr>`        | Action   | Target winner index or user public key address to reinvest   | All unprocessed winners                  |
| `--id <number>`               | Action   | Target redemption ID to claim or query                       | All settled redemptions                  |
| `--user <pubkey>`             | Action   | Filter redemptions, winnings, or registry queries by user    | None                                     |
| `--limit <number>`            | Action   | Maximum items to process or proposals to query               | `10` for proposals                       |
| `--batch-size <num>`          | Action   | Maximum entries to process per `prepare-draw` batch          | `500`                                    |
| `--new-randomness <pubkey>`   | Action   | New Switchboard randomness account address                   | **Required** for `rebind-randomness`     |
| `--address <pubkey>`          | Action   | Mock Huma Pool State account address                         | Resolved from state                      |
| `--multisig <pubkey>`         | Multisig | Squads V4 Multisig account address                           | `SQUADS_MULTISIG_ADDRESS`                |
| `--vault-index <num>`         | Multisig | Squads V4 vault index acting as authority                    | `0`                                      |
| `--index <num>`               | Multisig | Target Squads transaction / proposal index                   | **Required** for squads actions          |
| `--memo <string>`             | Multisig | Optional memo string attached to vote                        | None                                     |
| `--rent-collector <pubkey>`   | Multisig | Recipient address for reclaimed rent lamports                | Signer address                           |
| `--cu-limit <num>`            | Multisig | Compute unit limit for proposal execution transaction        | `800000`                                 |
| `--propose`                   | Multisig | Route action through Squads V4 proposal creation             | `false`                                  |
| `--export-ix`                 | Multisig | Export instruction data and Squads UI JSON payload           | `false`                                  |
| `--dry-run`                   | Safety   | Simulate transaction execution without broadcasting          | `false`                                  |
| `--no-auto-approve`           | Multisig | Do not automatically approve created proposal                | `false`                                  |

---

### Operational Workflow Examples

#### 1. Draw Crank Lifecycle

```bash
# 1. Harvest yield from Huma and lock pool
npm run pb-cli harvest -- --pool 1

# 2. Prepare tickets in batches (prefix sums computation)
npm run pb-cli prepare-draw -- --pool 1 --batch-size 500

# 3. Reveal randomness and pick winners
npm run pb-cli reveal -- --pool 1

# 4. Reinvest winnings for all winners
npm run pb-cli reinvest -- --pool 1

# 5. Claim settled redemptions
npm run pb-cli claim-redemption -- --pool 1
```

#### 2. Emergency Pause & Multisig Unpause

```bash
# Fast Guardian panic button pause (no multisig delay)
npm run pb-cli pause-pool -- --pool 1

# Admin cold multisig unpause (requires explicit confirmation)
npm run pb-cli unpause-pool -- --pool 1 --confirm
```

#### 3. Two-Step Admin Ownership Transfer

```bash
# Step 1: Existing admin nominates candidate address
npm run pb-cli nominate-admin -- --new-admin <CANDIDATE_PUBKEY>

# (Optional: Cancel nomination if needed)
# npm run pb-cli cancel-admin-nomination

# Step 2: Candidate signs and accepts admin role
npm run pb-cli accept-admin -- --keypair candidate-keypair.json
```

#### 4. Squads Multisig Proposal Workflow

```bash
# Step 1: Create a proposed pool update via Squads
npm run pb-cli update-pool-config -- --pool 1 --fee-bps 150 --propose

# Step 2: Member votes to approve proposal index 1
npm run pb-cli squads-approve -- --index 1 --memo "Approve fee rate update to 1.5%"

# Step 3: Execute approved proposal after timelock expires
npm run pb-cli squads-execute -- --index 1
```
