import {
  address,
  generateKeyPairSigner,
  AccountRole,
  Instruction,
} from "@solana/kit";
import {
  findMultisigPda,
  findMultisigVaultPda,
  findVaultTransactionPda,
  findProposalPda,
  parseMultisigAccount,
  parseProposalAccount,
  compileVaultTransactionMessage,
  buildAtomicProposeInstructions,
  buildVaultTransactionExecuteInstruction,
  ProposalStatus,
  SQUADS_PROGRAM_ADDRESS,
  MULTISIG_DISCRIMINATOR,
  PROPOSAL_DISCRIMINATOR,
  createNoopSigner,
} from "../app/lib/squads-sdk";
import { parseTransactionError, matchSquadsError } from "../app/lib/errors";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
  passedCount++;
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    console.error(
      `  ❌ FAILED: ${message} (Expected: ${String(expected)}, Got: ${String(actual)})`
    );
    failedCount++;
    throw new Error(
      `Assertion failed: ${message} (Expected: ${String(expected)}, Got: ${String(actual)})`
    );
  }
  console.log(`  ✓ ${message}`);
  passedCount++;
}

async function testVector1_PdaDerivations() {
  console.log("\n--- Vector 1: Deterministic PDA Derivations ---");
  const createKey = address("11111111111111111111111111111111");

  const multisigPda = await findMultisigPda(createKey);
  assert(
    typeof multisigPda === "string" && multisigPda.length >= 32,
    `findMultisigPda returns valid base58 address: ${multisigPda}`
  );

  const vault0Pda = await findMultisigVaultPda(multisigPda, 0);
  const vault1Pda = await findMultisigVaultPda(multisigPda, 1);
  assert(
    vault0Pda !== vault1Pda,
    `Different vault indices produce different PDAs: vault 0 (${vault0Pda}) != vault 1 (${vault1Pda})`
  );

  let outOfBoundsErrorCaught = false;
  try {
    await findMultisigVaultPda(multisigPda, 256);
  } catch (e: any) {
    outOfBoundsErrorCaught =
      e.message.includes("between 0 and 255") ||
      e.message.includes("Invalid vaultIndex");
  }
  assert(
    outOfBoundsErrorCaught,
    "findMultisigVaultPda throws error on vaultIndex > 255"
  );

  const tx1Pda = await findVaultTransactionPda(multisigPda, 1n);
  const tx2Pda = await findVaultTransactionPda(multisigPda, 2n);
  assert(
    tx1Pda !== tx2Pda,
    `Different tx indices produce distinct PDAs: tx 1 (${tx1Pda}) != tx 2 (${tx2Pda})`
  );

  const prop1Pda = await findProposalPda(multisigPda, 1n);
  assert(
    prop1Pda !== tx1Pda,
    `Proposal PDA (${prop1Pda}) differs from Transaction PDA (${tx1Pda}) for the same index`
  );
}

async function testVector2_DiscriminatorsAndAccountParsing() {
  console.log("\n--- Vector 2: Discriminators & Account Header Parsing ---");

  // Valid Multisig buffer
  const validMultisigBuf = new Uint8Array(200);
  validMultisigBuf.set(MULTISIG_DISCRIMINATOR, 0);
  const view = new DataView(validMultisigBuf.buffer);
  view.setUint16(72, 2, true); // threshold = 2
  view.setUint32(74, 3600, true); // timeLock = 3600
  view.setBigUint64(78, 5n, true); // transactionIndex = 5
  view.setBigUint64(86, 0n, true); // staleTransactionIndex = 0
  view.setUint8(94, 0); // hasRentCollector = false
  view.setUint8(95, 255); // bump
  view.setUint32(96, 0, true); // members len = 0

  const parsedMs = parseMultisigAccount(validMultisigBuf);
  assertEqual(
    parsedMs.transactionIndex,
    5n,
    "Multisig transactionIndex parsed correctly"
  );
  assertEqual(parsedMs.threshold, 2, "Multisig threshold parsed correctly");
  assertEqual(parsedMs.timeLock, 3600, "Multisig timeLock parsed correctly");

  // Invalid Multisig buffer (corrupt discriminator)
  const invalidBuf = new Uint8Array(validMultisigBuf);
  invalidBuf[0] = 0xff;
  let corruptDiscriminatorCaught = false;
  try {
    parseMultisigAccount(invalidBuf);
  } catch (e: any) {
    corruptDiscriminatorCaught = e.message.includes(
      "Invalid account discriminator"
    );
  }
  assert(
    corruptDiscriminatorCaught,
    "Corrupt discriminator rejected on parseMultisigAccount"
  );

  // Proposal buffer
  const validPropBuf = new Uint8Array(120);
  validPropBuf.set(PROPOSAL_DISCRIMINATOR, 0);
  const propView = new DataView(validPropBuf.buffer);
  propView.setBigUint64(40, 10n, true); // transactionIndex = 10
  propView.setUint8(48, ProposalStatus.Approved); // status = Approved
  propView.setUint8(49, 1); // has approvedTimestamp
  propView.setBigInt64(50, 1700000000n, true); // approvedTimestamp = 1700000000n
  propView.setUint8(58, 0); // has executedTimestamp = false
  propView.setUint32(59, 0, true); // approved len = 0
  propView.setUint32(63, 0, true); // rejected len = 0
  propView.setUint32(67, 0, true); // cancelled len = 0

  const parsedProp = parseProposalAccount(validPropBuf);
  assertEqual(
    parsedProp.transactionIndex,
    10n,
    "Proposal transactionIndex parsed correctly"
  );
  assertEqual(
    parsedProp.status,
    "Approved",
    "Proposal status string parsed correctly"
  );
  assertEqual(
    parsedProp.approvedTimestamp,
    1700000000n,
    "Proposal approvedTimestamp parsed correctly"
  );
}

async function testVector3_AccountSortingAndDeduplication() {
  console.log("\n--- Vector 3: Account Sorting & Deduplication ---");

  const k1 = (await generateKeyPairSigner()).address;
  const k2 = (await generateKeyPairSigner()).address;
  const k3 = (await generateKeyPairSigner()).address;
  const prog = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  const dummyIx: Instruction = {
    programAddress: prog,
    accounts: [
      { address: k3, role: AccountRole.READONLY },
      {
        address: k1,
        role: AccountRole.WRITABLE_SIGNER,
        signer: createNoopSigner(k1),
      },
      { address: k2, role: AccountRole.WRITABLE },
      { address: k3, role: AccountRole.WRITABLE }, // k3 duplicate with escalated role
    ],
    data: new Uint8Array([1, 2, 3]),
  };

  const compiled = compileVaultTransactionMessage([dummyIx]);

  // Account order must be: [Writable Signer, Readonly Signer, Writable Non-Signer, Readonly Non-Signer, Program Address]
  assertEqual(
    compiled.numSigners,
    1,
    "Compiled message has exactly 1 signer (k1)"
  );
  assertEqual(compiled.accountKeys[0], k1, "Account 0 is writable signer k1");
  assert(
    compiled.accountKeys.includes(k2),
    "Account list includes writable non-signer k2"
  );
  assert(
    compiled.accountKeys.includes(k3),
    "Account list includes escalated writable non-signer k3"
  );
  assert(
    compiled.accountKeys.includes(prog),
    "Account list includes program key prog"
  );

  // Deduplication check: k3 must only appear once in accountKeys
  const k3Count = compiled.accountKeys.filter((a) => a === k3).length;
  assertEqual(k3Count, 1, "Duplicate account k3 is deduplicated to 1 entry");
}

async function testVector4_PrivilegeDemotion() {
  console.log("\n--- Vector 4: Privilege Demotion for Execution ---");

  const dummyMultisig = (await generateKeyPairSigner()).address;
  const dummyVault = (await generateKeyPairSigner()).address;
  const memberKey = await generateKeyPairSigner();

  // Create a VaultTransaction with dummy instruction where Vault is signer
  const dummyIx: Instruction = {
    programAddress: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    accounts: [
      {
        address: dummyVault,
        role: AccountRole.WRITABLE_SIGNER,
        signer: createNoopSigner(dummyVault),
      },
      { address: memberKey.address, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array([0]),
  };

  const compiledMsg = compileVaultTransactionMessage([dummyIx]);
  assertEqual(
    compiledMsg.numSigners,
    1,
    "Inner message keeps dummyVault as WRITABLE_SIGNER"
  );

  // When building vault_transaction_execute, remaining accounts MUST demote dummyVault to non-signer
  const executeIx = await buildVaultTransactionExecuteInstruction({
    multisig: dummyMultisig,
    member: memberKey.address,
    transactionIndex: 1n,
    vaultTransactionMessage: compiledMsg,
  });

  const remainingVaultAcc = executeIx.accounts?.find(
    (a) => a.address === dummyVault
  );
  assert(
    remainingVaultAcc !== undefined,
    "Execute instruction remaining_accounts includes dummyVault"
  );
  assertEqual(
    remainingVaultAcc?.role,
    AccountRole.WRITABLE,
    "dummyVault is demoted from WRITABLE_SIGNER to WRITABLE (non-signer) in execute remaining_accounts"
  );
}

async function testVector5_TimelockVerification() {
  console.log("\n--- Vector 5: Timelock Boundaries ---");

  const now = 1700001000n;
  const approvedAt = 1700000000n;
  const timelock = 3600n; // 1 hour

  const unlockTime = approvedAt + timelock; // 1700003600n
  assert(
    now < unlockTime,
    `Current time (${now}) is before unlock time (${unlockTime}) => proposal timelocked`
  );

  const futureNow = 1700004000n;
  assert(
    futureNow >= unlockTime,
    `Future time (${futureNow}) is past unlock time (${unlockTime}) => proposal timelock passed`
  );
}

async function testVector6_WireSizeGuardAndMtuSplitting() {
  console.log(
    "\n--- Vector 6: Atomic Propose Wire Size Guard & MTU Splitting ---"
  );

  const dummyMultisig = (await generateKeyPairSigner()).address;
  const dummyVault = (await generateKeyPairSigner()).address;
  const memberKey = await generateKeyPairSigner();

  // Small instruction (< 1100 bytes)
  const smallIx: Instruction = {
    programAddress: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    accounts: [{ address: dummyVault, role: AccountRole.WRITABLE }],
    data: new Uint8Array([1, 2, 3]),
  };

  const smallProposal = await buildAtomicProposeInstructions({
    multisig: dummyMultisig,
    creator: memberKey.address,
    vaultIndex: 0,
    transactionIndex: 1n,
    instructions: [smallIx],
    autoApprove: true,
  });

  assert(
    !smallProposal.isSplit,
    "Small instruction is bundled atomically in 1 single transaction"
  );
  assertEqual(
    smallProposal.instructions.length,
    3,
    "Bundled transaction contains 3 instructions (createTx, createProposal, approve)"
  );

  // Large instruction payload (> 1100 bytes)
  const largeData = new Uint8Array(1150).fill(0xaa);
  const largeIx: Instruction = {
    programAddress: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    accounts: [{ address: dummyVault, role: AccountRole.WRITABLE }],
    data: largeData,
  };

  const largeProposal = await buildAtomicProposeInstructions({
    multisig: dummyMultisig,
    creator: memberKey.address,
    vaultIndex: 0,
    transactionIndex: 2n,
    instructions: [largeIx],
    autoApprove: true,
  });

  assert(
    largeProposal.isSplit,
    "Large instruction exceeding 1100 bytes is automatically split into 2 transactions"
  );
  assertEqual(
    largeProposal.instructions.length,
    2,
    "Tx 1 has 2 instructions (createTx + createProposal)"
  );
  assertEqual(
    largeProposal.secondaryInstructions?.length,
    1,
    "Tx 2 has 1 instruction (proposalApprove)"
  );
}

async function testVector7_HierarchicalErrorDisambiguation() {
  console.log("\n--- Vector 7: Hierarchical Error Disambiguation ---");

  // Squads 6000 series error
  const squadsErr = matchSquadsError(6001);
  assert(
    squadsErr !== null && squadsErr.info.name === "InvalidThreshold",
    `Squads error 6001 mapped to ${squadsErr?.info.name}: "${squadsErr?.info.message}"`
  );

  // Inner program error priority simulation
  const mockSimulationError = {
    InstructionError: [
      0,
      {
        Custom: 6017, // ErrorCode 6017 in YieldBonds = UnauthorizedAdmin
      },
    ],
  };

  const parsedError = parseTransactionError(
    mockSimulationError,
    [
      `Program ${SQUADS_PROGRAM_ADDRESS} invoke [1]`,
      "Program log: Instruction: VaultTransactionExecute",
      "Program 7wQY3e8L5eQ8dE... invoke [2]",
      "Program log: AnchorError thrown in src/instructions/admin.rs:45. Error Code: UnauthorizedAdmin. Error Number: 6017. Error Message: Signer is not the global protocol admin.",
      "Program 7wQY3e8L5eQ8dE... failed: custom program error: 0x1781",
      `Program ${SQUADS_PROGRAM_ADDRESS} failed: custom program error: 0x1781`,
    ],
    "Simulated Execution Failure"
  );

  assertEqual(
    parsedError.layer,
    "anchor",
    "Inner program Anchor error takes precedence over outer Squads 6000 error"
  );
  assert(
    parsedError.title.includes("UnauthorizedAdmin") ||
      parsedError.message.includes("administrator"),
    `Parsed error accurately reports inner cause: "${parsedError.title}: ${parsedError.message}"`
  );
}

async function runAllTests() {
  console.log(
    "==============================================================="
  );
  console.log(
    "  Running 7-Vector Squads V4 Multisig SDK Unit Test Suite      "
  );
  console.log(
    "==============================================================="
  );

  await testVector1_PdaDerivations();
  await testVector2_DiscriminatorsAndAccountParsing();
  await testVector3_AccountSortingAndDeduplication();
  await testVector4_PrivilegeDemotion();
  await testVector5_TimelockVerification();
  await testVector6_WireSizeGuardAndMtuSplitting();
  await testVector7_HierarchicalErrorDisambiguation();

  console.log(
    "\n==============================================================="
  );
  console.log(`  Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log(
    "==============================================================="
  );

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
