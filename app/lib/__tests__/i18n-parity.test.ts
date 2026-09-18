import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type JsonObject = { [key: string]: unknown };

function getFlatKeysWithValues(
  obj: JsonObject,
  prefix = ""
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, getFlatKeysWithValues(v as JsonObject, fullKey));
    } else if (typeof v === "string") {
      result[fullKey] = v;
    }
  }
  return result;
}

/**
 * Extracts top-level variable identifiers from ICU MessageFormat strings.
 * Correctly handles complex plural/select syntax like `{count, plural, =1 {1 bond} other {# bonds}}`.
 */
function extractIcuVariableNames(template: string): string[] {
  const vars: Set<string> = new Set();
  let i = 0;

  while (i < template.length) {
    if (template[i] === "{") {
      let depth = 1;
      let j = i + 1;
      let varName = "";
      while (j < template.length && depth > 0) {
        if (template[j] === "{") {
          depth++;
        } else if (template[j] === "}") {
          depth--;
        }
        j++;
      }

      const inner = template.slice(i + 1, j - 1);
      const parts = inner.split(",");
      varName = parts[0].trim();
      if (/^[a-zA-Z0-9_]+$/.test(varName)) {
        vars.add(varName);
      }
      i = j;
    } else {
      i++;
    }
  }

  return Array.from(vars).sort();
}

/**
 * Checks for ICU plural syntax and verifies that mandatory branches like 'other' exist.
 */
function checkIcuPluralCompleteness(template: string): {
  hasPlural: boolean;
  hasOtherBranch: boolean;
  pluralVariables: string[];
} {
  const pluralRegex = /\{([a-zA-Z0-9_]+)\s*,\s*plural\s*,/g;
  let match: RegExpExecArray | null;
  const pluralVariables: string[] = [];

  while ((match = pluralRegex.exec(template)) !== null) {
    pluralVariables.push(match[1]);
  }

  const hasPlural = pluralVariables.length > 0;
  const hasOtherBranch = !hasPlural || /\bother\s*\{/.test(template);

  return { hasPlural, hasOtherBranch, pluralVariables: pluralVariables.sort() };
}

/**
 * Extracts XML / rich-text tags (e.g. `<bold>`, `</bold>`, `<link>`, `</link>`) from a template.
 */
function extractXmlTags(template: string): string[] {
  const tagRegex = /<\/?[a-zA-Z0-9_-]+>/g;
  const matches = template.match(tagRegex);
  return matches ? matches : [];
}

describe("i18n Localization Parity & ICU Integrity Tests", () => {
  const enPath = path.resolve(process.cwd(), "messages/en.json");
  const esPath = path.resolve(process.cwd(), "messages/es.json");

  const enJson: JsonObject = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const esJson: JsonObject = JSON.parse(fs.readFileSync(esPath, "utf8"));

  const enEntries = getFlatKeysWithValues(enJson);
  const esEntries = getFlatKeysWithValues(esJson);

  const enKeys = Object.keys(enEntries).sort();
  const esKeys = Object.keys(esEntries).sort();

  it("should have identical translation key sets in English and Spanish", () => {
    const missingInEs = enKeys.filter((k) => !esEntries[k]);
    const missingInEn = esKeys.filter((k) => !enEntries[k]);

    assert.deepStrictEqual(
      missingInEs,
      [],
      `The following keys exist in en.json but are missing in es.json: ${missingInEs.join(", ")}`
    );
    assert.deepStrictEqual(
      missingInEn,
      [],
      `The following keys exist in es.json but are missing in en.json: ${missingInEn.join(", ")}`
    );
  });

  it("should not contain any empty translation strings in English or Spanish", () => {
    for (const [key, value] of Object.entries(enEntries)) {
      assert.ok(
        value.trim().length > 0,
        `en.json has an empty translation string at key: ${key}`
      );
    }
    for (const [key, value] of Object.entries(esEntries)) {
      assert.ok(
        value.trim().length > 0,
        `es.json has an empty translation string at key: ${key}`
      );
    }
  });

  it("should have matching ICU parameter variables across en and es", () => {
    for (const key of enKeys) {
      const enVal = enEntries[key];
      const esVal = esEntries[key];

      const enVars = extractIcuVariableNames(enVal);
      const esVars = extractIcuVariableNames(esVal);

      assert.deepStrictEqual(
        esVars,
        enVars,
        `ICU variable mismatch at key "${key}". EN: [${enVars.join(", ")}], ES: [${esVars.join(", ")}]`
      );
    }
  });

  it("should enforce complete ICU plural branches and required 'other' clauses", () => {
    for (const key of enKeys) {
      const enVal = enEntries[key];
      const esVal = esEntries[key];

      const enPlural = checkIcuPluralCompleteness(enVal);
      const esPlural = checkIcuPluralCompleteness(esVal);

      if (enPlural.hasPlural) {
        assert.ok(
          enPlural.hasOtherBranch,
          `en.json key "${key}" uses ICU plural but is missing mandatory 'other' branch.`
        );
        assert.ok(
          esPlural.hasPlural,
          `es.json key "${key}" is missing ICU plural syntax present in en.json.`
        );
        assert.ok(
          esPlural.hasOtherBranch,
          `es.json key "${key}" uses ICU plural but is missing mandatory 'other' branch.`
        );
        assert.deepStrictEqual(
          esPlural.pluralVariables,
          enPlural.pluralVariables,
          `ICU plural variable mismatch at key "${key}".`
        );
      }
    }
  });

  it("should have identical rich text XML formatting tags across en and es", () => {
    for (const key of enKeys) {
      const enVal = enEntries[key];
      const esVal = esEntries[key];

      const enTags = extractXmlTags(enVal);
      const esTags = extractXmlTags(esVal);

      assert.deepStrictEqual(
        esTags,
        enTags,
        `XML rich-text tag mismatch at key "${key}". EN: [${enTags.join(", ")}], ES: [${esTags.join(", ")}]`
      );
    }
  });

  it("should verify substantial translations are localized in Spanish", () => {
    // Exempt keys that contain brand names, technical identifiers, protocol signatures, or universal symbols
    const allowedIdenticalKeys = new Set([
      "Activity.descriptions.generic",
      "Common.tiers.tierN",
    ]);

    const untranslatedKeys: string[] = [];

    for (const key of enKeys) {
      if (allowedIdenticalKeys.has(key)) continue;

      const enVal = enEntries[key].trim();
      const esVal = esEntries[key].trim();

      // Only check natural language phrases of sufficient length (> 20 chars) that do not purely consist of ICU tokens
      if (
        enVal.length > 20 &&
        enVal === esVal &&
        !enVal.startsWith("http") &&
        !/^\{[a-zA-Z0-9_, =#]+\}$/.test(enVal)
      ) {
        untranslatedKeys.push(key);
      }
    }

    assert.deepStrictEqual(
      untranslatedKeys,
      [],
      `The following keys have identical English and Spanish text (likely untranslated): ${untranslatedKeys.join(", ")}`
    );
  });
});
