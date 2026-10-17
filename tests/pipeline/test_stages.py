import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

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
    StoreAction,
)
from pipeline.model import (
    AttemptKind,
    BlockReason,
    CircuitBreaker,
    CommentRef,
    DecisionsUnresolved,
    Editor,
    Effort,
    Fingerprint,
    ImplAtDev,
    ImplAtPrHead,
    ImplementTarget,
    IntegrateTarget,
    IntegratorQuestion,
    IssueRef,
    LaneBusy,
    LaneConflict,
    Liveness,
    MergeConflict,
    MergeFailed,
    Mergeable,
    Phase,
    PipelineBlock,
    PipelineLabels,
    PipelineNotice,
    PrRef,
    PrUnrecognized,
    Readiness,
    RetriesExhausted,
    ReviewCapReached,
    ReviewId,
    ReviewSlot,
    ReviewStatus,
    ReviewTarget,
    ReviseTarget,
    RunId,
    Stage,
    Step,
    StepSpec,
    StepTarget,
    Unresolved,
    UnresolvedReason,
    UntrustedEdit,
    VerificationId,
    VerifyTarget,
    _ACTION_REQUIRED,
)
from pipeline.stages import pending_fingerprint, plan_issue, plan_tick, reap
from pipeline.state import (
    ActiveRun,
    FinishedRun,
    IssueLocalState,
    IssueRunState,
    IssueView,
    RunOutcome,
    StoreState,
    apply_store_action,
    build_views,
    overlay_labels,
)
from tests.pipeline.builders import (
    active_run,
    closed_pr,
    decision,
    default_config,
    failed_snapshot,
    finished_run,
    issue,
    merged_pr,
    open_pr,
    review,
    run_record,
    view,
)

EPOCH = datetime(2026, 10, 17, 0, 0, 0, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)


class TestStagesCoverage(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_coverage_for_all_18_stage_members(self):
        # 1. RUNNING
        v1 = view(gh=issue(number=1), live_run=run_record(issue_num=1))
        self.assertEqual(plan_issue(v1, self.config, NOW).stage, Stage.RUNNING)

        # 2. SNAPSHOT_FAILED
        v2 = view(gh=failed_snapshot(number=2))
        self.assertEqual(plan_issue(v2, self.config, NOW).stage, Stage.SNAPSHOT_FAILED)

        # 3. INELIGIBLE (closed or missing label)
        v3 = view(gh=issue(number=3, labels=[]))
        self.assertEqual(plan_issue(v3, self.config, NOW).stage, Stage.INELIGIBLE)

        # 4. MERGED
        v4 = view(gh=issue(number=4, pr=merged_pr(401)))
        self.assertEqual(plan_issue(v4, self.config, NOW).stage, Stage.MERGED)

        # 5. RESUMED (block recorded, but blocking label was removed by human)
        blk = PipelineBlock(BlockReason.CIRCUIT_BREAKER, PrRef(501))
        v5 = view(
            gh=issue(number=5, pr=open_pr(501), labels=["agent:auto"]),
            local=IssueLocalState(block=blk),
        )
        self.assertEqual(plan_issue(v5, self.config, NOW).stage, Stage.RESUMED)

        # 6. BLOCKED_HUMAN (ready-for-human or needs-info present)
        v6 = view(gh=issue(number=6, labels=["agent:auto", "ready-for-human"]))
        self.assertEqual(plan_issue(v6, self.config, NOW).stage, Stage.BLOCKED_HUMAN)

        # 7. UNTRUSTED_EDIT
        v7 = view(gh=issue(number=7, body_trusted=False))
        self.assertEqual(plan_issue(v7, self.config, NOW).stage, Stage.UNTRUSTED_EDIT)

        # 8. BREAKER_TRIP
        pr8 = open_pr(801, readiness=Readiness.CIRCUIT_BREAKER_TRIPPED, verification_id="ver-1")
        v8 = view(gh=issue(number=8, pr=pr8))
        self.assertEqual(plan_issue(v8, self.config, NOW).stage, Stage.BREAKER_TRIP)

        # 9. AWAITING_MERGE
        pr9 = open_pr(901, readiness=Readiness.ALREADY_APPROVED)
        v9 = view(gh=issue(number=9, pr=pr9))
        self.assertEqual(plan_issue(v9, self.config, NOW).stage, Stage.AWAITING_MERGE)

        # 10. VERIFY
        pr10 = open_pr(1001, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)
        v10 = view(gh=issue(number=10, pr=pr10))
        self.assertEqual(plan_issue(v10, self.config, NOW).stage, Stage.VERIFY)

        # 11. REVISE
        pr11 = open_pr(1101, readiness=Readiness.AWAITING_REVISION)
        v11 = view(gh=issue(number=11, pr=pr11))
        self.assertEqual(plan_issue(v11, self.config, NOW).stage, Stage.REVISE)

        # 12. PR_UNRECOGNIZED
        pr12 = open_pr(1201, readiness=Readiness.UNKNOWN, raw_verdict="MYSTERY")
        v12 = view(gh=issue(number=12, pr=pr12))
        self.assertEqual(plan_issue(v12, self.config, NOW).stage, Stage.PR_UNRECOGNIZED)

        # 13. PR_CLOSED_UNMERGED
        pr13 = closed_pr(1301)
        v13 = view(gh=issue(number=13, pr=pr13, labels=["agent:auto", "in-progress"]))
        self.assertEqual(plan_issue(v13, self.config, NOW).stage, Stage.PR_CLOSED_UNMERGED)

        # 14. IMPLEMENTING_ORPHAN (in-progress, spec complete, no PR)
        r1 = review(round=1, status=ReviewStatus.INTEGRATED)
        r2 = review(round=2, status=ReviewStatus.INTEGRATED)
        v14 = view(gh=issue(number=14, labels=["agent:auto", "in-progress"], reviews=[r1, r2]))
        self.assertEqual(plan_issue(v14, self.config, NOW).stage, Stage.IMPLEMENTING_ORPHAN)

        # 15. DECISIONS_UNRESOLVED
        dec_unres = decision(resolution=Unresolved(UnresolvedReason.NO_SELECTION))
        r_dec = review(round=1, status=ReviewStatus.AWAITING_DECISION, decisions=[dec_unres])
        v15 = view(gh=issue(number=15, reviews=[r_dec]))
        self.assertEqual(plan_issue(v15, self.config, NOW).stage, Stage.DECISIONS_UNRESOLVED)

        # 16. INTEGRATE
        r_pend = review(round=1, status=ReviewStatus.PENDING)
        v16 = view(gh=issue(number=16, reviews=[r_pend]))
        self.assertEqual(plan_issue(v16, self.config, NOW).stage, Stage.INTEGRATE)

        # 17. REVIEW
        v17 = view(gh=issue(number=17))
        self.assertEqual(plan_issue(v17, self.config, NOW).stage, Stage.REVIEW)

        # 18. READY
        v18 = view(gh=issue(number=18, reviews=[r1, r2]))
        self.assertEqual(plan_issue(v18, self.config, NOW).stage, Stage.READY)

    def test_open_pr_never_reaches_spec_stages(self):
        for readiness in Readiness:
            pr = open_pr(101, readiness=readiness)
            v = view(gh=issue(number=1, pr=pr))
            plan = plan_issue(v, self.config, NOW)
            self.assertNotIn(
                plan.stage,
                (
                    Stage.PR_CLOSED_UNMERGED,
                    Stage.IMPLEMENTING_ORPHAN,
                    Stage.DECISIONS_UNRESOLVED,
                    Stage.INTEGRATE,
                    Stage.REVIEW,
                    Stage.READY,
                ),
                f"Readiness {readiness} must never reach spec stages",
            )

    def test_pending_fingerprint_matches_plan_issue_target_fingerprint(self):
        scenarios = [
            view(gh=issue(number=1)),  # Review target
            view(gh=issue(number=2, reviews=[review(round=1, status=ReviewStatus.PENDING)])),  # Integrate
            view(gh=issue(number=3, pr=open_pr(301, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION))),  # Verify
            view(gh=issue(number=4, pr=open_pr(401, readiness=Readiness.AWAITING_REVISION))),  # Revise
            view(
                gh=issue(
                    number=5,
                    reviews=[
                        review(round=1, status=ReviewStatus.INTEGRATED),
                        review(round=2, status=ReviewStatus.INTEGRATED),
                    ],
                )
            ),  # Implement
        ]
        for v in scenarios:
            plan = plan_issue(v, self.config, NOW)
            pf = pending_fingerprint(v, self.config)
            if plan.target is not None:
                self.assertEqual(pf, plan.target.fingerprint)
            else:
                self.assertIsNone(pf)


class TestLaneAndConcurrency(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_lane_holding_rules(self):
        # 1. live run holding lane holds lane
        r_impl = run_record(run_id="run-lane", issue_num=1, target=ImplementTarget())
        v1 = view(gh=issue(number=1))
        views = {IssueRef(1): v1, IssueRef(2): view(gh=issue(number=2))}
        tick_plan = plan_tick(views, [r_impl], self.config, NOW)
        p1 = next(p for p in tick_plan if p.issue == IssueRef(1))
        # 2. OpenPr holds lane
        v2 = view(gh=issue(number=2, pr=open_pr(201, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)))
        tick_plan2 = plan_tick({IssueRef(2): v2}, [], self.config, NOW)
        p2 = tick_plan2[0]
        # Dispatched verify target because it holds lane and no conflicting live run
        self.assertTrue(any(isinstance(a, Dispatch) for a in p2.actions))

    def test_ready_for_human_alone_does_not_hold_lane(self):
        # Issue with ready-for-human alone (no block, no PR, no live run)
        v_rfh = view(gh=issue(number=1, labels=["agent:auto", "ready-for-human"]))
        # Another issue that is READY
        r1 = review(round=1, status=ReviewStatus.INTEGRATED)
        r2 = review(round=2, status=ReviewStatus.INTEGRATED)
        v_ready = view(gh=issue(number=2, reviews=[r1, r2]))

        tick_plan = plan_tick({IssueRef(1): v_rfh, IssueRef(2): v_ready}, [], self.config, NOW)
        p_ready = next(p for p in tick_plan if p.issue == IssueRef(2))
        # Candidate READY issue admitted because issue 1 does NOT hold the lane!
        self.assertTrue(any(isinstance(a, Dispatch) for a in p_ready.actions))

    def test_live_lane_run_of_unlabelled_issue_keeps_lane_busy(self):
        r_unlabelled = run_record(run_id="run-orphan", issue_num=99, target=ImplementTarget())
        r1 = review(round=1, status=ReviewStatus.INTEGRATED)
        r2 = review(round=2, status=ReviewStatus.INTEGRATED)
        v_ready = view(gh=issue(number=1, reviews=[r1, r2]))

        tick_plan = plan_tick({IssueRef(1): v_ready}, [r_unlabelled], self.config, NOW)
        p1 = tick_plan[0]
        # Target not admitted because live lane run is running
        self.assertFalse(any(isinstance(a, Dispatch) for a in p1.actions))

    def test_two_lane_holders_single_dispatch(self):
        # Two issues with open PRs
        pr1 = open_pr(101, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)
        pr2 = open_pr(201, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)
        v1 = view(gh=issue(number=1, pr=pr1))
        v2 = view(gh=issue(number=2, pr=pr2))

        tick_plan = plan_tick({IssueRef(1): v1, IssueRef(2): v2}, [], self.config, NOW)
        dispatches = [a for p in tick_plan for a in p.actions if isinstance(a, Dispatch)]
        self.assertEqual(len(dispatches), 1)
        self.assertEqual(dispatches[0].issue, IssueRef(1))

    def test_review_cap_and_slot_assignment(self):
        # Review concurrency = 2
        v1 = view(gh=issue(number=1))  # Review round 1
        v2 = view(gh=issue(number=2))  # Review round 1
        v3 = view(gh=issue(number=3))  # Review round 1

        tick_plan = plan_tick({IssueRef(1): v1, IssueRef(2): v2, IssueRef(3): v3}, [], self.config, NOW)
        dispatches = [a for p in tick_plan for a in p.actions if isinstance(a, Dispatch)]
        self.assertEqual(len(dispatches), 2)
        self.assertEqual(dispatches[0].workspace, ReviewSlot(0))
        self.assertEqual(dispatches[1].workspace, ReviewSlot(1))

        # Issue 3 gets ReviewCapReached
        p3 = next(p for p in tick_plan if p.issue == IssueRef(3))
        self.assertFalse(any(isinstance(a, Dispatch) for a in p3.actions))


class TestReap(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_reap_equal_fingerprint_records_attempt(self):
        rec = run_record(run_id="run-1", issue_num=1, target=ReviewTarget(1))
        ar = active_run(record=rec, liveness=Liveness.EXITED, group_alive=False)
        v = view(gh=issue(number=1))  # pending_fingerprint is review:1
        actions = reap({RunId("run-1"): ar}, {IssueRef(1): v}, self.config)

        self.assertTrue(any(isinstance(a, FinishRun) for a in actions))
        attempts = [a for a in actions if isinstance(a, RecordAttempt)]
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].fingerprint, Fingerprint(AttemptKind.REVIEW, "1"))

    def test_reap_advanced_fingerprint_records_no_attempt(self):
        rec = run_record(run_id="run-1", issue_num=1, target=ReviewTarget(1))
        ar = active_run(record=rec, liveness=Liveness.EXITED, group_alive=False)
        # Issue has advanced: review 1 is already integrated!
        v = view(gh=issue(number=1, reviews=[review(round=1, status=ReviewStatus.INTEGRATED)]))
        actions = reap({RunId("run-1"): ar}, {IssueRef(1): v}, self.config)

        self.assertTrue(any(isinstance(a, FinishRun) for a in actions))
        self.assertFalse(any(isinstance(a, RecordAttempt) for a in actions))

    def test_reap_integrator_question_blocks_without_attempt(self):
        rev_id = ReviewId("rev-1")
        target = IntegrateTarget(review_id=rev_id, comment=CommentRef("IC_1"))
        rec = run_record(run_id="run-int", issue_num=1, target=target, started_at=NOW)
        ar = active_run(record=rec, liveness=Liveness.EXITED, group_alive=False)

        # Issue has a needs_input notice within 5 minutes of started_at
        notice = PipelineNotice(kind="needs_input", review_id=rev_id, created_at=NOW - timedelta(minutes=2))
        r_pend = review(review_id=rev_id.value, round=1, status=ReviewStatus.PENDING)
        v = view(gh=issue(number=1, reviews=[r_pend], pipeline_notices=[notice]))

        actions = reap({RunId("run-int"): ar}, {IssueRef(1): v}, self.config)
        self.assertFalse(any(isinstance(a, RecordAttempt) for a in actions))
        blocks = [a for a in actions if isinstance(a, RecordPipelineBlock)]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].block.reason, BlockReason.INTEGRATOR_QUESTION)

    def test_no_stage_emits_record_attempt(self):
        # Verify that plan_issue never emits RecordAttempt directly across all scenarios
        scenarios = [
            view(gh=issue(number=1)),
            view(gh=issue(number=2, pr=open_pr(201, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION))),
            view(gh=issue(number=3, pr=open_pr(301, readiness=Readiness.CIRCUIT_BREAKER_TRIPPED))),
            view(gh=issue(number=4, labels=["agent:auto", "in-progress"])),
        ]
        for v in scenarios:
            plan = plan_issue(v, self.config, NOW)
            self.assertFalse(any(isinstance(a, RecordAttempt) for a in plan.actions))

    def test_reap_timed_out_and_exited_with_group_alive_kills_group(self):
        rec1 = run_record(run_id="r1", issue_num=1)
        ar1 = active_run(record=rec1, liveness=Liveness.TIMED_OUT, group_alive=True, pgid=5555)

        rec2 = run_record(run_id="r2", issue_num=2)
        ar2 = active_run(record=rec2, liveness=Liveness.EXITED, group_alive=True, pgid=6666)

        actions = reap({RunId("r1"): ar1, RunId("r2"): ar2}, {}, self.config)
        kills = [a for a in actions if isinstance(a, KillRunGroup)]
        self.assertEqual(len(kills), 2)
        self.assertEqual({k.pgid for k in kills}, {5555, 6666})


class TestTickDataFlowPureFold(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_attempt_reaching_limit_blocks_same_tick(self):
        # Run finished and did not advance. Local state already had 1 attempt. max_step_attempts = 2.
        fp = Fingerprint(AttemptKind.REVIEW, "1")
        rec = run_record(run_id="r-rev", issue_num=1, target=ReviewTarget(1))
        ar = active_run(record=rec, liveness=Liveness.EXITED, group_alive=False)

        local0 = IssueLocalState(attempts={fp: 1})
        v0 = view(gh=issue(number=1), local=local0)

        # 1. reap
        reaped_actions = reap({RunId("r-rev"): ar}, {IssueRef(1): v0}, self.config)

        # 2. reduce store actions
        state0 = StoreState(issues={IssueRef(1): local0})
        for act in reaped_actions:
            if isinstance(act, StoreAction):
                state0 = apply_store_action(state0, act)

        local1 = state0.issues.get(IssueRef(1), IssueLocalState())
        self.assertEqual(local1.attempts[fp], 2)
        v1 = view(gh=issue(number=1), local=local1)

        # 3. plan_tick sees the post-reap attempt count and blocks immediately in the same tick!
        tick_plan = plan_tick({IssueRef(1): v1}, [], self.config, NOW)
        p1 = tick_plan[0]
        blocks = [a for a in p1.actions if isinstance(a, RecordPipelineBlock)]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].block.reason, BlockReason.SPEC_RETRIES_EXHAUSTED)


class TestImplementingAndMerging(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_orphan_implementing_issue_queued_does_not_burn_attempts(self):
        r1 = review(round=1, status=ReviewStatus.INTEGRATED)
        r2 = review(round=2, status=ReviewStatus.INTEGRATED)
        v_orphan = view(gh=issue(number=1, labels=["agent:auto", "in-progress"], reviews=[r1, r2]))

        # Live lane run on another issue holds the lane
        r_busy = run_record(run_id="r-busy", issue_num=99, target=ImplementTarget())

        # Repeated ticks with the lane busy:
        plan1 = plan_tick({IssueRef(1): v_orphan}, [r_busy], self.config, NOW)[0]
        self.assertFalse(any(isinstance(a, RecordAttempt) for a in plan1.actions))
        self.assertFalse(any(isinstance(a, Dispatch) for a in plan1.actions))

    def test_spec_incomplete_with_stray_in_progress_removes_in_progress(self):
        # Issue has in-progress, but reviews are not yet complete!
        v = view(gh=issue(number=1, labels=["agent:auto", "in-progress"]))
        plan = plan_issue(v, self.config, NOW)
        self.assertEqual(plan.stage, Stage.REVIEW)
        # Actions must contain EditLabels removing in-progress
        edit_labels = next(a for a in plan.actions if isinstance(a, EditLabels))
        self.assertIn("in-progress", edit_labels.remove)

    def test_awaiting_merge_table(self):
        # 1. MERGEABLE and auto_merge not enabled -> MergePr with on_failure RecordAttempt
        pr1 = open_pr(101, readiness=Readiness.ALREADY_APPROVED, mergeable=Mergeable.MERGEABLE, auto_merge_enabled=False)
        p1 = plan_issue(view(gh=issue(number=1, pr=pr1)), self.config, NOW)
        merge_act = next(a for a in p1.actions if isinstance(a, MergePr))
        self.assertEqual(merge_act.pr, PrRef(101))
        self.assertIsInstance(merge_act.on_failure, RecordAttempt)

        # 2. MERGEABLE and auto_merge enabled -> no action
        pr2 = open_pr(201, readiness=Readiness.ALREADY_APPROVED, mergeable=Mergeable.MERGEABLE, auto_merge_enabled=True)
        p2 = plan_issue(view(gh=issue(number=2, pr=pr2)), self.config, NOW)
        self.assertEqual(p2.actions, ())

        # 3. CONFLICTING -> block(MergeConflict)
        pr3 = open_pr(301, readiness=Readiness.ALREADY_APPROVED, mergeable=Mergeable.CONFLICTING)
        p3 = plan_issue(view(gh=issue(number=3, pr=pr3)), self.config, NOW)
        self.assertTrue(any(isinstance(a, RecordPipelineBlock) and a.block.reason == BlockReason.MERGE_CONFLICT for a in p3.actions))

        # 4. Merge attempts at limit -> MergeFailed
        fp_merge = Fingerprint(AttemptKind.MERGE, "401")
        pr4 = open_pr(401, readiness=Readiness.ALREADY_APPROVED)
        v4 = view(gh=issue(number=4, pr=pr4), local=IssueLocalState(attempts={fp_merge: 2}, last_detail={fp_merge: "base branch drifted"}))
        p4 = plan_issue(v4, self.config, NOW)
        blk_action = next(a for a in p4.actions if isinstance(a, RecordPipelineBlock))
        self.assertEqual(blk_action.block.reason, BlockReason.MERGE_FAILED)


class TestRetriesAndResumed(unittest.TestCase):
    def setUp(self):
        self.config = default_config()

    def test_retries_exhausted_when_last_finished_is_none(self):
        fp = Fingerprint(AttemptKind.VERIFY, "0")
        pr = open_pr(101, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)
        v = view(gh=issue(number=1, pr=pr), local=IssueLocalState(attempts={fp: 2}), last_finished=None)

        plan = plan_issue(v, self.config, NOW)
        self.assertEqual(plan.stage, Stage.VERIFY)
        self.assertIsNone(plan.target)
        blk = next(a for a in plan.actions if isinstance(a, RecordPipelineBlock)).block
        self.assertEqual(blk.reason, BlockReason.IMPL_RETRIES_EXHAUSTED)

    def test_run_id_is_none_when_last_finished_belongs_to_different_fingerprint(self):
        fp_v = Fingerprint(AttemptKind.VERIFY, "0")
        fp_old = Fingerprint(AttemptKind.IMPLEMENT, "")
        pr = open_pr(101, readiness=Readiness.READY_FOR_INITIAL_VERIFICATION)
        old_finished = finished_run(record=run_record(run_id="old-run", target=ImplementTarget()))
        v = view(gh=issue(number=1, pr=pr), local=IssueLocalState(attempts={fp_v: 2}), last_finished=old_finished)

        plan = plan_issue(v, self.config, NOW)
        # Cause should have run_id = None
        post_comment = next(a for a in plan.actions if isinstance(a, PostComment))
        self.assertIn("inspect `pipeline logs` for the issue locally", post_comment.body)

    def test_breaker_resume_posts_cycle_reset_with_last_verification_cycle(self):
        pr = open_pr(101, readiness=Readiness.READY_FOR_RE_VERIFICATION, last_verification_cycle=3, has_ready_for_human_label=True)
        blk = PipelineBlock(BlockReason.CIRCUIT_BREAKER, PrRef(101))
        # Label ready-for-human was removed by maintainer from issue!
        v = view(gh=issue(number=1, pr=pr, labels=["agent:auto"]), local=IssueLocalState(block=blk))

        plan = plan_issue(v, self.config, NOW)
        self.assertEqual(plan.stage, Stage.RESUMED)
        post = next(a for a in plan.actions if isinstance(a, PostComment))
        self.assertIn('"after_cycle": 3', post.body)
        # Also removes ready-for-human from PR
        edit_pr = next(a for a in plan.actions if isinstance(a, EditLabels) and a.target == PrRef(101))
        self.assertIn("ready-for-human", edit_pr.remove)

    def test_breaker_blocked_closed_pr_resumes_with_abandon(self):
        pr = closed_pr(101)
        blk = PipelineBlock(BlockReason.CIRCUIT_BREAKER, PrRef(101))
        v = view(gh=issue(number=1, pr=pr, labels=["agent:auto"]), local=IssueLocalState(block=blk))

        plan = plan_issue(v, self.config, NOW)
        self.assertEqual(plan.stage, Stage.RESUMED)
        clear = next(a for a in plan.actions if isinstance(a, ClearPipelineBlock))
        self.assertEqual(clear.abandon_pr, PrRef(101))


class TestPredicatesAndMarkers(unittest.TestCase):
    def test_stage_predicates_table_completeness(self):
        for stage in Stage:
            _ = stage.phase
            _ = stage.is_blocked_on_human
            self.assertIsInstance(stage.is_blocked_on_human, bool)

    def test_block_reason_predicates(self):
        for reason in BlockReason:
            self.assertIsInstance(reason.phase, Phase)

    def test_step_predicates(self):
        for step in Step:
            self.assertIsInstance(step.phase, Phase)
            self.assertIsInstance(step.skill, str)
            self.assertEqual(step.holds_lane, step.phase is Phase.IMPL)

    def test_action_required_table_completeness(self):
        for reason in BlockReason:
            self.assertIn(reason, _ACTION_REQUIRED)
            self.assertTrue(len(_ACTION_REQUIRED[reason]) > 10)

    def test_fingerprint_and_workspace_equality(self):
        # Fingerprint equality
        fp1 = Fingerprint(AttemptKind.REVIEW, "1")
        fp2 = Fingerprint(AttemptKind.REVIEW, "1")
        fp3 = Fingerprint(AttemptKind.REVIEW, "2")
        self.assertEqual(fp1, fp2)
        self.assertNotEqual(fp1, fp3)
        self.assertEqual(hash(fp1), hash(fp2))

        # Workspace equality
        self.assertEqual(ReviewSlot(0), ReviewSlot(0))
        self.assertNotEqual(ReviewSlot(0), ReviewSlot(1))
        self.assertEqual(ImplAtDev(), ImplAtDev())
        self.assertEqual(ImplAtPrHead("feat/x"), ImplAtPrHead("feat/x"))
        self.assertNotEqual(ImplAtPrHead("feat/x"), ImplAtPrHead("feat/y"))
        self.assertNotEqual(ImplAtDev(), ReviewSlot(0))


if __name__ == "__main__":
    unittest.main()
