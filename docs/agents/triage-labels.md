# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Blocked on a maintainer decision (spec phase) |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `in-progress`              | `in-progress`        | Claimed by agent; active implementation  |
| `ready-for-human`          | `ready-for-human`    | Blocked on a human (implementation phase): circuit breaker, exhausted retries, merge conflict/failure, or invalid PR |
| `verified` (PR label)      | `verified`           | Pull Request verified by /pr-verify      |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |
| `agent:auto`               | `agent:auto`         | Opt-in to the autonomous pipeline reconciler |
| `agent:skip-review`        | `agent:skip-review`  | Stops new review rounds; rounds already posted are still integrated or block on their DECs |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

> [!IMPORTANT]
> Do not run the lifecycle skills manually on `agent:auto` issues. The pipeline owns them; to take an issue over, remove `agent:auto` first.

## Full Autonomous Lifecycle Flow

1. **Issue Creation & Triage**: Maintainer or reporter opens issue $\rightarrow$ labeled `needs-triage` (or opted in with `agent:auto`).
2. **AI Review & Integration (N Rounds & DEC Protocol)**:
   - `/issue-review --round <k>` audits the issue specification. If human choices are required (`[DEC-N]`), the review sets `"human_decision_required": true` and applies `needs-info` (in manual mode; in pipeline mode the reconciler applies it).
   - If `agent:skip-review` is added to the issue, further review rounds are stopped; however, already posted rounds are still integrated or block on their DECs.
   - Once all decisions for the target review are resolved by the maintainer, `/issue-integrate-review` integrates accepted findings and DEC selections under `### 🧭 Maintainer Decisions` in the issue body, appends to the issue ledger, clears `needs-info` and `needs-triage`, and transitions the issue to `ready-for-agent`. (In pipeline mode per D13, label transitions are owned exclusively by the reconciler).
3. **Autonomous Implementation**:
   - `/issue-implement` claims the issue (`in-progress`), branches `feat/issue-<id>-<slug>` off `origin/dev`, writes code and tests, runs targeted test gates (`NO_DNA=1 cargo test --manifest-path anchor/Cargo.toml` and frontend lint/tests), commits, and opens a PR targeting `dev` (`Closes #<id>`).
   - In pipeline mode, label checks and claim edits are skipped; the reconciler claims the issue before dispatching.
4. **Verification Gate & Revision**:
   - `/pr-verify` audits the PR against the closed issue spec and runs targeted test gates without moving goalposts.
   - **Approval**:
     - In manual mode: submits approved PR review (or comment review on self-authored PRs), and merges into `dev` via squash (unless `--not-auto-merge` was specified, which applies `verified`). After a successful merge, runs `issue_lifecycle_helper.sh --close-merged-issue --issue <n> --pr <pr>` to close the issue.
     - In pipeline mode: submits approved PR review and skips both merge and `verified` label edits. The reconciler is the only merger in pipeline mode (D13).
   - **Changes Requested**: Submits review requesting changes (handling self-authored PRs via comment reviews to prevent GitHub 422 errors) $\rightarrow$ re-enters `/issue-implement --pr <pr>` in Revision Mode up to `--max-cycles` (default 2).
   - **Circuit Breaker**: When revision cycles reach `--max-cycles` (default 2) without approval, trips the circuit breaker: marks issue and PR as `ready-for-human`, unassigns agent, and requests human intervention. (In pipeline mode, the circuit breaker comment and label edits are skipped; the reconciler surfaces the breaker and applies labels).
