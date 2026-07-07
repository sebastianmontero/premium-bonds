import * as kit from "@solana/kit";

const keys = Object.keys(kit);
console.log("=== kit send/sign/confirm ===");
console.log(
  keys.filter(
    (k) =>
      k.toLowerCase().includes("send") ||
      k.toLowerCase().includes("sign") ||
      k.toLowerCase().includes("confirm")
  )
);
