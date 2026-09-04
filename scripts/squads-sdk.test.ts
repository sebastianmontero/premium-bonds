import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  isProposalExecutable,
  ProposalStatus,
  SQUADS_PROGRAM_ADDRESS,
  MULTISIG_DISCRIMINATOR,
  PROPOSAL_DISCRIMINATOR,
  createNoopSigner,
  MultisigAccount,
  ProposalAccount,
} from "../app/lib/squads-sdk";
import { parseTransactionError, matchSquadsError } from "../app/lib/errors";

describe("7-Vector Squads V4 Multisig SDK Suite", () => {
  it("Vector 1: Deterministic PDA Derivations", async () => {
    const createKey = address("11111111111111111111111111111111");

    const multisigPda = await findMultisigPda(createKey);
    assert.strictEqual(
      typeof multisigPda,
      "string",
      "Multisig PDA must be a string"
    );
    assert.ok(
      multisigPda.length >= 32,
      `findMultisigPda must return valid base58 address: ${multisigPda}`
    );

    const vault0Pda = await findMultisigVaultPda(multisigPda, 0);
    const vault1Pda = await findMultisigVaultPda(multisigPda, 1);
    assert.notStrictEqual(
      vault0Pda,
      vault1Pda,
      `Different vault indices must produce different PDAs: vault 0 (${vault0Pda}) != vault 1 (${vault1Pda})`
    );

    await assert.rejects(
      async () => {
        await findMultisigVaultPda(multisigPda, 256);
      },
      /between 0 and 255|Invalid vaultIndex/,
      "findMultisigVaultPda must reject vaultIndex > 255"
    );

    const tx1Pda = await findVaultTransactionPda(multisigPda, 1n);
    const tx2Pda = await findVaultTransactionPda(multisigPda, 2n);
    assert.notStrictEqual(
      tx1Pda,
      tx2Pda,
      `Different tx indices must produce distinct PDAs: tx 1 (${tx1Pda}) != tx 2 (${tx2Pda})`
    );

    const prop1Pda = await findProposalPda(multisigPda, 1n);
    assert.notStrictEqual(
      prop1Pda,
      tx1Pda,
      `Proposal PDA (${prop1Pda}) must differ from Transaction PDA (${tx1Pda}) for the same index`
    );
  });

  it("Vector 2: Discriminators & Account Header Parsing", () => {
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
    assert.strictEqual(
      parsedMs.transactionIndex,
      5n,
      "Multisig transactionIndex parsed correctly"
    );
    assert.strictEqual(
      parsedMs.threshold,
      2,
      "Multisig threshold parsed correctly"
    );
    assert.strictEqual(
      parsedMs.timeLock,
      3600,
      "Multisig timeLock parsed correctly"
    );

    // Invalid Multisig buffer (corrupt discriminator)
    const invalidBuf = new Uint8Array(validMultisigBuf);
    invalidBuf[0] = 0xff;
    assert.throws(
      () => parseMultisigAccount(invalidBuf),
      /Invalid account discriminator/,
      "Corrupt discriminator must be rejected on parseMultisigAccount"
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
    assert.strictEqual(
      parsedProp.transactionIndex,
      10n,
      "Proposal transactionIndex parsed correctly"
    );
    assert.strictEqual(
      parsedProp.status,
      "Approved",
      "Proposal status string parsed correctly"
    );
    assert.strictEqual(
      parsedProp.approvedTimestamp,
      1700000000n,
      "Proposal approvedTimestamp parsed correctly"
    );
  });

  it("Vector 3: Account Sorting & Deduplication", async () => {
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
    assert.strictEqual(
      compiled.numSigners,
      1,
      "Compiled message has exactly 1 signer (k1)"
    );
    assert.strictEqual(
      compiled.accountKeys[0],
      k1,
      "Account 0 is writable signer k1"
    );
    assert.ok(
      compiled.accountKeys.includes(k2),
      "Account list includes writable non-signer k2"
    );
    assert.ok(
      compiled.accountKeys.includes(k3),
      "Account list includes escalated writable non-signer k3"
    );
    assert.ok(
      compiled.accountKeys.includes(prog),
      "Account list includes program key prog"
    );

    // Deduplication check: k3 must only appear once in accountKeys
    const k3Count = compiled.accountKeys.filter((a) => a === k3).length;
    assert.strictEqual(
      k3Count,
      1,
      "Duplicate account k3 is deduplicated to 1 entry"
    );
  });

  it("Vector 4: Privilege Demotion for Execution", async () => {
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
    assert.strictEqual(
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
    assert.notStrictEqual(
      remainingVaultAcc,
      undefined,
      "Execute instruction remaining_accounts includes dummyVault"
    );
    assert.strictEqual(
      remainingVaultAcc?.role,
      AccountRole.WRITABLE,
      "dummyVault is demoted from WRITABLE_SIGNER to WRITABLE (non-signer) in execute remaining_accounts"
    );
  });

  it("Vector 5: Timelock Boundaries & Executability Verification", () => {
    const mockMultisigAddress = address("11111111111111111111111111111111");
    const mockMember1 = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const mockMember2 = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    const multisig: MultisigAccount = {
      address: mockMultisigAddress,
      createKey: mockMultisigAddress,
      configAuthority: mockMultisigAddress,
      threshold: 2,
      timeLock: 3600, // 1 hour
      transactionIndex: 10n,
      staleTransactionIndex: 0n,
      bump: 255,
      members: [
        { key: mockMember1, permissions: 7 },
        { key: mockMember2, permissions: 7 },
      ],
    };

    const proposal: ProposalAccount = {
      address: mockMultisigAddress,
      multisig: mockMultisigAddress,
      transactionIndex: 10n,
      status: "Approved",
      statusCode: ProposalStatus.Approved,
      approvedTimestamp: 1700000000n,
      approved: [mockMember1, mockMember2],
      rejected: [],
      cancelled: [],
    };

    // Before timelock expiration (1700000000 + 3600 = 1700003600)
    const beforeTimelock = isProposalExecutable(
      proposal,
      multisig,
      1700001000n
    );
    assert.strictEqual(
      beforeTimelock.executable,
      false,
      "Proposal must not be executable before timelock elapses"
    );
    assert.ok(
      beforeTimelock.reason?.includes("Timelock active"),
      `Expected timelock active reason, got: ${beforeTimelock.reason}`
    );

    // Exactly at or after timelock expiration
    const afterTimelock = isProposalExecutable(proposal, multisig, 1700003600n);
    assert.strictEqual(
      afterTimelock.executable,
      true,
      "Proposal must be executable once timelock duration has elapsed"
    );

    // Insufficient approvals check
    const insufficientProposal: ProposalAccount = {
      ...proposal,
      approved: [mockMember1], // only 1 approval, threshold is 2
    };
    const insufficientResult = isProposalExecutable(
      insufficientProposal,
      multisig,
      1700004000n
    );
    assert.strictEqual(
      insufficientResult.executable,
      false,
      "Proposal must not be executable when approvals < threshold"
    );
    assert.ok(
      insufficientResult.reason?.includes("do not satisfy threshold"),
      `Expected threshold failure reason, got: ${insufficientResult.reason}`
    );
  });

  it("Vector 6: Atomic Propose Wire Size Guard & MTU Splitting", async () => {
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

    assert.strictEqual(
      smallProposal.isSplit,
      false,
      "Small instruction is bundled atomically in 1 single transaction"
    );
    assert.strictEqual(
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

    assert.strictEqual(
      largeProposal.isSplit,
      true,
      "Large instruction exceeding 1100 bytes is automatically split into 2 transactions"
    );
    assert.strictEqual(
      largeProposal.instructions.length,
      2,
      "Tx 1 has 2 instructions (createTx + createProposal)"
    );
    assert.strictEqual(
      largeProposal.secondaryInstructions?.length,
      1,
      "Tx 2 has 1 instruction (proposalApprove)"
    );
  });

  it("Vector 7: Hierarchical Error Disambiguation", () => {
    // Squads 6000 series error
    const squadsErr = matchSquadsError(6001);
    assert.notStrictEqual(
      squadsErr,
      null,
      "Squads error 6001 must be mapped to a known error object"
    );
    assert.strictEqual(
      squadsErr?.info.name,
      "InvalidThreshold",
      `Squads error 6001 mapped to ${squadsErr?.info.name}`
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

    assert.strictEqual(
      parsedError.layer,
      "anchor",
      "Inner program Anchor error takes precedence over outer Squads 6000 error"
    );
    assert.ok(
      parsedError.title.includes("UnauthorizedAdmin") ||
        parsedError.message.includes("administrator"),
      `Parsed error accurately reports inner cause: "${parsedError.title}: ${parsedError.message}"`
    );
  });

  it("Vector 8: Codama Admin Instruction Signer Propagation into Vault Message", async () => {
    const {
      buildAdminVoidPayoutRegistryInstruction,
      buildUpdateGlobalConfigInstruction,
    } = await import("../app/lib/bonds-sdk");

    const vaultPda = address("11111111111111111111111111111111");

    // 1. buildAdminVoidPayoutRegistryInstruction with NoopSigner
    const voidIx = await buildAdminVoidPayoutRegistryInstruction({
      admin: createNoopSigner(vaultPda),
      poolId: 1,
      cycleId: 4,
    });

    const voidAdminAccount = voidIx.accounts?.find(
      (a) => a.address === vaultPda
    );
    assert.strictEqual(
      voidAdminAccount?.role,
      AccountRole.READONLY_SIGNER,
      "Admin account must have READONLY_SIGNER role when built with createNoopSigner"
    );

    const compiledVoidMsg = compileVaultTransactionMessage([voidIx]);
    assert.strictEqual(
      compiledVoidMsg.numSigners,
      1,
      "Compiled vault message for void-draw must have exactly 1 signer"
    );
    assert.strictEqual(
      compiledVoidMsg.accountKeys[0],
      vaultPda,
      "Vault PDA must be account key 0 (signer)"
    );

    // 2. buildUpdateGlobalConfigInstruction with NoopSigner
    const updateConfigIx = await buildUpdateGlobalConfigInstruction({
      admin: createNoopSigner(vaultPda),
    });

    const configAdminAccount = updateConfigIx.accounts?.find(
      (a) => a.address === vaultPda
    );
    assert.strictEqual(
      configAdminAccount?.role,
      AccountRole.READONLY_SIGNER,
      "Admin account in update-global-config must have READONLY_SIGNER role"
    );

    const compiledConfigMsg = compileVaultTransactionMessage([updateConfigIx]);
    assert.strictEqual(
      compiledConfigMsg.numSigners,
      1,
      "Compiled vault message for update-global-config must have exactly 1 signer"
    );
    assert.strictEqual(
      compiledConfigMsg.accountKeys[0],
      vaultPda,
      "Vault PDA must be account key 0 (signer)"
    );
  });
});
