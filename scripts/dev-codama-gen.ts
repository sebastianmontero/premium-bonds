import fs from "fs";
import path from "path";
import { createFromRoot, updateAccountsVisitor } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJsVisitor } from "@codama/renderers-js";

async function main() {
  console.log("Testing Codama generation...");

  // 1. YieldBonds
  const yieldBondsPath = path.resolve(
    __dirname,
    "../anchor/target/idl/anchor.json"
  );
  if (!fs.existsSync(yieldBondsPath)) {
    throw new Error(`IDL not found at ${yieldBondsPath}`);
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

  // Truncate TicketRegistry dynamic array in Codama AST to prevent OOM on 10MB accounts
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
  codamaYieldBonds.accept(renderJsVisitor(outYieldBonds));
  console.log(`✓ YieldBonds client generated at ${outYieldBonds}`);

  // 2. MockHuma
  const mockHumaPath = path.resolve(
    __dirname,
    "../anchor/target/idl/mock_huma.json"
  );
  if (fs.existsSync(mockHumaPath)) {
    const mockHumaIdl = JSON.parse(fs.readFileSync(mockHumaPath, "utf-8"));
    const codamaMockHuma = createFromRoot(rootNodeFromAnchor(mockHumaIdl));
    const outMockHuma = path.resolve(
      __dirname,
      "../app/lib/generated/mock-huma"
    );
    codamaMockHuma.accept(renderJsVisitor(outMockHuma));
    console.log(`✓ MockHuma client generated at ${outMockHuma}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
