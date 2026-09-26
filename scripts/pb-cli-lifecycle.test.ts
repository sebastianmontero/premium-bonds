import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CliArgumentError,
  CliPreconditionError,
  CliUserError,
  formatPoolFlag,
  resolveTargetCycleId,
  validateVoidDrawEligibility,
  validateForceUnlockEligibility,
} from "./pb-cli";
import { PayoutRegistryStatus } from "../app/lib/bonds-sdk";

describe("pb-cli lifecycle & validation", () => {
  describe("formatPoolFlag", () => {
    it("should return empty string for pool 1 or undefined", () => {
      assert.equal(formatPoolFlag(1), "");
      assert.equal(formatPoolFlag(undefined), "");
    });

    it("should return formatted flag for non-default pool IDs", () => {
      assert.equal(formatPoolFlag(2), " --pool 2");
      assert.equal(formatPoolFlag(42), " --pool 42");
    });
  });

  describe("resolveTargetCycleId", () => {
    it("should return currentDrawCycleId - 1 when currentDrawCycleId > 1 and no explicit cycleId provided", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 6 };
      assert.equal(resolveTargetCycleId(poolState), 5);
    });

    it("should return 1 when currentDrawCycleId is 1 and no explicit cycleId provided", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 1 };
      assert.equal(resolveTargetCycleId(poolState), 1);
    });

    it("should return explicit numeric cycleId if specified", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 6 };
      assert.equal(resolveTargetCycleId(poolState, 3), 3);
      assert.equal(resolveTargetCycleId(poolState, 0), 0);
    });

    it("should parse explicit string cycleId if specified", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 6 };
      assert.equal(resolveTargetCycleId(poolState, "4"), 4);
    });

    it("should reject negative cycleId with CliArgumentError", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 6 };
      assert.throws(
        () => resolveTargetCycleId(poolState, -1),
        (err: unknown) =>
          err instanceof CliArgumentError &&
          err instanceof CliUserError &&
          err.message.includes('Invalid cycle ID: "-1"')
      );
    });

    it("should reject non-numeric string cycleId with CliArgumentError", () => {
      const poolState = { poolId: 1, currentDrawCycleId: 6 };
      assert.throws(
        () => resolveTargetCycleId(poolState, "invalid"),
        (err: unknown) =>
          err instanceof CliArgumentError &&
          err.message.includes('Invalid cycle ID: "invalid"')
      );
    });

    it("should throw CliPreconditionError when currentDrawCycleId === 0 and no explicit cycleId provided", () => {
      const poolState = { poolId: 2, currentDrawCycleId: 0 };
      assert.throws(
        () => resolveTargetCycleId(poolState),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "NO_DRAW_CYCLES" &&
          err.message.includes("No draw cycles exist for Pool 2.")
      );
    });
  });

  describe("validateVoidDrawEligibility", () => {
    const validBaseContext = {
      poolState: { isFrozenForDraw: false, status: "Active" },
      drawCycleState: { status: "Complete", cycleId: 5, poolId: 1 },
      payoutState: {
        status: PayoutRegistryStatus.Active,
        payoutsCompleted: 0,
      },
      poolId: 1,
    };

    it("should succeed for a valid completed draw with 0 payouts", () => {
      assert.doesNotThrow(() => {
        validateVoidDrawEligibility(validBaseContext);
      });
    });

    it("should reject AwaitingRandomness draws with DRAW_NOT_COMPLETE and suggest force-unlock-draw", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            drawCycleState: {
              status: "AwaitingRandomness",
              cycleId: 5,
              poolId: 1,
            },
            payoutState: null,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CliPreconditionError);
          assert.equal(err.code, "DRAW_NOT_COMPLETE");
          assert.match(err.message, /currently in status 'AwaitingRandomness'/);
          assert.match(err.message, /pb-cli force-unlock-draw 5 --confirm/);
          assert.equal(
            err.suggestedCommand,
            "npm run -- pb-cli force-unlock-draw 5 --confirm"
          );
          return true;
        }
      );
    });

    it("should include --pool flag in suggested force-unlock-draw command when poolId !== 1", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            poolId: 3,
            drawCycleState: {
              status: "AwaitingRandomness",
              cycleId: 7,
              poolId: 3,
            },
            payoutState: null,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CliPreconditionError);
          assert.equal(err.code, "DRAW_NOT_COMPLETE");
          assert.match(
            err.message,
            /pb-cli force-unlock-draw 7 --pool 3 --confirm/
          );
          assert.equal(
            err.suggestedCommand,
            "npm run -- pb-cli force-unlock-draw 7 --pool 3 --confirm"
          );
          return true;
        }
      );
    });

    it("should reject already voided draws with DRAW_ALREADY_VOIDED", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            drawCycleState: { status: "Voided", cycleId: 5, poolId: 1 },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_ALREADY_VOIDED" &&
          err.message.includes("Draw cycle 5 has already been voided.")
      );
    });

    it("should reject already force-unlocked draws with DRAW_ALREADY_FORCE_UNLOCKED", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            drawCycleState: { status: "ForceUnlocked", cycleId: 5, poolId: 1 },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_ALREADY_FORCE_UNLOCKED" &&
          err.message.includes(
            "Draw cycle 5 has already been force-unlocked and cannot be voided."
          )
      );
    });

    it("should reject draws in any other non-Complete status with DRAW_NOT_COMPLETE", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            drawCycleState: {
              status: "PreparingTickets",
              cycleId: 5,
              poolId: 1,
            },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_NOT_COMPLETE" &&
          err.message.includes(
            "Draw cycle 5 is in status 'PreparingTickets'. Only 'Complete' draws can be voided."
          )
      );
    });

    it("should reject if pool is closed with POOL_CLOSED", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            poolState: { isFrozenForDraw: false, status: "Closed" },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "POOL_CLOSED" &&
          err.message.includes("Prize pool 1 is closed and cannot be modified.")
      );
    });

    it("should reject if pool is currently frozen with POOL_FROZEN", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            poolState: { isFrozenForDraw: true, status: "Active" },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "POOL_FROZEN" &&
          err.message.includes(
            "Prize pool 1 is currently frozen for a draw. Cannot void payout registry while frozen."
          )
      );
    });

    it("should reject if payout registry does not exist with PAYOUT_REGISTRY_NOT_FOUND", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            payoutState: null,
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "PAYOUT_REGISTRY_NOT_FOUND" &&
          err.message.includes(
            "PayoutRegistry account for completed cycle 5 was not found on-chain."
          )
      );
    });

    it("should reject if payout registry is already voided with PAYOUT_REGISTRY_ALREADY_VOIDED", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            payoutState: {
              status: PayoutRegistryStatus.Voided,
              payoutsCompleted: 0,
            },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "PAYOUT_REGISTRY_ALREADY_VOIDED" &&
          err.message.includes(
            "PayoutRegistry for cycle 5 is already marked as Voided."
          )
      );
    });

    it("should reject if any payouts have already been completed with PAYOUTS_ALREADY_STARTED", () => {
      assert.throws(
        () =>
          validateVoidDrawEligibility({
            ...validBaseContext,
            payoutState: {
              status: PayoutRegistryStatus.Active,
              payoutsCompleted: 2,
            },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "PAYOUTS_ALREADY_STARTED" &&
          err.message.includes(
            "Cannot void draw cycle 5: 2 payout(s) have already been claimed/processed."
          )
      );
    });
  });

  describe("validateForceUnlockEligibility", () => {
    const validBaseContext = {
      poolState: { isFrozenForDraw: true, status: "Active" },
      drawCycleState: { status: "AwaitingRandomness", cycleId: 5, poolId: 1 },
      poolId: 1,
    };

    it("should succeed for a draw in AwaitingRandomness", () => {
      assert.doesNotThrow(() => {
        validateForceUnlockEligibility(validBaseContext);
      });
    });

    it("should reject Complete draws with DRAW_NOT_AWAITING_RANDOMNESS and suggest void-draw", () => {
      assert.throws(
        () =>
          validateForceUnlockEligibility({
            ...validBaseContext,
            drawCycleState: { status: "Complete", cycleId: 5, poolId: 1 },
          }),
        (err: unknown) => {
          assert.ok(err instanceof CliPreconditionError);
          assert.equal(err.code, "DRAW_NOT_AWAITING_RANDOMNESS");
          assert.match(err.message, /Draw cycle 5 is in status 'Complete'/);
          assert.match(err.message, /pb-cli void-draw 5 --confirm/);
          assert.equal(
            err.suggestedCommand,
            "npm run -- pb-cli void-draw 5 --confirm"
          );
          return true;
        }
      );
    });

    it("should include --pool flag in suggested void-draw command when poolId !== 1", () => {
      assert.throws(
        () =>
          validateForceUnlockEligibility({
            ...validBaseContext,
            poolId: 2,
            drawCycleState: { status: "Complete", cycleId: 8, poolId: 2 },
          }),
        (err: unknown) => {
          assert.ok(err instanceof CliPreconditionError);
          assert.equal(err.code, "DRAW_NOT_AWAITING_RANDOMNESS");
          assert.match(err.message, /pb-cli void-draw 8 --pool 2 --confirm/);
          assert.equal(
            err.suggestedCommand,
            "npm run -- pb-cli void-draw 8 --pool 2 --confirm"
          );
          return true;
        }
      );
    });

    it("should reject already force-unlocked draws with DRAW_ALREADY_FORCE_UNLOCKED", () => {
      assert.throws(
        () =>
          validateForceUnlockEligibility({
            ...validBaseContext,
            drawCycleState: { status: "ForceUnlocked", cycleId: 5, poolId: 1 },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_ALREADY_FORCE_UNLOCKED" &&
          err.message.includes("Draw cycle 5 has already been force-unlocked.")
      );
    });

    it("should reject already voided draws with DRAW_ALREADY_VOIDED", () => {
      assert.throws(
        () =>
          validateForceUnlockEligibility({
            ...validBaseContext,
            drawCycleState: { status: "Voided", cycleId: 5, poolId: 1 },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_ALREADY_VOIDED" &&
          err.message.includes("Draw cycle 5 has already been voided.")
      );
    });

    it("should reject any other status with DRAW_NOT_AWAITING_RANDOMNESS", () => {
      assert.throws(
        () =>
          validateForceUnlockEligibility({
            ...validBaseContext,
            drawCycleState: {
              status: "PreparingTickets",
              cycleId: 5,
              poolId: 1,
            },
          }),
        (err: unknown) =>
          err instanceof CliPreconditionError &&
          err.code === "DRAW_NOT_AWAITING_RANDOMNESS" &&
          err.message.includes(
            "Draw cycle 5 is in status 'PreparingTickets'. Only draws in 'AwaitingRandomness' can be force unlocked."
          )
      );
    });
  });
});
