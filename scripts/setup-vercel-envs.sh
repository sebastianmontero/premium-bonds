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

add_env() {
  local key="$1"
  local val="$2"
  local env="$3"
  local type="${4:-config}"
  echo -n "$val" | npx vercel env add "$key" "$env" --type "$type" --yes || true
}

echo "Setting up Preview Environment (Devnet)..."
add_env NEXT_PUBLIC_ENVIRONMENT "devnet" preview
add_env NEXT_PUBLIC_SOLANA_RPC_URL "https://api.devnet.solana.com" preview
add_env NEXT_PUBLIC_PROGRAM_ID "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos" preview

echo "Setting up Production Environment (Mainnet)..."
add_env NEXT_PUBLIC_ENVIRONMENT "mainnet-beta" production
add_env NEXT_PUBLIC_PROGRAM_ID "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos" production

if [ -z "$HELIUS_API_KEY" ]; then
  read -p "Enter your Helius Mainnet API Key (or press Enter to set a placeholder): " HELIUS_KEY
  if [ -z "$HELIUS_KEY" ]; then
    HELIUS_KEY="YOUR_HELIUS_API_KEY"
  fi
else
  HELIUS_KEY="$HELIUS_API_KEY"
fi

add_env NEXT_PUBLIC_SOLANA_RPC_URL "https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}" production

echo "Setting up Development Environment (Devnet)..."
add_env NEXT_PUBLIC_ENVIRONMENT "devnet" development
add_env NEXT_PUBLIC_SOLANA_RPC_URL "https://api.devnet.solana.com" development
add_env NEXT_PUBLIC_PROGRAM_ID "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos" development

echo "=== Vercel Environment Setup Complete ==="
