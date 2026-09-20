import test from "node:test";
import assert from "node:assert/strict";
import { bondsKeys } from "../query-keys";
import { USDC_MINT } from "../bonds-sdk";

test("balance-query-keys: hierarchy and prefix matching validation", () => {
  const user = "test-user-address";
  const userBalancesKey = bondsKeys.userBalances(user);
  const userAssetKey = bondsKeys.userAssetBalances(user, USDC_MINT);
  const userLegacyKey = bondsKeys.userTokenBalance(user, USDC_MINT);

  // Exact match between userTokenBalance legacy alias and userAssetBalances
  assert.deepEqual(userLegacyKey, userAssetKey);

  // Prefix matching: userAssetBalances starts with userBalances
  assert.deepEqual(
    userAssetKey.slice(0, userBalancesKey.length),
    userBalancesKey
  );

  // Verify structure
  assert.deepEqual(bondsKeys.balances(), ["yield-bonds", "balances"]);
  assert.deepEqual(bondsKeys.userBalances(), [
    "yield-bonds",
    "balances",
    "user",
  ]);
  assert.deepEqual(userBalancesKey, [
    "yield-bonds",
    "balances",
    "user",
    "test-user-address",
  ]);
  assert.deepEqual(userAssetKey, [
    "yield-bonds",
    "balances",
    "user",
    "test-user-address",
    "asset",
    String(USDC_MINT),
  ]);

  // Prefix invalidation simulation: prefix match check
  function isPrefixMatch(
    prefix: readonly unknown[],
    target: readonly unknown[]
  ) {
    if (prefix.length > target.length) return false;
    return prefix.every((item, i) => item === target[i]);
  }

  assert.ok(isPrefixMatch(bondsKeys.userBalances(user), userAssetKey));
  assert.ok(isPrefixMatch(bondsKeys.balances(), userAssetKey));
  assert.ok(!isPrefixMatch(bondsKeys.userBalances("other-user"), userAssetKey));
});
