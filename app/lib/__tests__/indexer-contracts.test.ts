import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeKeysetCursor,
  decodeKeysetCursor,
  PrizeLedgerFilterSchema,
  ActivityLedgerFilterSchema,
  DrawExplorerFilterSchema,
  RedemptionLedgerFilterSchema,
  type ApiSuccessResponse,
  type ApiErrorResponse,
} from "../../types/indexer-contracts";
import {
  respondSuccess,
  respondFallback,
  respondValidationError,
} from "../indexer-response";

describe("Indexer Contracts & Keyset Cursor Suite", () => {
  describe("encodeKeysetCursor and decodeKeysetCursor", () => {
    it("should round-trip encode and decode valid block_time and id tuple", () => {
      const blockTime = 1757184000;
      const id = 12345;
      const cursor = encodeKeysetCursor(blockTime, id);

      assert.ok(typeof cursor === "string");
      assert.ok(cursor.length > 0);

      const decoded = decodeKeysetCursor(cursor);
      assert.notEqual(decoded, null);
      assert.strictEqual(decoded?.blockTime, blockTime);
      assert.strictEqual(decoded?.id, id);
    });

    it("should decode legacy blockTime_id string format", () => {
      const legacyCursor = "1757184000_12345";
      const decoded = decodeKeysetCursor(legacyCursor);
      assert.notEqual(decoded, null);
      assert.strictEqual(decoded?.blockTime, 1757184000);
      assert.strictEqual(decoded?.id, 12345);
    });

    it("should return null on corrupted or invalid base64 cursor strings", () => {
      assert.strictEqual(decodeKeysetCursor(""), null);
      assert.strictEqual(decodeKeysetCursor("not-valid-base64!@#$%^"), null);
      assert.strictEqual(
        decodeKeysetCursor(Buffer.from("invalid-json").toString("base64url")),
        null
      );
      assert.strictEqual(
        decodeKeysetCursor(
          Buffer.from(JSON.stringify({ b: "not-a-num", i: 123 })).toString(
            "base64url"
          )
        ),
        null
      );
    });

    it("should return null when cursor object is missing id or blockTime", () => {
      const missingId = Buffer.from(JSON.stringify({ b: 12345 })).toString(
        "base64url"
      );
      assert.strictEqual(decodeKeysetCursor(missingId), null);

      const missingTime = Buffer.from(JSON.stringify({ i: 123 })).toString(
        "base64url"
      );
      assert.strictEqual(decodeKeysetCursor(missingTime), null);
    });
  });

  describe("Zod Filter Validation Schemas", () => {
    describe("PrizeLedgerFilterSchema", () => {
      it("should parse valid prize ledger query params with defaults", () => {
        const parsed = PrizeLedgerFilterSchema.parse({
          user: "5xYz1234MockAddress5678901234567890",
        });

        assert.strictEqual(parsed.user, "5xYz1234MockAddress5678901234567890");
        assert.strictEqual(parsed.poolId, 1);
        assert.strictEqual(parsed.page, 1);
        assert.strictEqual(parsed.pageSize, 10);
        assert.strictEqual(parsed.status, "all");
        assert.strictEqual(parsed.tierIndex, undefined);
        assert.strictEqual(parsed.search, undefined);
      });

      it("should reject pageSize exceeding 100", () => {
        assert.throws(() => {
          PrizeLedgerFilterSchema.parse({
            user: "5xYz1234MockAddress5678901234567890",
            pageSize: "500",
          });
        });
      });

      it("should accept valid status, tierIndex, and page filters", () => {
        const parsed = PrizeLedgerFilterSchema.parse({
          user: "5xYz1234MockAddress5678901234567890",
          status: "processing",
          tierIndex: "0",
          page: "3",
          search: " winning ",
        });
        assert.strictEqual(parsed.status, "processing");
        assert.strictEqual(parsed.tierIndex, 0);
        assert.strictEqual(parsed.page, 3);
        assert.strictEqual(parsed.search, "winning");
      });

      it("should handle tierIndex boundary values and aliases", () => {
        const minTier = PrizeLedgerFilterSchema.parse({ tierIndex: 0 });
        assert.strictEqual(minTier.tierIndex, 0);

        const maxTier = PrizeLedgerFilterSchema.parse({ tierIndex: "9" });
        assert.strictEqual(maxTier.tierIndex, 9);

        const allTier = PrizeLedgerFilterSchema.parse({ tierIndex: "all" });
        assert.strictEqual(allTier.tierIndex, undefined);

        const emptyTier = PrizeLedgerFilterSchema.parse({ tierIndex: "" });
        assert.strictEqual(emptyTier.tierIndex, undefined);

        assert.throws(() => {
          PrizeLedgerFilterSchema.parse({ tierIndex: 10 });
        });
        assert.throws(() => {
          PrizeLedgerFilterSchema.parse({ tierIndex: -1 });
        });
      });
    });

    describe("ActivityLedgerFilterSchema", () => {
      it("should parse valid activity query params with defaults", () => {
        const parsed = ActivityLedgerFilterSchema.parse({
          user: "5xYz1234MockAddress5678901234567890",
        });

        assert.strictEqual(parsed.user, "5xYz1234MockAddress5678901234567890");
        assert.strictEqual(parsed.poolId, 1);
        assert.strictEqual(parsed.limit, 20);
        assert.strictEqual(parsed.type, "all");
        assert.strictEqual(parsed.search, undefined);
        assert.strictEqual(parsed.cursor, undefined);
      });

      it("should reject limit exceeding 100", () => {
        assert.throws(() => {
          ActivityLedgerFilterSchema.parse({
            user: "5xYz1234MockAddress5678901234567890",
            limit: "250",
          });
        });
      });
    });

    describe("DrawExplorerFilterSchema", () => {
      it("should parse valid draw explorer query params with defaults", () => {
        const parsed = DrawExplorerFilterSchema.parse({});
        assert.strictEqual(parsed.poolId, 1);
        assert.strictEqual(parsed.page, 1);
        assert.strictEqual(parsed.pageSize, 10);
        assert.strictEqual(parsed.status, "all");
        assert.strictEqual(parsed.search, undefined);
      });

      it("should normalize and parse search and status", () => {
        const parsed = DrawExplorerFilterSchema.parse({
          status: "Complete",
          search: " 42 ",
          page: "2",
          pageSize: "25",
        });
        assert.strictEqual(parsed.status, "Complete");
        assert.strictEqual(parsed.search, "42");
        assert.strictEqual(parsed.page, 2);
        assert.strictEqual(parsed.pageSize, 25);
      });
    });

    describe("RedemptionLedgerFilterSchema", () => {
      it("should parse valid redemption filters with defaults", () => {
        const parsed = RedemptionLedgerFilterSchema.parse({
          user: "5xYz1234MockAddress5678901234567890",
        });
        assert.strictEqual(parsed.user, "5xYz1234MockAddress5678901234567890");
        assert.strictEqual(parsed.poolId, 1);
        assert.strictEqual(parsed.status, "pending");
        assert.strictEqual(parsed.limit, 50);
      });

      it("should accept valid status enum variants", () => {
        for (const status of [
          "pending",
          "settling",
          "ready",
          "claimed",
          "all",
        ] as const) {
          const parsed = RedemptionLedgerFilterSchema.parse({
            user: "5xYz1234MockAddress5678901234567890",
            status,
          });
          assert.strictEqual(parsed.status, status);
        }
      });

      it("should reject invalid user address length", () => {
        assert.throws(() =>
          RedemptionLedgerFilterSchema.parse({ user: "too-short" })
        );
      });

      it("should reject limit exceeding 100", () => {
        assert.throws(() =>
          RedemptionLedgerFilterSchema.parse({
            user: "5xYz1234MockAddress5678901234567890",
            limit: 200,
          })
        );
      });
    });
  });

  describe("API Response Envelopes & Response Builders", () => {
    it("should conform to ApiSuccessResponse discriminated envelope", () => {
      const response: ApiSuccessResponse<
        Array<{ id: number; name: string }>,
        { page: number; pageSize: number; totalCount: number },
        { totalFilteredValue: string }
      > = {
        success: true,
        data: [{ id: 1, name: "item" }],
        meta: { page: 1, pageSize: 10, totalCount: 1 },
        aggregates: { totalFilteredValue: "5000000" },
        fallbackRequired: false,
      };

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.fallbackRequired, false);
      assert.strictEqual(response.data.length, 1);
      assert.strictEqual(response.meta?.totalCount, 1);
      assert.strictEqual(response.aggregates?.totalFilteredValue, "5000000");
    });

    it("should conform to ApiErrorResponse discriminated envelope", () => {
      const errorResponse: ApiErrorResponse = {
        success: false,
        error: "Cursor signature expired",
        fallbackRequired: true,
      };

      assert.strictEqual(errorResponse.success, false);
      assert.strictEqual(errorResponse.fallbackRequired, true);
      assert.strictEqual(errorResponse.error, "Cursor signature expired");
    });

    it("respondSuccess should produce a 200 JSON response with correct envelope", async () => {
      const res = respondSuccess({ count: 42 }, { meta: { page: 1 } });
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.fallbackRequired, false);
      assert.deepStrictEqual(body.data, { count: 42 });
      assert.deepStrictEqual(body.meta, { page: 1 });
    });

    it("respondFallback should produce a fallback payload with error message", async () => {
      const res = respondFallback(new Error("DB Down"), 200);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.fallbackRequired, true);
      assert.strictEqual(body.error, "DB Down");
    });

    it("respondValidationError should produce a 400 error response from string or ZodError", async () => {
      const resStr = respondValidationError("Invalid param");
      assert.strictEqual(resStr.status, 400);
      const bodyStr = (await resStr.json()) as Record<string, unknown>;
      assert.strictEqual(bodyStr.success, false);
      assert.strictEqual(bodyStr.fallbackRequired, true);
      assert.strictEqual(bodyStr.error, "Invalid param");

      const zodResult = RedemptionLedgerFilterSchema.safeParse({
        user: "short",
      });
      assert.strictEqual(zodResult.success, false);
      if (!zodResult.success) {
        const resZod = respondValidationError(zodResult.error);
        assert.strictEqual(resZod.status, 400);
        const bodyZod = (await resZod.json()) as Record<string, unknown>;
        assert.strictEqual(bodyZod.success, false);
        assert.strictEqual(bodyZod.fallbackRequired, true);
        assert.ok(
          typeof bodyZod.error === "string" && bodyZod.error.length > 0
        );
      }
    });
  });
});
