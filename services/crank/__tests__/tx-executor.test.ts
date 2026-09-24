import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBenignConcurrencyRace,
  JITO_TIP_ACCOUNTS,
  getRandomJitoTipAccount,
  createSystemTransferInstruction,
} from "../executor/tx-executor";
import { generateKeyPairSigner } from "@solana/kit";

describe("TxExecutor Unit Tests", () => {
  it("should classify Anchor race error codes as benign concurrency race", () => {
    // 6008 = AlreadyClaimed
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6008 }],
      }),
      true
    );

    // 6000 = PoolClosed
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6000 }],
      }),
      true
    );

    // 6001 = PoolPaused
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6001 }],
      }),
      true
    );

    // Error messages with standard Anchor race strings
    assert.strictEqual(
      isBenignConcurrencyRace(new Error("custom program error: 0x1778")),
      true
    );
    assert.strictEqual(
      isBenignConcurrencyRace(
        new Error("State already revealed by competitor")
      ),
      true
    );

    // Non-benign errors should return false
    assert.strictEqual(
      isBenignConcurrencyRace(new Error("Account not found")),
      false
    );
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6009 }], // MathOverflow
      }),
      false
    );
  });

  it("should have exactly 8 canonical Jito tip accounts and rotate across them", () => {
    assert.strictEqual(JITO_TIP_ACCOUNTS.length, 8);
    const chosen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      chosen.add(getRandomJitoTipAccount().toString());
    }
    assert.strictEqual(chosen.size > 1, true);
  });

  it("should construct valid SystemProgram transfer tip instruction", async () => {
    const signer = await generateKeyPairSigner();
    const tipAccount = JITO_TIP_ACCOUNTS[0];
    const tipLamports = 10_000n;

    const ix = createSystemTransferInstruction({
      from: signer,
      to: tipAccount,
      lamports: tipLamports,
    });

    assert.strictEqual(ix.programAddress, "11111111111111111111111111111111");
    assert.strictEqual(ix.accounts?.length, 2);
    assert.strictEqual(ix.accounts?.[0]?.address, signer.address);
    assert.strictEqual(ix.accounts?.[1]?.address, tipAccount);
    assert.strictEqual(ix.data?.length, 12);
  });
});
