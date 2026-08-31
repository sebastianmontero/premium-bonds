import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOC_CATEGORIES,
  DOC_ARTICLES,
  ERROR_LOOKUP_ITEMS,
  normalizeSearchText,
  getDocArticle,
  getDocCategory,
  getDocArticlesByCategory,
  getAdjacentDocArticles,
  searchDocArticles,
  searchErrorLookupItems,
} from "../docs/data";

describe("Documentation & Help Center Architecture Suite", () => {
  describe("Categories and Articles Referential Integrity", () => {
    it("should have exactly 4 main documentation categories", () => {
      assert.strictEqual(DOC_CATEGORIES.length, 4);
      const categorySlugs = DOC_CATEGORIES.map((c) => c.slug);
      assert.deepStrictEqual(categorySlugs, [
        "1-getting-started",
        "2-protocol-mechanics",
        "3-in-app-help",
        "4-troubleshooting",
      ]);
    });

    it("should have all categories populated with valid English and Spanish metadata", () => {
      for (const cat of DOC_CATEGORIES) {
        assert.ok(cat.slug, "Category slug must be non-empty");
        assert.ok(cat.icon, `Category ${cat.slug} must have an icon`);
        assert.ok(cat.title.en, `Category ${cat.slug} must have English title`);
        assert.ok(cat.title.es, `Category ${cat.slug} must have Spanish title`);
        assert.ok(
          cat.description.en,
          `Category ${cat.slug} must have English description`
        );
        assert.ok(
          cat.description.es,
          `Category ${cat.slug} must have Spanish description`
        );
      }
    });

    it("should contain exactly 16 articles across the 4 categories", () => {
      assert.strictEqual(
        DOC_ARTICLES.length,
        16,
        "Total article count must be 16"
      );

      const gettingStarted = DOC_ARTICLES.filter(
        (a) => a.categorySlug === "1-getting-started"
      );
      const protocolMechanics = DOC_ARTICLES.filter(
        (a) => a.categorySlug === "2-protocol-mechanics"
      );
      const inAppHelp = DOC_ARTICLES.filter(
        (a) => a.categorySlug === "3-in-app-help"
      );
      const troubleshooting = DOC_ARTICLES.filter(
        (a) => a.categorySlug === "4-troubleshooting"
      );

      assert.strictEqual(
        gettingStarted.length,
        4,
        "1-getting-started must have 4 articles"
      );
      assert.strictEqual(
        protocolMechanics.length,
        5,
        "2-protocol-mechanics must have 5 articles"
      );
      assert.strictEqual(
        inAppHelp.length,
        3,
        "3-in-app-help must have 3 articles"
      );
      assert.strictEqual(
        troubleshooting.length,
        4,
        "4-troubleshooting must have 4 articles"
      );
    });

    it("should ensure every article references a valid category and has non-empty bilingual fields", () => {
      const validCategorySlugs = new Set(DOC_CATEGORIES.map((c) => c.slug));

      for (const article of DOC_ARTICLES) {
        assert.ok(
          validCategorySlugs.has(article.categorySlug),
          `Article ${article.slug} has invalid categorySlug: ${article.categorySlug}`
        );
        assert.ok(
          article.title.en && article.title.en.trim().length > 0,
          `Article ${article.slug} missing English title`
        );
        assert.ok(
          article.title.es && article.title.es.trim().length > 0,
          `Article ${article.slug} missing Spanish title`
        );
        assert.ok(
          article.summary.en && article.summary.en.trim().length > 0,
          `Article ${article.slug} missing English summary`
        );
        assert.ok(
          article.summary.es && article.summary.es.trim().length > 0,
          `Article ${article.slug} missing Spanish summary`
        );
        assert.ok(
          article.content.en && article.content.en.trim().length > 0,
          `Article ${article.slug} missing English content`
        );
        assert.ok(
          article.content.es && article.content.es.trim().length > 0,
          `Article ${article.slug} missing Spanish content`
        );
        assert.ok(
          article.tags.length > 0,
          `Article ${article.slug} must have at least one tag`
        );
      }
    });
  });

  describe("Query & Domain Helper Functions", () => {
    it("should retrieve single article via getDocArticle", () => {
      const article = getDocArticle("2-protocol-mechanics", "prize-draws-vrf");
      assert.ok(article);
      assert.strictEqual(article?.slug, "prize-draws-vrf");
      assert.strictEqual(article?.categorySlug, "2-protocol-mechanics");
    });

    it("should return undefined for non-existent article", () => {
      const article = getDocArticle(
        "1-getting-started",
        "non-existent-article"
      );
      assert.strictEqual(article, undefined);
    });

    it("should retrieve category via getDocCategory", () => {
      const cat = getDocCategory("3-in-app-help");
      assert.ok(cat);
      assert.strictEqual(cat?.slug, "3-in-app-help");
      assert.strictEqual(cat?.icon, "💡");
    });

    it("should retrieve articles by category via getDocArticlesByCategory", () => {
      const articles = getDocArticlesByCategory("4-troubleshooting");
      assert.strictEqual(articles.length, 4);
      assert.strictEqual(articles[0].slug, "common-errors");
    });

    it("should calculate previous and next articles for pagination via getAdjacentDocArticles", () => {
      const firstArticle = DOC_ARTICLES[0];
      const adjFirst = getAdjacentDocArticles(
        firstArticle.categorySlug,
        firstArticle.slug
      );
      assert.strictEqual(adjFirst.prev, null);
      assert.strictEqual(adjFirst.next?.slug, DOC_ARTICLES[1].slug);

      const midArticle = DOC_ARTICLES[2];
      const adjMid = getAdjacentDocArticles(
        midArticle.categorySlug,
        midArticle.slug
      );
      assert.strictEqual(adjMid.prev?.slug, DOC_ARTICLES[1].slug);
      assert.strictEqual(adjMid.next?.slug, DOC_ARTICLES[3].slug);

      const lastArticle = DOC_ARTICLES[DOC_ARTICLES.length - 1];
      const adjLast = getAdjacentDocArticles(
        lastArticle.categorySlug,
        lastArticle.slug
      );
      assert.strictEqual(
        adjLast.prev?.slug,
        DOC_ARTICLES[DOC_ARTICLES.length - 2].slug
      );
      assert.strictEqual(adjLast.next, null);
    });
  });

  describe("Search Engine & Unicode Diacritics Normalization", () => {
    it("should normalize combining diacritics and casing", () => {
      assert.strictEqual(normalizeSearchText("Depósito"), "deposito");
      assert.strictEqual(normalizeSearchText("MECÁNICA"), "mecanica");
      assert.strictEqual(
        normalizeSearchText("  Aleatoriedad  "),
        "aleatoriedad"
      );
      assert.strictEqual(normalizeSearchText(""), "");
    });

    it("should search articles in English", () => {
      const results = searchDocArticles("zero-loss", "en");
      assert.ok(results.length > 0, "Should match zero-loss articles");
      const slugs = results.map((r) => r.slug);
      assert.ok(slugs.includes("overview") || slugs.includes("how-it-works"));
    });

    it("should search articles in Spanish with diacritics-insensitivity", () => {
      // Searching unaccented "deposito" should match accented Spanish text "Depósito"
      const resultsUnaccented = searchDocArticles("deposito", "es");
      assert.ok(
        resultsUnaccented.length > 0,
        "Unaccented search 'deposito' must match articles"
      );

      // Searching accented "depósito" should produce matching results
      const resultsAccented = searchDocArticles("depósito", "es");
      assert.ok(
        resultsAccented.length > 0,
        "Accented search 'depósito' must match articles"
      );
      assert.strictEqual(
        resultsUnaccented.length,
        resultsAccented.length,
        "Accented and unaccented searches must return identical results"
      );
    });

    it("should handle multi-token AND queries", () => {
      const results = searchDocArticles("huma credit yield", "en");
      assert.ok(results.length > 0);
      assert.ok(
        results.some(
          (r) => r.slug === "how-it-works" || r.slug === "yield-breakdown"
        )
      );
    });

    it("should return empty array on blank query", () => {
      assert.deepStrictEqual(searchDocArticles(""), []);
      assert.deepStrictEqual(searchDocArticles("   "), []);
    });

    it("should return empty array for non-matching gibberish", () => {
      assert.deepStrictEqual(searchDocArticles("xyzzy999foobar"), []);
    });
  });

  describe("Complete 51 Anchor Error Codes & Hex Parity", () => {
    it("should contain all 51 Anchor error codes (6000 to 6050)", () => {
      for (let code = 6000; code <= 6050; code++) {
        const item = ERROR_LOOKUP_ITEMS.find((e) => e.code === String(code));
        assert.ok(item, `Error code ${code} must exist in ERROR_LOOKUP_ITEMS`);
        assert.strictEqual(
          item?.numericCode,
          code,
          `Numeric code for ${code} must match`
        );
      }
    });

    it("should have exact hex parity for all Anchor error codes (6000+x = 0x1770+x)", () => {
      for (let code = 6000; code <= 6050; code++) {
        const item = ERROR_LOOKUP_ITEMS.find((e) => e.code === String(code));
        const expectedHex = `0x${code.toString(16)}`;
        assert.strictEqual(
          item?.hexCode,
          expectedHex,
          `Hex code for Anchor error ${code} must be ${expectedHex}`
        );
      }
    });

    it("should have complete bilingual diagnosis and solution for all error items", () => {
      for (const item of ERROR_LOOKUP_ITEMS) {
        assert.ok(
          item.diagnosis.en && item.diagnosis.en.trim().length > 0,
          `Error ${item.code} missing English diagnosis`
        );
        assert.ok(
          item.diagnosis.es && item.diagnosis.es.trim().length > 0,
          `Error ${item.code} missing Spanish diagnosis`
        );
        assert.ok(
          item.solution.en && item.solution.en.trim().length > 0,
          `Error ${item.code} missing English solution`
        );
        assert.ok(
          item.solution.es && item.solution.es.trim().length > 0,
          `Error ${item.code} missing Spanish solution`
        );
      }
    });

    it("should contain standard Solana wallet and network errors (4001, 0x1, BlockhashNotFound, 4900)", () => {
      const walletReject = ERROR_LOOKUP_ITEMS.find((e) => e.code === "4001");
      const lowSol = ERROR_LOOKUP_ITEMS.find((e) => e.code === "0x1");
      const expiredBlockhash = ERROR_LOOKUP_ITEMS.find(
        (e) => e.code === "BlockhashNotFound"
      );
      const disconnected = ERROR_LOOKUP_ITEMS.find((e) => e.code === "4900");

      assert.ok(walletReject, "4001 UserRejectedRequestError must exist");
      assert.ok(lowSol, "0x1 InsufficientFundsForFee must exist");
      assert.ok(expiredBlockhash, "BlockhashNotFound must exist");
      assert.ok(disconnected, "4900 WalletDisconnectedError must exist");
    });

    it("should search error lookup items by decimal, hex, and name", () => {
      // By decimal
      const resDec = searchErrorLookupItems("6044");
      assert.ok(resDec.some((e) => e.name === "PayoutTimelockActive"));

      // By hex
      const resHex = searchErrorLookupItems("0x179c");
      assert.ok(resHex.some((e) => e.code === "6044"));

      // By keyword
      const resKeyword = searchErrorLookupItems("insolvent");
      assert.ok(resKeyword.some((e) => e.code === "6047"));
    });
  });
});
