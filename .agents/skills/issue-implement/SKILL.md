---
name: issue-implement
description: "Autonomously claims a fully specified issue (ready-for-agent), implements code and tests against the closed issue specification, runs targeted local test gates, commits, and opens a PR into dev linked via 'Closes #<id>'. Also features an idempotent Revision Mode to resolve verification findings on an existing PR."
argument-hint: "<issue_number_or_url> [--dry-run]"
---

# Autonomous Issue Implementation Skill (`/issue-implement`)

Use this skill to implement features and bug fixes specified in a GitHub issue that has completed specification review and integration (`ready-for-agent`).

The skill operates in one of two modes:
1. **Greenfield Mode** (no PR exists yet): Claims the issue, creates a topic branch off `origin/dev`, implements requirements, runs targeted test gates, and opens a PR targeting `dev`.
2. **Revision Mode** (open PR already exists with `CHANGES_REQUESTED`): Checks out the PR branch, parses verification findings, enforces idempotency and circuit breaker limits, applies targeted fixes, and pushes revision commits.

---

## Key Capabilities

1. **Dual-Mode Re-entrancy**: Seamlessly handles both new implementations and iterative remediation of PR verification findings using a single command.
2. **Deterministic Branch & Commit Naming**: Enforces `feat/issue-<id>-<slug>` topic branches and clean commit messages linking `Closes #<id>`.
3. **Targeted Verification Gate**: Only runs Anchor/Rust tests if contract files were modified, and TypeScript/linter tests if frontend files were modified, eliminating unnecessary test latency per `GEMINI.md`.
4. **Idempotency & Race Protection**: Checks commit timestamps against review submission timestamps to prevent duplicate revision runs.
5. **Circuit Breaker Enforcement**: Enforces a strict 2-cycle revision ceiling before escalating to `ready-for-human`.

---

## Step-by-Step Execution Protocol

### Step 1: Parse Issue & Detect Execution Mode

1. **Parse Target Issue Number**:
   - Extract numeric ID from argument: `#42`, `42`, or `https://github.com/<owner>/<repo>/issues/42` $\rightarrow$ `42`.
   - If omitted, prompt the user for the target issue number.

2. **Check for Linked Open PR**:
   Run the lifecycle helper to discover if an open PR already exists for this issue:
   ```bash
   LINKED_PR="$(bash .agents/scripts/issue_lifecycle_helper.sh --get-linked-pr <issue_number> 2>/dev/null || true)"
   ```

3. **Route Execution**:
   - If `LINKED_PR` is non-empty: Proceed to **Branch B: Revision Mode**.
   - If `LINKED_PR` is empty: Proceed to **Branch A: Greenfield Mode**.

---

### Step 2, Branch A: Greenfield Implementation Mode

1. **Verify Issue Readiness & Clean Tree**:
   - Inspect issue labels using `gh issue view <issue_number> --json labels,title,body`.
   - Verify the issue contains the `ready-for-agent` label. If missing (e.g. `needs-triage`), halt and instruct user to run `/issue-review` and `/issue-integrate-review` first.
   - Verify working directory has no uncommitted changes:
     ```bash
     if [[ -n "$(git status --porcelain)" ]]; then
       echo "Error: Working directory has uncommitted changes. Please commit or stash before proceeding."
       exit 1
     fi
     ```

2. **Claim Issue & Transition Label**:
   - Assign to current user/agent and apply `in-progress`:
     ```bash
     gh issue edit <issue_number> --add-assignee "@me" --remove-label "ready-for-agent" --add-label "in-progress"
     ```

3. **Create Topic Branch**:
   - Fetch latest `origin/dev`:
     ```bash
     git fetch origin dev
     ```
   - Generate topic branch name from issue title:
     ```bash
     # Example: feat/issue-14-enforce-minimum-position
     SLUG="$(echo "<title>" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-|-$//g' | cut -c1-35)"
     BRANCH="feat/issue-<issue_number>-${SLUG}"
     git checkout -b "$BRANCH" origin/dev
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
     (cd anchor && NO_DNA=1 cargo test)
     ```
   - **Frontend / Client (TypeScript/Next.js)**: If any files in `src/`, `package.json`, or TypeScript files were modified:
     ```bash
     npm run lint
     npx tsc --noEmit
     npm run test
     ```

6. **Commit & Push**:
   - Stage and commit changes:
     ```bash
     git add -A
     git commit -m "feat(<scope>): <short_summary> (Closes #<issue_number>)"
     ```
   - Push topic branch:
     ```bash
     git push -u origin "$BRANCH"
     ```

7. **Open Pull Request Targeting `dev`**:
   - Open PR linked to the issue:
     ```bash
     gh pr create \
       --base dev \
       --title "feat(<scope>): <short_summary> (Closes #<issue_number>)" \
       --body "Closes #<issue_number>. Implements closed specification from issue."
     ```

8. **Notify Developer**:
   - Output summary with PR URL and advise running `/pr-verify <pr_number>`.

---

### Step 2, Branch B: Revision Mode (Remediating PR Findings)

1. **Inspect Readiness & Circuit Breaker**:
   - Check status and cycle count using the helper script:
     ```bash
     READINESS_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --check-revision-readiness "$LINKED_PR")"
     STATUS="$(echo "$READINESS_JSON" | jq -r .status)"
     CYCLE="$(echo "$READINESS_JSON" | jq -r .cycle)"
     ```
   - **If `status == "CIRCUIT_BREAKER_TRIPPED"` or `CYCLE >= 2` and no new commits:**
     Halt immediately:
     ```bash
     echo "Circuit breaker tripped: PR #$LINKED_PR has reached the 2-cycle revision limit."
     gh issue edit <issue_number> --remove-label "in-progress" --add-label "ready-for-human" --remove-assignee "@me"
     gh pr edit "$LINKED_PR" --add-label "ready-for-human"
     gh pr comment "$LINKED_PR" --body "⚠️ Automated revision limit reached (2 cycles). Escalating to maintainer intervention."
     exit 1
     ```
   - **If `status == "READY_FOR_RE_VERIFICATION"`:**
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

3. **Ingest Verification Findings**:
   - Parse findings from the latest review:
     ```bash
     VERIFY_JSON="$(bash .agents/scripts/issue_lifecycle_helper.sh --parse-verification "$LINKED_PR")"
     ```
   - Extract finding IDs and suggested fixes from `.findings[]`.

4. **Apply Targeted Remediations**:
   - Resolve each specific verification finding (`VER-1`, `VER-2`).
   - Do NOT introduce unrequested architectural changes outside the reported findings.

5. **Re-Execute Targeted Test Gates**:
   - Run relevant test suites (`NO_DNA=1 cargo test`, `npm test`, etc.) matching modified files.

6. **Commit & Push Revision**:
   - Stage and commit with explicit finding references:
     ```bash
     git add -A
     git commit -m "fix(issue-<issue_number>): address verification findings [VER-1]"
     git push origin HEAD
     ```

7. **Notify on PR**:
   - Post comment on the PR informing maintainers that revision is complete:
     ```bash
     gh pr comment "$LINKED_PR" --body "✅ Revision commits pushed to address verification findings. Ready for \`/pr-verify $LINKED_PR\`."
     ```

---

## Completion Criteria

1. In Greenfield Mode:
   - Branch created off updated `origin/dev`.
   - Code and tests implemented according to issue specification.
   - Local test gates verified.
   - PR opened into `dev` containing `Closes #<id>`.
   - Issue labeled `in-progress` and assigned to `@me`.
2. In Revision Mode:
   - Idempotency and circuit breaker rules enforced.
   - Targeted fixes applied for reported findings.
   - Fix commit pushed to PR branch.
   - Notification posted on PR.
