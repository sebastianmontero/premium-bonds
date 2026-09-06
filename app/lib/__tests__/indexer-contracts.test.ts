import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeKeysetCursor,
  decodeKeysetCursor,
  PrizeLedgerFilterSchema,
  ActivityLedgerFilterSchema,
  DrawExplorerFilterSchema,
  type ApiSuccessResponse,
  type ApiErrorResponse,
} from "../../types/indexer-contracts";

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
        assert.strictEqual(parsed.tier, "all");
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

      it("should accept valid status, tier, and page filters", () => {
        const parsed = PrizeLedgerFilterSchema.parse({
          user: "5xYz1234MockAddress5678901234567890",
          status: "processing",
          tier: "grand",
          page: "3",
          search: " winning ",
        });
        assert.strictEqual(parsed.status, "processing");
        assert.strictEqual(parsed.tier, "grand");
        assert.strictEqual(parsed.page, 3);
        assert.strictEqual(parsed.search, "winning");
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
  });

  describe("API Response Envelopes", () => {
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
  });
});
