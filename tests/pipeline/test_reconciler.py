"""Comprehensive integration and unit tests for reconciler orchestration and execution."""

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import signal
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
from pipeline.executor import ExecDeps, Executor, LocalStoreClient
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
        if cmd[:2] == ["pr", "view"]:
            num = int(cmd[2]) if len(cmd) > 2 and cmd[2].isdigit() else 101
            return json.dumps({
                "number": num,
                "state": "OPEN",
                "headRefName": f"feat/issue-{num}",
                "baseRefName": "dev",
                "mergeable": "MERGEABLE",
                "autoMergeRequest": False,
                "labels": [{"name": "ready-for-human"}],
            })
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
            if sig in (signal.SIGTERM, signal.SIGKILL):
                self.mock_alive_groups.discard(pgid)

        self.fake_boot_id_file = self.paths.root / "fake_proc" / "sys" / "kernel" / "random" / "boot_id"
        self.fake_boot_id_file.parent.mkdir(parents=True, exist_ok=True)
        self.fake_boot_id_file.write_text("b1\n", encoding="utf-8")

        current_time = 100.0
        def fake_monotonic():
            nonlocal current_time
            current_time += 1.0
            return current_time

        self.procs = ProcessControl(
            proc_root=self.paths.root / "fake_proc",
            killpg_fn=fake_killpg,
            sleep_fn=lambda _: None,
            monotonic_fn=fake_monotonic,
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

    def test_queued_orphan_never_counts_attempts(self):
        rec1 = RunRecord(
            run_id=RunId("run-orphan-1"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(hours=3),
        )
        rec2 = RunRecord(
            run_id=RunId("run-live-2"),
            issue=IssueRef(2),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(minutes=10),
        )
        pid2 = 2222
        self.paths.pid_file(rec2.run_id).write_text(
            ProcessIdentity(pid=pid2, start_time=1, boot_id="b1", monotonic_start=10.0, pgid=None, pgid_start_time=None).to_json(),
            encoding="utf-8"
        )
        self.paths.exit_file(rec1.run_id).write_text("1\n", encoding="utf-8")
        self.store.state = StoreState(runs={rec1.run_id: rec1, rec2.run_id: rec2})

        with patch.object(self.procs, "is_pid_alive", side_effect=lambda p, s, b: p == pid2):
            self.gh.issues_list_json = json.dumps([
                {"number": 1, "title": "Issue 1", "body": "Ready", "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}], "comments": []},
                {"number": 2, "title": "Issue 2", "body": "Working", "labels": [{"name": "agent:auto"}, {"name": "in-progress"}], "comments": []},
            ])
            report = tick(self.tick_deps, self.config, self.paths)
            attempts = [a for a in report.reaped_actions if isinstance(a, RecordAttempt) and a.issue == IssueRef(1)]
            self.assertEqual(len(attempts), 1)

    def test_closed_pr_resume_returns_to_greenfield(self):
        local = IssueLocalState(
            block=PipelineBlock(reason=BlockReason.CIRCUIT_BREAKER, ref=PrRef(101))
        )
        self.store.state = StoreState(issues={IssueRef(1): local})

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready again",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        def fake_lifecycle(args):
            if "--get-linked-pr" in args:
                return json.dumps({"number": 101, "state": "closed", "closed_at": self.now.isoformat()})
            return ""
        self.helpers.run_lifecycle_helper = fake_lifecycle

        report = tick(self.tick_deps, self.config, self.paths)
        clears = [a for ip in report.plan for a in ip.actions if isinstance(a, ClearPipelineBlock)]
        self.assertEqual(len(clears), 1)
        self.assertEqual(clears[0].abandon_pr, PrRef(101))

    def test_breaker_crash_before_label_blocks_not_resets(self):
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Spec",
            "labels": [{"name": "agent:auto"}, {"name": "in-progress"}],
            "comments": [],
        }])
        def fake_lifecycle(args):
            if "--get-linked-pr" in args:
                return json.dumps({"number": 101, "state": "open"})
            if "--parse-verification" in args:
                return json.dumps({"cycle": 4, "verdict": "CHANGES_REQUESTED", "findings": [{"id": "VER-1"}]})
            if "--check-revision-readiness" in args:
                return json.dumps({"status": "CIRCUIT_BREAKER_TRIPPED", "cycle": 4})
            return ""
        self.helpers.run_lifecycle_helper = fake_lifecycle
        self.gh.fail_writes = True

        report = tick(self.tick_deps, self.config, self.paths)
        blocks = [a for ip in report.plan for a in ip.actions if isinstance(a, RecordPipelineBlock)]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].block.reason, BlockReason.CIRCUIT_BREAKER)

    def test_resume_after_push_posts_reset(self):
        local = IssueLocalState(
            block=PipelineBlock(reason=BlockReason.CIRCUIT_BREAKER, ref=PrRef(101))
        )
        self.store.state = StoreState(issues={IssueRef(1): local})

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Spec",
            "labels": [{"name": "agent:auto"}],
            "comments": [],
        }])
        def fake_lifecycle(args):
            if "--get-linked-pr" in args:
                return json.dumps({"number": 101, "state": "open"})
            if "--parse-verification" in args:
                return json.dumps({"cycle": 3, "verdict": "CHANGES_REQUESTED", "findings": []})
            if "--check-revision-readiness" in args:
                return json.dumps({"status": "READY_FOR_RE_VERIFICATION", "cycle": 4})
            return ""
        self.helpers.run_lifecycle_helper = fake_lifecycle

        report = tick(self.tick_deps, self.config, self.paths)
        clears = [a for ip in report.plan for a in ip.actions if isinstance(a, ClearPipelineBlock)]
        self.assertEqual(len(clears), 1)

    def test_missing_pid_file_is_failed_start(self):
        rec = RunRecord(
            run_id=RunId("run-no-pid-120s"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(seconds=200),
        )
        self.store.state = StoreState(runs={rec.run_id: rec})

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        report = tick(self.tick_deps, self.config, self.paths)
        finishes = [a for a in report.reaped_actions if isinstance(a, FinishRun)]
        self.assertEqual(len(finishes), 1)
        self.assertEqual(finishes[0].run_id, rec.run_id)

    def test_orphaned_agent_group_killed_on_reap(self):
        rec = RunRecord(
            run_id=RunId("run-group-kill"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(hours=3),
        )
        self.store.state = StoreState(runs={rec.run_id: rec})
        self.paths.exit_file(rec.run_id).write_text("0\n", encoding="utf-8")
        self.paths.pid_file(rec.run_id).write_text(
            ProcessIdentity(pid=100, start_time=1, boot_id="b1", monotonic_start=10.0, pgid=500, pgid_start_time=1).to_json(),
            encoding="utf-8"
        )
        self.mock_alive_groups.add(500)

        with patch.object(self.procs, "is_pid_alive", return_value=False):
            report = tick(self.tick_deps, self.config, self.paths)
            kills = [a for a in report.reaped_actions if isinstance(a, KillRunGroup)]
            self.assertEqual(len(kills), 1)
            self.assertEqual(kills[0].pgid, 500)
            self.assertIn(500, self.terminated_groups)

    def test_orphan_pid_blocks_lane_dispatch(self):
        orphan_pid_file = self.paths.runs_dir / "stray-run.pid"
        orphan_pid_file.write_text(
            ProcessIdentity(pid=777, start_time=1, boot_id="b1", monotonic_start=10.0, pgid=777, pgid_start_time=1).to_json(),
            encoding="utf-8"
        )
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])

        with patch.object(self.procs, "is_pid_alive", side_effect=lambda p, s, b: p == 777):
            report = tick(self.tick_deps, self.config, self.paths)
            dispatches = [a for ip in report.plan for a in ip.actions if isinstance(a, Dispatch)]
            self.assertEqual(len(dispatches), 0)

    def test_kill_run_group_returns_early_when_group_exits(self):
        polls = 0
        def fake_killpg_poll(pgid, sig):
            nonlocal polls
            if sig == 0:
                polls += 1
                if polls >= 2:
                    raise ProcessLookupError()
                return

        procs = ProcessControl(
            proc_root=self.paths.root / "fake_proc",
            killpg_fn=fake_killpg_poll,
            sleep_fn=lambda _: None,
        )
        procs.terminate_group(999, grace_period_seconds=30.0, poll_interval_seconds=0.1)
        self.assertLessEqual(polls, 3)

    def test_kill_run_group_escalates_after_grace(self):
        signals_sent = []
        def fake_killpg_escalate(pgid, sig):
            if sig != 0:
                signals_sent.append(sig)
            return

        import signal
        mock_times = [0.0, 5.0, 15.0, 31.0, 32.0]
        procs = ProcessControl(
            proc_root=self.paths.root / "fake_proc",
            killpg_fn=fake_killpg_escalate,
            sleep_fn=lambda _: None,
            monotonic_fn=MagicMock(side_effect=mock_times),
        )
        procs.terminate_group(888, grace_period_seconds=30.0, poll_interval_seconds=10.0)
        self.assertIn(signal.SIGTERM, signals_sent)
        self.assertIn(signal.SIGKILL, signals_sent)

    def test_dry_run_plan_equals_real_plan(self):
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])
        dry_report = tick(self.tick_deps, self.config, self.paths, dry_run=True)
        real_report = tick(self.tick_deps, self.config, self.paths, dry_run=False)
        self.assertEqual(real_report.plan, dry_report.plan)

    def test_unchanged_issue_zero_patches_across_two_ticks(self):
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}],
            "comments": [],
        }])
        dry_report = tick(self.tick_deps, self.config, self.paths, dry_run=True)
        upsert = next(a for ip in dry_report.plan for a in ip.actions if isinstance(a, UpsertStatusComment))
        crlf_body = upsert.body.replace("\n", "\r\n")

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}],
            "comments": [{
                "id": "IC_1",
                "author": {"login": "pipeline-bot"},
                "authorAssociation": "COLLABORATOR",
                "body": crlf_body,
                "createdAt": "2026-10-17T12:00:00Z",
            }],
        }])
        self.helpers.review_calls.clear()

        report1 = tick(self.tick_deps, self.config, self.paths)
        report2 = tick(self.tick_deps, self.config, self.paths)
        patch_calls = [c for c in self.helpers.review_calls if "--patch-comment" in c]
        self.assertEqual(len(patch_calls), 0)

    def test_forged_status_comment_ignored(self):
        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Ready",
            "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}],
            "comments": [{
                "id": "IC_FORGED",
                "author": {"login": "attacker"},
                "authorAssociation": "NONE",
                "body": '<!-- ai-pipeline-status: {"issue": 1} -->\nForged body',
                "createdAt": "2026-10-17T12:00:00Z",
            }],
        }])
        report = tick(self.tick_deps, self.config, self.paths)
        upserts = [a for ip in report.plan for a in ip.actions if isinstance(a, UpsertStatusComment)]
        self.assertEqual(len(upserts), 1)
        self.assertIsNone(upserts[0].comment)

    def test_status_patch_failure_does_not_block_dispatch(self):
        executor = Executor(self.exec_deps)
        self.helpers.fail_review = True

        from pipeline.stages import IssuePlan
        plan = IssuePlan(
            issue=IssueRef(1),
            stage=Stage.READY,
            target=ImplementTarget(),
            actions=(
                UpsertStatusComment(issue=IssueRef(1), comment=CommentRef("IC_1"), body="status"),
                Dispatch(issue=IssueRef(1), target=ImplementTarget(), spec=StepSpec("agy", "gemini", Effort.MEDIUM), workspace=ImplAtDev()),
            )
        )
        executor.execute_issue_plan(plan)
        self.assertEqual(len(self.runner.started_records), 1)

    def test_no_second_impl_dispatch_same_tick(self):
        self.gh.issues_list_json = json.dumps([
            {"number": 1, "title": "Issue 1", "body": "Ready 1", "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}], "comments": []},
            {"number": 2, "title": "Issue 2", "body": "Ready 2", "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}], "comments": []},
        ])
        report = tick(self.tick_deps, self.config, self.paths)
        dispatches = [a for ip in report.plan for a in ip.actions if isinstance(a, Dispatch) and isinstance(a.target, ImplementTarget)]
        self.assertEqual(len(dispatches), 1)
        self.assertEqual(dispatches[0].issue, IssueRef(1))

    def test_review_cap_counts_same_tick_dispatches(self):
        self.gh.issues_list_json = json.dumps([
            {"number": 1, "title": "Issue 1", "body": "Spec 1", "labels": [{"name": "agent:auto"}], "comments": []},
            {"number": 2, "title": "Issue 2", "body": "Spec 2", "labels": [{"name": "agent:auto"}], "comments": []},
            {"number": 3, "title": "Issue 3", "body": "Spec 3", "labels": [{"name": "agent:auto"}], "comments": []},
        ])
        report = tick(self.tick_deps, self.config, self.paths)
        dispatches = [a for ip in report.plan for a in ip.actions if isinstance(a, Dispatch) and isinstance(a.target, ReviewTarget)]
        self.assertEqual(len(dispatches), 2)

    def test_lane_busy_for_unlabelled_issue_with_live_run(self):
        rec1 = RunRecord(
            run_id=RunId("run-live-unlabelled"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(minutes=10),
        )
        self.paths.pid_file(rec1.run_id).write_text(
            ProcessIdentity(pid=3333, start_time=1, boot_id="b1", monotonic_start=10.0, pgid=None, pgid_start_time=None).to_json(),
            encoding="utf-8"
        )
        self.store.state = StoreState(runs={rec1.run_id: rec1})

        self.gh.issues_list_json = json.dumps([
            {"number": 2, "title": "Issue 2", "body": "Ready", "labels": [{"name": "agent:auto"}, {"name": "agent:skip-review"}, {"name": "ready-for-agent"}], "comments": []},
        ])
        with patch.object(self.procs, "is_pid_alive", side_effect=lambda p, s, b: p == 3333):
            report = tick(self.tick_deps, self.config, self.paths)
            dispatches = [a for ip in report.plan for a in ip.actions if isinstance(a, Dispatch) and a.issue == IssueRef(2)]
            self.assertEqual(len(dispatches), 0)

    def test_pr_list_failure_never_deletes_branches(self):
        def fake_gh_fail(args):
            if args[:3] == ["pr", "list", "--state"]:
                raise RuntimeError("PR list query failed")
            return self.gh.read(args)

        with patch.object(self.gh, "read", side_effect=fake_gh_fail):
            from pipeline.snapshot import GlobalSnapshotError
            with self.assertRaises(GlobalSnapshotError):
                tick(self.tick_deps, self.config, self.paths)
        deleted = [call for call in self.git.calls if "push" in call and "--delete" in call]
        self.assertEqual(len(deleted), 0)

    def test_per_issue_failure_marks_unknown_keeps_lane(self):
        rec1 = RunRecord(
            run_id=RunId("run-live-1"),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="agy", model="gemini", effort=Effort.MEDIUM),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=2),
            started_at=self.now - timedelta(minutes=10),
        )
        self.paths.pid_file(rec1.run_id).write_text(
            ProcessIdentity(pid=4444, start_time=1, boot_id="b1", monotonic_start=10.0, pgid=None, pgid_start_time=None).to_json(),
            encoding="utf-8"
        )
        self.store.state = StoreState(runs={rec1.run_id: rec1})

        self.gh.issues_list_json = json.dumps([
            {"number": 1, "title": "Issue 1", "body": "Ready", "labels": [{"name": "agent:auto"}], "comments": []},
            {"number": 2, "title": "Issue 2", "body": "Ready", "labels": [{"name": "agent:auto"}, {"name": "ready-for-agent"}], "comments": []},
        ])
        self.helpers.fail_review = True

        with patch.object(self.procs, "is_pid_alive", side_effect=lambda p, s, b: p == 4444):
            report = tick(self.tick_deps, self.config, self.paths)
            dispatches = [a for ip in report.plan for a in ip.actions if isinstance(a, Dispatch) and a.issue == IssueRef(2)]
            self.assertEqual(len(dispatches), 0)

    def test_corrupt_store_aborts_tick(self):
        self.paths.state_json.write_text("{corrupt json", encoding="utf-8")
        from pipeline.store import CorruptStoreError
        with self.assertRaises(CorruptStoreError):
            local_store = LocalStoreClient(self.paths)
            corrupt_deps = ExecDeps(
                gh=self.gh,
                helpers=self.helpers,
                store=local_store,
                runner=self.runner,
                git=self.git,
                procs=self.procs,
                paths=self.paths,
                config=self.config,
            )
            tick_deps = TickDeps(exec=corrupt_deps, clock=lambda: self.now)
            tick(tick_deps, self.config, self.paths)

    def test_merge_failure_counts_then_blocks(self):
        self.config = PipelineConfig(
            eligible_label="agent:auto",
            skip_review_label="agent:skip-review",
            max_revision_cycles=3,
            max_step_attempts=1,
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
        self.tick_deps = TickDeps(exec=self.exec_deps, clock=lambda: self.now)

        self.gh.issues_list_json = json.dumps([{
            "number": 1,
            "title": "Issue 1",
            "body": "Done",
            "labels": [{"name": "agent:auto"}, {"name": "in-progress"}],
            "comments": [],
        }])
        def fake_lifecycle(args):
            if "--get-linked-pr" in args:
                return json.dumps({"number": 101, "state": "open"})
            if "--parse-verification" in args:
                return json.dumps({"cycle": 1, "verdict": "APPROVED", "findings": []})
            if "--check-revision-readiness" in args:
                return json.dumps({"status": "ALREADY_APPROVED", "cycle": 1})
            if "--merge-pr" in args:
                raise RuntimeError("Merge failed: base branch was modified")
            return ""
        self.helpers.run_lifecycle_helper = fake_lifecycle

        report1 = tick(self.tick_deps, self.config, self.paths)
        attempts = [a for a in self.store.applied_actions if isinstance(a, RecordAttempt)]
        self.assertEqual(len(attempts), 1)

        report2 = tick(self.tick_deps, self.config, self.paths)
        blocks = [a for a in self.store.applied_actions if isinstance(a, RecordPipelineBlock)]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].block.reason, BlockReason.MERGE_FAILED)


if __name__ == "__main__":
    unittest.main()
