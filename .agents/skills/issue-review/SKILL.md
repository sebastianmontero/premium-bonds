---
name: issue-review
description: "Critically audit the main post of a GitHub issue for accuracy, completeness, and optimal architectural solutions. Selects and orchestrates specialized domain reviewer agents (solution-critic, contract-plan-reviewer, frontend-plan-reviewer, code-smell-reviewer), critically filters and triages findings into actionable recommendations with stable keys, and publishes a structured review comment on GitHub equipped with machine-readable tracking metadata and an integration checklist. Works across both agy and claude code CLIs."
argument-hint: "<issue_number_or_url> [--agents <comma_separated>] [--model <model>] [--round <k>]"
---

# Issue Review Skill (`/issue-review`)

Use this skill when a GitHub issue or PRD proposal needs a rigorous, independent AI review before implementation starts.

This skill audits the main post of the issue for technical accuracy, architectural optimality, edge cases, and testability. It routes the issue to specialized reviewer subagents, synthesizes their critiques using a 3-Bucket Critical Analysis, and posts a structured review comment to GitHub with an actionable GFM checklist and machine-readable metadata.

---

## Key Capabilities

1. **Dual-CLI Native Execution**: Runs seamlessly in both **Google Antigravity (`agy` CLI)** via `invoke_subagent` and **Claude Code CLI** via the `Task` tool.
2. **Intelligent Domain Routing**: Automatically selects the appropriate reviewer subagents based on the issue scope (Solana smart contract, frontend/dApp, full-stack, Fowler code smells).
3. **Stateless Review ID Generation**: Uses `.agents/scripts/issue_review_helper.sh --generate-review-id` to generate deterministic, collision-free identifiers (e.g. `rev-20261015-42-a1b2`).
4. **Structured 3-Bucket Critical Analysis & DEC Protocol**: Separates accepted findings, superior alternatives, rejected hallucinations, and maintainer decisions (`[DEC-N]`).
5. **Machine-Readable Tracking Metadata**: Embeds `<!-- ai-issue-review: {...} -->` metadata generated via `issue_review_helper.sh --format-review-metadata` for automated lifecycle tracking and downstream integration via `/issue-integrate-review`.

---

## Pipeline Mode (D13)

When running inside the autonomous issue pipeline (`[[ -n "${PIPELINE_RUN_ID:-}" ]]`):
- **Lifecycle labels & assignees**: The reconciler owns all lifecycle label transitions (`ready-for-agent`, `in-progress`, `needs-info`, `ready-for-human`, `verified`) and assignees. Skills make **no** edits to these labels or assignees in pipeline mode.
- **Halts**: Preconditions and circuit breaker conditions still halt the skill, but without performing label side effects.
- **Markers**: Every comment posted by a skill carries an `<!-- ai-` marker in both modes.
- **Helper exits**: An exit code of 2 from any helper script indicates a GitHub/API failure and must halt the skill immediately.

---

## Step-by-Step Execution Protocol

### Step 1: Issue Resolution & Context Ingestion

1. **Parse Input Argument & Optional Flags**:
   - Extract the issue number from the command argument:
     - `#42` or `42` $\rightarrow$ `42`
     - `https://github.com/<owner>/<repo>/issues/42` $\rightarrow$ `42`
   - If no issue number was provided, prompt the user for the target issue.
   - Extract optional `--round <k>` if specified.

2. **Pre-fetch Issue Payload via `gh`**:
   Fetch the full issue state including comments, labels, and timestamps to `/tmp/`:
   ```bash
   gh issue view <number> --json number,title,body,author,labels,comments,updatedAt > /tmp/issue_<number>_raw.json
   ```

3. **Check Prior Rounds & Declined Items**:
   Parse prior reviews to respect already-integrated findings and avoid re-raising declined points:
   ```bash
   if ! bash .agents/scripts/issue_review_helper.sh --parse-reviews --file /tmp/issue_<number>_raw.json > /tmp/issue_<number>_parsed.json; then
     echo "Error: Failed to parse review history for issue <number>" >&2
     exit 2
   fi
   DECLINED_ITEMS="$(jq -c .declined_items /tmp/issue_<number>_parsed.json 2>/dev/null || echo '[]')"
   ```
   If prior reviews exist, the reviewer must audit the current, already-integrated issue body (which incorporates earlier accepted findings) and must not re-raise findings already recorded in the ledger as declined (`DECLINED_ITEMS`).

4. **Extract Issue Body for Subagents**:
   Export the issue title and markdown body to a dedicated file so subagents can read it directly without network overhead:
   ```bash
   jq -r .body /tmp/issue_<number>_raw.json > /tmp/issue_<number>_body.md
   ```

---

### Step 2: Scope & Reviewer Routing Matrix

Analyze the issue's title, body, and labels to determine which specialist reviewers to invoke:

| Issue Scope / Content Indicators | Selected Subagents |
| :--- | :--- |
| **Solana / Smart Contract** (Anchor, Rust, programs, accounts, CPIs, instructions, state, LiteSVM, Kamino, Huma) | `solution-critic`, `contract-plan-reviewer` |
| **Frontend / Web3 dApp** (Next.js 16, React 19, framework-kit, `@solana/client`, Codama, wallet adapter, UI) | `solution-critic`, `frontend-plan-reviewer` |
| **Full-Stack Solana & dApp** (Touches both contract and frontend/client) | `solution-critic`, `contract-plan-reviewer`, `frontend-plan-reviewer` |
| **Architectural Refactor / New Data Types** (New state structs, complex traits, cross-module boundaries) | Add `code-smell-reviewer` |
| **Non-Code / Documentation / Tooling / Skills** (Docs, process, configuration) | `solution-critic` only |

> [!NOTE]
> If the user passed explicit `--agents <agent1,agent2>` flags, use the specified subagents instead of the auto-routed matrix.

---

### Step 3: Dual-CLI Subagent Invocation

Generate the unique review ID and resolve active model:
```bash
REV_ID="$(bash .agents/scripts/issue_review_helper.sh --generate-review-id <number>)"
MODEL="$(bash .agents/scripts/issue_lifecycle_helper.sh --resolve-model ${MODEL_FLAG:-})"
echo "Generated Review ID: $REV_ID (Model: $MODEL)"
```

Dispatch the review tasks concurrently to each selected subagent.

#### Branch A: Antigravity CLI (`agy`)
In `agy`, use the `invoke_subagent` tool with `TypeName: "self"`:
- Load the specialized prompt guidelines from `.agents/agents/<dir_name>/agent.md` (where directory names use snake_case: `solution_critic`, `contract_plan_reviewer`, `frontend_plan_reviewer`, `code_smell_reviewer`).
- In each subagent prompt, inject:
  - Role description from `agent.md`.
  - Path to the pre-fetched issue body: `/tmp/issue_<number>_body.md`.
  - Issue metadata (Number, Title).
  - Declined findings from prior rounds (`$DECLINED_ITEMS`) that must NOT be re-raised.
  - Protocol mandates: Ripgrep (`rg`) requirement from `<RULE[user_global]>` and architecture standards from `GEMINI.md`.
  - Task instruction: "Audit the issue body against your domain expertise. Return structured findings with clear technical justifications, code diffs or stubs where relevant, and concrete test vectors."

#### Branch B: Claude Code CLI
In Claude Code, use the `Task` tool referencing existing subagents:
- Call `Task` with `subagent_type: "<agent_name>"` (e.g. `solution-critic`, `contract-plan-reviewer`, `frontend-plan-reviewer`, `code-smell-reviewer` available via `.claude/agents/`).
- Pass the prompt containing the issue body path `/tmp/issue_<number>_body.md`, metadata, declined items, and task instructions.

---

### Step 4: Critical 3-Bucket Triaging & DEC Synthesis

As the primary orchestrator, critically evaluate all findings returned by the reviewer subagents. Do not accept recommendations blindly; apply strict senior-engineer judgment:

1. **Bucket 1: Accepted / Actionable Findings**:
   - Definite architectural flaws, security risks, missing negative test vectors, unhandled error states, or simplified design patterns that align with repository invariants.
   - Assign stable, concise category keys:
     - `[ARCH-N]`: Architecture & state design
     - `[SEC-N]`: Security, access control, CPIs
     - `[TEST-N]`: Missing test coverage, LiteSVM vectors
     - `[CLEAN-N]`: Code smell, naming, modularity
     - `[UI-N]`: Frontend, React, wallet lifecycle

2. **Bucket 2: Valid Alternative Solutions**:
   - Competing technical approaches that offer superior simplicity, CU efficiency, or maintainability. Present trade-offs clearly.

3. **Bucket 3: Rejected / Disputed Findings**:
   - Hallucinations, outdated patterns, irrelevant nitpicks, or suggestions that contradict repository architecture rules (e.g. unnecessary backward compatibility layers in pre-production).
   - Document explicit reasons for dismissal.

4. **Maintainer Decisions (`[DEC-N]`)**:
   - Use `[DEC-N]` only when the choice is genuinely the maintainer's (product, economics, risk appetite, ambiguous intent), not when one option is objectively superior.
   - Give 2–4 options, one of them recommended.
   - Never use `[DEC-N]` for issues the reviewer can settle itself.
   - If any `[DEC-N]` exists:
     - Set overall verdict to `NEEDS HUMAN DECISION`.
     - Set `human_decision_required=true`.
     - Include `- [ ] **[DEC-N]**: Apply maintainer decision on <topic>` in the integration checklist.

---

### Step 5: Format & Publish Review Comment

1. **Format Metadata Marker Line via Helper**:
   Emit the metadata line using `issue_review_helper.sh --format-review-metadata`:
   ```bash
   META_ARGS=(
     --review-id "$REV_ID"
     --issue "<number>"
     --model "$MODEL"
     --agents '<agents_json>'
   )
   if [[ -n "${ROUND:-}" ]]; then
     META_ARGS+=(--round "$ROUND")
   fi
   if [[ "$HUMAN_DECISION_REQUIRED" == true ]]; then
     META_ARGS+=(--human-decision-required)
   fi
   METADATA_LINE="$(bash .agents/scripts/issue_review_helper.sh --format-review-metadata "${META_ARGS[@]}")"
   ```

2. **Format the Review Comment Body**:
   Construct `/tmp/issue_review_<number>_comment.md` following this canonical format:

   ```markdown
   <METADATA_LINE>

   ## 🔍 AI Issue Review: `<REV_ID>`

   **Evaluated Scope:** `<Scope>`
   **Reviewer Model:** `<MODEL>`
   **Specialist Reviewers:** `<agent1>`, `<agent2>`
   **Overall Verdict:** `OPTIMAL WITH REVISIONS` <!-- or APPROVED AS-IS / NEEDS HUMAN DECISION / REQUIRES RE-DESIGN -->

   <!-- If HUMAN_DECISION_REQUIRED is true, place this section immediately after the verdict: -->
   ### 🛑 Decisions Required (integration is blocked until every decision is resolved)
   **How to resolve:** for each decision tick exactly one option below, **or** reply on this issue with a line `DEC-N: <your answer>`. Then remove the `needs-info` label to resume the pipeline.

   #### [DEC-1] <question>
   <context, consequences of each option, recommendation>
   - [ ] **DEC-1/A**: <option text> *(recommended)*
   - [ ] **DEC-1/B**: <option text>

   ---

   ### 📋 Actionable Integration Checklist
   - [ ] **[ARCH-1]**: <Brief description of accepted change>
   - [ ] **[SEC-1]**: <Brief description of security fix>
   - [ ] **[TEST-1]**: <Brief description of test vector to add>
   - [ ] **[DEC-1]**: Apply maintainer decision on <topic>

   ---

   ### 💡 Detailed Findings & Recommendations

   #### 🏛️ Architecture & Security
   - **[ARCH-1]**: <Detailed technical explanation, suggested account layout or CPI modification>
   - **[SEC-1]**: <Detailed explanation of security edge case and remediation>

   #### 🧪 Testing & Validation
   - **[TEST-1]**: <Specific LiteSVM or UI test vectors needed>

   ---

   ### ⚖️ Evaluated Alternatives & Trade-offs
   <Trade-off discussion if applicable, or "None identified.">

   ---

   <details>
   <summary>❌ Dismissed Findings (<count>)</summary>

   - **[DISMISSED]** <Finding>: <Explicit rationale for rejection>
   </details>

   ---
   <sub>*Generated by `/issue-review` using `<MODEL>`. Integrate accepted items directly into the main post using `/issue-integrate-review #<number>`.*</sub>
   ```

3. **Publish Comment to GitHub**:
   ```bash
   gh issue comment <number> --body-file /tmp/issue_review_<number>_comment.md
   ```

4. **Label Guard for Human Decision**:
   If any DEC exists and the run is not in pipeline mode, add `needs-info`:
   ```bash
   if [[ -z "${PIPELINE_RUN_ID:-}" ]]; then
     if [[ "$HUMAN_DECISION_REQUIRED" == true ]]; then
       gh issue edit <number> --add-label "needs-info"
     fi
   fi
   ```
   *(In pipeline mode, label edits are skipped; the reconciler applies `needs-info` per D13).*

5. **Report to Developer**:
   - Output a concise markdown summary including:
     - Review ID and verdict.
     - Direct link to the issue and review comment.
     - List of accepted checklist items and required maintainer decisions.
     - Next steps: resolve decisions (if any) or run `/issue-integrate-review <number>`.
