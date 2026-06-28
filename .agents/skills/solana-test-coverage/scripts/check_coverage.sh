#!/usr/bin/env bash
set -euo pipefail

# 1. Resolve workspace paths dynamically
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ANCHOR_DIR="$GIT_ROOT/anchor"
SCRIPTS_DIR="$GIT_ROOT/.agents/skills/solana-test-coverage/scripts"

echo "=== Premium Bonds Coverage Check ==="
echo "Workspace root: $GIT_ROOT"
echo "Anchor directory: $ANCHOR_DIR"

# 2. Check and install llvm-tools-preview if needed
echo "Checking LLVM tools dependency..."
if ! rustup component list --installed | grep -q "llvm-tools-preview"; then
    echo "llvm-tools-preview is missing. Installing..."
    rustup component add llvm-tools-preview
else
    echo "llvm-tools-preview is already installed."
fi

# 3. Clean old raw profile files
cd "$ANCHOR_DIR"
echo "Cleaning old coverage profiles..."
find . -name "*.profraw" -delete
rm -f coverage.profdata cargo_test_output.txt

# 4. Execute tests with coverage flags
echo "Running tests with coverage instrumentation..."
RUSTFLAGS="-C instrument-coverage" cargo test > cargo_test_output.txt 2>&1 || true
cat cargo_test_output.txt

# 5. Parse executed test binaries
echo "Locating test binaries..."
OBJECTS=()
while IFS= read -r bin; do
    if [ -f "$bin" ] && [ -x "$bin" ]; then
        OBJECTS+=("-object" "$bin")
    fi
done < <(grep -o 'target/debug/deps/[a-zA-Z0-9_-]\+' cargo_test_output.txt | sort -u)

if [ ${#OBJECTS[@]} -eq 0 ]; then
    echo "Error: No executed test binaries could be parsed from output!"
    exit 1
fi

# 6. Locate LLVM tools from rustc sysroot
SYSROOT=$(rustc --print sysroot)
HOST_TRIPLE=$(rustc -vV | grep host | cut -d' ' -f2)
LLVM_PROFDATA="$SYSROOT/lib/rustlib/$HOST_TRIPLE/bin/llvm-profdata"
LLVM_COV="$SYSROOT/lib/rustlib/$HOST_TRIPLE/bin/llvm-cov"

if [ ! -f "$LLVM_PROFDATA" ] || [ ! -f "$LLVM_COV" ]; then
    echo "Error: Could not locate llvm-profdata or llvm-cov inside sysroot!"
    exit 1
fi

# 7. Merge profile data
echo "Merging coverage data..."
"$LLVM_PROFDATA" merge -sparse $(find . -name "*.profraw") -o coverage.profdata

# 8. Generate reports
echo "Generating text coverage report for src/instructions..."
"$LLVM_COV" report "${OBJECTS[@]}" \
    --instr-profile=coverage.profdata \
    programs/anchor/src/instructions || true

echo "Generating HTML coverage report to anchor/coverage_html/..."
rm -rf coverage_html
"$LLVM_COV" show "${OBJECTS[@]}" \
    --instr-profile=coverage.profdata \
    -format=html \
    -output-dir=coverage_html \
    programs/anchor/src/instructions || true

echo "NOTE: Host coverage on SBF guest instructions will show 0.00% because SBF runs inside the LiteSVM VM."
echo "Running static error analyzer to check error path coverage..."

# 9. Run static error path analyzer
if [ -f "$SCRIPTS_DIR/analyze_tests.py" ]; then
    python3 "$SCRIPTS_DIR/analyze_tests.py"
else
    echo "Warning: analyze_tests.py not found at $SCRIPTS_DIR/analyze_tests.py!"
fi

echo "=== Coverage check finished successfully ==="
