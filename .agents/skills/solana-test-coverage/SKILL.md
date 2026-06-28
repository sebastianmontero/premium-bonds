---
name: solana-test-coverage
description: Trigger this skill when the user asks to "check test coverage", "find uncovered errors", "analyze Solana test coverage", or "run coverage reports". Do NOT use this skill when checking web/frontend test coverage or writing unit tests for non-Solana modules.
user-invocable: true
metadata:
  version: 1.0.0
---

# Solana Test & Error Coverage Playbook

## What this Skill is for

This skill abstracts the process of verifying integration test and error path coverage for the Solana Anchor smart contracts. It enables the developer to quickly locate gaps in error-handling logic (validation guards) and generate line coverage reports.

## Core Stack & Assumptions

- **Smart Contracts**: Anchor framework (Rust) inside the `anchor/` directory.
- **Testing framework**: LiteSVM for integration tests.
- **Test execution**: Prefix CLI commands with `NO_DNA=1` to suppress interactive prompts and guarantee structured outputs.
- **VM Coverage Constraint**: SBF bytecode runs inside the LiteSVM VM, meaning host-based coverage tools (`llvm-cov`) report `0.00%` for instruction handlers. Use static error mapping (`analyze_tests.py`) as the primary proxy for instruction coverage, and reserve `llvm-cov` for host unit tests (like `utils.rs` or `state/pool.rs`).

## Operating Procedure

When verifying Solana contract coverage:

1. Ensure `rustc` has the `llvm-tools-preview` component installed.
2. Run the unified coverage bash script:
   ```bash
   bash .agents/skills/solana-test-coverage/scripts/check_coverage.sh
   ```
3. Review the text summary output to check line coverage for host unit tests.
4. Review the dynamic output of the static error analyzer printed at the end of the script to check for uncovered instruction validation guards.
5. If there are uncovered errors, refer to the testing references to implement appropriate tests.

## Agent Safety Constraints

- **CLI Commands**: When using `run_command` to execute `check_coverage.sh`, always set `SafeToAutoRun` to `false` because it invokes cargo compilation and test execution.

## Progressive Disclosure (Read When Needed)

- [Mocking & Overflows]: Read `references/test_patterns.md` for code snippets on injecting state to mock PDA accounts or trigger `MathOverflow` and status-based errors.
- [Coverage Tooling]: Run `scripts/check_coverage.sh` to generate the HTML report.
- [Static Analyzer]: Run `python3 scripts/analyze_tests.py` to check which specific instruction validation errors are missing test coverage.
