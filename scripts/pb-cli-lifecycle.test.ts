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
  resolveHarvestRandomnessAccount,
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

  describe("resolveHarvestRandomnessAccount", () => {
    const defaultAddr = "3id2GxC6pd6ZAJcM2QsCu6efjNbZ8jXi66JdYZNi78KS";
    const explicitAddr = "C3RyBny4y9Hs2JCYuecZZ7KosULS5efv7os4JpKB23HP";
    const pool2EnvAddr = "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7";
    const pool1StateAddr = "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze";
    const globalStateAddr = "11111111111111111111111111111111";

    it("should prioritize explicit CLI argument over env and stateAddresses", () => {
      const resolved = resolveHarvestRandomnessAccount({
        explicitAccount: explicitAddr,
        poolId: 1,
        stateAddresses: { randomnessAccount: defaultAddr },
        env: { POOL_1_RANDOMNESS_ACCOUNT: pool1StateAddr },
      });
      assert.equal(resolved, explicitAddr);
    });

    it("should prioritize POOL_2_RANDOMNESS_ACCOUNT over generic addresses.json:randomnessAccount for Pool 2", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 2,
        stateAddresses: { randomnessAccount: defaultAddr },
        env: { POOL_2_RANDOMNESS_ACCOUNT: pool2EnvAddr },
      });
      assert.equal(resolved, pool2EnvAddr);
    });

    it("should prioritize pool_1_randomnessAccount over generic addresses.json:randomnessAccount", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 1,
        stateAddresses: {
          pool_1_randomnessAccount: pool1StateAddr,
          randomnessAccount: defaultAddr,
        },
        env: {},
      });
      assert.equal(resolved, pool1StateAddr);
    });

    it("should resolve addresses.json:randomnessAccount for pool 1 when no pool-specific override exists", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 1,
        stateAddresses: { randomnessAccount: defaultAddr },
        env: {},
      });
      assert.equal(resolved, defaultAddr);
    });

    it("should fall back to state NEXT_PUBLIC_RANDOMNESS_ACCOUNT when pool-specific candidates are missing", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 2,
        stateAddresses: { NEXT_PUBLIC_RANDOMNESS_ACCOUNT: globalStateAddr },
        env: {},
      });
      assert.equal(resolved, globalStateAddr);
    });

    it("should fall back to env NEXT_PUBLIC_RANDOMNESS_ACCOUNT", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 2,
        stateAddresses: {},
        env: { NEXT_PUBLIC_RANDOMNESS_ACCOUNT: globalStateAddr },
      });
      assert.equal(resolved, globalStateAddr);
    });

    it("should ignore empty and whitespace-only strings and fall through to next candidate", () => {
      const resolved = resolveHarvestRandomnessAccount({
        explicitAccount: "   ",
        poolId: 1,
        stateAddresses: { randomnessAccount: defaultAddr },
        env: { POOL_1_RANDOMNESS_ACCOUNT: "" },
      });
      assert.equal(resolved, defaultAddr);
    });

    it("should return undefined when no candidates are provided", () => {
      const resolved = resolveHarvestRandomnessAccount({
        poolId: 2,
        stateAddresses: {},
        env: {},
      });
      assert.equal(resolved, undefined);
    });

    it("should throw CliArgumentError on invalid base58 address string", () => {
      assert.throws(
        () =>
          resolveHarvestRandomnessAccount({
            explicitAccount: "invalid-base-58!",
            poolId: 1,
            stateAddresses: {},
            env: {},
          }),
        (err: unknown) =>
          err instanceof CliArgumentError &&
          err.message.includes(
            'Invalid randomness account public key address: "invalid-base-58!".'
          )
      );
    });
  });
});
