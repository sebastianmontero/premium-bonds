import { createSolanaRpc, address } from "@solana/kit";

async function main() {
  const rpc = createSolanaRpc("http://127.0.0.1:8899");
  const registryAddr = address("6aKN9MqdAzEek6eWobDc8wSEd2JGz6uv19emRCMLJnFu");

  const info = await rpc
    .getAccountInfo(registryAddr, { encoding: "base64" })
    .send();
  if (info && info.value) {
    const rawData = Buffer.from(info.value.data[0], "base64");
    console.log("Registry owner:", info.value.owner);
    console.log("Registry data length:", rawData.length);

    // Parse TicketRegistry header:
    // discriminator: 8 bytes (0..8)
    // pool_id: 4 bytes (8..12)
    // capacity: 4 bytes (12..16)
    // active_tickets_count: 4 bytes (16..20)
    // pending_tickets_count: 4 bytes (20..24)
    const view = new DataView(
      rawData.buffer,
      rawData.byteOffset,
      rawData.byteLength
    );
    const poolId = view.getUint32(8, true);
    const capacity = view.getUint32(12, true);
    const activeCount = view.getUint32(16, true);
    const pendingCount = view.getUint32(20, true);

    console.log(`Parsed TicketRegistry:
      poolId: ${poolId}
      capacity: ${capacity}
      activeCount: ${activeCount}
      pendingCount: ${pendingCount}
    `);
  } else {
    console.log("Registry account does not exist.");
  }
}

main().catch(console.error);
