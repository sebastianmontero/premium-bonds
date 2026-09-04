import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  addOptimisticActivity,
  removeOptimisticActivity,
  reconcileOptimisticActivities,
  clearOptimisticActivitiesForUser,
  getOptimisticServerSnapshot,
  getOptimisticStoreSnapshot,
  subscribeToOptimisticStore,
  _resetOptimisticStoreForTesting,
} from "../optimistic-activity-store";
import type { ActivityEntry } from "../../types";

describe("Optimistic Activity Store Suite", () => {
  const user1 = "UserAddress111111111111111111111111111111";
  const user2 = "UserAddress222222222222222222222222222222";

  const sampleEntry1: ActivityEntry = {
    id: "act-1",
    date: new Date().toISOString(),
    type: "deposit",
    description: "Deposited 50 USDC",
    amount: 50_000_000,
    txSignature: "tx-sig-1",
  };

  const sampleEntry2: ActivityEntry = {
    id: "act-2",
    date: new Date().toISOString(),
    type: "withdraw",
    description: "Sold 2 bonds",
    amount: 20_000_000,
    txSignature: "tx-sig-2",
  };

  beforeEach(() => {
    _resetOptimisticStoreForTesting();
  });

  describe("Snapshot Referential Stability", () => {
    it("should return the exact same frozen reference across repeated getServerSnapshot calls", () => {
      const snap1 = getOptimisticServerSnapshot();
      const snap2 = getOptimisticServerSnapshot();
      assert.strictEqual(snap1, snap2);
      assert.strictEqual(snap1.length, 0);
      assert.ok(Object.isFrozen(snap1));
    });

    it("should return cached empty snapshot for undefined or empty user address in getOptimisticStoreSnapshot", () => {
      const serverSnap = getOptimisticServerSnapshot();
      const clientSnapUndefined = getOptimisticStoreSnapshot(undefined);
      const clientSnapUnknown = getOptimisticStoreSnapshot(user1);

      assert.strictEqual(clientSnapUndefined, serverSnap);
      assert.strictEqual(clientSnapUnknown, serverSnap);
    });

    it("should maintain referential equality across getOptimisticStoreSnapshot calls when store is not mutated", () => {
      addOptimisticActivity(user1, sampleEntry1);

      const snap1 = getOptimisticStoreSnapshot(user1);
      const snap2 = getOptimisticStoreSnapshot(user1);

      assert.strictEqual(snap1, snap2);
      assert.strictEqual(snap1.length, 1);
      assert.strictEqual(snap1[0].txSignature, "tx-sig-1");
    });
  });

  describe("Store Mutations & Subscriptions", () => {
    it("should notify subscribers when an optimistic activity is added", () => {
      let notifiedCount = 0;
      const unsubscribe = subscribeToOptimisticStore(() => {
        notifiedCount++;
      });

      addOptimisticActivity(user1, sampleEntry1);
      assert.strictEqual(notifiedCount, 1);

      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].id, "act-1");

      unsubscribe();
      addOptimisticActivity(user1, sampleEntry2);
      assert.strictEqual(
        notifiedCount,
        1,
        "Should not notify after unsubscribe"
      );
      assert.strictEqual(getOptimisticStoreSnapshot(user1).length, 2);
    });

    it("should ignore entries without a txSignature", () => {
      let notifiedCount = 0;
      subscribeToOptimisticStore(() => {
        notifiedCount++;
      });

      const invalidEntry: ActivityEntry = {
        id: "act-invalid",
        date: new Date().toISOString(),
        type: "deposit",
        description: "Invalid",
        amount: 10_000_000,
      };

      addOptimisticActivity(user1, invalidEntry);
      assert.strictEqual(notifiedCount, 0);
      assert.strictEqual(getOptimisticStoreSnapshot(user1).length, 0);
    });

    it("should deduplicate by txSignature when adding an existing transaction", () => {
      addOptimisticActivity(user1, sampleEntry1);
      const updatedEntry1: ActivityEntry = {
        ...sampleEntry1,
        description: "Deposited 50 USDC (Updated)",
      };
      addOptimisticActivity(user1, updatedEntry1);

      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].description, "Deposited 50 USDC (Updated)");
    });

    it("should remove optimistic activity and notify subscribers", () => {
      addOptimisticActivity(user1, sampleEntry1);
      addOptimisticActivity(user1, sampleEntry2);

      let notified = false;
      subscribeToOptimisticStore(() => {
        notified = true;
      });

      removeOptimisticActivity(user1, "tx-sig-1");
      assert.strictEqual(notified, true);

      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].txSignature, "tx-sig-2");
    });

    it("should be a no-op when removing non-existent txSignature", () => {
      addOptimisticActivity(user1, sampleEntry1);

      let notified = false;
      subscribeToOptimisticStore(() => {
        notified = true;
      });

      removeOptimisticActivity(user1, "non-existent-sig");
      assert.strictEqual(notified, false);
      assert.strictEqual(getOptimisticStoreSnapshot(user1).length, 1);
    });

    it("should clean up store key when all entries for a user are removed", () => {
      addOptimisticActivity(user1, sampleEntry1);
      removeOptimisticActivity(user1, "tx-sig-1");

      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries, getOptimisticServerSnapshot());
    });
  });

  describe("Batch Reconciliation", () => {
    it("should reconcile and remove multiple matching confirmed transactions in a single notification", () => {
      addOptimisticActivity(user1, sampleEntry1);
      addOptimisticActivity(user1, sampleEntry2);

      const sampleEntry3: ActivityEntry = {
        id: "act-3",
        date: new Date().toISOString(),
        type: "win",
        description: "Won prize",
        amount: 100_000_000,
        txSignature: "tx-sig-3",
      };
      addOptimisticActivity(user1, sampleEntry3);

      let notifyCount = 0;
      subscribeToOptimisticStore(() => {
        notifyCount++;
      });

      // Confirm tx-sig-1 and tx-sig-2 in batch
      reconcileOptimisticActivities(user1, ["tx-sig-1", "tx-sig-2"]);

      assert.strictEqual(
        notifyCount,
        1,
        "Should notify exactly once for batch eviction"
      );
      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].txSignature, "tx-sig-3");
    });

    it("should accept a Set of confirmed signatures", () => {
      addOptimisticActivity(user1, sampleEntry1);
      addOptimisticActivity(user1, sampleEntry2);

      const confirmedSet = new Set(["tx-sig-1"]);
      reconcileOptimisticActivities(user1, confirmedSet);

      const entries = getOptimisticStoreSnapshot(user1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].txSignature, "tx-sig-2");
    });

    it("should not notify or alter store when none of the confirmed signatures match", () => {
      addOptimisticActivity(user1, sampleEntry1);

      let notifyCount = 0;
      subscribeToOptimisticStore(() => {
        notifyCount++;
      });

      reconcileOptimisticActivities(user1, ["unrelated-sig-99"]);
      assert.strictEqual(notifyCount, 0);
      assert.strictEqual(getOptimisticStoreSnapshot(user1).length, 1);
    });

    it("should cleanly handle unknown or empty user in reconcileOptimisticActivities", () => {
      let notifyCount = 0;
      subscribeToOptimisticStore(() => {
        notifyCount++;
      });

      reconcileOptimisticActivities("non-existent-user", ["tx-sig-1"]);
      assert.strictEqual(notifyCount, 0);
    });
  });

  describe("User Cleanup & Test Reset", () => {
    it("should clear all entries for a specific user without affecting other users", () => {
      addOptimisticActivity(user1, sampleEntry1);
      addOptimisticActivity(user2, sampleEntry2);

      clearOptimisticActivitiesForUser(user1);

      assert.strictEqual(
        getOptimisticStoreSnapshot(user1),
        getOptimisticServerSnapshot()
      );
      assert.strictEqual(getOptimisticStoreSnapshot(user2).length, 1);
    });

    it("should reset all store state, timers, and listeners with _resetOptimisticStoreForTesting", () => {
      addOptimisticActivity(user1, sampleEntry1);
      addOptimisticActivity(user2, sampleEntry2);

      let notified = false;
      subscribeToOptimisticStore(() => {
        notified = true;
      });

      _resetOptimisticStoreForTesting();

      assert.strictEqual(
        getOptimisticStoreSnapshot(user1),
        getOptimisticServerSnapshot()
      );
      assert.strictEqual(
        getOptimisticStoreSnapshot(user2),
        getOptimisticServerSnapshot()
      );

      // Mutation after reset should not trigger previous listeners
      addOptimisticActivity(user1, sampleEntry1);
      assert.strictEqual(notified, false);
    });
  });
});
