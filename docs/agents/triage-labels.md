# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `in-progress`              | `in-progress`        | Claimed by agent; active implementation  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation or circuit breaker tripped after 2 cycles |
| `verified` (PR label)      | `verified`           | Pull Request verified by /pr-verify      |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Full Autonomous Lifecycle Flow

1. **Issue Creation & Triage**: Maintainer or reporter opens issue $\rightarrow$ labeled `needs-triage`.
2. **AI Review & Integration**: `/issue-review` audits the issue specification and `/issue-integrate-review` integrates findings into the main issue post $\rightarrow$ transitions to `ready-for-agent`.
3. **Autonomous Implementation**: `/issue-implement` claims the issue, adds `in-progress`, branches `feat/issue-<id>-<slug>`, writes code and tests, commits, and opens a PR targeting `dev` (`Closes #<id>`).
4. **Verification Gate**: `/pr-verify` audits the PR against the issue spec and runs deterministic test suites.
   - If verified (default auto-merge): submits approved PR review and merges into `dev` via squash, closing the issue.
   - If verified with `--not-auto-merge`: submits approved PR review and applies PR label `verified`.
   - If changes requested (cycle < 2): submits review requesting changes $\rightarrow$ re-enters `/issue-implement` in Revision Mode.
   - If circuit breaker tripped (cycle >= 2): marks issue and PR as `ready-for-human`, unassigns agent, and requests human intervention.
