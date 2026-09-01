import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isInFlightStage,
  isTerminalStage,
  type TransactionStage,
} from "../../components/dashboard/TransactionProgressModal";

describe("Transaction Modal Dismissal & Stage Invariant Suite", () => {
  it("should classify in-flight transaction stages accurately", () => {
    const inFlightStages: TransactionStage[] = [
      "preparing",
      "signing",
      "broadcasting",
      "confirming",
    ];

    for (const stage of inFlightStages) {
      assert.strictEqual(
        isInFlightStage(stage),
        true,
        `Expected stage "${stage}" to be identified as in-flight`
      );
      assert.strictEqual(
        isTerminalStage(stage),
        false,
        `Expected stage "${stage}" not to be terminal`
      );
    }
  });

  it("should classify terminal stages accurately", () => {
    const terminalStages: TransactionStage[] = ["success", "error"];

    for (const stage of terminalStages) {
      assert.strictEqual(
        isTerminalStage(stage),
        true,
        `Expected stage "${stage}" to be identified as terminal`
      );
      assert.strictEqual(
        isInFlightStage(stage),
        false,
        `Expected stage "${stage}" not to be in-flight`
      );
    }
  });

  it("should classify idle stage (null) as neither in-flight nor terminal", () => {
    assert.strictEqual(isInFlightStage(null), false);
    assert.strictEqual(isTerminalStage(null), false);
  });

  it("should enforce backdrop click blocking logic on in-flight operations", () => {
    // Backdrop click dismisses only when isTerminalStage(stage) is true
    const inFlightStages: TransactionStage[] = [
      "preparing",
      "signing",
      "broadcasting",
      "confirming",
    ];

    for (const stage of inFlightStages) {
      assert.strictEqual(
        isTerminalStage(stage),
        false,
        `In-flight stage "${stage}" must block backdrop dismissal`
      );
      assert.strictEqual(
        isInFlightStage(stage),
        true,
        `In-flight stage "${stage}" must be identified as in-flight`
      );
    }

    // Terminal stages allow backdrop click dismissal
    const terminalStages: TransactionStage[] = ["success", "error"];
    for (const stage of terminalStages) {
      assert.strictEqual(
        isTerminalStage(stage),
        true,
        `Terminal stage "${stage}" must allow backdrop dismissal`
      );
    }
  });
});
