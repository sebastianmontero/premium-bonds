import fs from "fs";
import path from "path";
import { createFromRoot, updateAccountsVisitor } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJsVisitor } from "@codama/renderers-js";

function fixGeneratedFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf-8");
  let modified = false;

  if (content.includes("extendClient")) {
    const mockImpl =
      "type ExtendedClient<TClient, TExtension> = TClient & TExtension;\nfunction extendClient<TClient, TExtension>(client: TClient, extension: TExtension): TClient & TExtension { return Object.assign(client as any, extension); }";

    content = content.replace(
      /import\s*\{[^}]*extendClient[^}]*\}\s*from\s*["']@solana\/plugin-core["'];?/gi,
      mockImpl
    );
    modified = true;
  }

  if (content.includes("SOLANA_ERROR__PROGRAM_CLIENTS__")) {
    content = content.replace(
      /import\s*\{[\s\S]*?\}\s*from\s*["']@solana\/(errors|codecs)["'];?/g,
      (match) => {
        return match
          .replace(/\s*SOLANA_ERROR__PROGRAM_CLIENTS__[A-Z0-9_]+,?\s*/g, "\n")
          .replace(/,\s*\}/g, " }");
      }
    );

    const mockErrors = `const SOLANA_ERROR__PROGRAM_CLIENTS__FAILED_TO_IDENTIFY_ACCOUNT = 1200001 as any;\nconst SOLANA_ERROR__PROGRAM_CLIENTS__FAILED_TO_IDENTIFY_INSTRUCTION = 1200002 as any;\nconst SOLANA_ERROR__PROGRAM_CLIENTS__UNRECOGNIZED_INSTRUCTION_TYPE = 1200003 as any;\nconst SOLANA_ERROR__PROGRAM_CLIENTS__INSUFFICIENT_ACCOUNT_METAS = 1200004 as any;\n`;
    content = mockErrors + content;
    modified = true;
  }

  // Deduplicate repeated PDA seed arguments & type properties in generated code
  if (
    content.includes("getAddressFromResolvedInstructionAccount") ||
    content.includes("Seeds = {")
  ) {
    const orig = content;
    content = content.replace(
      /(pool:\s*getAddressFromResolvedInstructionAccount\([\s\S]*?\)\s*,\s*)pool:\s*getAddressFromResolvedInstructionAccount\([\s\S]*?\)/g,
      "$1"
    );
    content = content.replace(
      /(\s*([a-zA-Z0-9_]+):\s*Address;)\s*\2:\s*Address;/g,
      "$1"
    );
    content = content.replace(/\n\s*,\s*\n/g, "\n");
    if (content !== orig) {
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`  ✓ Patched client imports in ${path.basename(filePath)}`);
  }
}

function fixAllGeneratedFiles(dirPath: string) {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixAllGeneratedFiles(fullPath);
    } else if (file.endsWith(".ts")) {
      fixGeneratedFile(fullPath);
    }
  }
}

async function main() {
  console.log("Generating Codama TypeScript clients from Anchor IDLs...");

  // 1. YieldBonds
  const yieldBondsPath = path.resolve(
    __dirname,
    "../anchor/target/idl/anchor.json"
  );
  if (!fs.existsSync(yieldBondsPath)) {
    throw new Error(
      `YieldBonds IDL not found at ${yieldBondsPath}. Please run 'anchor build' first.`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yieldBondsIdl = JSON.parse(fs.readFileSync(yieldBondsPath, "utf-8"));

  // Clean self-referential PDA seeds from IDL accounts before building Codama AST
  if (Array.isArray(yieldBondsIdl.instructions)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ix of yieldBondsIdl.instructions) {
      if (Array.isArray(ix.accounts)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const acc of ix.accounts) {
          if (acc.pda && Array.isArray(acc.pda.seeds)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isSelfReferential = acc.pda.seeds.some(
              (seed: any) => seed.kind === "account" && seed.path === acc.name
            );
            if (isSelfReferential) {
              delete acc.pda;
            }
          }
        }
      }
    }
  }

  const codamaYieldBonds = createFromRoot(rootNodeFromAnchor(yieldBondsIdl));

  // AST Visitor Safeguard: Truncate TicketRegistry dynamic array in Codama AST to prevent OOM on 10MB accounts
  codamaYieldBonds.update(
    updateAccountsVisitor({
      TicketRegistry: (node) => {
        return {
          ...node,
          data: {
            ...node.data,
            struct: {
              ...node.data.struct,
              fields: node.data.struct.fields.filter(
                (field) => field.name !== "entries"
              ),
            },
          },
        };
      },
    })
  );

  const outYieldBonds = path.resolve(
    __dirname,
    "../app/lib/generated/yield-bonds"
  );
  await codamaYieldBonds.accept(
    renderJsVisitor(outYieldBonds, { kitImportStrategy: "granular" })
  );
  fixAllGeneratedFiles(outYieldBonds);
  console.log(`✓ YieldBonds Codama client generated at ${outYieldBonds}`);

  // 2. MockHuma
  const mockHumaPath = path.resolve(
    __dirname,
    "../anchor/target/idl/mock_huma.json"
  );
  if (fs.existsSync(mockHumaPath)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockHumaIdl = JSON.parse(fs.readFileSync(mockHumaPath, "utf-8"));
    const codamaMockHuma = createFromRoot(rootNodeFromAnchor(mockHumaIdl));
    const outMockHuma = path.resolve(
      __dirname,
      "../app/lib/generated/mock-huma"
    );
    await codamaMockHuma.accept(
      renderJsVisitor(outMockHuma, { kitImportStrategy: "granular" })
    );
    fixAllGeneratedFiles(outMockHuma);
    console.log(`✓ MockHuma Codama client generated at ${outMockHuma}`);
  }
}

main().catch((err) => {
  console.error("Codegen error:", err);
  process.exit(1);
});
