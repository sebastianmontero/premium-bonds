import { address } from "@solana/kit";
import { USDC_MINT } from "../bonds-sdk";

export const TEST_ADDRESSES = {
  USER: address("11111111111111111111111111111111"),
  USER_2: address("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"),
  MINT: USDC_MINT, // Canonical USDC Mint from bonds-sdk
  ATA_PROGRAM: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  ADMIN: address("SysvarRent111111111111111111111111111111111"),
  HUMA_POOL: address("HumaPoo111111111111111111111111111111111111"),
} as const;

export const MOCK_PUBKEY = TEST_ADDRESSES.USER;
export const MOCK_TOKEN_MINT = TEST_ADDRESSES.MINT;
