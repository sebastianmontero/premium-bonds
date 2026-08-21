import {
  PB_BALANCE_UPDATE_EVENT,
  notifyBalanceUpdate,
} from "../app/hooks/useUserTokenBalance";
import { fetchUserAtaBalance, USDC_MINT } from "../app/lib/bonds-sdk";
import { formatTokenAmount } from "../app/lib/formatters";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log("=========================================");
  console.log("   TEST: User Token Balance Synchronization");
  console.log("=========================================\n");

  // 1. Event Constant & SSR Safety
  console.log("1. Testing Event Constant and SSR Safety...");
  {
    assert(
      PB_BALANCE_UPDATE_EVENT === "pb:balance-update",
      "PB_BALANCE_UPDATE_EVENT must equal 'pb:balance-update'"
    );

    // In Node.js environment where global.window is initially undefined
    const originalWindow = (global as unknown as { window?: unknown }).window;
    try {
      delete (global as unknown as { window?: unknown }).window;
      // Should safely no-op and not throw
      notifyBalanceUpdate();
      console.log("  ✓ SSR safe execution without window verified.");
    } finally {
      if (originalWindow !== undefined) {
        (global as unknown as { window?: unknown }).window = originalWindow;
      }
    }
  }

  // 2. CustomEvent Dispatching in Browser/DOM Environment
  console.log("2. Testing CustomEvent dispatching and listener capture...");
  {
    let eventFiredCount = 0;
    let receivedEventType = "";

    const mockWindow = {
      listeners: new Map<string, Array<(event: unknown) => void>>(),
      addEventListener(type: string, handler: (event: unknown) => void) {
        const list = this.listeners.get(type) || [];
        list.push(handler);
        this.listeners.set(type, list);
      },
      removeEventListener(type: string, handler: (event: unknown) => void) {
        const list = this.listeners.get(type) || [];
        this.listeners.set(
          type,
          list.filter((h) => h !== handler)
        );
      },
      dispatchEvent(event: { type: string }) {
        const list = this.listeners.get(event.type) || [];
        for (const handler of list) {
          handler(event);
        }
        return true;
      },
    };

    class MockCustomEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    }

    (global as unknown as { window: typeof mockWindow }).window = mockWindow;
    (global as unknown as { CustomEvent: typeof MockCustomEvent }).CustomEvent =
      MockCustomEvent;

    const testHandler = (e: unknown) => {
      eventFiredCount++;
      receivedEventType = (e as MockCustomEvent).type;
    };

    mockWindow.addEventListener(PB_BALANCE_UPDATE_EVENT, testHandler);

    // Dispatch event
    notifyBalanceUpdate();
    assert(eventFiredCount === 1, "Listener should receive exactly 1 event");
    assert(
      receivedEventType === "pb:balance-update",
      "Received event type must be 'pb:balance-update'"
    );

    // Dispatch second event
    notifyBalanceUpdate();
    assert(eventFiredCount === 2, "Listener should receive 2 events");

    // Remove listener
    mockWindow.removeEventListener(PB_BALANCE_UPDATE_EVENT, testHandler);
    notifyBalanceUpdate();
    assert(
      eventFiredCount === 2,
      "Removed listener should no longer receive events"
    );

    console.log("  ✓ CustomEvent dispatch and capture verified.");
  }

  // 3. Testing fetchUserAtaBalance Decoder
  console.log("3. Testing fetchUserAtaBalance decoder helper...");
  {
    // Helper to build mock raw SPL token account data (165 bytes standard)
    const buildMockTokenAccount = (amount: bigint): Uint8Array => {
      const data = new Uint8Array(165);
      const view = new DataView(data.buffer);
      // bytes 0-31: Mint address (dummy)
      data.fill(1, 0, 32);
      // bytes 32-63: Owner address (dummy)
      data.fill(2, 32, 64);
      // bytes 64-71: Amount (u64 little endian)
      view.setBigUint64(64, amount, true);
      // byte 72: State (Initialized = 1)
      data[72] = 1;
      return data;
    };

    // 3a. Valid balance of 500,000,000 micro-USDC ($500.00 USDC)
    const rawBytes = buildMockTokenAccount(500_000_000n);
    const base64Str = Buffer.from(rawBytes).toString("base64");

    const mockRpcSuccess = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            data: [base64Str, "base64"],
          },
        }),
      }),
    };

    const dummyUser = "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m";

    const balance = await fetchUserAtaBalance(
      mockRpcSuccess,
      dummyUser,
      USDC_MINT
    );
    assert(
      balance === 500_000_000,
      `Expected 500_000_000, received ${balance}`
    );

    const formatted = formatTokenAmount(balance, 6, 2, 2);
    assert(
      formatted === "500.00",
      `Expected formatted balance '500.00', got '${formatted}'`
    );

    // 3b. Zero balance account
    const zeroBytes = buildMockTokenAccount(0n);
    const mockRpcZero = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            data: [Buffer.from(zeroBytes).toString("base64"), "base64"],
          },
        }),
      }),
    };
    const zeroBalance = await fetchUserAtaBalance(
      mockRpcZero,
      dummyUser,
      USDC_MINT
    );
    assert(zeroBalance === 0, `Expected 0 balance, got ${zeroBalance}`);

    // 3c. Non-existent ATA account (null value from RPC)
    const mockRpcNull = {
      getAccountInfo: () => ({
        send: async () => ({
          value: null,
        }),
      }),
    };
    const nullBalance = await fetchUserAtaBalance(
      mockRpcNull,
      dummyUser,
      USDC_MINT
    );
    assert(
      nullBalance === 0,
      `Expected 0 for null account, got ${nullBalance}`
    );

    // 3d. RPC network/connection error
    const mockRpcError = {
      getAccountInfo: () => ({
        send: async () => {
          throw new Error("RPC network timeout");
        },
      }),
    };
    const errorBalance = await fetchUserAtaBalance(
      mockRpcError,
      dummyUser,
      USDC_MINT
    );
    assert(errorBalance === 0, `Expected 0 on RPC error, got ${errorBalance}`);

    console.log("  ✓ fetchUserAtaBalance parsing & error handling verified.");
  }

  console.log("\n✅ ALL TOKEN BALANCE SYNC TESTS PASSED SUCCESSFULLY!\n");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
