import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

interface Violation {
  file: string;
  line: number;
  column: number;
  type: "JSX_TEXT" | "JSX_ATTRIBUTE" | "TEMPLATE_LITERAL";
  attributeName?: string;
  text: string;
  message: string;
}

const ALLOWLISTED_TERMS = new Set([
  "USDC",
  "SOL",
  "WBTC",
  "VRF",
  "PDA",
  "RPC",
  "TX",
  "TXS",
  "YIELDBONDS",
  "SWITCHBOARD",
  "SOLSCAN",
  "SOLANA",
  "EXPLORER",
  "HUMA",
  "PHANTOM",
  "SOLFLARE",
  "BACKPACK",
  "TORUS",
  "LEDGER",
  "BASE",
  "MAINNET",
  "DEVNET",
  "TESTNET",
  "LOCALNET",
  "APY",
  "TVL",
  "USD",
  "JSON",
  "CSV",
  "UTC",
  "GMT",
  "BPS",
  "PST",
  "CU",
  "SHA-256",
  "V1",
  "V2",
  "V3",
  "X",
  "ID",
  "PROTOCOL",
  "ON",
  "DEMAND",
  "ON-DEMAND",
  "EN",
  "ES",
  "PT",
  "FR",
  "DE",
  "ZH",
  "JA",
]);

const INTERACTIVE_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "title",
  "placeholder",
  "alt",
]);

function isIgnoredSymbolOrPunctuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Standalone numbers, decimals, percentages, hex
  if (/^[+-]?\$?[\d,.]+%?$/.test(trimmed)) return true;
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return true;

  // Single or multiple punctuation/symbols only: e.g. ·, →, ↗, ↘, ▾, ▴, /, |, +, -, $, %, :, >, <, #, @, &, *, etc.
  if (/^[·→↗↘▾▴/|\\+\-$%:><#@&*=_~^—–•…!?()[\]{},.'"`;]+$/.test(trimmed)) {
    return true;
  }

  // HTML entities or single entity fragments
  if (/^&[a-zA-Z0-9#]+;$/.test(trimmed)) return true;

  // Allowlisted technical/protocol terms
  const normalized = trimmed.toUpperCase();
  if (ALLOWLISTED_TERMS.has(normalized)) return true;

  // Combination of symbols and allowlisted term (e.g. "+USDC", "$USDC", "(USDC)")
  const stripped = trimmed.replace(
    /^[·→↗↘▾▴/|\\+\-$%:><#@&*=_~^—–•…!?()[\]{},.'"`;\s]+|[·→↗↘▾▴/|\\+\-$%:><#@&*=_~^—–•…!?()[\]{},.'"`;\s]+$/g,
    ""
  );
  if (stripped && ALLOWLISTED_TERMS.has(stripped.toUpperCase())) return true;
  if (/^[+-]?\$?[\d,.]+%?$/.test(stripped)) return true;

  return false;
}

function hasNaturalLanguageWords(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isIgnoredSymbolOrPunctuation(trimmed)) return false;

  // Check if text has any word with 2+ letters
  const words = trimmed.match(/[a-zA-Z]{2,}/g);
  if (!words) return false;

  for (const word of words) {
    if (!ALLOWLISTED_TERMS.has(word.toUpperCase())) {
      return true;
    }
  }

  return false;
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  function checkNode(node: ts.Node) {
    // 1. Check raw JSX text
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile);
      if (hasNaturalLanguageWords(text)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        );
        violations.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          type: "JSX_TEXT",
          text: text.trim(),
          message: `Hardcoded JSX text "${text.trim()}" found. Use next-intl useTranslations hook instead.`,
        });
      }
    }

    // 2. Check JSX attributes (aria-label, title, placeholder, alt, etc.)
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile);
      if (INTERACTIVE_ATTRIBUTES.has(attrName)) {
        const init = node.initializer;
        if (init) {
          if (ts.isStringLiteral(init)) {
            const attrText = init.text;
            if (hasNaturalLanguageWords(attrText)) {
              const { line, character } =
                sourceFile.getLineAndCharacterOfPosition(
                  init.getStart(sourceFile)
                );
              violations.push({
                file: filePath,
                line: line + 1,
                column: character + 1,
                type: "JSX_ATTRIBUTE",
                attributeName: attrName,
                text: attrText,
                message: `Hardcoded string literal in attribute "${attrName}='${attrText}'". Use next-intl translation hook.`,
              });
            }
          } else if (ts.isJsxExpression(init) && init.expression) {
            const expr = init.expression;
            if (ts.isStringLiteral(expr)) {
              const attrText = expr.text;
              if (hasNaturalLanguageWords(attrText)) {
                const { line, character } =
                  sourceFile.getLineAndCharacterOfPosition(
                    expr.getStart(sourceFile)
                  );
                violations.push({
                  file: filePath,
                  line: line + 1,
                  column: character + 1,
                  type: "JSX_ATTRIBUTE",
                  attributeName: attrName,
                  text: attrText,
                  message: `Hardcoded string expression in attribute "${attrName}={'${attrText}'}". Use next-intl translation hook.`,
                });
              }
            } else if (ts.isTemplateExpression(expr)) {
              // Check head and span literals
              const literalParts = [
                expr.head.text,
                ...expr.templateSpans.map((span) => span.literal.text),
              ];
              const combinedLiteralText = literalParts.join(" ");
              if (hasNaturalLanguageWords(combinedLiteralText)) {
                const { line, character } =
                  sourceFile.getLineAndCharacterOfPosition(
                    expr.getStart(sourceFile)
                  );
                violations.push({
                  file: filePath,
                  line: line + 1,
                  column: character + 1,
                  type: "TEMPLATE_LITERAL",
                  attributeName: attrName,
                  text: expr.getText(sourceFile),
                  message: `Hardcoded natural language inside template literal for attribute "${attrName}". Use next-intl ICU parameters.`,
                });
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, checkNode);
  }

  checkNode(sourceFile);
  return violations;
}

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "__tests__" ||
        entry.name === "scratch"
      ) {
        continue;
      }
      results.push(...findTsxFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runLocalizationScan(): {
  filesScanned: number;
  violations: Violation[];
} {
  const rootDir = process.cwd();
  const scanDirs = [
    path.join(rootDir, "app/components"),
    path.join(rootDir, "app/[locale]"),
  ];

  const filesToScan: string[] = [];
  for (const dir of scanDirs) {
    filesToScan.push(...findTsxFiles(dir));
  }

  const allViolations: Violation[] = [];
  for (const file of filesToScan) {
    allViolations.push(...scanFile(file));
  }

  return {
    filesScanned: filesToScan.length,
    violations: allViolations,
  };
}

// CLI Execution
if (require.main === module || process.argv[1]?.includes("scan-unlocalized")) {
  console.log(
    "🔍 Scanning codebase for unlocalized strings & attributes (AST scanner)..."
  );
  const { filesScanned, violations } = runLocalizationScan();

  if (violations.length === 0) {
    console.log(
      `✅ Localization scan passed! ${filesScanned} TSX component files scanned with 0 unlocalized violations.`
    );
    process.exit(0);
  } else {
    console.error(
      `❌ Localization scan failed with ${violations.length} unlocalized violation(s):\n`
    );
    for (const v of violations) {
      const relPath = path.relative(process.cwd(), v.file);
      console.error(`  • [${v.type}] ${relPath}:${v.line}:${v.column}`);
      console.error(`    ${v.message}`);
      console.error(`    Snippet: "${v.text}"\n`);
    }
    process.exit(1);
  }
}
