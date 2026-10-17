# Autonomous Pipeline Operator Guide

The autonomous pipeline reconciler automates the end-to-end lifecycle of GitHub issues in this repository, spanning multi-round specification review, maintainer decision resolution, autonomous implementation in isolated worktrees, verification gating, revision loops, and automated squash merging into `dev`.

---

## 1. Architecture & Core Concepts

### Control Worktree
The reconciler runs from an isolated control worktree located at:
```
${XDG_STATE_HOME:-~/.local/state}/premium-bonds-pipeline/worktrees/control
```
- **Live Branch Tracking:** Every tick fetches `origin dev` and detaches at `origin/dev`.
- **Automatic Re-exec:** If `HEAD` has advanced on `origin/dev`, the tick process re-executes itself via `--lock-fd <fd>`, preserving the file descriptor lock.
- **Rule of Thumb:** All reconciler code, skill definitions, and `pipeline.toml` changes ship through `dev`. Changes made in a feature branch or local working directory do **not** affect active reconciler runs until merged into `dev`.

### Worktree Pool & Lane Concurrency
The pipeline maintains isolated worktrees under `${XDG_STATE_HOME:-~/.local/state}/premium-bonds-pipeline/worktrees/`:
- `control/`: Reconciler code and configuration at `origin/dev`.
- `impl/`: Dedicated worktree for implementation (`implement` and `revise` steps). Concurrency is strictly 1 (D12).
- `review-<slot>/`: Review worktree pool with `slot ∈ [0, concurrency.review)`. Each slot isolates concurrent review and integration steps.

### Locking & Contention Model
The pipeline uses `fcntl.flock(LOCK_EX | LOCK_NB)` on `${XDG_STATE_HOME:-~/.local/state}/premium-bonds-pipeline/tick.lock`:
- **`tick` / `tick --issue`:** Non-blocking attempt. If another tick is currently executing, it prints `tick in progress` and exits cleanly with code `0`. A busy timer tick is expected and normal.
- **`setup`:** If the lock is held, `setup` prints `error: tick in progress; retry setup once it finishes` to `stderr` and exits with code `75` (`EX_TEMPFAIL`). This guarantees scripts and humans never mistake lock contention for successful setup.
- **`status` / `logs` / `exec`:** These inspection and wrapper commands never acquire `tick.lock` and never mutate state.

---

## 2. Setup & Preflight

### Installation
To initialize the pipeline environment, directories, GitHub labels, and worktrees:
```bash
python3 .agents/scripts/pipeline setup
```

To install and enable the background systemd timer at the same time:
```bash
python3 .agents/scripts/pipeline setup --install-timer
```

### Preflight Checks
Before executing mutations, `setup` verifies your environment:
1. `gh auth status`: Confirms GitHub CLI authentication is valid.
2. `claude --help`: Ensures the Anthropic Claude CLI is installed and supports `--effort`, `--output-format`, and `--permission-mode auto`.
3. `agy --help` & `agy models`: Ensures Google Antigravity CLI is installed, supports `-p`, `--mode auto`, and `--output-format stream-json`, and lists the models specified in `pipeline.toml`.
4. `systemd-run --user --version`: Verified when `--install-timer` is passed.
5. `.claude/settings.json`: Verifies auto-approval permissions are present.

### Setup Flags
- `--install-timer`: Renders and writes user unit files to `~/.config/systemd/user/premium-bonds-pipeline.{service,timer}`, reloads systemd daemon, and enables the timer immediately.
- `--reset-store`: Resets `${XDG_STATE_HOME:-~/.local/state}/premium-bonds-pipeline/state.json` to an empty schema version 1. Aborts with an error if any agent run is currently `ALIVE`.

---

## 3. Configuration Reference (`pipeline.toml`)

Pipeline behavior is configured in `.agents/pipeline.toml`:

```toml
eligible_label = "agent:auto"        # Opt-in triage label for pipeline management
skip_review_label = "agent:skip-review" # Halts new review rounds; existing rounds finish/integrate
max_revision_cycles = 3               # Revisions permitted before tripping the circuit breaker
max_step_attempts = 2                 # Retry ceiling for identical fingerprints before blocking
runner = "auto"                       # "auto" | "herdr" | "headless"

# Review specifications (round k uses index k-1)
reviews = [
  { cli = "agy",    model = "gemini-3.8-flash", effort = "high" },
  { cli = "claude", model = "claude-opus-5-5",  effort = "high" },
]
integrator = { cli = "claude", model = "claude-opus-5-5",  effort = "high" }
implement  = { cli = "agy",    model = "gemini-3.8-flash", effort = "medium" }
verify     = { cli = "claude", model = "claude-opus-5-5",  effort = "high" }
revise     = { cli = "agy",    model = "gemini-3.8-flash", effort = "medium" }

[concurrency]
review = 2           # Concurrently active review/integration slots (implementation lane is always 1)

[timeouts_minutes]
review = 45          # Timeout for each review round
integrate = 30       # Timeout for review integration
implement = 120      # Timeout for greenfield implementation
verify = 60          # Timeout for PR verification
revise = 90          # Timeout for revision cycles

[cli.agy]
extra_args = ["--mode", "auto"]

[cli.claude]
extra_args = ["--permission-mode", "auto"]
```

---

## 4. Systemd Timer & Scheduling ([DEC-1])

The pipeline timer uses a calendar-based cadence:
- **Unit Configuration:**
  - `OnCalendar=*:0/10` (runs every 10 minutes on wall-clock boundaries: :00, :10, :20, :30, :40, :50).
  - `Persistent=true` ensures that if the machine was powered down or suspended during a scheduled tick, systemd immediately executes a catch-up tick upon boot or resume.
- **Service Isolation:** Runs as a systemd user service (`premium-bonds-pipeline.service`). In headless mode, individual agent runs spawn under transient units (`pb-pipeline-<run-id>`) that outlive the tick.
- **Inspection:**
  ```bash
  systemctl --user list-timers premium-bonds-pipeline.timer
  journalctl --user -u premium-bonds-pipeline.service -f
  ```

---

## 5. Label Ownership & Lifecycle Protocol

To prevent race conditions between human operators and the automated reconciler, label ownership is strictly delineated (D13).

### Label Ownership Matrix

| Label | Meaning | Manual Mode Writer | Pipeline Mode Writer |
| :--- | :--- | :--- | :--- |
| `agent:auto` | Opt-in to autonomous management | Maintainer | Maintainer |
| `agent:skip-review` | Skip further review rounds | Maintainer | Maintainer |
| `needs-triage` | Initial unreviewed state | Maintainer / gh issue create | Maintainer |
| `needs-info` | Spec phase blocked on human decisions (`[DEC-N]`) | `/issue-review` | Reconciler |
| `ready-for-agent` | Spec complete, ready for implementation | `/issue-integrate-review` | Reconciler |
| `in-progress` | Active implementation / revision run | `/issue-implement` | Reconciler |
| `ready-for-human` | PR phase blocked (breaker, merge fail, invalid PR) | `/pr-verify` | Reconciler |
| `verified` | PR passed verification without auto-merge | `/pr-verify` | Reconciler |

> [!IMPORTANT]
> **Do not run lifecycle skills manually on `agent:auto` issues.**
> The pipeline reconciler owns all label transitions and worktree checkouts for `agent:auto` issues. If you want to take over an issue manually, remove `agent:auto` first.

### Trust Model & Residual Risk
- Agent CLI processes (`agy` and `claude`) run locally under the maintainer's user account and inherit GitHub authentication via `gh`.
- `.claude/settings.json` permits non-interactive execution including `gh api` and git operations.
- The reconciler enforces dry-run safety gates: `tick --dry-run` guarantees zero mutations across GitHub API, git remotes, and local store state.

---

## 6. Human Action & Resume Protocol

When an issue requires maintainer intervention, the pipeline posts a status comment and applies either `needs-info` (spec phase) or `ready-for-human` (implementation phase).

### Saved-Search Inbox
Maintainers can monitor issues requiring attention using this GitHub filter:
```
is:open label:agent:auto label:needs-info,ready-for-human
```

### Spec Phase: Resolving Decisions (`needs-info`)
1. Open the issue and locate the `### 🧭 Maintainer Decisions` section or the latest review comment detailing open `[DEC-N]` items.
2. Edit the issue body to record your selections under `### 🧭 Maintainer Decisions` (e.g., `- [DEC-1] Selection: A`).
3. Remove the `needs-info` label (or reply to the comment). On the next tick, the pipeline clears the block, triggers `/issue-integrate-review`, and transitions the issue to `ready-for-agent`.

### Implementation Phase: Circuit Breaker & Merges (`ready-for-human`)
If verification fails repeatedly (`max_revision_cycles` exhausted), merge conflicts arise, or an invalid PR state occurs:
1. Inspect the PR and review feedback.
2. **Option A (Fix & Resume):** Address the findings directly on the PR branch, push changes, and remove `ready-for-human`. The reconciler will re-verify the PR on the next tick.
3. **Option B (Abandon PR to Restart Greenfield):** Close the PR on GitHub. On the next tick, the pipeline detects the closed PR, clears the block, records the PR in `abandoned_prs`, and schedules a fresh greenfield implementation from `origin/dev`.
4. **Option C (Drop from Pipeline):** Remove the `agent:auto` label. The pipeline will immediately drop the issue from its active set.

---

## 7. CLI Usage & Diagnostics

### Reconciler Commands
```bash
# Execute a single reconcile cycle
python3 .agents/scripts/pipeline tick

# Dry-run: plan actions without mutating state, GitHub, or git
python3 .agents/scripts/pipeline tick --dry-run

# Trigger reconcile for a specific issue only
python3 .agents/scripts/pipeline tick --issue 42

# View current pipeline status table
python3 .agents/scripts/pipeline status

# Output status formatted as JSON (for scripting/monitoring)
python3 .agents/scripts/pipeline status --json
```

### Inspecting Logs
Run output and agent traces are logged to `${XDG_STATE_HOME:-~/.local/state}/premium-bonds-pipeline/logs/<run-id>.log` with permissions `0600`.

```bash
# View latest log for issue #42
python3 .agents/scripts/pipeline logs 42

# Follow log in real-time
python3 .agents/scripts/pipeline logs 42 -f

# View log by specific RunId
python3 .agents/scripts/pipeline logs run-20261017-123456-42-impl
```

---

## 8. Troubleshooting

### GitHub Authentication
If commands fail with credential or auth errors under systemd:
- The pipeline injects a non-interactive environment (`GH_PROMPT_DISABLED=1`, `GIT_TERMINAL_PROMPT=0`, and GitHub credential helpers).
- Verify host authentication: `gh auth status`. If needed, re-authenticate via `gh auth login`.

### Environment PATH under systemd
User systemd services might have a minimal `PATH` that lacks `~/.local/bin` or custom package managers.
- `setup --install-timer` automatically captures the current shell's `$PATH` and bakes it into `premium-bonds-pipeline.service`.
- If new binaries are added to your PATH, re-run `python3 .agents/scripts/pipeline setup --install-timer`.

### Herdr Server Unavailable
- When `runner = "auto"` in `pipeline.toml`, the pipeline checks if the `herdr` socket is responding.
- If herdr is stopped or unavailable, `AutoRunner` gracefully falls back to `HeadlessRunner` without failing. Under systemd, headless runs use `systemd-run --user` to maintain supervisor isolation.

### Orphaned Runs & Stray PID Cleanup
- The probe audits `/proc/<pid>/stat` (start time field 22) and kernel `boot_id` before signalling or reading state.
- Stale pid files from reboots or wrapped PIDs are automatically detected as `EXITED` and cleaned up without signalling arbitrary processes.
- Never manually signal PIDs ≤ 1.

### Resetting Store State
If local state becomes desynchronized:
```bash
python3 .agents/scripts/pipeline setup --reset-store
```
*Note: This command will refuse to reset if an active agent run is detected.*
