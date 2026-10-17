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
3. **Closed-Specification Anti-Goalpost Rule**: Strictly evaluates the PR against the requirements agreed upon in the issue. Every finding is triaged into exactly one of three classes (spec violation, spec ambiguity, improvement). Any deviation from explicit issue text blocks, however low its risk. Unrequested refactorings and stylistic preferences never block.
4. **Human-Gated Follow-up Issues**: When a PR is approved with non-blocking improvement notes, files them as one follow-up issue labelled `needs-triage` and never `agent:auto`. The pipeline ignores the issue until a maintainer reviews it and opts it in.
5. **Targeted Deterministic Test Gates**: Runs `NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml` only if contract files changed, and `npm test` / linter only if UI/TS files changed.
6. **Effective Cycle & Configurable Breaker**: Respects `--max-cycles N` (revision cycles allowed, default 3; the breaker trips when verification cycle N+1 requests changes), uses `effective_cycle` for human-facing headers, and tracks raw cycles for verification IDs.
7. **Pipeline Mode Integration (D13)**: In pipeline mode, skips all merges and `verified` label edits, delegating merging exclusively to the pipeline reconciler.

---

## Pipeline Mode (D13)

When running inside the autonomous issue pipeline (`[[ -n "${PIPELINE_RUN_ID:-}" ]]`):
- **Lifecycle labels & assignees**: The reconciler owns all lifecycle label transitions (`ready-for-agent`, `in-progress`, `needs-info`, `ready-for-human`, `verified`) and assignees. Skills make **no** edits to these labels or assignees in pipeline mode.
- **Sole merger**: The reconciler is the only merger in pipeline mode (D13). `/pr-verify` skips Step 7 entirely in pipeline mode (no merge and no `verified` label).
- **Self-authored approvals**: In Step 6, the `--comment` review is submitted, but the `verified` label edit is skipped; metadata verdict is the authoritative approval signal.
- **Follow-up issues**: Step 5's follow-up issue is still filed in pipeline mode. It is a new issue labelled only `needs-triage`, which is not one of the lifecycle labels above. No skill ever adds `agent:auto`: opting an issue into the pipeline is reserved for a human.
- **Halts**: Circuit breaker conditions still halt the skill, but without performing label side effects or posting circuit-breaker comments (which the reconciler surfaces via status comments per #23 D11).
- **Markers**: Every comment posted by a skill carries an `<!-- ai-` marker in both modes.
- **Helper exits**: An exit code of 2 from any helper script indicates a GitHub/API failure and must halt the skill immediately.

---

## Step-by-Step Execution Protocol

### Step 1: Resolve PR, Linked Issue & Model Provenance

1. **Parse Input Argument & Optional Flags**:
   - Extract numeric ID from argument: `#25`, `25`, or GitHub PR/Issue URL.
   - Extract optional `--max-cycles <N>` (revision cycles allowed, default 3) and `--not-auto-merge`.
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
   STATE_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --check-revision-readiness "$PR_NUMBER" --max-cycles "${MAX_CYCLES:-3}")"
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
   > - You MUST NOT downgrade a deviation from explicit issue text because its practical risk looks low. Risk only shapes the wording of the finding, never its class.

3. **Finding Triage (exactly one class per finding)**:
   Quote the issue text (section heading plus the sentence) that each finding is judged against. A finding that cannot quote a requirement is never class 1.

   | Class | Test | Outcome |
   |---|---|---|
   | **1. Spec violation** | The PR contradicts explicit issue text (Scope, file list, a numbered or bulleted requirement, `[DEC-N]`, an acceptance criterion), or a repository invariant from `GEMINI.md`. | Blocking. Marks its checklist item `VIOLATED` with a `VER-N` finding. |
   | **2. Spec ambiguity** | The issue is silent, ambiguous or self-contradictory on the point, **and** at least one reasonable reading makes the PR violate an acceptance criterion or invariant. | Blocking, and the fix needs a maintainer decision. It gets a `VER-N` finding whose description starts with `[NEEDS-DECISION]` and quotes the conflicting passages. It is listed under *Maintainer Decisions Needed*, because a revision cannot settle it until the issue is amended. |
   | **3. Improvement** | Every reasonable reading of the issue is satisfied, and the point is about robustness beyond the spec, error messages, naming, docs polish or future-proofing. | Non-blocking note. On an `APPROVED` verdict it goes into the human-gated follow-up issue (Step 5). |

   If the issue is ambiguous but every reasonable reading is satisfied, the finding is class 3, not class 2.

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
   Audit each item from the issue's requirements, including the requirements stated in the body sections and not only the *Acceptance criteria* list:
   - Does the implementation satisfy the requirement? $\rightarrow$ `SATISFIED`
   - Is there a class 1 or class 2 finding against it (Step 2)? $\rightarrow$ `VIOLATED`, assign `finding_id: "VER-N"`

2. **Evaluate Invariants**:
   - Check error handling, account layout, and CPI safety per `GEMINI.md`.
   - Verify negative test vectors exist in `anchor/tests/` or client tests.

3. **Re-triage Carried-over Notes**:
   On a re-verification, re-classify every note from previous verification reports from scratch against the current issue text. The issue may have been amended since. A note is never kept as non-blocking just because an earlier cycle classified it that way.

4. **Determine Verdict**:
   - If ALL tests pass and there are no class 1 or class 2 findings:
     `VERDICT="APPROVED"`
   - If any test fails, or there is any class 1 or class 2 finding:
     `VERDICT="CHANGES_REQUESTED"`
   - Class 3 notes never affect the verdict.

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
     --max-cycles "${MAX_CYCLES:-3}" \
     --verdict "$VERDICT" \
     --test-results '<TEST_RESULTS_JSON>' \
     --checklist '<CHECKLIST_JSON>' \
     --findings '<FINDINGS_JSON>' \
     --output-file /tmp/pr_verification_review_${PR_NUMBER}.md
   ```

3. **File the Human-Gated Follow-up Issue (`APPROVED` with class 3 notes only)**:
   Skip this sub-step when the verdict is `CHANGES_REQUESTED`: the notes stay in the review and are re-triaged next cycle (Step 4.3). Also skip it when there are no class 3 notes. The issue is filed in both manual and pipeline mode.

   a. **Idempotency**: reuse an existing follow-up for this PR instead of filing a second one:
      ```bash
      FOLLOWUP_MARKER="<!-- ai-pr-followup: {\"pr\": ${PR_NUMBER},"
      if ! EXISTING_JSON="$(gh issue list --state all --search "\"PR #${PR_NUMBER}\" in:title" --limit 50 --json number,body)"; then
        echo "Error: GitHub API failure while checking for a follow-up issue." >&2
        exit 2
      fi
      FOLLOWUP_ISSUE="$(echo "$EXISTING_JSON" | jq -r --arg m "$FOLLOWUP_MARKER" '[.[] | select(.body | contains($m))][0].number // empty')"
      ```
   b. **Write the body** to `/tmp/pr_followup_${PR_NUMBER}.md` (only when `FOLLOWUP_ISSUE` is empty). Write it as a self-contained spec, so it can go through `/issue-review` or `/issue-implement` unchanged once a human opts it in:
      ```markdown
      > [!IMPORTANT]
      > **Human review required before pipeline intake.** Filed by `/pr-verify` from verification `<VERIFICATION_ID>` of PR #<PR_NUMBER> (issue #<ISSUE_NUMBER>). These notes did not block that PR. The pipeline ignores this issue until a maintainer reviews it and adds `agent:auto`.

      ## Context
      <One paragraph: what #<ISSUE_NUMBER> / PR #<PR_NUMBER> delivered, and why these points were judged improvements rather than spec violations.>

      ## Scope
      ### NOTE-1: <short title>
      - **Where:** `<path>:<line>`
      - **Observation:** <what the code does today>
      - **Why non-blocking:** <the issue text it was judged against, and why every reading of it is satisfied>
      - **Suggested change:** <concrete change, including the test that proves it>

      ## Acceptance criteria
      - [ ] NOTE-1: <verifiable outcome>
      - [ ] The targeted test gates for the touched files pass.

      ## Maintainer review checklist
      - [ ] Delete any note that is not worth doing; edit the rest as needed.
      - [ ] Scope and acceptance criteria are complete.
      - [ ] Opt in: add `agent:auto` (plus `agent:skip-review` if no AI spec-review rounds are needed), or label `ready-for-agent` for a manual `/issue-implement`.

      <!-- ai-pr-followup: {"pr": <PR_NUMBER>, "issue": <ISSUE_NUMBER>, "verification_id": "<VERIFICATION_ID>"} -->
      ```
   c. **Create it**, labelled `needs-triage` only. Never add `agent:auto`, `agent:skip-review` or `ready-for-agent`, and assign nobody:
      ```bash
      if [[ -z "$FOLLOWUP_ISSUE" ]]; then
        if ! FOLLOWUP_URL="$(gh issue create \
            --title "Follow-up: non-blocking notes from PR #${PR_NUMBER} verification (#${ISSUE_NUMBER})" \
            --label "needs-triage" \
            --body-file /tmp/pr_followup_${PR_NUMBER}.md)"; then
          echo "Error: GitHub API failure while creating the follow-up issue." >&2
          exit 2
        fi
        FOLLOWUP_ISSUE="${FOLLOWUP_URL##*/}"
      fi
      ```

4. **Append Review Sections**:
   Insert these sections, when non-empty, into `/tmp/pr_verification_review_${PR_NUMBER}.md` immediately before the closing `---` footer line written by the helper:
   - `### ✅ Resolved Since Cycle <N>`: on re-verification, the previous findings that are now fixed, one line each.
   - `### ⚠️ Maintainer Decisions Needed`: every class 2 finding, with the conflicting issue passages and the options.
   - `### ℹ️ Non-blocking Notes`: every class 3 note, one line each. On `APPROVED`, the first line is `Filed as #${FOLLOWUP_ISSUE} for maintainer review; the pipeline ignores it until a maintainer adds \`agent:auto\`.`

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
   - **If `(( EFFECTIVE_CYCLE <= ${MAX_CYCLES:-3} ))`** (a revision is still allowed):
     Submit review requesting changes:
     ```bash
     gh pr review "$PR_NUMBER" $REVIEW_FLAG --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     ```
     Instruct user or agent to re-run `/issue-implement #$ISSUE_NUMBER --pr $PR_NUMBER` in Revision Mode.
   - **If `(( EFFECTIVE_CYCLE > ${MAX_CYCLES:-3} ))` (Circuit Breaker: all revisions used)**:
     Submit review and trip circuit breaker:
     ```bash
     gh pr review "$PR_NUMBER" $REVIEW_FLAG --body-file /tmp/pr_verification_review_${PR_NUMBER}.md
     if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
       gh issue edit "$ISSUE_NUMBER" --remove-label "in-progress" --add-label "ready-for-human" --remove-assignee "@me"
       gh pr edit "$PR_NUMBER" --add-label "ready-for-human"
       gh pr comment "$PR_NUMBER" --body "<!-- ai-pipeline-notice: {\"kind\":\"circuit_breaker\"} -->
⚠️ Verification failed after ${MAX_CYCLES:-3} revision cycles. Circuit breaker triggered; escalating to maintainer intervention."
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

1. PR diff audited strictly against closed issue specification without goalpost shifts. Every finding is triaged into exactly one class (spec violation, spec ambiguity, improvement), and carried-over notes are re-triaged each cycle.
2. On an `APPROVED` verdict with class 3 notes, exactly one follow-up issue per PR exists, labelled `needs-triage` and never `agent:auto`, and the review links it.
3. Targeted automated test gates executed and recorded with manifest paths.
4. Machine-readable review metadata (`<!-- ai-pr-verification: ... -->`) submitted to GitHub.
5. Self-approval and self-review restrictions handled gracefully via `--comment` reviews.
6. In pipeline mode, all lifecycle label edits and merge actions are skipped (reconciler-owned).
7. In manual mode, approved PR merged and issue closed via `--close-merged-issue`, or labeled `verified` if hold requested.
