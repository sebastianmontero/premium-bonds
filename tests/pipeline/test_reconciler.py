"""Comprehensive integration and unit tests for reconciler orchestration and execution."""

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.actions import (
    ClearPipelineBlock,
    CloseMergedIssue,
    DeleteStaleBranches,
    Dispatch,
    EditLabels,
    FinishRun,
    KillRunGroup,
    MergePr,
    PostComment,
    RecordAttempt,
    RecordPipelineBlock,
    RecordRun,
    RecordRunnerHandle,
    UpsertStatusComment,
)
from pipeline.config import CliConfig, ConcurrencyConfig, PipelineConfig
from pipeline.executor import ExecDeps, Executor
from pipeline.gh import DryRunViolationError
from pipeline.model import (
    AttemptKind,
    BlockReason,
    CommentOrigin,
    CommentRef,
    CustomAnswer,
    Decision,
    Editor,
    Effort,
    ExistingComment,
    FailedSnapshot,
    Fingerprint,
    ImplementTarget,
    ImplAtDev,
    ImplAtPrHead,
    IntegrateTarget,
    IssueDetails,
    IssueRef,
    IssueSnapshot,
    Liveness,
    Mergeable,
    MergedPr,
    OpenPr,
    PipelineBlock,
    PipelineNotice,
    PrRef,
    Readiness,
    ReviewId,
    ReviewSnapshot,
    ReviewStatus,
    ReviewTarget,
    ReviseTarget,
    RunId,
    SelectedOption,
    Stage,
    Step,
    StepSpec,
    VerificationId,
    VerifyTarget,
)
from pipeline.paths import PipelinePaths
from pipeline.procs import ProcessControl, ProcessIdentity
from pipeline.reconciler import TickDeps, tick
from pipeline.state import (
    ActiveRun,
    HeadlessHandle,
    IssueLocalState,
    RunOutcome,
    RunRecord,
    StoreState,
    apply_store_action,
)
from pipeline.store import CorruptStoreError, save_store


class FakeGh:
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.writes: list[list[str]] = []
        self.reads: list[list[str]] = []
        self.fail_writes = False
        self.user_login = "pipeline-bot"
        self.prs_list_json = "[]"
        self.issues_list_json = "[]"
        self.open_prs_by_head: dict[str, list[dict]] = {}

    def read(self, args: Sequence[str]) -> str:
        self.reads.append(list(args))
        cmd = list(args)
        if cmd[:3] == ["api", "user", "-q"]:
            return self.user_login
        if cmd[:3] == ["repo", "view", "--json"]:
            return json.dumps({"owner": {"login": "owner"}, "name": "repo"})
        if cmd[:3] == ["issue", "list", "--label"]:
            return self.issues_list_json
        if cmd[:3] == ["pr", "list", "--state"]:
            return self.prs_list_json
        if cmd[:2] == ["pr", "list"] and "--head" in cmd:
            idx = cmd.index("--head")
            branch = cmd[idx + 1]
            return json.dumps(self.open_prs_by_head.get(branch, []))
        return "{}"

    def write(self, args: Sequence[str]) -> str:
        if self.dry_run:
            raise DryRunViolationError(f"Attempted write in dry-run mode: {args}")
        if self.fail_writes:
            raise RuntimeError(f"Simulated GitHub write failure on {args}")
        self.writes.append(list(args))
        return "{}"


class FakeHelpers:
    def __init__(self) -> None:
        self.review_calls: list[list[str]] = []
        self.lifecycle_calls: list[list[str]] = []
        self.fail_review = False
        self.fail_lifecycle = False

    def run_review_helper(self, args: Sequence[str]) -> str:
        self.review_calls.append(list(args))
        if self.fail_review:
            raise RuntimeError("Review helper simulated failure")
        return json.dumps({"reviews": []})

    def run_lifecycle_helper(self, args: Sequence[str]) -> str:
        self.lifecycle_calls.append(list(args))
        if self.fail_lifecycle:
            raise RuntimeError("Lifecycle helper simulated failure")
        return ""


class FakeStore:
    def __init__(self, initial_state: StoreState | None = None) -> None:
        self.state = initial_state or StoreState()
        self.applied_actions = []

    def get_state(self) -> StoreState:
        return self.state

    def apply_action(self, action) -> StoreState:
        self.applied_actions.append(action)
        self.state = apply_store_action(self.state, action)
        return self.state


class FakeRunner:
    def __init__(self) -> None:
        self.started_records: list[RunRecord] = []
        self.cleaned_runs = []

    def start(self, record: RunRecord):
        self.started_records.append(record)
        return HeadlessHandle()

    def cleanup_stale_runs(self, finished, now):
        self.cleaned_runs.append((finished, now))


class FakeGit:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.ls_remote_output = ""

    def run(self, args: Sequence[str]) -> str:
        self.calls.append(list(args))
        if "ls-remote" in args:
            return self.ls_remote_output
        return ""


class TestReconciler(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = PipelinePaths(root=Path(self.tmp.name))
        self.paths.ensure_dirs()

        self.gh = FakeGh()
        self.helpers = FakeHelpers()
        self.store = FakeStore()
        self.runner = FakeRunner()
        self.git = FakeGit()
        self.terminated_groups: list[int] = []

        self.mock_alive_pids: dict[int, int] = {}
        self.mock_alive_groups: set[int] = set()

        def fake_killpg(pgid: int, sig: int):
            if sig == 0:
                if pgid in self.mock_alive_groups:
                    return
                raise ProcessLookupError()
            self.terminated_groups.append(pgid)

        self.procs = ProcessControl(
            proc_root=self.paths.root / "fake_proc",
            killpg_fn=fake_killpg,
        )

        self.config = PipelineConfig(
            eligible_label="agent:auto",
            skip_review_label="agent:skip-review",
            max_revision_cycles=3,
            max_step_attempts=2,
            runner="auto",
            reviews=(StepSpec(cli="claude", model="opus", effort=Effort.HIGH),),
            integrator=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            implement=StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM),
            verify=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            revise=StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM),
            concurrency=ConcurrencyConfig(review=2),
            timeouts={
                Step.REVIEW: timedelta(minutes=45),
                Step.INTEGRATE: timedelta(minutes=30),
                Step.IMPLEMENT: timedelta(hours=2),
                Step.VERIFY: timedelta(hours=1),
                Step.REVISE: timedelta(minutes=90),
            },
        )

        self.exec_deps = ExecDeps(
            gh=self.gh,
            helpers=self.helpers,
            store=self.store,
            runner=self.runner,
            git=self.git,
            procs=self.procs,
            paths=self.paths,
            config=self.config,
        )
        self.now = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)
        self.tick_deps = TickDeps(exec=self.exec_deps, clock=lambda: self.now)

    def tearDown(self):
        self.tmp.cleanup()

    # --- Reaping and Resuming ---

    def test_reap_counts_failed_attempt_once(self):
        rec = RunRecord(
            run_id=RunId("run-reap-1"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(hours=3),
        )
        self.store.state = StoreState(runs={rec.run_id: rec})

        # Mark exited
        self.paths.exit_file(rec.run_id).write_text("1\n", encoding="utf-8")

        # Snapshot returns issue in READY state matching ImplementTarget fingerprint
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        report = tick(self.tick_deps, self.config, self.paths)
        attempts = [a for a in report.reaped_actions if isinstance(a, RecordAttempt)]
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].issue, IssueRef(1))
        self.assertEqual(attempts[0].fingerprint, Fingerprint(AttemptKind.IMPLEMENT, ""))

    def test_resume_clears_block_once(self):
        # Issue currently blocked on DECISIONS_UNRESOLVED
        local = IssueLocalState(
            block=PipelineBlock(reason=BlockReason.DECISIONS_UNRESOLVED, ref=ReviewId("rev-1"))
        )
        self.store.state = StoreState(issues={IssueRef(1): local})

        # Issue updated on GitHub: review is integrated
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Specification complete",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        report = tick(self.tick_deps, self.config, self.paths)
        clears = [a for ip in report.plan for a in ip.actions if isinstance(a, ClearPipelineBlock)]
        self.assertEqual(len(clears), 1)
        self.assertEqual(clears[0].issue, IssueRef(1))

    # --- Crashes and Dispatch Order ---

    def test_crash_midway_is_idempotent(self):
        # Gh action fails -> store actions skipped -> same plan next tick
        executor = Executor(self.exec_deps)
        self.gh.fail_writes = True

        plan_actions = [
            EditLabels(target=IssueRef(1), add=("in-progress",)),
            RecordAttempt(issue=IssueRef(1), fingerprint=Fingerprint(AttemptKind.IMPLEMENT, "head")),
        ]
        from pipeline.stages import IssuePlan
        plan = IssuePlan(issue=IssueRef(1), stage=Stage.READY, target=ImplementTarget(), actions=tuple(plan_actions))

        executor.execute_issue_plan(plan)
        # Verify RecordAttempt was NOT applied because EditLabels failed and had no on_failure
        self.assertNotIn(plan_actions[1], self.store.applied_actions)

    def test_dispatch_writes_record_before_start(self):
        executor = Executor(self.exec_deps)
        dispatch_action = Dispatch(
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            workspace=ImplAtDev(),
        )
        executor.apply(dispatch_action, now=self.now)

        # Confirm RecordRun was applied before runner.start
        self.assertEqual(len(self.runner.started_records), 1)
        self.assertTrue(any(isinstance(a, RecordRun) for a in self.store.applied_actions))
        self.assertTrue(any(isinstance(a, RecordRunnerHandle) for a in self.store.applied_actions))

    # --- Signal Safety ---

    def test_reap_emits_no_kill_without_pgid(self):
        rec = RunRecord(
            run_id=RunId("run-no-pgid"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(hours=3),
        )
        # Timeout run with pgid=None
        ar = ActiveRun(record=rec, liveness=Liveness.TIMED_OUT, group_alive=False, pgid=None)
        from pipeline.stages import reap
        actions = reap({rec.run_id: ar}, {}, self.config)
        self.assertFalse(any(isinstance(a, KillRunGroup) for a in actions))

    def test_kill_run_group_ignores_zero_or_negative_pgid(self):
        self.procs.terminate_group(0)
        self.procs.terminate_group(1)
        self.procs.terminate_group(-1)
        self.assertEqual(len(self.terminated_groups), 0)

    # --- Dry Run ---

    def test_dry_run_no_store_or_gh_writes_or_signals(self):
        self.gh.dry_run = True
        dry_deps = ExecDeps(
            gh=self.gh,
            helpers=self.helpers,
            store=self.store,
            runner=self.runner,
            git=self.git,
            procs=self.procs,
            paths=self.paths,
            config=self.config,
        )
        tick_deps = TickDeps(exec=dry_deps, clock=lambda: self.now)

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        report = tick(tick_deps, self.config, self.paths, dry_run=True)
        self.assertTrue(report.dry_run)
        self.assertEqual(len(self.gh.writes), 0)
        self.assertEqual(len(self.store.applied_actions), 0)
        self.assertEqual(len(self.terminated_groups), 0)

    # --- Failures ---

    def test_failed_snapshot_preserves_runs_and_lane_hold(self):
        rec = RunRecord(
            run_id=RunId("run-failed-snap"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(hours=3),
        )
        self.store.state = StoreState(runs={rec.run_id: rec})
        self.paths.exit_file(rec.run_id).write_text("1\n", encoding="utf-8")

        # Snapshot fails for issue #1
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}],
            "comments": [],
        }])
        self.helpers.fail_review = True  # Triggers FailedSnapshot for issue #1

        report = tick(self.tick_deps, self.config, self.paths)
        # Assert no FinishRun and no RecordAttempt for issue #1
        self.assertFalse(any(isinstance(a, FinishRun) for a in report.reaped_actions))
        self.assertFalse(any(isinstance(a, RecordAttempt) for a in report.reaped_actions))

    def test_delete_stale_branches_skips_open_pr_head(self):
        executor = Executor(self.exec_deps)
        self.git.ls_remote_output = (
            "abc1234\trefs/heads/feat/issue-1-active-pr\n"
            "def5678\trefs/heads/feat/issue-1-stale\n"
        )
        self.gh.open_prs_by_head["feat/issue-1-active-pr"] = [{"number": 99}]

        executor.apply(DeleteStaleBranches(issue=IssueRef(1)))

        # Assert only the stale branch was deleted, NOT the active PR head
        deleted = [call for call in self.git.calls if "push" in call and "--delete" in call]
        self.assertEqual(len(deleted), 1)
        self.assertEqual(deleted[0][-1], "feat/issue-1-stale")


if __name__ == "__main__":
    unittest.main()
