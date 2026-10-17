---
name: pr-verify
description: "Audits a pull request against its linked issue specification without moving goalposts, runs targeted deterministic test gates, handles GitHub self-approval restrictions, submits an authoritative PR review with tracking metadata, and merges into dev by default (with graceful fallback if auto-merge is disabled)."
argument-hint: "<pr_or_issue_number> [--max-cycles <N>] [--model <model>] [--not-auto-merge]"
---

# Autonomous PR Verification Skill (`/pr-verify`)

Use this skill to audit an open Pull Request against the closed specification of its linked GitHub issue. It executes targeted test suites, checks acceptance criteria without moving goalposts, submits an authoritative GitHub PR Review with structured tracking metadata (`<!-- ai-pr-verification: ... -->`), and automatically merges into `dev` by default in manual runs.

---

## Key Capabilities

1. **Native GitHub PR Reviews**: Submits authoritative reviews via `gh pr review --approve` or `gh pr review --request-changes`.
2. **Self-Approval & Self-Review Restriction Handling**: If the verifying agent has the same GitHub identity as the PR author, detects the restriction and posts reviews via `gh pr review --comment` for all verdicts (`APPROVED` and `CHANGES_REQUESTED`), bypassing HTTP 422 errors while keeping metadata verdicts authoritative.
3. **Closed-Specification Anti-Goalpost Rule**: Strictly evaluates the PR against the requirements agreed upon in the issue. Explicitly forbids failing verification over unrequested refactorings or stylistic bikeshedding.
4. **Targeted Deterministic Test Gates**: Runs `NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml` only if contract files changed, and `npm test` / linter only if UI/TS files changed.
5. **Effective Cycle & Configurable Breaker**: Respects `--max-cycles N` (default 2), uses `effective_cycle` for human-facing headers, and tracks raw cycles for verification IDs.
6. **Pipeline Mode Integration (D13)**: In pipeline mode, skips all merges and `verified` label edits, delegating merging exclusively to the pipeline reconciler.

---

## Pipeline Mode (D13)

When running inside the autonomous issue pipeline (`[[ -n "${PIPELINE_RUN_ID:-}" ]]`):
- **Lifecycle labels & assignees**: The reconciler owns all lifecycle label transitions (`ready-for-agent`, `in-progress`, `needs-info`, `ready-for-human`, `verified`) and assignees. Skills make **no** edits to these labels or assignees in pipeline mode.
- **Sole merger**: The reconciler is the only merger in pipeline mode (D13). `/pr-verify` skips Step 7 entirely in pipeline mode (no merge and no `verified` label).
- **Self-authored approvals**: In Step 6, the `--comment` review is submitted, but the `verified` label edit is skipped; metadata verdict is the authoritative approval signal.
- **Halts**: Circuit breaker conditions still halt the skill, but without performing label side effects or posting circuit-breaker comments (which the reconciler surfaces via status comments per #23 D11).
- **Markers**: Every comment posted by a skill carries an `<!-- ai-` marker in both modes.
- **Helper exits**: An exit code of 2 from any helper script indicates a GitHub/API failure and must halt the skill immediately.

---

## Step-by-Step Execution Protocol

### Step 1: Resolve PR, Linked Issue & Model Provenance

1. **Parse Input Argument & Optional Flags**:
   - Extract numeric ID from argument: `#25`, `25`, or GitHub PR/Issue URL.
   - Extract optional `--max-cycles <N>` (default 2) and `--not-auto-merge`.
   - Resolve active model slug:
     ```bash
     MODEL="$(bash .agents/scripts/issue_lifecycle_helper.sh --resolve-model ${MODEL_FLAG:-})"
     ```
   - If argument refers to an issue, discover its linked PR:
     ```bash
     if ! PR_NUMBER="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-linked-pr <number>)"; then
       STATUS=$?
       if [[ $STATUS -eq 2 ]]; then
         echo "Error: GitHub API failure while resolving linked PR." >&2
         exit 2
       fi
       echo "Error: No linked PR found for issue <number>." >&2
       exit 1
     fi
     ```
   - If argument is already a PR number, resolve the linked issue:
     ```bash
     ISSUE_NUMBER="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-pr-issue <number>)"
     PR_NUMBER="<number>"
     ```

2. **Parse Current Verification State & Implementing Model**:
   Retrieve existing review cycles, readiness, and implementing model:
   ```bash
   STATE_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --check-revision-readiness "$PR_NUMBER" --max-cycles "${MAX_CYCLES:-2}")"
   STATUS="$(echo "$STATE_JSON" | jq -r .status)"
   CYCLE="$(echo "$STATE_JSON" | jq -r .cycle)"
   EFFECTIVE_CYCLE="$(echo "$STATE_JSON" | jq -r .effective_cycle)"
   IMPL_MODEL="$(echo "$STATE_JSON" | jq -r '.implementing_model // empty')"
   ```
   - If `STATUS == "ALREADY_APPROVED"`: Inform user that PR is already approved.
   - If `STATUS == "AWAITING_REVISION"`: Warn that changes were requested and no new commits have been pushed since.

---

### Step 2: Ingest Closed Specification (Anti-Goalpost Guardrails)

1. **Fetch Issue Body**:
   Fetch issue specification to a per-PR path:
   ```bash
   gh issue view "$ISSUE_NUMBER" --json title,body,labels > /tmp/verify_issue_${PR_NUMBER}_raw.json
   ```

2. **Anti-Goalpost Evaluation Mandate**:
   > [!IMPORTANT]
   > **Strict Closed-Specification Rule**
   > You are auditing strictly against the requirements documented in Issue `#<ISSUE_NUMBER>`.
   > - You MUST NOT invent new requirements or demand architectural overhauls not present in the issue.
   > - You MUST NOT request changes for stylistic preferences, premature micro-optimizations, or out-of-scope features.
   > - If you spot potential future improvements, record them as non-blocking informational notes, but DO NOT block approval.
   > - Mark an acceptance item `VIOLATED` only if the PR demonstrably breaks an issue requirement or violates a repository invariant from `GEMINI.md`.

---

### Step 3: Checkout PR Branch & Targeted Test Gates

1. **Checkout PR Locally**:
   ```bash
   gh pr checkout "$PR_NUMBER"
   ```

2. **Inspect Changed Files**:
   Identify changed files relative to mainline `dev`:
   ```bash
   CHANGED_FILES="$(git diff --name-only origin/dev...HEAD)"
   ```

3. **Execute Targeted Automated Test Gates**:
   - **Smart Contracts (Anchor/Rust)**:
     If `$CHANGED_FILES` includes `anchor/`, `Cargo.toml`, or `Cargo.lock`:
     ```bash
     echo "Running smart contract LiteSVM tests..."
     NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml
     CONTRACT_STATUS="PASSED"
     ```
     *(Record `FAILED` if tests fail)*.
   - **Frontend / Client (Next.js/TypeScript)**:
     If `$CHANGED_FILES` includes `src/`, `package.json`, or TypeScript files:
     ```bash
     echo "Running frontend lint and tests..."
     npm run lint
     npx tsc --noEmit
     npm run test
     FRONTEND_STATUS="PASSED"
     ```
     *(Record `FAILED` if tests or linter fail)*.

---

### Step 4: Audit Acceptance Criteria & Formulate Findings

1. **Evaluate Acceptance Checklist**:
   Audit each item from the issue's requirements:
   - Does the implementation satisfy the requirement? $\rightarrow$ `SATISFIED`
   - Does it violate the requirement? $\rightarrow$ `VIOLATED`, assign `finding_id: "VER-N"`

2. **Evaluate Invariants**:
   - Check error handling, account layout, and CPI safety per `GEMINI.md`.
   - Verify negative test vectors exist in `anchor/tests/` or client tests.

3. **Determine Verdict**:
   - If ALL tests pass and ALL acceptance criteria are satisfied:
     `VERDICT="APPROVED"`
   - If any test fails or any requirement is violated:
     `VERDICT="CHANGES_REQUESTED"`

---

### Step 5: Format Verification Review

1. **Generate Deterministic Verification ID**:
   ```bash
   VERIFICATION_ID="$(bash .agents/scripts/issue_lifecycle_helper.sh --generate-verification-id "$ISSUE_NUMBER" "$PR_NUMBER" "$CYCLE")"
   ```

2. **Format Review Markdown via Helper**:
   Format the review markdown to a per-PR output path passing effective cycle and max cycles:
   ```bash
   COMMIT_SHA="$(git rev-parse HEAD)"
   bash .agents/scripts/issue_lifecycle_helper.sh --format-verification-review \
     --verification-id "$VERIFICATION_ID" \
     --issue "$ISSUE_NUMBER" \
     --pr "$PR_NUMBER" \
     --model "$MODEL" \
     ${IMPL_MODEL:+--implementing-model "$IMPL_MODEL"} \
     --commit-sha "$COMMIT_SHA" \
     --cycle "$CYCLE" \
     --effective-cycle "$EFFECTIVE_CYCLE" \
     --max-cycles "${MAX_CYCLES:-2}" \
     --verdict "$VERDICT" \
     --test-results '<TEST_RESULTS_JSON>' \
     --checklist '<CHECKLIST_JSON>' \
     --findings '<FINDINGS_JSON>' \
     --output-file /tmp/pr_verification_review_${PR_NUMBER}.md
   ```

---

### Step 6: Submit PR Review & Handle Self-Review Restrictions

1. **Check Authenticated User vs PR Author**:
   ```bash
   CURRENT_USER="$(gh api user -q .login)"
   PR_AUTHOR="$(gh pr view "$PR_NUMBER" --json author -q .author.login)"
   ```

2. **Branch A: Verdict is `APPROVED`**:
   - **If `CURRENT_USER != PR_AUTHOR`**:
     Submit standard approving review:
     ```bash
     gh pr review "$PR_NUMBER" --approve --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     ```
   - **If `CURRENT_USER == PR_AUTHOR`** (Self-Approval restriction):
     GitHub blocks `--approve` on one's own PR. Submit as comment review:
     ```bash
     gh pr review "$PR_NUMBER" --comment --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
       gh pr edit "$PR_NUMBER" --add-label "verified"
     fi
     ```
     *(In pipeline mode, the `verified` label edit is skipped; metadata verdict is the sole approval signal).*

3. **Branch B: Verdict is `CHANGES_REQUESTED`**:
   Determine review command (GitHub blocks `--request-changes` on one's own PR):
   ```bash
   if [[ "$CURRENT_USER" == "$PR_AUTHOR" ]]; then
     REVIEW_FLAG="--comment"
   else
     REVIEW_FLAG="--request-changes"
   fi
   ```
   - **If `STATUS != "CIRCUIT_BREAKER_TRIPPED"`**:
     Submit review requesting changes:
     ```bash
     gh pr review "$PR_NUMBER" $REVIEW_FLAG --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     ```
     Instruct user or agent to re-run `/issue-implement #$ISSUE_NUMBER --pr $PR_NUMBER` in Revision Mode.
   - **If `STATUS == "CIRCUIT_BREAKER_TRIPPED"` (Early Circuit Breaker)**:
     Submit review and trip circuit breaker:
     ```bash
     gh pr review "$PR_NUMBER" $REVIEW_FLAG --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
       gh issue edit "$ISSUE_NUMBER" --remove-label "in-progress" --add-label "ready-for-human" --remove-assignee "@me"
       gh pr edit "$PR_NUMBER" --add-label "ready-for-human"
       gh pr comment "$PR_NUMBER" --body "<!-- ai-pipeline-notice: {\"kind\":\"circuit_breaker\"} -->
⚠️ Verification failed after ${MAX_CYCLES:-2} revision cycles. Circuit breaker triggered; escalating to maintainer intervention."
     fi
     ```
     *(In pipeline mode, label and assignee edits and breaker comments are skipped; the reconciler status comment surfaces the breaker per #23 D11).*

---

### Step 7: Finalize Merge or Hold (Manual Mode Only)

In pipeline mode, **Step 7 is skipped entirely**: no merge and no `verified` label edit. The reconciler is the sole deterministic merger in pipeline mode (D13).

```bash
if [[ -n "${PIPELINE_RUN_ID:-}" ]]; then
  echo "Pipeline mode active: skipping merge and label edits (reconciler handles merging)."
  exit 0
fi
```

In manual mode, if `VERDICT == "APPROVED"`:
1. **Default Mode (Auto-Merge)**:
   Unless `--not-auto-merge` was explicitly passed:
   ```bash
   bash .agents/scripts/issue_lifecycle_helper.sh --merge-pr "$PR_NUMBER"
   bash .agents/scripts/issue_lifecycle_helper.sh --close-merged-issue --issue "$ISSUE_NUMBER" --pr "$PR_NUMBER"
   ```
2. **Manual Hold Mode (`--not-auto-merge`)**:
   If `--not-auto-merge` was passed:
   ```bash
   gh pr edit "$PR_NUMBER" --add-label "verified"
   echo "PR #$PR_NUMBER verified and labeled 'verified'. Auto-merge skipped per --not-auto-merge."
   ```

---

## Completion Criteria

1. PR diff audited strictly against closed issue specification without goalpost shifts.
2. Targeted automated test gates executed and recorded with manifest paths.
3. Machine-readable review metadata (`<!-- ai-pr-verification: ... -->`) submitted to GitHub.
4. Self-approval and self-review restrictions handled gracefully via `--comment` reviews.
5. In pipeline mode, all label edits and merge actions are skipped (reconciler-owned).
6. In manual mode, approved PR merged and issue closed via `--close-merged-issue`, or labeled `verified` if hold requested.
