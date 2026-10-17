---
name: issue-implement
description: "Autonomously claims a fully specified issue (ready-for-agent), implements code and tests against the closed issue specification, runs targeted local test gates, commits, and opens a PR into dev linked via 'Closes #<id>'. Also features an idempotent Revision Mode to resolve verification findings on an existing PR."
argument-hint: "<issue_number_or_url> [--pr <pr_number>] [--max-cycles <N>] [--model <model>] [--dry-run]"
---

# Autonomous Issue Implementation Skill (`/issue-implement`)

Use this skill to implement features and bug fixes specified in a GitHub issue that has completed specification review and integration (`ready-for-agent`).

The skill operates in one of two modes:
1. **Greenfield Mode** (no PR exists yet): Claims the issue, creates a topic branch off `origin/dev`, implements requirements, runs targeted test gates, and opens a PR targeting `dev`.
2. **Revision Mode** (open PR already exists with `CHANGES_REQUESTED`): Checks out the PR branch, parses verification findings, enforces idempotency and circuit breaker limits, applies targeted fixes and maintainer guidance, and pushes revision commits.

---

## Key Capabilities

1. **Dual-Mode Re-entrancy & Explicit PR Routing**: Seamlessly handles both new implementations and iterative remediation of PR verification findings via `--pr <pr_number>` or automatic PR discovery.
2. **Deterministic Branch & Commit Naming**: Enforces `feat/issue-<id>-<slug>` topic branches and clean commit messages linking `Closes #<id>`.
3. **Targeted Verification Gate**: Only runs Anchor/Rust tests (`NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml`) if contract files were modified, and TypeScript/linter tests if frontend files were modified, eliminating unnecessary test latency per `GEMINI.md`.
4. **Idempotency & Race Protection**: Checks commit timestamps against review submission timestamps to prevent duplicate revision runs.
5. **Configurable Circuit Breaker Enforcement**: Respects `--max-cycles N` (default 2) and cycle resets via `issue_lifecycle_helper.sh --check-revision-readiness`.
6. **Maintainer Guidance Ingestion**: Extracts human guidance comments on PRs using a strict author and timestamp filter, allowing maintainer instructions to override verification findings.

---

## Pipeline Mode (D13)

When running inside the autonomous issue pipeline (`[[ -n "${PIPELINE_RUN_ID:-}" ]]`):
- **Lifecycle labels & assignees**: The reconciler owns all lifecycle label transitions (`ready-for-agent`, `in-progress`, `needs-info`, `ready-for-human`, `verified`) and assignees. Skills make **no** edits to these labels or assignees in pipeline mode.
- **Preconditions**: In greenfield mode, the `ready-for-agent` label check and claim edits are skipped because the reconciler has already claimed the issue with `in-progress`.
- **Halts**: Circuit breaker conditions still halt the skill, but without performing label side effects or posting circuit-breaker comments (which the reconciler surfaces via status comments per #23 D11).
- **Markers**: Every comment posted by a skill carries an `<!-- ai-` marker in both modes.
- **Helper exits**: An exit code of 2 from any helper script indicates a GitHub/API failure and must halt the skill immediately.

---

## Human Guidance Comments

In Revision Mode, human-input comments posted on the PR after the latest verification provide authoritative maintainer guidance that takes precedence over reported `VER-N` findings when they conflict:
- **Fetch**: `gh pr view "$LINKED_PR" --json comments`.
- **Trusted author**: `TRUSTED="${GH_TRUSTED_AUTHOR:-$(gh api user -q .login)}"`.
- **Machine comment**: `author.login == $TRUSTED` **and** the body matches `<!--\s*ai-`. These are never guidance.
- **Human input**: not a machine comment **and** (`author.login == $TRUSTED` **or** `authorAssociation ∈ {OWNER, MEMBER, COLLABORATOR}`). A missing or unknown `authorAssociation` from any other author is not guidance (fail closed).
- **Cutoff**: `CUTOFF="$(echo "$VERIFY_JSON" | jq -r .latest_review_submitted_at)"` from `--parse-verification`. Only human-input comments with `createdAt` strictly after `CUTOFF` count.
- **Reference `jq` Filter**:
  ```bash
  jq --arg trusted "$TRUSTED" --arg after "$CUTOFF" '[.comments[]
    | select(.createdAt > $after)
    | select(((.author.login == $trusted) and ((.body // "") | test("<!--\\s*ai-"))) | not)
    | select(.author.login == $trusted or (.authorAssociation | IN("OWNER","MEMBER","COLLABORATOR")))]'
  ```
- Guidance comments are applied in chronological order; on conflict, the latest comment wins.

---

## Step-by-Step Execution Protocol

### Step 1: Parse Issue, Resolve Model & Detect Execution Mode

1. **Parse Target Issue Number & Flags**:
   - Extract numeric ID from argument: `#42`, `42`, or `https://github.com/<owner>/<repo>/issues/42` $\rightarrow$ `42`.
   - If omitted, prompt the user for the target issue number.
   - Extract optional `--pr <pr_number>` and `--max-cycles <N>` (default 2).
   - Resolve active model slug:
     ```bash
     MODEL="$(bash .agents/scripts/issue_lifecycle_helper.sh --resolve-model ${MODEL_FLAG:-})"
     ```

2. **Route Execution Mode**:
   - **Explicit `--pr <pr_number>` provided**:
     Verify that the PR is open:
     ```bash
     PR_STATE="$(gh pr view "$EXPLICIT_PR" --json state -q .state)"
     if [[ "$PR_STATE" != "OPEN" ]]; then
       echo "Error: PR #$EXPLICIT_PR is not open (state: $PR_STATE). Halting." >&2
       exit 1
     fi
     LINKED_PR="$EXPLICIT_PR"
     ```
     Proceed directly to **Branch B: Revision Mode**.
   - **In Pipeline Mode without `--pr`**:
     Proceed directly to **Branch A: Greenfield Mode** (no auto-detection).
   - **In Manual Mode without `--pr`**:
     Run the lifecycle helper to discover if an open PR exists:
     ```bash
     if ! LINKED_PR="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-linked-pr <issue_number> 2>/dev/null)"; then
       STATUS=$?
       if [[ $STATUS -eq 2 ]]; then
         echo "Error: GitHub API failure while checking for linked PR." >&2
         exit 2
       fi
       LINKED_PR=""
     fi
     ```
     - If `LINKED_PR` is non-empty: Proceed to **Branch B: Revision Mode**.
     - If `LINKED_PR` is empty: Proceed to **Branch A: Greenfield Mode**.

---

### Step 2, Branch A: Greenfield Implementation Mode

1. **Verify Issue Readiness & Clean Tree**:
   - In manual mode, verify the issue contains `ready-for-agent`:
     ```bash
     if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
       IS_READY="$(gh issue view <issue_number> --json labels -q '[.labels[].name] | index("ready-for-agent") != null')"
       if [[ "$IS_READY" != "true" ]]; then
         echo "Error: Issue <issue_number> is not labeled 'ready-for-agent'. Run /issue-review and /issue-integrate-review first." >&2
         exit 1
       fi
     fi
     ```
     *(In pipeline mode, this label check is skipped because the reconciler has already claimed the issue).*
   - Verify working directory has no uncommitted changes:
     ```bash
     if [[ -n "$(git status --porcelain)" ]]; then
       echo "Error: Working directory has uncommitted changes. Please commit or stash before proceeding." >&2
       exit 1
     fi
     ```

2. **Claim Issue & Transition Label (Manual Mode Only)**:
   In manual mode, assign to current user and apply `in-progress`:
   ```bash
   if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
     gh issue edit <issue_number> --add-assignee "@me" --remove-label "ready-for-agent" --add-label "in-progress"
   fi
   ```
   *(In pipeline mode per D13, label and assignee edits are skipped; the reconciler claims the issue).*

3. **Create Topic Branch**:
   - Fetch latest `origin/dev`:
     ```bash
     git fetch origin dev
     ```
   - Generate topic branch name from issue title:
     ```bash
     SLUG="$(echo "<title>" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-|-$//g' | cut -c1-35)"
     BRANCH="feat/issue-<issue_number>-${SLUG}"
     ```
   - Retry-safe checkout without force pushes:
     ```bash
     git checkout --ignore-other-worktrees -B "$BRANCH" origin/dev
     ```

4. **Closed-Specification Implementation**:
   - Read the issue body as the **Closed Invariant Specification**:
     - Implement only what was agreed upon in the issue.
     - Follow protocol rules in `GEMINI.md`: no backwards compatibility shims in pre-production; add new fields directly to accounts; keep `_reserved` buffers intact; use framework-kit for client code.
     - Add comprehensive test coverage matching the acceptance checklist.

5. **Execute Targeted Local Test Gates**:
   - Inspect modified files to determine which test suites to run:
     ```bash
     MODIFIED="$(git status --porcelain)"
     ```
   - **Smart Contract (Anchor/Rust)**: If any files in `anchor/`, `Cargo.toml`, or `Cargo.lock` were modified:
     ```bash
     NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml
     ```
   - **Frontend / Client (TypeScript/Next.js)**: If any files in `src/`, `package.json`, or TypeScript files were modified:
     ```bash
     npm run lint
     npx tsc --noEmit
     npm run test
     ```

6. **Commit & Push**:
   - Stage and commit changes with model trailer:
     ```bash
     git add -A
     git commit -m "feat(<scope>): <short_summary> (Closes #<issue_number>)" --trailer "AI-Model: $MODEL"
     ```
   - Push topic branch:
     ```bash
     git push -u origin "$BRANCH"
     ```

7. **Open Pull Request Targeting `dev`**:
   - Open PR linked to the issue with embedded metadata and trailer:
     ```bash
     gh pr create \
       --base dev \
       --title "feat(<scope>): <short_summary> (Closes #<issue_number>)" \
       --body "<!-- ai-issue-implement: {\"version\":\"1.0\",\"issue_number\":<issue_number>,\"model\":\"$MODEL\"} -->
Closes #<issue_number>. Implements closed specification from issue.

AI-Model: $MODEL"
     ```

8. **Notify Developer**:
   - Output summary with PR URL and advise running `/pr-verify <pr_number>`.

---

### Step 2, Branch B: Revision Mode (Remediating PR Findings)

1. **Inspect Readiness & Circuit Breaker**:
   - Check status and cycle count using the helper script with `--max-cycles`:
     ```bash
     READINESS_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --check-revision-readiness "$LINKED_PR" --max-cycles "${MAX_CYCLES:-2}")"
     STATUS="$(echo "$READINESS_JSON" | jq -r .status)"
     CYCLE="$(echo "$READINESS_JSON" | jq -r .cycle)"
     ```
   - **If `STATUS == "CIRCUIT_BREAKER_TRIPPED"`**:
     Halt immediately:
     ```bash
     echo "Circuit breaker tripped: PR #$LINKED_PR has reached the revision limit." >&2
     if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
       gh issue edit <issue_number> --remove-label "in-progress" --add-label "ready-for-human" --remove-assignee "@me"
       gh pr edit "$LINKED_PR" --add-label "ready-for-human"
       gh pr comment "$LINKED_PR" --body "<!-- ai-pipeline-notice: {\"kind\":\"circuit_breaker\"} -->
⚠️ Automated revision limit reached (${MAX_CYCLES:-2} cycles). Escalating to maintainer intervention."
     fi
     exit 1
     ```
     *(In pipeline mode, the circuit breaker comment and label edits are skipped; the reconciler status comment surfaces the breaker per #23 D11).*
   - **If `STATUS == "READY_FOR_RE_VERIFICATION"`**:
     Halt with notice:
     ```bash
     echo "PR #$LINKED_PR already has new revisions committed. Awaiting /pr-verify cycle $CYCLE."
     exit 0
     ```

2. **Checkout PR Branch & Sync**:
   - Checkout the PR branch:
     ```bash
     gh pr checkout "$LINKED_PR"
     ```
   - Merge latest `origin/dev` to prevent drift:
     ```bash
     git fetch origin dev
     git merge origin/dev --no-edit
     ```

3. **Ingest Verification Findings & Human Guidance**:
   - Parse findings from the latest review:
     ```bash
     VERIFY_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --parse-verification "$LINKED_PR")"
     ```
   - Extract finding IDs and suggested fixes from `.findings[]`.
   - Ingest human guidance comments posted after the latest review:
     ```bash
     TRUSTED="${GH_TRUSTED_AUTHOR:-$(gh api user -q .login)}"
     CUTOFF="$(echo "$VERIFY_JSON" | jq -r .latest_review_submitted_at)"
     PR_COMMENTS="$(gh pr view "$LINKED_PR" --json comments)"
     GUIDANCE="$(jq --arg trusted "$TRUSTED" --arg after "$CUTOFF" '[.comments[]
       | select(.createdAt > $after)
       | select(((.author.login == $trusted) and ((.body // "") | test("<!--\\s*ai-"))) | not)
       | select(.author.login == $trusted or (.authorAssociation | IN("OWNER","MEMBER","COLLABORATOR")))]' <<< "$PR_COMMENTS")"
     ```
   - Maintainer guidance takes precedence over `VER-N` findings when they conflict.

4. **Apply Targeted Remediations**:
   - Resolve each specific verification finding (`VER-1`, `VER-2`) and maintainer guidance item.
   - Do NOT introduce unrequested architectural changes outside the reported findings.

5. **Re-Execute Targeted Test Gates**:
   - Run relevant test suites matching modified files:
     - Anchor/Rust: `NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml`
     - Frontend: `npm run lint && npx tsc --noEmit && npm run test`

6. **Commit & Push Revision**:
   - Stage and commit with explicit finding references and model trailer:
     ```bash
     git add -A
     git commit -m "fix(issue-<issue_number>): address verification findings [VER-1]" --trailer "AI-Model: $MODEL"
     git push origin HEAD
     ```

7. **Notify on PR**:
   - Post comment carrying machine notice marker on the PR informing maintainers that revision is complete:
     ```bash
     gh pr comment "$LINKED_PR" --body "<!-- ai-pipeline-notice: {\"kind\":\"revision_ready\",\"cycle\":$CYCLE} -->
✅ Revision commits pushed by \`$MODEL\` to address verification findings. Ready for \`/pr-verify $LINKED_PR\`."
     ```

---

## Completion Criteria

1. In Greenfield Mode:
   - Branch created off updated `origin/dev` via retry-safe checkout.
   - Code and tests implemented according to issue specification.
   - Local test gates verified with manifest paths.
   - PR opened into `dev` containing `Closes #<id>` and model trailer.
   - In manual mode, issue labeled `in-progress` and assigned to `@me`.
2. In Revision Mode:
   - Idempotency and circuit breaker rules enforced via helper without raw cycle checks.
   - Targeted fixes applied for reported findings and PR maintainer guidance.
   - Fix commit pushed to PR branch.
   - Notification carrying `<!-- ai-pipeline-notice: {"kind":"revision_ready", ...} -->` posted on PR.
