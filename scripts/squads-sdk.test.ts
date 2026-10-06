import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  address,
  generateKeyPairSigner,
  AccountRole,
  Instruction,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
} from "@solana/kit";
import {
  findMultisigPda,
  findMultisigVaultPda,
  findVaultTransactionPda,
  findProposalPda,
  findProgramConfigPda,
  parseMultisigAccount,
  parseProposalAccount,
  parseVaultTransactionAccount,
  parseProgramConfigAccount,
  calculateMultisigAccountSpace,
  compileVaultTransactionMessage,
  serializeVaultTransactionMessage,
  buildVaultTransactionCreateInstruction,
  buildAtomicProposeInstructions,
  buildVaultTransactionExecuteInstruction,
  isProposalExecutable,
  ProposalStatus,
  SquadsPermission,
  formatSquadsPermissions,
  hasSquadsPermission,
  parseSquadsPermissions,
  SQUADS_PROGRAM_ADDRESS,
  SQUADS_INSTRUCTION_SIGHASHES,
  MULTISIG_DISCRIMINATOR,
  PROPOSAL_DISCRIMINATOR,
  PROGRAM_CONFIG_DISCRIMINATOR,
  createNoopSigner,
  MultisigAccount,
  ProposalAccount,
} from "../app/lib/squads-sdk";
import { parseTransactionError, matchSquadsError } from "../app/lib/errors";
import {
  fetchAccountData,
  fetchAccountInfo,
  parseSquadsCreateConfig,
  executeSquadsCreate,
  saveSquadsMultisigDeployment,
} from "./squads-cli-utils";
import { InsufficientFundsError } from "./utils";
import * as sqds from "@sqds/multisig";
import { PublicKey } from "@solana/web3.js";

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

    // Differential Oracle checks against @sqds/multisig
    const [expectedMsPda] = sqds.getMultisigPda({
      createKey: new PublicKey(createKey),
    });
    assert.strictEqual(
      multisigPda,
      expectedMsPda.toBase58(),
      "findMultisigPda must match @sqds/multisig getMultisigPda"
    );

    const [expectedVault0Pda] = sqds.getVaultPda({
      multisigPda: new PublicKey(multisigPda),
      index: 0,
    });
    assert.strictEqual(
      vault0Pda,
      expectedVault0Pda.toBase58(),
      "findMultisigVaultPda (vault 0) must match @sqds/multisig getVaultPda"
    );

    const [expectedTx1Pda] = sqds.getTransactionPda({
      multisigPda: new PublicKey(multisigPda),
      index: 1n,
    });
    assert.strictEqual(
      tx1Pda,
      expectedTx1Pda.toBase58(),
      "findVaultTransactionPda must match @sqds/multisig getTransactionPda"
    );

    const [expectedProp1Pda] = sqds.getProposalPda({
      multisigPda: new PublicKey(multisigPda),
      transactionIndex: 1n,
    });
    assert.strictEqual(
      prop1Pda,
      expectedProp1Pda.toBase58(),
      "findProposalPda must match @sqds/multisig getProposalPda"
    );

    const progConfigPda = await findProgramConfigPda();
    const [expectedProgConfigPda] = sqds.getProgramConfigPda({});
    assert.strictEqual(
      progConfigPda,
      expectedProgConfigPda.toBase58(),
      "findProgramConfigPda must match @sqds/multisig getProgramConfigPda"
    );
  });

  it("Vector 2: Discriminators & Account Header Parsing (Differential Oracle Tests)", async () => {
    // 1. Permission domain helpers
    assert.strictEqual(
      formatSquadsPermissions(7),
      "0x7 [Initiate, Vote, Execute]",
      "formatSquadsPermissions formats full mask"
    );
    assert.strictEqual(
      formatSquadsPermissions(1),
      "0x1 [Initiate]",
      "formatSquadsPermissions formats single permission"
    );
    assert.strictEqual(
      formatSquadsPermissions(0),
      "0x0 [None]",
      "formatSquadsPermissions formats zero permissions"
    );
    assert.deepStrictEqual(
      parseSquadsPermissions(SquadsPermission.Vote | SquadsPermission.Execute),
      ["Vote", "Execute"]
    );
    assert.strictEqual(hasSquadsPermission(7, SquadsPermission.Initiate), true);
    assert.strictEqual(
      hasSquadsPermission(2, SquadsPermission.Initiate),
      false
    );

    // 2. Minimum size guard
    assert.throws(
      () => parseMultisigAccount(new Uint8Array(50)),
      /Invalid Multisig account data size: 50 bytes/,
      "Multisig buffers smaller than 100 bytes must be rejected"
    );

    // 3. Differential Multisig Deserialization with @sqds/multisig oracle
    const member1 = (await generateKeyPairSigner()).address;
    const member2 = (await generateKeyPairSigner()).address;
    const member3 = (await generateKeyPairSigner()).address;
    const createKey = (await generateKeyPairSigner()).address;

    const [serializedMultisig] = sqds.accounts.Multisig.fromArgs({
      createKey: new PublicKey(createKey),
      configAuthority: PublicKey.default,
      threshold: 2,
      timeLock: 3600,
      transactionIndex: 5n,
      staleTransactionIndex: 1n,
      rentCollector: null,
      bump: 254,
      members: [
        {
          key: new PublicKey(member1),
          permissions: sqds.types.Permissions.all(),
        },
        {
          key: new PublicKey(member2),
          permissions: sqds.types.Permissions.fromPermissions([
            sqds.types.Permission.Vote,
            sqds.types.Permission.Execute,
          ]),
        },
        {
          key: new PublicKey(member3),
          permissions: sqds.types.Permissions.fromPermissions([
            sqds.types.Permission.Initiate,
          ]),
        },
      ],
    }).serialize();

    const parsedMs = parseMultisigAccount(new Uint8Array(serializedMultisig));
    assert.strictEqual(parsedMs.createKey, createKey);
    assert.strictEqual(parsedMs.configAuthority, PublicKey.default.toBase58());
    assert.strictEqual(parsedMs.threshold, 2);
    assert.strictEqual(parsedMs.timeLock, 3600);
    assert.strictEqual(parsedMs.transactionIndex, 5n);
    assert.strictEqual(parsedMs.staleTransactionIndex, 1n);
    assert.strictEqual(parsedMs.bump, 254);
    assert.strictEqual(parsedMs.members.length, 3);
    assert.strictEqual(parsedMs.members[0].key, member1);
    assert.strictEqual(parsedMs.members[0].permissions, 7);
    assert.strictEqual(parsedMs.members[1].key, member2);
    assert.strictEqual(parsedMs.members[1].permissions, 6);
    assert.strictEqual(parsedMs.members[2].key, member3);
    assert.strictEqual(parsedMs.members[2].permissions, 1);

    // 4. Real Devnet Multisig Account Regression Test (AkJHtXZeeTuzMoBqxudJJSFNeGLahGK6dBXKv8uTb1uF)
    const devnetHex =
      "e07479ba44a14feceaf03b3de9739519dcf52326dc9835c3e55a35ea18c32c834509d7e0d31db3d3" +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "0200" +
      "00000000" +
      "0000000000000000" +
      "0000000000000000" +
      "00" +
      "ff" +
      "02000000" +
      "c23e1b0aafde697a5a5cbc21fb27870f65c4cbabccadd91fd48a621f201b899d07" +
      "c3833e0ba3a46566c6d52ae54a70f32b3af7778b4ccbd66e7fd9e379e6c3910b07" +
      "0000000000000000000000000000000000000000000000000000000000000000";

    const devnetBuf = Buffer.from(devnetHex, "hex");
    const parsedDevnetMs = parseMultisigAccount(new Uint8Array(devnetBuf));
    assert.strictEqual(parsedDevnetMs.members.length, 2);
    assert.strictEqual(
      parsedDevnetMs.members[0].key,
      "E5F29wyzm1etJCWJ75uU4DBGPHKYcvbLaspz2kByS9et"
    );
    assert.strictEqual(parsedDevnetMs.members[0].permissions, 7);
    assert.strictEqual(
      parsedDevnetMs.members[1].key,
      "EACaCp2XDsdbHAUV9hxwo6VNB1qPqXkwhjQ7p5xu6q2i"
    );
    assert.strictEqual(parsedDevnetMs.members[1].permissions, 7);
    assert.strictEqual(parsedDevnetMs.threshold, 2);

    // 5. Differential Proposal Deserialization with @sqds/multisig oracle
    const msAddress = (await generateKeyPairSigner()).address;
    const [serializedProp] = sqds.accounts.Proposal.fromArgs({
      multisig: new PublicKey(msAddress),
      transactionIndex: 12n,
      status: {
        __kind: "Approved",
        timestamp: 1700000000n,
      } as any,
      bump: 253,
      approved: [new PublicKey(member1), new PublicKey(member2)],
      rejected: [new PublicKey(member3)],
      cancelled: [],
    }).serialize();

    const parsedProp = parseProposalAccount(new Uint8Array(serializedProp));
    assert.strictEqual(parsedProp.multisig, msAddress);
    assert.strictEqual(parsedProp.transactionIndex, 12n);
    assert.strictEqual(parsedProp.status, "Approved");
    assert.strictEqual(parsedProp.statusCode, ProposalStatus.Approved);
    assert.strictEqual(parsedProp.statusTimestamp, 1700000000n);
    assert.strictEqual(parsedProp.approvedTimestamp, 1700000000n);
    assert.strictEqual(parsedProp.bump, 253);
    assert.deepStrictEqual(parsedProp.approved, [member1, member2]);
    assert.deepStrictEqual(parsedProp.rejected, [member3]);
    assert.deepStrictEqual(parsedProp.cancelled, []);

    // 6. Differential VaultTransaction Deserialization with @sqds/multisig oracle
    const [serializedVaultTx] = sqds.accounts.VaultTransaction.fromArgs({
      multisig: new PublicKey(msAddress),
      creator: new PublicKey(member1),
      index: 12n,
      bump: 252,
      vaultIndex: 0,
      vaultBump: 251,
      ephemeralSignerBumps: new Uint8Array([250, 249]),
      message: {
        numSigners: 1,
        numWritableSigners: 1,
        numWritableNonSigners: 0,
        accountKeys: [new PublicKey(member1), new PublicKey(member2)],
        instructions: [
          {
            programIdIndex: 1,
            accountIndexes: new Uint8Array([0]),
            data: new Uint8Array([1, 2, 3]),
          },
        ],
        addressTableLookups: [],
      },
    }).serialize();

    const parsedVaultTx = parseVaultTransactionAccount(
      new Uint8Array(serializedVaultTx)
    );
    assert.strictEqual(parsedVaultTx.multisig, msAddress);
    assert.strictEqual(parsedVaultTx.creator, member1);
    assert.strictEqual(parsedVaultTx.index, 12n);
    assert.strictEqual(parsedVaultTx.bump, 252);
    assert.strictEqual(parsedVaultTx.vaultIndex, 0);
    assert.strictEqual(parsedVaultTx.vaultBump, 251);
    assert.deepStrictEqual(
      Array.from(parsedVaultTx.ephemeralSignerBumps),
      [250, 249]
    );
    assert.strictEqual(parsedVaultTx.ephemeralSigners, 2);
    assert.strictEqual(parsedVaultTx.message.numSigners, 1);
    assert.strictEqual(parsedVaultTx.message.accountKeys.length, 2);
    assert.strictEqual(parsedVaultTx.message.instructions.length, 1);
    assert.deepStrictEqual(
      Array.from(parsedVaultTx.message.instructions[0].data),
      [1, 2, 3]
    );

    // 7. Wire serialization parity for buildVaultTransactionCreateInstruction
    const dummyIx: Instruction = {
      programAddress: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      accounts: [{ address: member1, role: AccountRole.WRITABLE_SIGNER }],
      data: new Uint8Array([10, 20]),
    };
    const compiledMsg = compileVaultTransactionMessage([dummyIx]);
    const txPda = (await generateKeyPairSigner()).address;
    const vaultCreateIx = buildVaultTransactionCreateInstruction({
      multisig: msAddress,
      transactionPda: txPda,
      creator: member1,
      vaultIndex: 0,
      ephemeralSigners: 0,
      message: compiledMsg,
      memo: "test proposal",
    });

    // Account role correctness: multisig must be WRITABLE so Anchor permits state mutation
    assert.strictEqual(vaultCreateIx.accounts![0].role, AccountRole.WRITABLE);
    assert.strictEqual(vaultCreateIx.accounts![1].role, AccountRole.WRITABLE);

    // Differential Oracle check against @sqds/multisig beet serialization
    const sqdsMessage = {
      numSigners: compiledMsg.numSigners,
      numWritableSigners: compiledMsg.numWritableSigners,
      numWritableNonSigners: compiledMsg.numWritableNonSigners,
      accountKeys: compiledMsg.accountKeys.map((k) => new PublicKey(k)),
      instructions: compiledMsg.instructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accountIndexes: ix.accountIndexes,
        data: Array.from(ix.data),
      })),
      addressTableLookups: [],
    };
    const [expectedBeetBytes] =
      sqds.types.transactionMessageBeet.serialize(sqdsMessage);
    const actualSerializedMsg = serializeVaultTransactionMessage(compiledMsg);
    assert.deepStrictEqual(
      Buffer.from(actualSerializedMsg),
      Buffer.from(expectedBeetBytes),
      "serializeVaultTransactionMessage must match @sqds/multisig transactionMessageBeet byte-for-byte"
    );

    const expectedSqdsIx =
      sqds.generated.createVaultTransactionCreateInstruction(
        {
          multisig: new PublicKey(msAddress),
          transaction: new PublicKey(txPda),
          creator: new PublicKey(member1),
          rentPayer: new PublicKey(member1),
        },
        {
          args: {
            vaultIndex: 0,
            ephemeralSigners: 0,
            transactionMessage: expectedBeetBytes,
            memo: "test proposal",
          },
        }
      );
    assert.deepStrictEqual(
      Buffer.from(vaultCreateIx.data),
      Buffer.from(expectedSqdsIx.data),
      "vaultCreateIx.data must match @sqds/multisig instruction data byte-for-byte"
    );

    // Verify discriminator (8 bytes) + vaultIndex (1 byte) + ephemeralSigners (1 byte) + messageLen (4 bytes u32)
    assert.strictEqual(vaultCreateIx.data.length > 14, true);
    const msgLenView = new DataView(
      vaultCreateIx.data.buffer,
      vaultCreateIx.data.byteOffset
    );
    const lengthPrefix = msgLenView.getUint32(10, true);
    assert.strictEqual(
      lengthPrefix,
      actualSerializedMsg.length,
      `Message length prefix must equal actual SmallVec serialized message length (${actualSerializedMsg.length})`
    );

    // Differential Oracle check for vaultTransactionClose sighash
    assert.deepStrictEqual(
      Array.from(SQUADS_INSTRUCTION_SIGHASHES.vaultTransactionClose),
      sqds.generated.vaultTransactionAccountsCloseInstructionDiscriminator,
      "vaultTransactionClose must match vaultTransactionAccountsClose discriminator"
    );

    // 8. Corrupt discriminator rejection
    const invalidBuf = new Uint8Array(devnetBuf);
    invalidBuf[0] = 0xff;
    assert.throws(
      () => parseMultisigAccount(invalidBuf),
      /Invalid account discriminator/,
      "Corrupt discriminator must be rejected on parseMultisigAccount"
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

  it("Vector 8: fetchAccountData correctly decodes base64 RPC data without decoder TypeError", async () => {
    let capturedConfig: any = null;
    const mockRpc = {
      getAccountInfo: (_addr: any, config: any) => {
        capturedConfig = config;
        return {
          send: async () => ({
            context: { slot: 100n },
            value: {
              data: ["AQIDBAUG", "base64"],
              executable: false,
              lamports: 50_000_000n,
              owner: SQUADS_PROGRAM_ADDRESS,
              rentEpoch: 0n,
              space: 6n,
            },
          }),
        };
      },
    } as any;

    const dummyAddr = address("11111111111111111111111111111111");
    const accountData = await fetchAccountData(mockRpc, dummyAddr);
    assert.strictEqual(capturedConfig?.encoding, "base64");
    assert.ok(accountData instanceof Uint8Array);
    assert.deepStrictEqual(accountData, new Uint8Array([1, 2, 3, 4, 5, 6]));

    const accountInfo = await fetchAccountInfo(mockRpc, dummyAddr);
    assert.strictEqual(accountInfo?.value?.lamports, 50_000_000n);
  });

  it("Vector 9: squads-create Parameter Validation & Safety Guards", async () => {
    const feePayer = address("11111111111111111111111111111111");
    const alice = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const bob = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    // 1. Default Fallback when --members is omitted
    const defaultCfg = parseSquadsCreateConfig({
      feePayerAddress: feePayer,
    });
    assert.deepStrictEqual(defaultCfg.members, [feePayer]);
    assert.strictEqual(defaultCfg.threshold, 1);
    assert.strictEqual(defaultCfg.timeLock, 0n);
    assert.strictEqual(defaultCfg.configAuthority, null);

    // 2. Whitespace and comma-only fallback to fee payer
    const whitespaceMembersCfg = parseSquadsCreateConfig({
      membersRaw: " , , ",
      feePayerAddress: feePayer,
    });
    assert.deepStrictEqual(whitespaceMembersCfg.members, [feePayer]);

    // 3. Creator omission warning check (custom members retained)
    const customMembersCfg = parseSquadsCreateConfig({
      membersRaw: `${alice},${bob}`,
      feePayerAddress: feePayer,
    });
    assert.deepStrictEqual(customMembersCfg.members, [alice, bob]);
    assert.ok(!customMembersCfg.members.includes(feePayer));

    // 4. Threshold Bounds: Reject non-positive, non-integer, or floats
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "0",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "-1",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "abc",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "1.5",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "0.5",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "-2.5",
          feePayerAddress: feePayer,
        }),
      /Threshold must be a positive integer >= 1/
    );

    // 5. Threshold Overhang: Reject when threshold > members.length
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "3",
          membersRaw: `${alice},${bob}`,
          feePayerAddress: feePayer,
        }),
      /Threshold \(3\) cannot exceed the number of unique members \(2\)/
    );

    // 6. Deduplication Order: [Alice, Alice, Bob] with threshold 3 rejected because N_unique = 2 < 3
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          thresholdRaw: "3",
          membersRaw: `${alice},${alice},${bob}`,
          feePayerAddress: feePayer,
        }),
      /Threshold \(3\) cannot exceed the number of unique members \(2\)/
    );
    const dedupedCfg = parseSquadsCreateConfig({
      thresholdRaw: "2",
      membersRaw: `${alice},${alice},${bob}`,
      feePayerAddress: feePayer,
    });
    assert.deepStrictEqual(dedupedCfg.members, [alice, bob]);
    assert.strictEqual(dedupedCfg.threshold, 2);

    // 7. Address Validation: Reject invalid base58 public keys
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          membersRaw: "invalid-key-address",
          feePayerAddress: feePayer,
        }),
      /Invalid member public key address/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          configAuthorityRaw: "invalid-authority-key",
          feePayerAddress: feePayer,
        }),
      /Invalid config authority address/
    );

    // 8. Timelock Validation: Reject negative, non-integer, or u32 overflow
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          timelockRaw: "-10",
          feePayerAddress: feePayer,
        }),
      /Timelock must be a non-negative integer >= 0/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          timelockRaw: "abc",
          feePayerAddress: feePayer,
        }),
      /Timelock must be a non-negative integer >= 0/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          timelockRaw: "12.5",
          feePayerAddress: feePayer,
        }),
      /Timelock must be a non-negative integer >= 0/
    );
    assert.throws(
      () =>
        parseSquadsCreateConfig({
          timelockRaw: "4294967296", // u32::MAX + 1
          feePayerAddress: feePayer,
        }),
      /Timelock must be between 0 and 4294967295 seconds/
    );
    const validTimelockCfg = parseSquadsCreateConfig({
      timelockRaw: "3600",
      feePayerAddress: feePayer,
    });
    assert.strictEqual(validTimelockCfg.timeLock, 3600n);

    // 9. Space Formula Verification: 132 + 33 * N
    assert.strictEqual(calculateMultisigAccountSpace(1), 165);
    assert.strictEqual(calculateMultisigAccountSpace(2), 198);
    assert.strictEqual(calculateMultisigAccountSpace(5), 297);
    assert.strictEqual(calculateMultisigAccountSpace(10), 462);

    // 10. Autonomous Default & Custom Authority
    const customAuthCfg = parseSquadsCreateConfig({
      configAuthorityRaw: alice,
      feePayerAddress: feePayer,
    });
    assert.strictEqual(customAuthCfg.configAuthority, alice);

    // 11. PDA Derivation Parity between @solana/kit and @sqds/multisig
    const testCreateKey = address(
      "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM"
    );
    const kitMultisig = await findMultisigPda(testCreateKey);
    const [sqdsMultisigPk] = sqds.getMultisigPda({
      createKey: new PublicKey(testCreateKey),
    });
    assert.strictEqual(
      kitMultisig,
      sqdsMultisigPk.toBase58(),
      "Multisig PDA derivation must match @sqds/multisig"
    );

    const kitVault0 = await findMultisigVaultPda(kitMultisig, 0);
    const [sqdsVault0Pk] = sqds.getVaultPda({
      multisigPda: sqdsMultisigPk,
      index: 0,
    });
    assert.strictEqual(
      kitVault0,
      sqdsVault0Pk.toBase58(),
      "Vault index 0 PDA derivation must match @sqds/multisig"
    );

    const kitVault3 = await findMultisigVaultPda(kitMultisig, 3);
    const [sqdsVault3Pk] = sqds.getVaultPda({
      multisigPda: sqdsMultisigPk,
      index: 3,
    });
    assert.strictEqual(
      kitVault3,
      sqdsVault3Pk.toBase58(),
      "Vault index 3 PDA derivation must match @sqds/multisig"
    );

    const kitProgramConfig = await findProgramConfigPda();
    const [sqdsProgramConfigPk] = sqds.getProgramConfigPda({});
    assert.strictEqual(
      kitProgramConfig,
      sqdsProgramConfigPk.toBase58(),
      "ProgramConfig PDA derivation must match @sqds/multisig"
    );

    // 12. ProgramConfig Account Decoding & Discriminator Assertion
    const validConfigBuf = new Uint8Array(80);
    validConfigBuf.set(PROGRAM_CONFIG_DISCRIMINATOR, 0);
    const authBytes = getBase58Encoder().encode(alice);
    validConfigBuf.set(authBytes, 8);
    const view = new DataView(validConfigBuf.buffer);
    view.setBigUint64(40, 25_000_000n, true);
    const treasuryBytes = getBase58Encoder().encode(bob);
    validConfigBuf.set(treasuryBytes, 48);

    const parsedConfig = parseProgramConfigAccount(validConfigBuf);
    assert.strictEqual(parsedConfig.authority, alice);
    assert.strictEqual(parsedConfig.multisigCreationFee, 25_000_000n);
    assert.strictEqual(parsedConfig.treasury, bob);

    // Mismatched discriminator rejection
    const invalidDiscBuf = new Uint8Array(validConfigBuf);
    invalidDiscBuf[0] = 0xff;
    assert.throws(
      () => parseProgramConfigAccount(invalidDiscBuf),
      /Invalid account discriminator for ProgramConfig account/
    );

    // Short buffer rejection
    assert.throws(
      () => parseProgramConfigAccount(new Uint8Array(40)),
      /Invalid Squads ProgramConfig account size/
    );
  });

  it("Vector 10: executeSquadsCreate Lifecycle & Deployment Persistence", async () => {
    const signer = await generateKeyPairSigner();
    const alice = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const treasury = address("HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK");

    function createMockRpc(opts?: {
      programDeployed?: boolean;
      configDeployed?: boolean;
      creationFee?: bigint;
      creatorBalance?: bigint;
      rentLamports?: bigint;
    }) {
      const {
        programDeployed = true,
        configDeployed = true,
        creationFee = 0n,
        creatorBalance = 100_000_000n,
        rentLamports = 1_500_000n,
      } = opts ?? {};

      const configBuf = new Uint8Array(80);
      configBuf.set(PROGRAM_CONFIG_DISCRIMINATOR, 0);
      configBuf.set(getBase58Encoder().encode(alice), 8);
      const view = new DataView(configBuf.buffer);
      view.setBigUint64(40, creationFee, true);
      configBuf.set(getBase58Encoder().encode(treasury), 48);
      const configBase64 = Buffer.from(configBuf).toString("base64");

      return {
        getAccountInfo: (addr: Address, _cfg?: any) => {
          return {
            send: async () => {
              if (addr === SQUADS_PROGRAM_ADDRESS) {
                if (!programDeployed)
                  return { context: { slot: 1n }, value: null };
                return {
                  context: { slot: 1n },
                  value: {
                    data: ["", "base64"],
                    executable: true,
                    lamports: 1_000_000_000n,
                    owner: address(
                      "BPFLoaderUpgradeab1e11111111111111111111111"
                    ),
                    rentEpoch: 0n,
                    space: 36n,
                  },
                };
              }
              const programConfigPda = await findProgramConfigPda(
                SQUADS_PROGRAM_ADDRESS
              );
              if (addr === programConfigPda) {
                if (!configDeployed)
                  return { context: { slot: 1n }, value: null };
                return {
                  context: { slot: 1n },
                  value: {
                    data: [configBase64, "base64"],
                    executable: false,
                    lamports: 2_000_000n,
                    owner: SQUADS_PROGRAM_ADDRESS,
                    rentEpoch: 0n,
                    space: 80n,
                  },
                };
              }
              return { context: { slot: 1n }, value: null };
            },
          };
        },
        getMinimumBalanceForRentExemption: (_space: bigint) => {
          return {
            send: async () => rentLamports,
          };
        },
        getBalance: (_addr: Address) => {
          return {
            send: async () => ({
              context: { slot: 1n },
              value: creatorBalance,
            }),
          };
        },
        getLatestBlockhash: () => {
          return {
            send: async () => ({
              value: {
                blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
                lastValidBlockHeight: 1000n,
              },
            }),
          };
        },
        sendTransaction: (_wireTx: string, _opts?: any) => {
          return {
            send: async () => "mock_squads_create_tx_signature",
          };
        },
        getSignatureStatuses: (_sigs: string[]) => {
          return {
            send: async () => ({
              value: [
                {
                  confirmationStatus: "confirmed",
                  confirmations: 1,
                  err: null,
                  slot: 100n,
                },
              ],
            }),
          };
        },
      } as any;
    }

    const validConfig = parseSquadsCreateConfig({
      membersRaw: alice,
      thresholdRaw: "1",
      feePayerAddress: signer.address,
    });

    // 1. Guard: Squads program missing
    const rpcNoProg = createMockRpc({ programDeployed: false });
    await assert.rejects(
      () =>
        executeSquadsCreate({
          rpc: rpcNoProg,
          signer,
          config: validConfig,
        }),
      /Squads V4 program .* is not deployed on this cluster/
    );

    // 2. Guard: ProgramConfig account missing
    const rpcNoConfig = createMockRpc({ configDeployed: false });
    await assert.rejects(
      () =>
        executeSquadsCreate({
          rpc: rpcNoConfig,
          signer,
          config: validConfig,
        }),
      /Squads V4 ProgramConfig account .* not found on this cluster/
    );

    // 3. Guard: Insufficient balance with non-zero creation fee
    // rent = 1_500_000, feeBuffer = 10_000, creationFee = 50_000_000 => required = 51_510_000
    // Signer balance = 50_000_000 (insufficient)
    const rpcLowBalance = createMockRpc({
      creationFee: 50_000_000n,
      creatorBalance: 50_000_000n,
      rentLamports: 1_500_000n,
    });
    await assert.rejects(
      () =>
        executeSquadsCreate({
          rpc: rpcLowBalance,
          signer,
          config: validConfig,
        }),
      (err: any) => {
        assert.ok(err instanceof InsufficientFundsError);
        assert.strictEqual(err.requiredLamports, 51_510_000n);
        assert.strictEqual(err.balanceLamports, 50_000_000n);
        return true;
      }
    );

    // 4. Successful creation with default generated createKey
    const rpcSuccess = createMockRpc({
      creatorBalance: 100_000_000n,
      creationFee: 0n,
    });
    const resultDefault = await executeSquadsCreate({
      rpc: rpcSuccess,
      signer,
      config: validConfig,
    });
    assert.strictEqual(
      typeof resultDefault.multisigPda,
      "string",
      "Must return valid multisig PDA"
    );
    assert.strictEqual(
      typeof resultDefault.vaultPda,
      "string",
      "Must return valid vault PDA"
    );
    assert.strictEqual(
      typeof resultDefault.createKey,
      "string",
      "Must return valid createKey address"
    );
    assert.strictEqual(
      resultDefault.signature,
      "mock_squads_create_tx_signature"
    );

    // 5. Successful creation with explicit createKeySigner
    const explicitCreateKey = await generateKeyPairSigner();
    const resultExplicit = await executeSquadsCreate({
      rpc: rpcSuccess,
      signer,
      config: validConfig,
      createKeySigner: explicitCreateKey,
    });
    assert.strictEqual(resultExplicit.createKey, explicitCreateKey.address);
    const expectedMultisig = await findMultisigPda(explicitCreateKey.address);
    assert.strictEqual(resultExplicit.multisigPda, expectedMultisig);

    // 6. Dry-run simulation mode
    const dryRunResult = await executeSquadsCreate({
      rpc: rpcSuccess,
      signer,
      config: validConfig,
      dryRun: true,
    });
    assert.strictEqual(
      dryRunResult.signature,
      "simulated_dry_run_signature",
      "Dry run must return simulated signature without broadcasting"
    );

    // 7. Deployment persistence with saveSquadsMultisigDeployment
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "squads-test-persistence-")
    );
    try {
      // Localnet state directory setup
      const localStateDir = path.join(tmpDir, "scripts", "localnet-state");
      fs.mkdirSync(localStateDir, { recursive: true });
      fs.writeFileSync(
        path.join(localStateDir, "addresses.json"),
        JSON.stringify({ programId: "MockProgram11111111111111111111111111" })
      );

      // Devnet state directory setup
      const devStateDir = path.join(tmpDir, "scripts", "devnet-state");
      fs.mkdirSync(devStateDir, { recursive: true });
      fs.writeFileSync(
        path.join(devStateDir, "addresses.json"),
        JSON.stringify({ programId: "MockProgram11111111111111111111111111" })
      );
      fs.writeFileSync(
        path.join(tmpDir, ".env.devnet"),
        "NEXT_PUBLIC_PROGRAM_ID=MockProgram11111111111111111111111111\n"
      );

      // Test localnet save
      saveSquadsMultisigDeployment({
        rpcUrl: "http://127.0.0.1:8899",
        multisigPda: resultDefault.multisigPda,
        projectRoot: tmpDir,
      });
      const localEnvContent = fs.readFileSync(
        path.join(tmpDir, ".env.local"),
        "utf-8"
      );
      assert.ok(
        localEnvContent.includes(
          `SQUADS_MULTISIG_ADDRESS=${resultDefault.multisigPda}`
        ),
        ".env.local must contain SQUADS_MULTISIG_ADDRESS"
      );

      // Test devnet save
      saveSquadsMultisigDeployment({
        rpcUrl: "https://api.devnet.solana.com",
        multisigPda: resultExplicit.multisigPda,
        projectRoot: tmpDir,
      });
      const devnetEnvContent = fs.readFileSync(
        path.join(tmpDir, ".env.devnet"),
        "utf-8"
      );
      assert.ok(
        devnetEnvContent.includes(
          `SQUADS_MULTISIG_ADDRESS=${resultExplicit.multisigPda}`
        ),
        ".env.devnet must contain updated SQUADS_MULTISIG_ADDRESS"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
