import { AccountRole, Instruction, KeyPairSigner } from "@solana/kit";

/**
 * Defensively normalizes instruction accounts matching the signers' addresses
 * to use the canonical KeyPairSigner instances, avoiding reference-mismatch errors.
 */
export function normalizeInstructionSigners(
  instructions: readonly Instruction[],
  signers: KeyPairSigner | readonly KeyPairSigner[]
): Instruction[] {
  const signerList = Array.isArray(signers) ? signers : [signers];
  const signerMap = new Map(signerList.map((s) => [s.address, s]));
  return instructions.map((ix) => {
    if (!ix.accounts) return ix;
    const sanitizedAccounts = ix.accounts.map((acc) => {
      const isSignerRole =
        acc.role === AccountRole.READONLY_SIGNER ||
        acc.role === AccountRole.WRITABLE_SIGNER ||
        ("signer" in acc && Boolean(acc.signer));
      const matchedSigner = signerMap.get(acc.address);
      if (isSignerRole && matchedSigner) {
        const existingSigner = "signer" in acc ? acc.signer : undefined;
        if (existingSigner !== matchedSigner) {
          return { ...acc, signer: matchedSigner };
        }
      }
      return acc;
    });
    return { ...ix, accounts: sanitizedAccounts };
  });
}
