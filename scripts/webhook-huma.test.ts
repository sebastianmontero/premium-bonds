import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHumaSettlementTx } from "../app/lib/indexer/settlement-monitor";
import type { HeliusTransactionPayload } from "../app/lib/types/webhook";
import { address } from "@solana/kit";

const TARGET_HUMA_POOL = "HumaPoo111111111111111111111111111111111111";
const OTHER_ACCOUNT = "OtherAcc11111111111111111111111111111111111";

describe("isHumaSettlementTx Unit Tests", () => {
  it("should match when target address is in meta.accountKeys (string array)", () => {
    const tx: HeliusTransactionPayload = {
      signature: "tx_meta_str_1",
      slot: 100,
      timestamp: 1700000000,
      meta: {
        err: null,
        accountKeys: [OTHER_ACCOUNT, TARGET_HUMA_POOL],
      },
    };

    assert.strictEqual(isHumaSettlementTx(tx, TARGET_HUMA_POOL), true);
    assert.strictEqual(isHumaSettlementTx(tx, address(TARGET_HUMA_POOL)), true);
  });

  it("should match when target address is in meta.loadedAddresses (writable/readonly)", () => {
    const txWritable: HeliusTransactionPayload = {
      signature: "tx_alt_writable",
      slot: 101,
      timestamp: 1700000000,
      meta: {
        err: null,
        accountKeys: [OTHER_ACCOUNT],
        loadedAddresses: {
          writable: [address(TARGET_HUMA_POOL)],
          readonly: [],
        },
      },
    };
    assert.strictEqual(isHumaSettlementTx(txWritable, TARGET_HUMA_POOL), true);

    const txReadonly: HeliusTransactionPayload = {
      signature: "tx_alt_readonly",
      slot: 102,
      timestamp: 1700000000,
      meta: {
        err: null,
        accountKeys: [OTHER_ACCOUNT],
        loadedAddresses: {
          writable: [],
          readonly: [TARGET_HUMA_POOL],
        },
      },
    };
    assert.strictEqual(isHumaSettlementTx(txReadonly, TARGET_HUMA_POOL), true);
  });

  it("should match when target address is in top-level accountData (Helius Enhanced Webhook format)", () => {
    const txObjectFormat: HeliusTransactionPayload = {
      signature: "tx_enhanced_1",
      slot: 103,
      timestamp: 1700000000,
      accountData: [
        { account: OTHER_ACCOUNT, nativeBalanceChange: 0 },
        { account: TARGET_HUMA_POOL, nativeBalanceChange: 0 },
      ],
    };
    assert.strictEqual(
      isHumaSettlementTx(txObjectFormat, TARGET_HUMA_POOL),
      true
    );

    const txStringFormat: HeliusTransactionPayload = {
      signature: "tx_enhanced_2",
      slot: 104,
      timestamp: 1700000000,
      accountData: [OTHER_ACCOUNT, TARGET_HUMA_POOL],
    };
    assert.strictEqual(
      isHumaSettlementTx(txStringFormat, TARGET_HUMA_POOL),
      true
    );
  });

  it("should return false when target address is absent", () => {
    const tx: HeliusTransactionPayload = {
      signature: "tx_negative_1",
      slot: 105,
      timestamp: 1700000000,
      meta: {
        err: null,
        accountKeys: [OTHER_ACCOUNT],
        loadedAddresses: { writable: [], readonly: [] },
      },
      accountData: [{ account: OTHER_ACCOUNT }],
    };
    assert.strictEqual(isHumaSettlementTx(tx, TARGET_HUMA_POOL), false);
  });

  it("should return false when humaPoolStateAddress is undefined or empty", () => {
    const tx: HeliusTransactionPayload = {
      signature: "tx_no_target",
      slot: 106,
      timestamp: 1700000000,
      meta: {
        err: null,
        accountKeys: [TARGET_HUMA_POOL],
      },
    };
    assert.strictEqual(isHumaSettlementTx(tx, undefined), false);
    assert.strictEqual(isHumaSettlementTx(tx, ""), false);
  });

  it("should return false when tx.meta and accountData are missing", () => {
    const tx: HeliusTransactionPayload = {
      signature: "tx_empty",
      slot: 107,
      timestamp: 1700000000,
    };
    assert.strictEqual(isHumaSettlementTx(tx, TARGET_HUMA_POOL), false);
  });
});
