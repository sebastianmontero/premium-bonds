import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.actions import (
    ClearPipelineBlock,
    EditLabels,
    FinishRun,
    RecordAttempt,
    RecordPipelineBlock,
    RecordRun,
    RecordRunnerHandle,
)
from pipeline.model import (
    AttemptKind,
    BlockReason,
    Fingerprint,
    ImplementTarget,
    IssueRef,
    Liveness,
    PipelineBlock,
    PrRef,
    RunId,
)
from pipeline.state import (
    ActiveRun,
    FinishedRun,
    HeadlessHandle,
    IssueLocalState,
    RunOutcome,
    RunRecord,
    StoreState,
    apply_store_action,
    build_views,
    overlay_labels,
)
from tests.pipeline.builders import (
    active_run,
    failed_snapshot,
    issue,
    run_record,
)

EPOCH = datetime(2026, 10, 17, 0, 0, 0, tzinfo=timezone.utc)


class TestState(unittest.TestCase):
    def test_record_attempt(self):
        state = StoreState()
        fp = Fingerprint(AttemptKind.REVIEW, "1")
        action = RecordAttempt(issue=IssueRef(1), fingerprint=fp, detail="review timeout")
        s1 = apply_store_action(state, action)

        local = s1.issues[IssueRef(1)]
        self.assertEqual(local.attempts[fp], 1)
        self.assertEqual(local.last_detail[fp], "review timeout")

        # Second attempt
        action2 = RecordAttempt(issue=IssueRef(1), fingerprint=fp, detail="syntax error")
        s2 = apply_store_action(s1, action2)
        local2 = s2.issues[IssueRef(1)]
        self.assertEqual(local2.attempts[fp], 2)
        self.assertEqual(local2.last_detail[fp], "syntax error")

    def test_record_pipeline_block(self):
        state = StoreState()
        blk = PipelineBlock(reason=BlockReason.CIRCUIT_BREAKER, ref=PrRef(101))
        s1 = apply_store_action(state, RecordPipelineBlock(issue=IssueRef(1), block=blk))
        self.assertEqual(s1.issues[IssueRef(1)].block, blk)

    def test_clear_pipeline_block_preserves_implement_attempted(self):
        # Set up an issue with attempts, block, and implement_attempted = True
        fp = Fingerprint(AttemptKind.IMPLEMENT, "")
        local = IssueLocalState(
            attempts={fp: 2},
            last_detail={fp: "failed"},
            block=PipelineBlock(BlockReason.IMPL_RETRIES_EXHAUSTED, fp),
            implement_attempted=True,
            abandoned_prs=frozenset([PrRef(50)]),
        )
        state = StoreState(issues={IssueRef(1): local})

        # Clear block with an abandon_pr
        action = ClearPipelineBlock(issue=IssueRef(1), abandon_pr=PrRef(51))
        s1 = apply_store_action(state, action)

        cleared = s1.issues[IssueRef(1)]
        self.assertEqual(cleared.attempts, {})
        self.assertEqual(cleared.last_detail, {})
        self.assertIsNone(cleared.block)
        self.assertTrue(cleared.implement_attempted)
        self.assertEqual(cleared.abandoned_prs, frozenset([PrRef(50), PrRef(51)]))

    def test_record_run_marks_implement_attempted(self):
        state = StoreState()
        rec_impl = run_record(run_id="run-impl", issue_num=1, target=ImplementTarget())
        s1 = apply_store_action(state, RecordRun(record=rec_impl))

        self.assertIn(RunId("run-impl"), s1.runs)
        self.assertTrue(s1.issues[IssueRef(1)].implement_attempted)

    def test_record_runner_handle(self):
        state = StoreState()
        handle = HeadlessHandle()
        s1 = apply_store_action(state, RecordRunnerHandle(run_id=RunId("run-1"), handle=handle))
        self.assertEqual(s1.handles[RunId("run-1")], handle)

    def test_finish_run_and_pruning_to_last_5(self):
        state = StoreState()
        handle = HeadlessHandle()
        state = apply_store_action(state, RecordRunnerHandle(run_id=RunId("run-0"), handle=handle))

        # Add 6 runs for issue 1
        for i in range(6):
            rec = run_record(run_id=f"run-{i}", issue_num=1, started_at=EPOCH + timedelta(minutes=i * 10))
            state = apply_store_action(state, RecordRun(record=rec))

        # Finish all 6 runs in order
        for i in range(6):
            outcome = RunOutcome(
                exit_code=0,
                finished_at=EPOCH + timedelta(minutes=i * 10 + 5),
                liveness=Liveness.EXITED,
            )
            state = apply_store_action(state, FinishRun(run_id=RunId(f"run-{i}"), outcome=outcome))

        # Runs map should be empty, finished should contain exactly 5 most recent runs (run-1 through run-5)
        self.assertEqual(len(state.runs), 0)
        self.assertEqual(len(state.finished), 5)
        self.assertNotIn(RunId("run-0"), state.finished)
        self.assertIn(RunId("run-5"), state.finished)

    def test_build_views_alive_run_only(self):
        snap = issue(number=1)
        rec_alive = run_record(run_id="r-alive", issue_num=1)
        rec_exited = run_record(run_id="r-exited", issue_num=1)

        active_runs = {
            RunId("r-alive"): active_run(record=rec_alive, liveness=Liveness.ALIVE),
            RunId("r-exited"): active_run(record=rec_exited, liveness=Liveness.EXITED),
        }

        views = build_views([snap], StoreState(), active_runs)
        v = views[IssueRef(1)]
        self.assertEqual(v.run.live_run, rec_alive)

    def test_overlay_labels(self):
        snap1 = issue(number=1, labels=["agent:auto", "needs-info"])
        snap2 = failed_snapshot(number=2, labels=["agent:auto"])
        views = build_views([snap1, snap2], StoreState(), {})

        actions = [
            EditLabels(target=IssueRef(1), add=("ready-for-agent",), remove=("needs-info",)),
            EditLabels(target=IssueRef(2), add=("needs-info",), remove=()),
        ]

        overlaid = overlay_labels(views, actions)

        v1 = overlaid[IssueRef(1)]
        self.assertIn("ready-for-agent", v1.gh.labels)
        self.assertNotIn("needs-info", v1.gh.labels)

        v2 = overlaid[IssueRef(2)]
        self.assertIn("needs-info", v2.gh.labels)


if __name__ == "__main__":
    unittest.main()
