import {
  address,
  getBase58Encoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const url = "http://127.0.0.1:8899";
  const base58Encoder = getBase58Encoder();

  const programIdStr = "ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj";
  const programId = address(programIdStr);
  const BPFLoaderUpgradeable = address(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );

  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: BPFLoaderUpgradeable,
    seeds: [base58Encoder.encode(programId)],
  });

  console.log("Program ID:", programIdStr);
  console.log("ProgramData Address:", programDataAddress);

  const programDataAddressBytes = base58Encoder.encode(programDataAddress);
  const programDataAddressHex = Buffer.from(programDataAddressBytes).toString(
    "hex"
  );

  // Construct program account data: 4 bytes tag (2) + 32 bytes program data address
  const programAccountData = "02000000" + programDataAddressHex;

  // Construct program data account data:
  // 45-byte header:
  // - 4 bytes tag (3) -> 03000000
  // - 8 bytes slot (1) -> 0100000000000000
  // - 1 byte option tag (1) -> 01
  // - 32 bytes admin/authority (zeros or admin key)
  const headerHex = "03000000" + "0100000000000000" + "01" + "00".repeat(32);

  const soPath = path.resolve(
    __dirname,
    "../anchor/target/deploy/mock_huma.so"
  );
  console.log("Reading mock_huma.so from:", soPath);
  const soData = fs.readFileSync(soPath);
  const soHex = soData.toString("hex");
  const programDataAccountData = headerHex + soHex;

  console.log(
    "Program account data length (bytes):",
    programAccountData.length / 2
  );
  console.log(
    "Program data account data length (bytes):",
    programDataAccountData.length / 2
  );

  // Send setAccount for ProgramData first
  console.log("Injecting ProgramData account...");
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setAccount",
      params: [
        programDataAddress,
        {
          lamports: 5_000_000_000,
          data: programDataAccountData,
          owner: BPFLoaderUpgradeable,
          executable: false,
        },
      ],
    }),
  });
  console.log("ProgramData injection response:", await res.json());

  // Send setAccount for Program
  console.log("Injecting Program account...");
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "surfnet_setAccount",
      params: [
        programIdStr,
        {
          lamports: 2_000_000_000,
          data: programAccountData,
          owner: BPFLoaderUpgradeable,
          executable: true,
        },
      ],
    }),
  });
  console.log("Program injection response:", await res.json());

  // Now verify with getAccountInfo
  console.log("Verifying Program Account Info...");
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "getAccountInfo",
      params: [programIdStr, { encoding: "base64" }],
    }),
  });
  console.log(
    "Program account verification:",
    JSON.stringify(await res.json(), null, 2)
  );
}

main().catch(console.error);
