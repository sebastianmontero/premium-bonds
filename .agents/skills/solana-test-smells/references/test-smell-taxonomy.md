# The 10 Test Smells In-Depth Taxonomy (Solana Anchor & Web3)

This reference document provides an exhaustive breakdown of the 10 diagnostic test smells, their underlying technical causes, detection signals, and architectural risks.

---

### 1. Assertion Roulette

- **What it is:** A test function contains a barrage of multiple assertions (e.g. 5–10 `assert_eq!` or `expect` calls) without failure message explanations.
- **Why it hurts:** When an assertion fails in CI, the log only shows `assertion failed: left == right` at line 84, giving zero domain context on which business rule broke.
- **Detection Signal:** Multiple consecutive `assert_eq!(a, b);` statements lacking the third format string argument `assert_eq!(a, b, "Message")`.

### 2. Implementation-Coupled Test (Whitebox Over-Fitting)

- **What it is:** The test asserts on private struct fields, internal scratchpads, intermediate helper flags, or specific PDA derivation order that are not part of the public domain contract.
- **Why it hurts:** High refactoring friction. If an engineer optimizes account memory layout (e.g. packing booleans into bitflags or changing an array to a ring buffer), tests break despite 100% compliant external behavior.
- **Detection Signal:** Assertions on struct fields prefixed with `_` or checking internal iteration state rather than publicly observable account balances and emitted events.

### 3. Primitive Error Matching

- **What it is:** Asserting `assert!(res.is_err())` or checking for loose substrings (`err.contains("error")`) rather than asserting the exact typed `#[error_code]` enum.
- **Why it hurts:** False positive passes. If the instruction fails for an unexpected reason (e.g., account out of lamports or missing signature) instead of the intended validation guard, the test still passes!
- **Detection Signal:** `assert!(result.is_err())` without checking `AnchorError::ErrorCode` or comparing against numeric error codes.

### 4. Mystery Guest (Hidden / Ambient Fixture)

- **What it is:** The test relies on external state, environment variables, or account data prepared implicitly outside the test function without clear local parameters.
- **Why it hurts:** Non-deterministic execution and high cognitive load; the reader must hunt across helper files to understand what initial state makes the test pass.
- **Detection Signal:** Test functions that accept no context and make assertions against pre-existing global accounts.

### 5. Data Clump Fixture (Setup Blobs)

- **What it is:** Massive 50-line boilerplate account structures repeated across dozens of test files (e.g. setting up 12 dummy keys for CPI accounts).
- **Why it hurts:** Modifying an instruction signature forces tedious updates across all test files (Shotgun Surgery in tests).
- **Detection Signal:** Identical `AccountMeta` array definitions repeated in multiple `test_*.rs` files.

### 6. The Mockingbird (Over-Mocking SVM Internals)

- **What it is:** Heavy use of artificial memory mocks for system programs, token programs, or CPI targets instead of executing inside a realistic in-process SVM sandbox.
- **Why it hurts:** The test tests the mock's behavior, not Solana runtime behavior (e.g. missing rent exemption enforcement or signer privilege propagation).
- **Detection Signal:** Hand-rolled mock structs simulating token mints without SPL Token program binaries.

### 7. Eager / Divergent Test

- **What it is:** A single monolithic test function that walks through the entire protocol lifecycle (Init $\rightarrow$ Deposit $\rightarrow$ Draw $\rightarrow$ Claim $\rightarrow$ Pause $\rightarrow$ Withdraw).
- **Why it hurts:** When the test fails at step 2, steps 3–6 never run. Diagnostic masking obscures subsequent regressions.
- **Detection Signal:** Test functions exceeding 100 lines with multiple sequential state transitions.

### 8. Slot & Clock Illusion

- **What it is:** Manually editing timestamps on deserialized structs instead of manipulating the SVM clock sysvar (`Clock`).
- **Why it hurts:** Program instructions reading `Clock::get()?` continue to see the real SVM slot, causing tests to diverge from real validator execution.
- **Detection Signal:** `pool.last_harvest_timestamp = 100;` without calling `svm.set_sysvar(&Clock { ... })` or `svm.warp_to_slot(...)`.

### 9. Tautological Assertion (Copy-Paste Math)

- **What it is:** The test recalculates the expected value using the exact formula from the production code (e.g. `let expected = (gross * 500) / 10000; assert_eq!(fee, expected);`).
- **Why it hurts:** If the production formula contains an arithmetic bug (e.g. division before multiplication or wrong rounding direction), the test duplicates the bug and asserts it as correct.
- **Detection Signal:** Identical arithmetic equations appearing in both `src/instructions/*.rs` and `tests/test_*.rs`.

### 10. Ignored Error / Conditional Test Logic

- **What it is:** Wrapping assertions inside `if let Ok(...)` or `try/catch` blocks inside test functions.
- **Why it hurts:** If an unexpected error occurs, execution bypasses the `if` block and the test terminates successfully without running assertions.
- **Detection Signal:** `if`, `while`, or `match` blocks wrapping assertion macros inside test bodies.
