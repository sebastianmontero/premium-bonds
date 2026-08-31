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
    // Test dismissal predicate logic
    const checkShouldDismiss = (
      stage: TransactionStage,
      isSameTarget: boolean
    ): boolean => {
      const isBusy = isInFlightStage(stage);
      if (!isSameTarget || isBusy) return false;
      return true;
    };

    // Idle form: same target -> dismisses
    assert.strictEqual(checkShouldDismiss(null, true), true);
    // Idle form: child target clicked (bubbling) -> does not dismiss
    assert.strictEqual(checkShouldDismiss(null, false), false);

    // In-flight stages: NEVER dismiss even on direct backdrop click
    assert.strictEqual(checkShouldDismiss("preparing", true), false);
    assert.strictEqual(checkShouldDismiss("signing", true), false);
    assert.strictEqual(checkShouldDismiss("broadcasting", true), false);
    assert.strictEqual(checkShouldDismiss("confirming", true), false);

    // Terminal stages: direct click dismisses
    assert.strictEqual(checkShouldDismiss("success", true), true);
    assert.strictEqual(checkShouldDismiss("error", true), true);
  });
});
