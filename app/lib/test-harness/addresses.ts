import { address } from "@solana/kit";
import { USDC_MINT, type HumaPoolAddresses } from "../bonds-sdk";

export const TEST_ADDRESSES = {
  USER: address("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"),
  USER_2: address("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"),
  MINT: USDC_MINT, // Canonical USDC Mint from bonds-sdk
  ATA_PROGRAM: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  ADMIN: address("SysvarRent111111111111111111111111111111111"),
  HUMA_POOL: address("HumaPoo111111111111111111111111111111111111"),
} as const;

export const MOCK_PUBKEY = TEST_ADDRESSES.USER;
export const MOCK_TOKEN_MINT = TEST_ADDRESSES.MINT;

export const MOCK_HUMA_ADDRESSES = {
  poolState: address("D4fBgrqd2DjjYgmTFZT2EboVbXjjaM8VZEaEHYrQ8DtM"),
  config: address("8VA7RjU8fwqdYrN4j9T1xigJaDr9wvGCuRtz4V3P9mDt"),
  poolConfig: address("GzyGmodpbkSH4BD1qHYaawkq1ndNP3nEBPGcYxvVJgZq"),
  modeConfig: address("J9SJBMYruro9LwED8y54egBz1vuivG89sNSjb3FhS9Zy"),
  lenderState: address("mmb7zaCqYWJPr1z8BBfJAdnKLedAAwSYpc11LWqZWHC"),
  poolUnderlyingToken: address("C8bpcC3E5LQxsgzsKwDADpXpYPS8qy4bpZGdKMBAAXq"),
  modeMint: address("5R2YdvMLdpq59PKDBLF1mQARqfe2hkdraqSLtaKeg72F"),
  poolModeToken: address("6We37vc76UiQ91rfDxSUhFUmgbMbkwLT8NEpTYNN3RX"),
  lenderModeToken: address("8XFkP4b18T8R4zGvT8dY1Q6jMh2k3pP5qV9sA7bC3eD1"),
  redemptionRequest: address("Bw5wpTV4evkbxFA78LQkX6Bpxsr3Y5gXEDaJmQzqJ1qQ"),
  program: address("Bm9d3LeMLsbkM8Xf9NvZ9d4xPnQfLuX62LLeyfAtrijJ"),
} as const;

export function createMockHumaAddresses(
  overrides?: Partial<HumaPoolAddresses>
): HumaPoolAddresses {
  const result = { ...MOCK_HUMA_ADDRESSES, ...overrides };
  const values = Object.values(result).filter(Boolean);
  if (new Set(values).size !== values.length) {
    throw new Error(
      "Test harness invariant violation: Mock Huma addresses must be strictly unique to prevent account collisions."
    );
  }
  return result;
}
