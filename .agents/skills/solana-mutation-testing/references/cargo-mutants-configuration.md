# `cargo-mutants` Configuration & Execution Guide (Solana Anchor)

This reference document provides configuration guidelines and command-line recipes for running `cargo-mutants` against Anchor/LiteSVM test suites.

---

## 1. Installation & Environment Setup

Ensure `cargo-mutants` is installed in your local Rust environment:

```bash
cargo install cargo-mutants
```

---

## 2. Recommended `.cargo/mutants.toml` Configuration

Place a `.cargo/mutants.toml` configuration file in your workspace or crate root to optimize mutation performance and avoid unviable mutations:

```toml
# .cargo/mutants.toml

# Exclude generated IDLs, patches, or mock helpers from mutation
exclude_globs = [
    "programs/anchor/src/constants.rs",
    "programs/anchor/tests/common/**",
    "patches/**",
]

# Set test timeout to 30 seconds per mutant (LiteSVM runs in ~ms)
timeout = 30.0

# Number of parallel build and test jobs
jobs = 4

# Pass NO_DNA=1 environment variable to prevent interactive CLI hangs
test_args = ["--", "NO_DNA=1"]
```

---

## 3. Command-Line Recipes

### A. Targeted Mutation Run (Single Instruction + Integration Test)

```bash
cd anchor
cargo mutants --file programs/anchor/src/instructions/user/buy_bonds.rs \
              --test test_buy_bonds
```

### B. List Mutants Without Testing (Dry Run)

```bash
cd anchor
cargo mutants --list --file programs/anchor/src/instructions/yield_draw/reveal_and_pick_winners.rs
```

### C. Run Mutation Testing with JSON Output

```bash
cd anchor
cargo mutants --json --file programs/anchor/src/instructions/yield_draw/harvest_yield_and_commit.rs \
              --test test_harvest_yield_and_commit > mutants_harvest.json
```

---

## 4. Performance Optimization Tips for Solana Anchor

1. **Leverage LiteSVM In-Process Execution:** LiteSVM tests execute in single-digit milliseconds. Ensure tests avoid invoking `solana-test-validator` subprocesses.
2. **Filter by Modified Files:** When auditing PRs, only mutate files modified in `git diff origin/main...HEAD`.
3. **Skip Pure Boilerplate:** Skip Anchor declarative `#[derive(Accounts)]` structs if already checked by Anchor macro tests.
