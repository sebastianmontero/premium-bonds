/**
 * Spike: Huma create_lender_accounts_v2 fork behavior test (Issue #21).
 *
 * Tests how Huma handles pre-existing ATAs, third-party payers, idempotency,
 * and off-curve PDA lenders on a local surfpool mainnet fork.
 *
 * Prerequisites:
 *   surfpool start --rpc-url "${MAINNET_RPC_URL:-https://api.mainnet-beta.solana.com}" --no-tui --yes
 *
 * Run command:
 *   npx tsx scripts/spikes/huma-lender-init-fork-spike.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BorshCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const idlPath = path.resolve(__dirname, "../../anchor/huma-finance-idl.json");
const humaIdlJson = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

export const HUMA_MAINNET_PROGRAM_ID = new PublicKey(
  "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn"
);
export const PROTOCOL_PROGRAM_ID = new PublicKey(
  "4ZJJemMiVfNzwwoz8BedkWZ8ZKCkx1ya6iA59JS6baGG"
);
export const GENESIS_POOL_CONFIG = new PublicKey(
  "28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS"
);
export const CREATE_LENDER_ACCOUNTS_V2_DISC = Buffer.from([
  203, 52, 185, 231, 192, 74, 121, 108,
]);

export interface TestCaseResult {
  id: string;
  name: string;
  mode: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  cuConsumed: number;
  logs: string[];
  accountsCreated: {
    name: string;
    pubkey: string;
    owner: string;
    size: number;
    authority?: string;
    lenderField?: string;
  }[];
  notes: string;
}

export interface ExecutionOutcome {
  success: boolean;
  signature?: string;
  errorCode?: string;
  errorMessage?: string;
  cuConsumed: number;
  logs: string[];
}

/** Calls surfnet_setAccount via JSON-RPC to modify account state on surfpool */
async function surfnetSetAccount(
  connection: Connection,
  pubkey: PublicKey,
  account: { lamports: number; data: Buffer; owner: PublicKey }
): Promise<void> {
  const rpcUrl = (connection as any)._rpcEndpoint;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setAccount",
      params: [
        pubkey.toBase58(),
        {
          lamports: account.lamports,
          data: account.data.toString("hex"),
          owner: account.owner.toBase58(),
          executable: false,
        },
      ],
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`surfnet_setAccount error: ${JSON.stringify(json.error)}`);
  }
}

/** Helper to execute an instruction or simulate if failure is anticipated */
async function executeTx(
  connection: Connection,
  ix: TransactionInstruction,
  signers: Keypair[]
): Promise<ExecutionOutcome> {
  const payer = signers[0];
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;

  // First simulate to capture exact logs and compute units
  const sim = await connection.simulateTransaction(tx, signers);
  const simLogs = sim.value.logs ?? [];
  const cuConsumed = sim.value.unitsConsumed ?? 0;

  if (sim.value.err) {
    let errorCode = "Unknown";
    let errorMessage = JSON.stringify(sim.value.err);
    // Find custom error in logs if available
    for (const log of simLogs) {
      const match = log.match(/custom program error: (0x[0-9a-fA-F]+|\d+)/);
      if (match) {
        errorCode = match[1];
        break;
      }
      if (log.includes("already in use")) {
        errorCode = "AccountAlreadyInUse";
        errorMessage = log;
        break;
      }
    }
    return {
      success: false,
      errorCode,
      errorMessage,
      cuConsumed,
      logs: simLogs,
    };
  }

  // If simulation succeeded, send and confirm
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: "confirmed",
    });
    const confirmedTx = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return {
      success: true,
      signature: sig,
      cuConsumed: confirmedTx?.meta?.computeUnitsConsumed ?? cuConsumed,
      logs: confirmedTx?.meta?.logMessages ?? simLogs,
    };
  } catch (err: any) {
    return {
      success: false,
      errorCode: "SendFailure",
      errorMessage: err.message,
      cuConsumed,
      logs: simLogs,
    };
  }
}

function buildCreateLenderAccountsV2Ix(params: {
  payer: PublicKey;
  lender: PublicKey;
  isLenderSigner: boolean;
  humaConfig: PublicKey;
  poolConfig: PublicKey;
  poolState: PublicKey;
  modeConfig: PublicKey;
  modeMint: PublicKey;
  lenderState: PublicKey;
  lenderAta: PublicKey;
  tokenProgram: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: HUMA_MAINNET_PROGRAM_ID,
    data: CREATE_LENDER_ACCOUNTS_V2_DISC,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.lender, isSigner: params.isLenderSigner, isWritable: false },
      { pubkey: params.humaConfig, isSigner: false, isWritable: false },
      { pubkey: params.poolConfig, isSigner: false, isWritable: false },
      { pubkey: params.poolState, isSigner: false, isWritable: false },
      { pubkey: params.modeConfig, isSigner: false, isWritable: false },
      { pubkey: params.modeMint, isSigner: false, isWritable: false },
      { pubkey: params.lenderState, isSigner: false, isWritable: true },
      { pubkey: params.lenderAta, isSigner: false, isWritable: true },
      { pubkey: params.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

async function airdrop(connection: Connection, to: PublicKey, sol = 5): Promise<void> {
  const sig = await connection.requestAirdrop(to, sol * 1_000_000_000);
  await connection.confirmTransaction(sig);
}

async function runTestSuiteForMode(
  connection: Connection,
  modeName: string,
  modeConfig: PublicKey,
  poolConfig: PublicKey,
  poolState: PublicKey,
  humaConfig: PublicKey,
  tokenProgram: PublicKey
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const [modeMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("mode_mint"), poolConfig.toBuffer(), modeConfig.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );

  console.log(`\n======================================================`);
  console.log(`Running Test Suite for Mode: ${modeName} (${modeConfig.toBase58()})`);
  console.log(`Mode Mint: ${modeMint.toBase58()}`);
  console.log(`======================================================`);

  // -------------------------------------------------------------------------
  // T0: Baseline: fresh lender L, nothing exists, payer = L
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T0: Baseline (payer = lender = L)...");
  const lenderT0 = Keypair.generate();
  await airdrop(connection, lenderT0.publicKey);

  const [lenderStateT0] = PublicKey.findProgramAddressSync(
    [Buffer.from("lender_state"), modeConfig.toBuffer(), lenderT0.publicKey.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const lenderAtaT0 = getAssociatedTokenAddressSync(
    modeMint,
    lenderT0.publicKey,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ixT0 = buildCreateLenderAccountsV2Ix({
    payer: lenderT0.publicKey,
    lender: lenderT0.publicKey,
    isLenderSigner: true,
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT0,
    lenderAta: lenderAtaT0,
    tokenProgram,
  });

  const outcomeT0 = await executeTx(connection, ixT0, [lenderT0]);
  const stateAccT0 = await connection.getAccountInfo(lenderStateT0);
  const ataAccT0 = await connection.getAccountInfo(lenderAtaT0);

  results.push({
    id: "T0",
    name: "Baseline (fresh lender, nothing exists)",
    mode: modeName,
    success: outcomeT0.success,
    errorCode: outcomeT0.errorCode,
    errorMessage: outcomeT0.errorMessage,
    cuConsumed: outcomeT0.cuConsumed,
    logs: outcomeT0.logs,
    accountsCreated: [
      ...(stateAccT0
        ? [
            {
              name: "lender_state",
              pubkey: lenderStateT0.toBase58(),
              owner: stateAccT0.owner.toBase58(),
              size: stateAccT0.data.length,
              lenderField: new PublicKey(stateAccT0.data.subarray(9, 41)).toBase58(),
            },
          ]
        : []),
      ...(ataAccT0
        ? [
            {
              name: "lender_mode_token (ATA)",
              pubkey: lenderAtaT0.toBase58(),
              owner: ataAccT0.owner.toBase58(),
              size: ataAccT0.data.length,
              authority: new PublicKey(ataAccT0.data.subarray(32, 64)).toBase58(),
            },
          ]
        : []),
    ],
    notes: outcomeT0.success
      ? "Baseline passed cleanly. Lender state & ATA initialized."
      : `Baseline failed: ${outcomeT0.errorMessage}`,
  });
  console.log(`  T0 Result: ${outcomeT0.success ? "✅ Success" : "❌ Failed"} (${outcomeT0.cuConsumed} CU)`);

  // -------------------------------------------------------------------------
  // T1: ATA pre-created with CreateIdempotent by attacker A; payer = L
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T1: Pre-existing PST ATA (A pre-creates ATA)...");
  const lenderT1 = Keypair.generate();
  const attackerT1 = Keypair.generate();
  await airdrop(connection, lenderT1.publicKey);
  await airdrop(connection, attackerT1.publicKey);

  const [lenderStateT1] = PublicKey.findProgramAddressSync(
    [Buffer.from("lender_state"), modeConfig.toBuffer(), lenderT1.publicKey.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const lenderAtaT1 = getAssociatedTokenAddressSync(
    modeMint,
    lenderT1.publicKey,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Attacker A pre-creates ATA(L, pst_mint) with CreateIdempotent
  const preCreateAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    attackerT1.publicKey,
    lenderAtaT1,
    lenderT1.publicKey,
    modeMint,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const createAtaTx = new Transaction().add(preCreateAtaIx);
  await sendAndConfirmTransaction(connection, createAtaTx, [attackerT1], { commitment: "confirmed" });
  console.log(`  Attacker pre-created ATA: ${lenderAtaT1.toBase58()}`);

  const ixT1 = buildCreateLenderAccountsV2Ix({
    payer: lenderT1.publicKey,
    lender: lenderT1.publicKey,
    isLenderSigner: true,
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT1,
    lenderAta: lenderAtaT1,
    tokenProgram,
  });

  const outcomeT1 = await executeTx(connection, ixT1, [lenderT1]);
  const stateAccT1 = await connection.getAccountInfo(lenderStateT1);

  results.push({
    id: "T1",
    name: "Pre-existing PST ATA (pre-created by attacker)",
    mode: modeName,
    success: outcomeT1.success,
    errorCode: outcomeT1.errorCode,
    errorMessage: outcomeT1.errorMessage,
    cuConsumed: outcomeT1.cuConsumed,
    logs: outcomeT1.logs,
    accountsCreated: stateAccT1
      ? [
          {
            name: "lender_state",
            pubkey: lenderStateT1.toBase58(),
            owner: stateAccT1.owner.toBase58(),
            size: stateAccT1.data.length,
            lenderField: new PublicKey(stateAccT1.data.subarray(9, 41)).toBase58(),
          },
        ]
      : [],
    notes: outcomeT1.success
      ? "Huma tolerated pre-existing ATA (idempotent ATA creation)."
      : `Huma rejected pre-existing ATA: ${outcomeT1.errorCode} (${outcomeT1.errorMessage})`,
  });
  console.log(`  T1 Result: ${outcomeT1.success ? "✅ Success" : "❌ Failed"} (${outcomeT1.errorCode || outcomeT1.errorMessage})`);

  // -------------------------------------------------------------------------
  // T1b: Non-empty pre-existing PST ATA (A pre-creates ATA + 1 dust PST unit)
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T1b: Non-empty pre-existing PST ATA (with 1 dust unit)...");
  const lenderT1b = Keypair.generate();
  const attackerT1b = Keypair.generate();
  await airdrop(connection, lenderT1b.publicKey);
  await airdrop(connection, attackerT1b.publicKey);

  const [lenderStateT1b] = PublicKey.findProgramAddressSync(
    [Buffer.from("lender_state"), modeConfig.toBuffer(), lenderT1b.publicKey.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const lenderAtaT1b = getAssociatedTokenAddressSync(
    modeMint,
    lenderT1b.publicKey,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // A pre-creates ATA
  const preCreateAtaIxT1b = createAssociatedTokenAccountIdempotentInstruction(
    attackerT1b.publicKey,
    lenderAtaT1b,
    lenderT1b.publicKey,
    modeMint,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  await sendAndConfirmTransaction(connection, new Transaction().add(preCreateAtaIxT1b), [attackerT1b], {
    commitment: "confirmed",
  });

  // Inject 1 unit of PST dust into ATA via surfnet_setAccount
  const ataRaw = await connection.getAccountInfo(lenderAtaT1b);
  if (ataRaw) {
    const dataCopy = Buffer.from(ataRaw.data);
    dataCopy.writeBigUInt64LE(BigInt(1), 64); // amount = 1
    await surfnetSetAccount(connection, lenderAtaT1b, {
      lamports: ataRaw.lamports,
      data: dataCopy,
      owner: ataRaw.owner,
    });
    console.log(`  Injected 1 PST dust unit into ATA ${lenderAtaT1b.toBase58()}`);
  }

  const ixT1b = buildCreateLenderAccountsV2Ix({
    payer: lenderT1b.publicKey,
    lender: lenderT1b.publicKey,
    isLenderSigner: true,
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT1b,
    lenderAta: lenderAtaT1b,
    tokenProgram,
  });

  const outcomeT1b = await executeTx(connection, ixT1b, [lenderT1b]);
  const stateAccT1b = await connection.getAccountInfo(lenderStateT1b);

  results.push({
    id: "T1b",
    name: "Non-empty pre-existing PST ATA (1 unit dust)",
    mode: modeName,
    success: outcomeT1b.success,
    errorCode: outcomeT1b.errorCode,
    errorMessage: outcomeT1b.errorMessage,
    cuConsumed: outcomeT1b.cuConsumed,
    logs: outcomeT1b.logs,
    accountsCreated: stateAccT1b
      ? [
          {
            name: "lender_state",
            pubkey: lenderStateT1b.toBase58(),
            owner: stateAccT1b.owner.toBase58(),
            size: stateAccT1b.data.length,
            lenderField: new PublicKey(stateAccT1b.data.subarray(9, 41)).toBase58(),
          },
        ]
      : [],
    notes: outcomeT1b.success
      ? "Huma tolerated non-empty pre-existing ATA."
      : `Huma failed with non-empty ATA: ${outcomeT1b.errorCode} (${outcomeT1b.errorMessage})`,
  });
  console.log(`  T1b Result: ${outcomeT1b.success ? "✅ Success" : "❌ Failed"} (${outcomeT1b.errorCode || outcomeT1b.errorMessage})`);

  // -------------------------------------------------------------------------
  // T2: Third-party payer (payer = A, lender = L, L does not sign)
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T2: Third-party payer (payer = A, lender = L, L doesn't sign)...");
  const lenderT2 = Keypair.generate();
  const attackerT2 = Keypair.generate();
  await airdrop(connection, attackerT2.publicKey);

  const [lenderStateT2] = PublicKey.findProgramAddressSync(
    [Buffer.from("lender_state"), modeConfig.toBuffer(), lenderT2.publicKey.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const lenderAtaT2 = getAssociatedTokenAddressSync(
    modeMint,
    lenderT2.publicKey,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ixT2 = buildCreateLenderAccountsV2Ix({
    payer: attackerT2.publicKey,
    lender: lenderT2.publicKey,
    isLenderSigner: false, // L does NOT sign!
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT2,
    lenderAta: lenderAtaT2,
    tokenProgram,
  });

  const outcomeT2 = await executeTx(connection, ixT2, [attackerT2]);
  const stateAccT2 = await connection.getAccountInfo(lenderStateT2);
  const ataAccT2 = await connection.getAccountInfo(lenderAtaT2);

  results.push({
    id: "T2",
    name: "Third-party payer (payer = A, lender = L)",
    mode: modeName,
    success: outcomeT2.success,
    errorCode: outcomeT2.errorCode,
    errorMessage: outcomeT2.errorMessage,
    cuConsumed: outcomeT2.cuConsumed,
    logs: outcomeT2.logs,
    accountsCreated: [
      ...(stateAccT2
        ? [
            {
              name: "lender_state",
              pubkey: lenderStateT2.toBase58(),
              owner: stateAccT2.owner.toBase58(),
              size: stateAccT2.data.length,
              lenderField: new PublicKey(stateAccT2.data.subarray(9, 41)).toBase58(),
            },
          ]
        : []),
      ...(ataAccT2
        ? [
            {
              name: "lender_mode_token (ATA)",
              pubkey: lenderAtaT2.toBase58(),
              owner: ataAccT2.owner.toBase58(),
              size: ataAccT2.data.length,
              authority: new PublicKey(ataAccT2.data.subarray(32, 64)).toBase58(),
            },
          ]
        : []),
    ],
    notes: outcomeT2.success
      ? "Third-party payer CAN create accounts for any lender without lender signature."
      : `Third-party payer rejected: ${outcomeT2.errorMessage}`,
  });
  console.log(`  T2 Result: ${outcomeT2.success ? "✅ Success" : "❌ Failed"} (${outcomeT2.cuConsumed} CU)`);

  // -------------------------------------------------------------------------
  // T3: Idempotency (calling create_lender_accounts_v2 twice on same lender)
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T3: Idempotency check (re-calling on already initialized L)...");
  // Use lenderT0 who was successfully initialized in T0
  const ixT3 = buildCreateLenderAccountsV2Ix({
    payer: lenderT0.publicKey,
    lender: lenderT0.publicKey,
    isLenderSigner: true,
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT0,
    lenderAta: lenderAtaT0,
    tokenProgram,
  });

  const outcomeT3 = await executeTx(connection, ixT3, [lenderT0]);

  results.push({
    id: "T3",
    name: "Idempotency (re-initializing already initialized lender)",
    mode: modeName,
    success: outcomeT3.success,
    errorCode: outcomeT3.errorCode,
    errorMessage: outcomeT3.errorMessage,
    cuConsumed: outcomeT3.cuConsumed,
    logs: outcomeT3.logs,
    accountsCreated: [],
    notes: outcomeT3.success
      ? "Instruction is IDEMPOTENT; second call succeeded."
      : `Instruction is NOT idempotent; second call failed: ${outcomeT3.errorCode} (${outcomeT3.errorMessage})`,
  });
  console.log(`  T3 Result: ${outcomeT3.success ? "✅ Success (Idempotent)" : "❌ Failed (Non-idempotent)"} (${outcomeT3.errorCode || outcomeT3.errorMessage})`);

  // -------------------------------------------------------------------------
  // T4: Off-curve PDA lender (payer = A, lender = prize pool PDA)
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T4: Off-curve PDA lender...");
  const poolIdRandom = Math.floor(Math.random() * 1_000_000) + 100;
  const poolIdBuf = Buffer.alloc(4);
  poolIdBuf.writeUInt32LE(poolIdRandom);

  const [pdaLender] = PublicKey.findProgramAddressSync(
    [Buffer.from("prize_pool"), poolIdBuf],
    PROTOCOL_PROGRAM_ID
  );
  console.log(`  Derived off-curve PDA lender: ${pdaLender.toBase58()} (on-curve: ${PublicKey.isOnCurve(pdaLender)})`);

  const attackerT4 = Keypair.generate();
  await airdrop(connection, attackerT4.publicKey);

  const [lenderStateT4] = PublicKey.findProgramAddressSync(
    [Buffer.from("lender_state"), modeConfig.toBuffer(), pdaLender.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const lenderAtaT4 = getAssociatedTokenAddressSync(
    modeMint,
    pdaLender,
    true, // allowOwnerOffCurve = true
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ixT4 = buildCreateLenderAccountsV2Ix({
    payer: attackerT4.publicKey,
    lender: pdaLender,
    isLenderSigner: false,
    humaConfig,
    poolConfig,
    poolState,
    modeConfig,
    modeMint,
    lenderState: lenderStateT4,
    lenderAta: lenderAtaT4,
    tokenProgram,
  });

  const outcomeT4 = await executeTx(connection, ixT4, [attackerT4]);
  const stateAccT4 = await connection.getAccountInfo(lenderStateT4);
  const ataAccT4 = await connection.getAccountInfo(lenderAtaT4);

  results.push({
    id: "T4",
    name: "Off-curve PDA lender (pool PDA)",
    mode: modeName,
    success: outcomeT4.success,
    errorCode: outcomeT4.errorCode,
    errorMessage: outcomeT4.errorMessage,
    cuConsumed: outcomeT4.cuConsumed,
    logs: outcomeT4.logs,
    accountsCreated: [
      ...(stateAccT4
        ? [
            {
              name: "lender_state",
              pubkey: lenderStateT4.toBase58(),
              owner: stateAccT4.owner.toBase58(),
              size: stateAccT4.data.length,
              lenderField: new PublicKey(stateAccT4.data.subarray(9, 41)).toBase58(),
            },
          ]
        : []),
      ...(ataAccT4
        ? [
            {
              name: "lender_mode_token (ATA)",
              pubkey: lenderAtaT4.toBase58(),
              owner: ataAccT4.owner.toBase58(),
              size: ataAccT4.data.length,
              authority: new PublicKey(ataAccT4.data.subarray(32, 64)).toBase58(),
            },
          ]
        : []),
    ],
    notes: outcomeT4.success
      ? "Huma ACCEPTED off-curve PDA lender."
      : `Huma rejected off-curve PDA lender: ${outcomeT4.errorMessage}`,
  });
  console.log(`  T4 Result: ${outcomeT4.success ? "✅ Success" : "❌ Failed"} (${outcomeT4.cuConsumed} CU)`);

  // -------------------------------------------------------------------------
  // T5: Validate attacker-created state vs intended state
  // -------------------------------------------------------------------------
  console.log("\n▶ Running T5: Verifying attacker-created state integrity...");
  // Check state from T2 and T4
  let t5Passed = false;
  let t5Notes = "";

  if (stateAccT2 && ataAccT2 && stateAccT4 && ataAccT4) {
    const t2LenderInState = new PublicKey(stateAccT2.data.subarray(9, 41));
    const t2AtaAuthority = new PublicKey(ataAccT2.data.subarray(32, 64));
    const t4LenderInState = new PublicKey(stateAccT4.data.subarray(9, 41));
    const t4AtaAuthority = new PublicKey(ataAccT4.data.subarray(32, 64));

    const t2Match =
      stateAccT2.owner.equals(HUMA_MAINNET_PROGRAM_ID) &&
      t2LenderInState.equals(lenderT2.publicKey) &&
      ataAccT2.owner.equals(tokenProgram) &&
      t2AtaAuthority.equals(lenderT2.publicKey);

    const t4Match =
      stateAccT4.owner.equals(HUMA_MAINNET_PROGRAM_ID) &&
      t4LenderInState.equals(pdaLender) &&
      ataAccT4.owner.equals(tokenProgram) &&
      t4AtaAuthority.equals(pdaLender);

    t5Passed = t2Match && t4Match;
    t5Notes = t5Passed
      ? "Attacker-created state is 100% identical and legitimate. Owner = Huma, lender field = target, ATA authority = target."
      : "State verification mismatch detected.";
  } else {
    t5Notes = `Prerequisite accounts missing (T2 or T4 did not succeed)`;
  }

  results.push({
    id: "T5",
    name: "Integrity check of attacker-created state (T2 & T4)",
    mode: modeName,
    success: t5Passed,
    cuConsumed: 0,
    logs: [],
    accountsCreated: [],
    notes: t5Notes,
  });
  console.log(`  T5 Result: ${t5Passed ? "✅ Verified" : "❌ Failed"}`);

  return results;
}

async function main() {
  console.log("=== Huma create_lender_accounts_v2 Fork Spike (Issue #21) ===");

  const rpcUrl = process.env.SURFPOOL_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const coder = new BorshCoder(humaIdlJson as any);

  // 1. Fetch Genesis Pool Config
  const poolConfigAcc = await connection.getAccountInfo(GENESIS_POOL_CONFIG);
  if (!poolConfigAcc) {
    throw new Error(
      `PoolConfig ${GENESIS_POOL_CONFIG.toBase58()} not found on fork. Is surfpool running?`
    );
  }
  const poolConfig = coder.accounts.decode("PoolConfig", poolConfigAcc.data);
  const humaConfig = poolConfig.huma_config as PublicKey;
  console.log(`Pool Name: ${poolConfig.pool_name}`);
  console.log(`Huma Global Config: ${humaConfig.toBase58()}`);

  // 2. Fetch Pool State
  const [poolState] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state"), GENESIS_POOL_CONFIG.toBuffer()],
    HUMA_MAINNET_PROGRAM_ID
  );
  const poolStateAcc = await connection.getAccountInfo(poolState);
  if (!poolStateAcc) {
    throw new Error(`PoolState ${poolState.toBase58()} not found on fork.`);
  }
  const poolStateDecoded = coder.accounts.decode("PoolState", poolStateAcc.data);
  const modeConfigKeys = poolStateDecoded.mode_config_keys as PublicKey[];
  console.log(`Found ${modeConfigKeys.length} modes configured:`, modeConfigKeys.map((k) => k.toBase58()));

  // 3. Inspect Mode Mints and Token Programs
  const modes: { name: string; key: PublicKey; tokenProgram: PublicKey }[] = [];
  for (const key of modeConfigKeys) {
    const acc = await connection.getAccountInfo(key);
    const decoded = coder.accounts.decode("ModeConfig", acc!.data);
    const [modeMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("mode_mint"), GENESIS_POOL_CONFIG.toBuffer(), key.toBuffer()],
      HUMA_MAINNET_PROGRAM_ID
    );
    const mintAcc = await connection.getAccountInfo(modeMint);
    const tokenProg = mintAcc?.owner ?? TOKEN_PROGRAM_ID;
    modes.push({
      name: decoded.name,
      key,
      tokenProgram: tokenProg,
    });
  }

  // 4. Run test cases for each mode
  const allResults: Record<string, TestCaseResult[]> = {};
  for (const m of modes) {
    const modeResults = await runTestSuiteForMode(
      connection,
      m.name,
      m.key,
      GENESIS_POOL_CONFIG,
      poolState,
      humaConfig,
      m.tokenProgram
    );
    allResults[m.name] = modeResults;
  }

  // 5. Output Summary Report & Decision Table
  console.log("\n\n=======================================================");
  console.log("FINAL RESULTS SUMMARY");
  console.log("=======================================================\n");

  for (const [modeName, results] of Object.entries(allResults)) {
    console.log(`### Results for Mode: ${modeName}\n`);
    console.log("| # | Test Case | Outcome | Error / Status | CU Consumed | Notes |");
    console.log("|---|---|---|---|---|---|");
    for (const r of results) {
      const outcome = r.success ? "✅ Success" : "❌ Fail";
      const err = r.errorCode ? `\`${r.errorCode}\`` : "-";
      console.log(`| ${r.id} | ${r.name} | ${outcome} | ${err} | ${r.cuConsumed.toLocaleString("en-US")} | ${r.notes} |`);
    }
    console.log("#### Key Log Excerpts:\n");
    for (const r of results) {
      if (r.logs && r.logs.length > 0) {
        console.log(`**${r.id} (${r.name}):**`);
        console.log("```");
        const relevantLogs = r.logs.filter(
          (l) =>
            l.includes("invoke") ||
            l.includes("success") ||
            l.includes("failed") ||
            l.includes("Create") ||
            l.includes("Instruction:") ||
            l.includes("already in use") ||
            l.includes("consumed")
        );
        console.log(relevantLogs.slice(0, 10).join("\n"));
        console.log("```\n");
      }
    }
    console.log("\n");
  }

  // Determine decision rule
  const classic = allResults["Classic"];
  const t1 = classic.find((r) => r.id === "T1");
  const t2 = classic.find((r) => r.id === "T2");
  const t3 = classic.find((r) => r.id === "T3");
  const t4 = classic.find((r) => r.id === "T4");

  console.log("=======================================================");
  console.log("DECISION RULE RESOLUTION FOR #18");
  console.log("=======================================================");
  console.log(`T1 (Pre-existing ATA): ${t1?.success ? "PASS" : "FAIL"}`);
  console.log(`T2 (Third-party payer): ${t2?.success ? "PASS" : "FAIL"}`);
  console.log(`T3 (Idempotency): ${t3?.success ? "PASS" : "FAIL"}`);
  console.log(`T4 (PDA lender): ${t4?.success ? "PASS" : "FAIL"}`);

  if (t4 && !t4.success) {
    console.log("\n🚨 BLOCKER: T4 failed. Huma does not accept PDA lenders.");
  } else if (t1 && !t1.success && t2 && t2.success) {
    console.log("\n➡️  Row 4 triggered (T1 ❌ and T2 ✅):");
    console.log(
      "Both ATA squatting and third-party pre-creation are possible. ATA creation fails if already existing (non-idempotent AToken Create), but anyone can pre-initialize the whole lender state.\n" +
      "Consequence: initialize_huma_lender must accept existing valid state, AND pool creation + initialization must use atomic create + initialize with random pool_id (or accept pre-created state)."
    );
  } else if (t3 && !t3.success && t2 && t2.success && t1 && t1.success) {
    console.log("\n➡️  Row 2 triggered (T3 ❌ and T2 ✅):");
    console.log(
      "Anyone can pre-create our lender accounts. initialize_huma_lender must accept existing valid lender state instead of failing."
    );
  } else if (t1 && t1.success && t3 && t3.success) {
    console.log("\n➡️  Row 1 triggered (T1 ✅ and T3 ✅):");
    console.log("No attack. Still put create_pool and initialize_huma_lender in one transaction.");
  }
}

main().catch((err) => {
  console.error("Spike failed with fatal error:", err);
  process.exit(1);
});
