#!/usr/bin/env bash
set -e

echo "=== Premium Bonds Vercel Environment Setup ==="

# Check if vercel CLI is installed or can be executed via npx
if ! npx vercel --version > /dev/null 2>&1; then
  echo "Error: Vercel CLI is not installed or available via npx."
  exit 1
fi

echo "Linking project to Vercel..."
npx vercel link --yes

echo "Setting up Preview Environment (Devnet)..."
echo -n "devnet" | npx vercel env add NEXT_PUBLIC_ENVIRONMENT preview || true
echo -n "https://api.devnet.solana.com" | npx vercel env add NEXT_PUBLIC_SOLANA_RPC_URL preview || true
echo -n "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx" | npx vercel env add NEXT_PUBLIC_PROGRAM_ID preview || true

echo "Setting up Production Environment (Mainnet)..."
echo -n "mainnet-beta" | npx vercel env add NEXT_PUBLIC_ENVIRONMENT production || true
echo -n "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx" | npx vercel env add NEXT_PUBLIC_PROGRAM_ID production || true

if [ -z "$HELIUS_API_KEY" ]; then
  read -p "Enter your Helius Mainnet API Key (or press Enter to set a placeholder): " HELIUS_KEY
  if [ -z "$HELIUS_KEY" ]; then
    HELIUS_KEY="YOUR_HELIUS_API_KEY"
  fi
else
  HELIUS_KEY="$HELIUS_API_KEY"
fi

echo -n "https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}" | npx vercel env add NEXT_PUBLIC_SOLANA_RPC_URL production || true

echo "Setting up Development Environment (Devnet)..."
echo -n "devnet" | npx vercel env add NEXT_PUBLIC_ENVIRONMENT development || true
echo -n "https://api.devnet.solana.com" | npx vercel env add NEXT_PUBLIC_SOLANA_RPC_URL development || true
echo -n "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx" | npx vercel env add NEXT_PUBLIC_PROGRAM_ID development || true

echo "=== Vercel Environment Setup Complete ==="
