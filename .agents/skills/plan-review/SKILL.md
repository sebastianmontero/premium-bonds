---
name: plan-review
description: "Review a plan artifact in detail using the 'review-plan-basic' skill before implementation. Supports dual execution runners: spawning an in-session background subagent or creating an interactive agy CLI session in a new Herdr tab named after the active tab count. Discovers session artifacts, prompts for choices if unspecified, waits for review completion, critically triages findings across 3 buckets, and integrates valid improvements into the target artifact."
argument-hint: "[--artifact <path_or_name>] [--runner <subagent|herdr-tab>] [--model <model_name>] [--timeout <ms>]"
---

# Plan Review Skill (`/plan-review`)

Use this skill when you have formulated an implementation plan or design artifact and want a rigorous, independent AI review before implementing.

The skill runs the [`review-plan-basic`](file:///home/sebastian/.agents/skills/review-plan-basic/SKILL.md) skill over the target plan artifact, captures the detailed critique, critically analyzes each recommendation, and integrates valid improvements directly into the artifact.

---

## Key Capabilities

1. **Dual Execution Runners**:
   - **In-Session Subagent (`--runner subagent`)**: Invokes a background subagent in the active conversation via `invoke_subagent`. Fast, lightweight, and works in any environment without requiring Herdr.
   - **Herdr Tab Session (`--runner herdr-tab`)**: Spawns a dedicated `agy` CLI session in a new Herdr tab named strictly after the current open tab count. Provides visual isolation and interactive terminal inspection.
2. **Interactive Artifact Discovery**: Automatically discovers all top-level `.md` artifacts in the current session. If multiple artifacts exist and none was specified, prompts the user displaying full file paths, sizes, and creation/modification timestamps.
3. **Runner-Specific Model Selection**: Prompts the user with appropriate model options (e.g. `inherit`, `pro`, `flash` for subagents; `gemini-3.7-flash-high`, `claude-sonnet-4-6` for Herdr CLI sessions) if unspecified.
4. **File-First Review Output Protocol**: Ensures 100% pristine, untruncated markdown review capture by directing the reviewer to write to a dedicated output file on disk, with automatic fallback to ANSI-stripped terminal scraping.
5. **Structured 3-Bucket Critical Analysis**: Triages all reviewer recommendations into Accepted (applied to the plan), Rejected (with documented rationale), and User Clarification Needed.

---

## Step-by-Step Execution Protocol

### Step 1: Resolve Target Artifact

1. If `--artifact <path_or_name>` is provided:
   - Verify file existence on disk or resolve against current session brain directory.
2. If `--artifact` is omitted:
   - Query candidate artifacts in the active session brain directory (`~/.gemini/antigravity-cli/brain/<conversation-id>/`) using:
     ```bash
     .agents/skills/plan-review/scripts/run_plan_review.sh --list-artifacts
     ```
   - **If 0 artifacts found**: Report that no candidate plan artifacts were found in the current session and halt.
   - **If exactly 1 artifact found**: Automatically select it as the target.
   - **If >1 artifacts found**: Prompt the user using `ask_question` with a formatted list showing full path, size, and date:
     - `(Recommended) [plan_name.md](file:///path/to/plan_name.md) (9.3 KB, 2026-08-30 17:12:03)`
     - `[other_doc.md](file:///path/to/other_doc.md) (4.1 KB, 2026-08-30 16:45:00)`

### Step 2: Select Execution Runner

1. If `--runner <subagent|herdr-tab>` is provided:
   - Use the requested runner.
2. If `--runner` is omitted:
   - Check if running inside Herdr: `test "${HERDR_ENV:-}" = 1`
   - **If inside Herdr (`HERDR_ENV=1`)**: Prompt the user using `ask_question`:
     - `(Recommended) In-Session Subagent (Run in background within current session)`
     - `Herdr Tab (Spawn interactive agy CLI session in a new Herdr tab)`
   - **If outside Herdr**: Automatically select `subagent` runner.

### Step 3: Select Model

1. If `--model <model_name>` is provided, use it directly.
2. If `--model` is omitted:
   - **For Subagent Runner**: Prompt user using `ask_question`:
     - `(Recommended) inherit (Use calling agent model)`
     - `pro (Gemini 3.1 Pro / deeper reasoning)`
     - `flash (Gemini Flash / faster execution)`
     - `flash_lite (Lightweight)`
   - **For Herdr Tab Runner**: Prompt user using `ask_question`:
     - `(Recommended) gemini-3.7-flash-high (Gemini 3.7 Flash High)`
     - `gemini-3.7-flash-medium (Gemini 3.7 Flash Medium)`
     - `gemini-3.6-flash-high (Gemini 3.6 Flash High)`
     - `gemini-3.1-pro-high (Gemini 3.1 Pro High)`
     - `claude-sonnet-4-6 (Claude Sonnet 4.6 Thinking)`
     - `claude-opus-4-6-thinking (Claude Opus 4.6 Thinking)`
     - `gpt-oss-120b-medium (GPT-OSS 120B Medium)`

---

### Step 4: Execute Review

#### Branch A: In-Session Subagent Runner

1. Locate `review-plan-basic` skill file at `.agents/skills/review-plan-basic/SKILL.md` or `~/.agents/skills/review-plan-basic/SKILL.md`.
2. Invoke subagent using `invoke_subagent`:
   ```json
   {
     "TypeName": "self",
     "Role": "Plan Reviewer",
     "Model": "<selected_model>",
     "Workspace": "inherit",
     "Prompt": "Please review the implementation plan located at file://<TARGET_ARTIFACT_PATH>.\n\nMandatory Instructions:\n1. Read the skill instructions at file://<PATH_TO_REVIEW_PLAN_BASIC_SKILL> using view_file.\n2. Thoroughly critique the target plan across architecture, edge cases, invariants, security risks, missing test cases, and Fowler code smells.\n3. Output a detailed structured review report with: Overall Assessment, Strengths, Actionable Findings, and Proposed Edits."
   }
   ```
3. Wait for subagent completion message.

#### Branch B: Herdr Tab Runner

1. Execute the automation script:
   ```bash
   .agents/skills/plan-review/scripts/run_plan_review.sh \
     --artifact "<TARGET_ARTIFACT_PATH>" \
     --model "<SELECTED_MODEL>" \
     --json
   ```
2. The script will:
   - Create a new Herdr tab and label it with the total open tab count.
   - Start an `agy` agent in `--mode plan` with the chosen `--model`.
   - Apply account verification delay / readiness polling.
   - Dispatch the review prompt with file-first output handoff (`/tmp/plan_review_*.md`).
   - Wait for child agent completion (`herdr agent wait`).
   - Extract pristine markdown from disk (or fallback to ANSI-filtered terminal output).
   - Return structured JSON with the review report.

---

### Step 5: Structured 3-Bucket Critical Analysis

Examine each finding in the reviewer report and categorize it into the 3-bucket evaluation matrix:

| Bucket                            | Criteria                                                                                                                              | Action                                     |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------- |
| **Bucket 1: Accepted & Applied**  | Valid architectural blind spots, missing negative test vectors, invariant violations, security considerations, or Fowler code smells. | Modify target artifact directly.           |
| **Bucket 2: Rejected / Disputed** | Hallucinated constraints, out-of-scope feature creep, premature micro-optimizations, or conflicting domain requirements.              | Document explicit rationale for rejection. |
| **Bucket 3: User Clarification**  | High-level strategic trade-offs or ambiguous product decisions requiring human choice.                                                | Surface questions to user.                 |

---

### Step 6: Artifact Integration & Reporting

1. Apply all **Bucket 1** improvements to the target plan artifact using file editing tools.
2. Present a clear summary to the user:
   - Reviewer metadata (Runner used, model, artifact reviewed).
   - Summary of key review findings.
   - 3-Bucket triage breakdown (What was accepted and integrated vs what was declined and why).
   - Link to the updated artifact.

---

## Completion Criteria

Execution of `/plan-review` is complete when:

1. The target artifact is resolved and validated.
2. The review was executed through the chosen runner (In-Session Subagent or Herdr Tab).
3. The complete review critique was retrieved without loss or truncation.
4. All findings were triaged across the 3-bucket matrix.
5. All valid improvements are integrated into the target artifact.
6. A summary report is presented to the user.
