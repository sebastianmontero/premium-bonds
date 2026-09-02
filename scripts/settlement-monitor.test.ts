import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SettlementMonitorService,
  DEFAULT_POOL_ID,
  type SolanaRpcClient,
} from "../app/lib/indexer/settlement-monitor";
import { address, getBase64Encoder } from "@solana/kit";

describe("SettlementMonitorService Unit Tests", () => {
  const TEST_POOL_STATE_ADDR = "HumaPoo111111111111111111111111111111111111";

  it("should fail gracefully when humaPoolStateAddress is empty or undefined", async () => {
    const monitor = new SettlementMonitorService();
    const result = await monitor.syncHumaPoolSettlements(
      "http://127.0.0.1:8899",
      ""
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.updatedCount, 0);
    assert.strictEqual(result.error, "Huma pool state address is required");
  });

  it("should fail gracefully when account is not found on-chain", async () => {
    const mockRpc = {
      getAccountInfo: (_addr: any, _opts: any) => ({
        send: async () => ({ value: null }),
      }),
    } as unknown as SolanaRpcClient;

    const monitor = new SettlementMonitorService();
    const result = await monitor.syncHumaPoolSettlements(
      mockRpc,
      TEST_POOL_STATE_ADDR,
      DEFAULT_POOL_ID
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.updatedCount, 0);
    assert.match(
      result.error ?? "",
      /Huma pool state account not found: HumaPoo111111111111111111111111111111111111 on RPC client/
    );
  });

  it("should decode Huma account data, parse queue IDs, and invoke settleEligibleRedemptions", async () => {
    // Construct valid Mock Huma Pool State buffer (512 bytes)
    // numModes at offset 26 = 1
    // totalAssets at offset 30..46 = 100_000_000
    // numConfigKeys at offset 30 + 1 * 216 = 246 = 0
    // redemptionOffset at 246 + 4 = 250
    // nextRequestId at offset 250 = 42n
    // lastRequestId at offset 266 = 50n
    const buffer = new Uint8Array(512);
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );

    view.setUint32(26, 1, true); // numModes = 1
    view.setBigUint64(30, 100_000_000n, true); // totalAssets low
    view.setBigUint64(38, 0n, true); // totalAssets high

    const modeConfigKeysOffset = 30 + 1 * 216; // 246
    view.setUint32(modeConfigKeysOffset, 0, true); // numConfigKeys = 0

    const redemptionOffset = modeConfigKeysOffset + 4; // 250
    view.setBigUint64(redemptionOffset, 42n, true); // nextRequestId low
    view.setBigUint64(redemptionOffset + 8, 0n, true); // nextRequestId high
    view.setBigUint64(redemptionOffset + 16, 50n, true); // lastRequestId low
    view.setBigUint64(redemptionOffset + 24, 0n, true); // lastRequestId high

    const base64Str = Buffer.from(buffer).toString("base64");

    const mockRpc = {
      getAccountInfo: (_addr: any, _opts: any) => ({
        send: async () => ({
          value: {
            data: [base64Str, "base64"],
            executable: false,
            lamports: 1000000n,
            owner: address("11111111111111111111111111111111"),
            rentEpoch: 0n,
          },
        }),
      }),
    } as unknown as SolanaRpcClient;

    const monitor = new SettlementMonitorService();

    let settledPoolId: number | null = null;
    let settledNextRequestId: bigint | null = null;

    // Spy on settleEligibleRedemptions
    monitor.settleEligibleRedemptions = async (
      poolId: number,
      nextRequestId: bigint
    ) => {
      settledPoolId = poolId;
      settledNextRequestId = nextRequestId;
      return 3;
    };

    const result = await monitor.syncHumaPoolSettlements(
      mockRpc,
      TEST_POOL_STATE_ADDR,
      1
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updatedCount, 3);
    assert.strictEqual(result.nextRequestId, 42n);
    assert.strictEqual(settledPoolId, 1);
    assert.strictEqual(settledNextRequestId, 42n);
  });

  it("should handle RPC exceptions gracefully without crashing", async () => {
    const mockRpc = {
      getAccountInfo: () => ({
        send: async () => {
          throw new Error("RPC network timeout / rate limited");
        },
      }),
    } as unknown as SolanaRpcClient;

    const monitor = new SettlementMonitorService();
    const result = await monitor.syncHumaPoolSettlements(
      mockRpc,
      TEST_POOL_STATE_ADDR
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.updatedCount, 0);
    assert.strictEqual(result.error, "RPC network timeout / rate limited");
  });
});
