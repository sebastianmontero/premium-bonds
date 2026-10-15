---
name: issue-review
description: "Critically audit the main post of a GitHub issue for accuracy, completeness, and optimal architectural solutions. Selects and orchestrates specialized domain reviewer agents (solution-critic, contract-plan-reviewer, frontend-plan-reviewer, code-smell-reviewer), critically filters and triages findings into actionable recommendations with stable keys, and publishes a structured review comment on GitHub equipped with machine-readable tracking metadata and an integration checklist. Works across both agy and claude code CLIs."
argument-hint: "<issue_number_or_url> [--agents <comma_separated>] [--model <model>]"
---

# Issue Review Skill (`/issue-review`)

Use this skill when a GitHub issue or PRD proposal needs a rigorous, independent AI review before implementation starts.

This skill audits the main post of the issue for technical accuracy, architectural optimality, edge cases, and testability. It routes the issue to specialized reviewer subagents, synthesizes their critiques using a 3-Bucket Critical Analysis, and posts a structured review comment to GitHub with an actionable GFM checklist and machine-readable metadata.

---

## Key Capabilities

1. **Dual-CLI Native Execution**: Runs seamlessly in both **Google Antigravity (`agy` CLI)** via `invoke_subagent` and **Claude Code CLI** via the `Task` tool.
2. **Intelligent Domain Routing**: Automatically selects the appropriate reviewer subagents based on the issue scope (Solana smart contract, frontend/dApp, full-stack, Fowler code smells).
3. **Stateless Review ID Generation**: Uses `.agents/scripts/issue_review_helper.sh --generate-review-id` to generate deterministic, collision-free identifiers (e.g. `rev-20261015-42-a1b2`).
4. **Structured 3-Bucket Critical Analysis**: Separates accepted findings, superior alternatives, and rejected hallucinations before publishing.
5. **Machine-Readable Tracking Metadata**: Embeds `<!-- ai-issue-review: {...} -->` metadata for automated lifecycle tracking and downstream integration via `/issue-integrate-review`.

---

## Step-by-Step Execution Protocol

### Step 1: Issue Resolution & Context Ingestion

1. **Parse Input Argument**:
   - Extract the issue number from the command argument:
     - `#42` or `42` $\rightarrow$ `42`
     - `https://github.com/<owner>/<repo>/issues/42` $\rightarrow$ `42`
   - If no issue number was provided, prompt the user for the target issue.

2. **Pre-fetch Issue Payload via `gh`**:
   Fetch the full issue state including comments, labels, and timestamps to `/tmp/`:
   ```bash
   gh issue view <number> --json number,title,body,author,labels,comments,updatedAt > /tmp/issue_<number>_raw.json
   ```

3. **Extract Issue Body for Subagents**:
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

Generate the unique review ID:
```bash
REV_ID="$(bash .agents/scripts/issue_review_helper.sh --generate-review-id <number>)"
echo "Generated Review ID: $REV_ID"
```

Dispatch the review tasks concurrently to each selected subagent.

#### Branch A: Antigravity CLI (`agy`)
In `agy`, use the `invoke_subagent` tool with `TypeName: "self"`:
- Load the specialized prompt guidelines from `.agents/agents/<dir_name>/agent.md` (where directory names use snake_case: `solution_critic`, `contract_plan_reviewer`, `frontend_plan_reviewer`, `code_smell_reviewer`).
- In each subagent prompt, inject:
  - Role description from `agent.md`.
  - Path to the pre-fetched issue body: `/tmp/issue_<number>_body.md`.
  - Issue metadata (Number, Title).
  - Protocol mandates: Ripgrep (`rg`) requirement from `<RULE[user_global]>` and architecture standards from `GEMINI.md`.
  - Task instruction: "Audit the issue body against your domain expertise. Return structured findings with clear technical justifications, code diffs or stubs where relevant, and concrete test vectors."

#### Branch B: Claude Code CLI
In Claude Code, use the `Task` tool referencing existing subagents:
- Call `Task` with `subagent_type: "<agent_name>"` (e.g. `solution-critic`, `contract-plan-reviewer`, `frontend-plan-reviewer`, `code-smell-reviewer` available via `.claude/agents/`).
- Pass the prompt containing the issue body path `/tmp/issue_<number>_body.md`, metadata, and task instructions.

---

### Step 4: Critical 3-Bucket Triaging & Synthesis

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

---

### Step 5: Format & Publish Review Comment

1. **Format the Review Comment**:
   Construct `/tmp/issue_review_<number>_comment.md` following this canonical format:

   ```markdown
   <!-- ai-issue-review: {"version":"1.0","review_id":"<REV_ID>","issue_number":<number>,"agents":["<agent1>","<agent2>"],"timestamp":"<ISO_TIMESTAMP>","status":"pending"} -->

   ## 🔍 AI Issue Review: `<REV_ID>`

   **Evaluated Scope:** `<Scope>`
   **Specialist Reviewers:** `<agent1>`, `<agent2>`
   **Overall Verdict:** `OPTIMAL WITH REVISIONS` <!-- or APPROVED AS-IS / REQUIRES RE-DESIGN -->

   ---

   ### 📋 Actionable Integration Checklist
   - [ ] **[ARCH-1]**: <Brief description of accepted change>
   - [ ] **[SEC-1]**: <Brief description of security fix>
   - [ ] **[TEST-1]**: <Brief description of test vector to add>

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
   <sub>*Generated by `/issue-review`. Integrate accepted items directly into the main post using `/issue-integrate-review #<number>`.*</sub>
   ```

2. **Publish Comment to GitHub**:
   ```bash
   gh issue comment <number> --body-file /tmp/issue_review_<number>_comment.md
   ```

3. **Report to Developer**:
   - Output a concise markdown summary including:
     - Review ID.
     - Direct link to the issue and review comment.
     - List of accepted checklist items.
     - Recommendation to run `/issue-integrate-review <number>` to apply changes.
