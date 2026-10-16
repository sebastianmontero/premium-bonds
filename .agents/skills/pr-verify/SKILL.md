---
name: pr-verify
description: "Audits a pull request against its linked issue specification without moving goalposts, runs targeted deterministic test gates, handles GitHub self-approval restrictions, submits an authoritative PR review with tracking metadata, and merges into dev by default (with graceful fallback if auto-merge is disabled)."
argument-hint: "<pr_or_issue_number> [--not-auto-merge]"
---

# Autonomous PR Verification Skill (`/pr-verify`)

Use this skill to audit an open Pull Request against the closed specification of its linked GitHub issue. It executes targeted test suites, checks acceptance criteria without moving goalposts, submits an authoritative GitHub PR Review with structured tracking metadata (`<!-- ai-pr-verification: ... -->`), and automatically merges into `dev` by default.

---

## Key Capabilities

1. **Native GitHub PR Reviews**: Submits authoritative reviews via `gh pr review --approve` or `gh pr review --request-changes`.
2. **Self-Approval Restriction Handling**: If the verifying agent/developer has the same GitHub identity as the PR author, detects the restriction and posts the review via `gh pr review --comment` with `APPROVED` verdict and `verified` label, bypassing HTTP 422 errors.
3. **Closed-Specification Anti-Goalpost Rule**: Strictly evaluates the PR against the requirements agreed upon in the issue. Explicitly forbids failing verification over unrequested refactorings or stylistic bikeshedding.
4. **Targeted Deterministic Test Gates**: Runs `NO_DNA=1 cargo test` in `/anchor` only if contract files changed, and `npm test` / linter only if UI/TS files changed.
5. **Early Circuit Breaker**: If verification fails on Cycle 2, directly trips the circuit breaker: unassigns the agent, applies `ready-for-human`, and requests maintainer intervention.
6. **Resilient Auto-Merge Engine**: Merges approved PRs via `gh pr merge --squash --delete-branch --auto`, automatically falling back to immediate squash merge if repository auto-merge is disabled.

---

## Step-by-Step Execution Protocol

### Step 1: Resolve PR & Linked Issue

1. **Parse Input Argument**:
   - Extract numeric ID from argument: `#25`, `25`, or GitHub PR/Issue URL.
   - If argument refers to an issue, discover its linked PR:
     ```bash
     PR_NUMBER="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-linked-pr <number>)"
     ```
   - If argument is already a PR number, resolve the linked issue:
     ```bash
     ISSUE_NUMBER="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-pr-issue <number>)"
     PR_NUMBER="<number>"
     ```

2. **Parse Current Verification State**:
   Retrieve existing review cycles and readiness:
   ```bash
   STATE_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --check-revision-readiness "$PR_NUMBER")"
   STATUS="$(echo "$STATE_JSON" | jq -r .status)"
   CYCLE="$(echo "$STATE_JSON" | jq -r .cycle)"
   ```
   - If `STATUS == "ALREADY_APPROVED"`: Inform user that PR is already approved.
   - If `STATUS == "AWAITING_REVISION"`: Warn that changes were requested and no new commits have been pushed since.

---

### Step 2: Ingest Closed Specification (Anti-Goalpost Guardrails)

1. **Fetch Issue Body**:
   ```bash
   gh issue view "$ISSUE_NUMBER" --json title,body,labels > /tmp/verify_issue_raw.json
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
     (cd anchor && NO_DNA=1 cargo test)
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
   - Check error handling, account reallocation, and CPI safety per `GEMINI.md`.
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
   ```bash
   COMMIT_SHA="$(git rev-parse HEAD)"
   bash .agents/scripts/issue_lifecycle_helper.sh --format-verification-review \
     --verification-id "$VERIFICATION_ID" \
     --issue "$ISSUE_NUMBER" \
     --pr "$PR_NUMBER" \
     --commit-sha "$COMMIT_SHA" \
     --cycle "$CYCLE" \
     --verdict "$VERDICT" \
     --test-results '<TEST_RESULTS_JSON>' \
     --checklist '<CHECKLIST_JSON>' \
     --findings '<FINDINGS_JSON>' \
     --output-file /tmp/pr_verification_review.md
   ```

---

### Step 6: Submit PR Review & Handle Self-Approval Restrictions

1. **Check Authenticated User vs PR Author**:
   ```bash
   CURRENT_USER="$(gh api user -q .login)"
   PR_AUTHOR="$(gh pr view "$PR_NUMBER" --json author -q .author.login)"
   ```

2. **Branch A: Verdict is `APPROVED`**:
   - **If `CURRENT_USER != PR_AUTHOR`**:
     Submit standard approving review:
     ```bash
     gh pr review "$PR_NUMBER" --approve --body-file /tmp/pr_verification_review.md
     ```
   - **If `CURRENT_USER == PR_AUTHOR`** (Self-Approval restriction):
     GitHub blocks `--approve` on one's own PR. Submit as comment review, embed approval, and apply `verified` label:
     ```bash
     gh pr review "$PR_NUMBER" --comment --body-file /tmp/pr_verification_review.md
     gh pr edit "$PR_NUMBER" --add-label "verified"
     ```

3. **Branch B: Verdict is `CHANGES_REQUESTED`**:
   - **If `CYCLE < 2`**:
     Submit review requesting changes:
     ```bash
     gh pr review "$PR_NUMBER" --request-changes --body-file /tmp/pr_verification_review.md
     ```
     Instruct user or agent to re-run `/issue-implement #$ISSUE_NUMBER` in Revision Mode.
   - **If `CYCLE >= 2` (Early Circuit Breaker)**:
     Submit review and trip circuit breaker immediately:
     ```bash
     gh pr review "$PR_NUMBER" --request-changes --body-file /tmp/pr_verification_review.md
     gh issue edit "$ISSUE_NUMBER" --remove-label "in-progress" --add-label "ready-for-human" --remove-assignee "@me"
     gh pr edit "$PR_NUMBER" --add-label "ready-for-human"
     gh pr comment "$PR_NUMBER" --body "⚠️ Verification failed after 2 revision cycles. Circuit breaker triggered; escalating to maintainer intervention."
     ```

---

### Step 7: Finalize Merge or Hold

If `VERDICT == "APPROVED"`:
1. **Default Mode (Auto-Merge)**:
   Unless `--not-auto-merge` was explicitly passed:
   ```bash
   bash .agents/scripts/issue_lifecycle_helper.sh --merge-pr "$PR_NUMBER"
   ```
   GitHub's merge engine merges the PR into `dev` and automatically closes Issue `#$ISSUE_NUMBER`.
2. **Manual Hold Mode (`--not-auto-merge`)**:
   If `--not-auto-merge` was passed:
   ```bash
   gh pr edit "$PR_NUMBER" --add-label "verified"
   echo "PR #$PR_NUMBER verified and labeled 'verified'. Auto-merge skipped per --not-auto-merge."
   ```

---

## Completion Criteria

1. PR diff audited strictly against closed issue specification.
2. Targeted automated test gates executed and recorded.
3. Machine-readable review metadata (`<!-- ai-pr-verification: ... -->`) submitted to GitHub.
4. Self-approval restriction gracefully handled without API errors.
5. If changes requested, cycle limit tracked; if cycle $\ge$ 2, circuit breaker tripped.
6. If approved, PR merged automatically (default) or labeled `verified` (if `--not-auto-merge`).
