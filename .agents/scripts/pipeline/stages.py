"""Pure reconciler core: plan_issue, pending_fingerprint, reap, and plan_tick.

This module imports only from model.py, actions.py, config.py, state.py,
status_comment.py, and standard library.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import assert_never

from .actions import (
    Action,
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
    UpsertStatusComment,
    block,
)
from .config import PipelineConfig
from .model import (
    AttemptKind,
    BlockReason,
    CircuitBreaker,
    ClosedPr,
    DecisionsUnresolved,
    Editor,
    FailedSnapshot,
    Fingerprint,
    ImplAtDev,
    ImplAtPrHead,
    ImplementTarget,
    IntegrateTarget,
    IntegratorQuestion,
    IssueRef,
    IssueSnapshot,
    LaneBusy,
    LaneConflict,
    Liveness,
    MergeConflict,
    MergeFailed,
    Mergeable,
    MergedPr,
    OpenPr,
    Phase,
    PipelineLabels,
    PipelineMarkers,
    PrClosedUnmerged,
    PrUnrecognized,
    QueueReason,
    Readiness,
    RetriesExhausted,
    ReviewCapReached,
    ReviewSlot,
    ReviewStatus,
    ReviewTarget,
    ReviseTarget,
    RunId,
    Stage,
    Step,
    StepTarget,
    Unresolved,
    UntrustedEdit,
    VerificationId,
    VerifyTarget,
)
from .state import ActiveRun, IssueView, RunOutcome, RunRecord
from .status_comment import needs_patch, render


@dataclass(frozen=True)
class IssuePlan:
    issue: IssueRef
    stage: Stage
    target: StepTarget | None
    actions: tuple[Action, ...]


TickPlan = tuple[IssuePlan, ...]


def plan_issue(view: IssueView, config: PipelineConfig, now: datetime) -> IssuePlan:
    # 1. RUNNING
    if view.run.live_run is not None:
        return IssuePlan(view.gh.issue, Stage.RUNNING, None, ())

    # 2. SNAPSHOT_FAILED
    if isinstance(view.gh, FailedSnapshot):
        return IssuePlan(view.gh.issue, Stage.SNAPSHOT_FAILED, None, ())

    gh = view.gh
    assert isinstance(gh, IssueSnapshot)

    # 3. INELIGIBLE
    if config.eligible_label not in gh.labels or not gh.is_open:
        return IssuePlan(gh.issue, Stage.INELIGIBLE, None, ())

    # 4. MERGED
    if isinstance(gh.linked_pr, MergedPr):
        actions: list[Action] = [CloseMergedIssue(gh.issue, gh.linked_pr.pr)]
        if view.run.local.block is not None:
            actions.append(ClearPipelineBlock(gh.issue))
        return IssuePlan(gh.issue, Stage.MERGED, None, tuple(actions))

    # 5. RESUMED
    if view.run.local.block is not None and view.run.local.block.reason.phase.block_label not in gh.labels:
        if isinstance(gh.linked_pr, ClosedPr):
            actions = [
                EditLabels(gh.issue, remove=(PipelineLabels.IN_PROGRESS,)),
                ClearPipelineBlock(gh.issue, abandon_pr=gh.linked_pr.pr),
            ]
        else:
            actions = []
            if isinstance(gh.linked_pr, OpenPr) and gh.linked_pr.has_ready_for_human_label:
                actions.append(EditLabels(gh.linked_pr.pr, remove=(PipelineLabels.READY_FOR_HUMAN,)))
            if (
                view.run.local.block.reason is BlockReason.CIRCUIT_BREAKER
                and isinstance(gh.linked_pr, OpenPr)
            ):
                actions.append(
                    PostComment(
                        gh.linked_pr.pr,
                        PipelineMarkers.cycle_reset(
                            after_cycle=gh.linked_pr.last_verification_cycle,
                            at=now,
                        ),
                    )
                )
            actions.append(ClearPipelineBlock(gh.issue))
        return IssuePlan(gh.issue, Stage.RESUMED, None, tuple(actions))

    # 6. BLOCKED_HUMAN
    if PipelineLabels.READY_FOR_HUMAN in gh.labels or PipelineLabels.NEEDS_INFO in gh.labels:
        return IssuePlan(gh.issue, Stage.BLOCKED_HUMAN, None, ())

    # 7. UNTRUSTED_EDIT
    if not gh.body_trusted:
        actions = block(gh.issue, UntrustedEdit(gh.editor or Editor("unknown")))
        return IssuePlan(gh.issue, Stage.UNTRUSTED_EDIT, None, actions)

    # OpenPr handling (rows 8-12)
    if isinstance(gh.linked_pr, OpenPr):
        open_pr = gh.linked_pr
        match open_pr.readiness:
            case Readiness.CIRCUIT_BREAKER_TRIPPED:
                actions = block(
                    gh.issue,
                    CircuitBreaker(
                        open_pr.pr,
                        open_pr.verification_id or VerificationId("unknown"),
                    ),
                )
                return IssuePlan(gh.issue, Stage.BREAKER_TRIP, None, actions)

            case Readiness.ALREADY_APPROVED:
                pr = open_pr.pr
                fp = Fingerprint(AttemptKind.MERGE, str(pr.number))
                attempts = view.run.local.attempts.get(fp, 0)
                if attempts >= config.max_step_attempts:
                    actions = block(gh.issue, MergeFailed(pr, view.run.local.last_detail.get(fp, "")))
                else:
                    match open_pr.mergeable:
                        case Mergeable.MERGEABLE:
                            if not open_pr.auto_merge_enabled:
                                actions = (MergePr(gh.issue, pr, on_failure=RecordAttempt(gh.issue, fp)),)
                            else:
                                actions = ()
                        case Mergeable.CONFLICTING:
                            actions = block(gh.issue, MergeConflict(pr))
                        case Mergeable.UNKNOWN:
                            actions = ()
                        case _ as unreachable:
                            assert_never(unreachable)
                return IssuePlan(gh.issue, Stage.AWAITING_MERGE, None, actions)

            case Readiness.READY_FOR_INITIAL_VERIFICATION | Readiness.READY_FOR_RE_VERIFICATION:
                v_target: StepTarget | None = VerifyTarget(
                    open_pr.pr,
                    open_pr.last_verification_cycle,
                )
                attempts = view.run.local.attempts.get(v_target.fingerprint, 0)
                if attempts >= config.max_step_attempts:
                    slug = config.spec_for(v_target).provenance_slug
                    rid = (
                        view.run.last_finished.record.run_id
                        if (
                            view.run.last_finished
                            and view.run.last_finished.record.target.fingerprint == v_target.fingerprint
                        )
                        else None
                    )
                    v_actions = block(gh.issue, RetriesExhausted(v_target.fingerprint, slug, attempts, rid))
                    v_target = None
                else:
                    v_actions = ()
                return IssuePlan(gh.issue, Stage.VERIFY, v_target, v_actions)

            case Readiness.AWAITING_REVISION:
                r_target: StepTarget | None = ReviseTarget(
                    open_pr.pr,
                    open_pr.last_verification_cycle,
                )
                attempts = view.run.local.attempts.get(r_target.fingerprint, 0)
                if attempts >= config.max_step_attempts:
                    slug = config.spec_for(r_target).provenance_slug
                    rid = (
                        view.run.last_finished.record.run_id
                        if (
                            view.run.last_finished
                            and view.run.last_finished.record.target.fingerprint == r_target.fingerprint
                        )
                        else None
                    )
                    r_actions = block(gh.issue, RetriesExhausted(r_target.fingerprint, slug, attempts, rid))
                    r_target = None
                else:
                    r_actions = ()
                return IssuePlan(gh.issue, Stage.REVISE, r_target, r_actions)

            case Readiness.UNKNOWN:
                actions = block(gh.issue, PrUnrecognized(open_pr.pr, open_pr.raw_verdict))
                return IssuePlan(gh.issue, Stage.PR_UNRECOGNIZED, None, actions)

            case _ as unreachable:
                assert_never(unreachable)

    assert not isinstance(gh.linked_pr, OpenPr), "OpenPr must never reach spec stages"

    # 13. PR_CLOSED_UNMERGED
    if (
        isinstance(gh.linked_pr, ClosedPr)
        and (gh.linked_pr.pr not in view.run.local.abandoned_prs)
        and (PipelineLabels.IN_PROGRESS in gh.labels)
    ):
        actions = block(gh.issue, PrClosedUnmerged(gh.linked_pr.pr))
        return IssuePlan(gh.issue, Stage.PR_CLOSED_UNMERGED, None, actions)

    # Spec completeness predicate (READY predicate)
    integrated_rounds = {
        r.round for r in gh.reviews
        if r.round is not None and r.status is ReviewStatus.INTEGRATED
    }
    is_spec_complete = (config.skip_review_label in gh.labels) or all(
        k in integrated_rounds for k in range(1, len(config.reviews) + 1)
    )

    # 14. IMPLEMENTING_ORPHAN
    if (
        PipelineLabels.IN_PROGRESS in gh.labels
        and (gh.linked_pr is None or isinstance(gh.linked_pr, ClosedPr))
        and is_spec_complete
    ):
        o_target: StepTarget | None = ImplementTarget()
        attempts = view.run.local.attempts.get(o_target.fingerprint, 0)
        if attempts >= config.max_step_attempts:
            slug = config.spec_for(o_target).provenance_slug
            rid = (
                view.run.last_finished.record.run_id
                if (
                    view.run.last_finished
                    and view.run.last_finished.record.target.fingerprint == o_target.fingerprint
                )
                else None
            )
            o_actions = block(gh.issue, RetriesExhausted(o_target.fingerprint, slug, attempts, rid))
            o_target = None
        else:
            o_actions = (DeleteStaleBranches(gh.issue),)
        return IssuePlan(gh.issue, Stage.IMPLEMENTING_ORPHAN, o_target, o_actions)

    stray_in_progress = PipelineLabels.IN_PROGRESS in gh.labels

    # 15. DECISIONS_UNRESOLVED
    unresolved_rev = None
    for rev in gh.reviews:
        if rev.status is ReviewStatus.MALFORMED:
            unresolved_rev = rev
            break
        if rev.status is ReviewStatus.AWAITING_DECISION and any(
            isinstance(d.resolution, Unresolved) for d in rev.decisions
        ):
            unresolved_rev = rev
            break

    if unresolved_rev is not None:
        unresolved = tuple(
            (d.id, d.resolution.reason)
            for d in unresolved_rev.decisions
            if isinstance(d.resolution, Unresolved)
        )
        cause = DecisionsUnresolved(
            unresolved_rev.review_id,
            unresolved,
            unresolved_rev.status is ReviewStatus.MALFORMED,
        )
        act_list = list(block(gh.issue, cause))
        if stray_in_progress:
            act_list.insert(0, EditLabels(gh.issue, remove=(PipelineLabels.IN_PROGRESS,)))
        return IssuePlan(gh.issue, Stage.DECISIONS_UNRESOLVED, None, tuple(act_list))

    # 16. INTEGRATE
    candidates = [
        r for r in gh.reviews
        if r.round is not None
        and (
            r.status in (ReviewStatus.PENDING, ReviewStatus.PARTIALLY_INTEGRATED)
            or (
                r.status is ReviewStatus.AWAITING_DECISION
                and all(not isinstance(d.resolution, Unresolved) for d in r.decisions)
            )
        )
    ]
    if candidates:
        candidates.sort(key=lambda r: r.round if r.round is not None else 999)
        rev = candidates[0]
        i_target: StepTarget | None = IntegrateTarget(rev.review_id, rev.comment)
        act_list = []
        if stray_in_progress:
            act_list.append(EditLabels(gh.issue, remove=(PipelineLabels.IN_PROGRESS,)))
        attempts = view.run.local.attempts.get(i_target.fingerprint, 0)
        if attempts >= config.max_step_attempts:
            slug = config.spec_for(i_target).provenance_slug
            rid = (
                view.run.last_finished.record.run_id
                if (
                    view.run.last_finished
                    and view.run.last_finished.record.target.fingerprint == i_target.fingerprint
                )
                else None
            )
            act_list.extend(block(gh.issue, RetriesExhausted(i_target.fingerprint, slug, attempts, rid)))
            i_target = None
        return IssuePlan(gh.issue, Stage.INTEGRATE, i_target, tuple(act_list))

    # 17. REVIEW
    if config.skip_review_label not in gh.labels and len(integrated_rounds) < len(config.reviews):
        unreviewed_round = next(
            k for k in range(1, len(config.reviews) + 1) if k not in integrated_rounds
        )
        rw_target: StepTarget | None = ReviewTarget(unreviewed_round)
        act_list = []
        if stray_in_progress:
            act_list.append(EditLabels(gh.issue, remove=(PipelineLabels.IN_PROGRESS,)))
        attempts = view.run.local.attempts.get(rw_target.fingerprint, 0)
        if attempts >= config.max_step_attempts:
            slug = config.spec_for(rw_target).provenance_slug
            rid = (
                view.run.last_finished.record.run_id
                if (
                    view.run.last_finished
                    and view.run.last_finished.record.target.fingerprint == rw_target.fingerprint
                )
                else None
            )
            act_list.extend(block(gh.issue, RetriesExhausted(rw_target.fingerprint, slug, attempts, rid)))
            rw_target = None
        return IssuePlan(gh.issue, Stage.REVIEW, rw_target, tuple(act_list))

    # 18. READY
    rd_target: StepTarget | None = ImplementTarget()
    attempts = view.run.local.attempts.get(rd_target.fingerprint, 0)
    if attempts >= config.max_step_attempts:
        slug = config.spec_for(rd_target).provenance_slug
        rid = (
            view.run.last_finished.record.run_id
            if (
                view.run.last_finished
                and view.run.last_finished.record.target.fingerprint == rd_target.fingerprint
            )
            else None
        )
        rd_actions = block(gh.issue, RetriesExhausted(rd_target.fingerprint, slug, attempts, rid))
        rd_target = None
    else:
        rd_act_list: list[Action] = []
        add_labels = []
        remove_labels = []
        if PipelineLabels.READY_FOR_AGENT not in gh.labels:
            add_labels.append(PipelineLabels.READY_FOR_AGENT)
        if PipelineLabels.NEEDS_TRIAGE in gh.labels:
            remove_labels.append(PipelineLabels.NEEDS_TRIAGE)
        if add_labels or remove_labels:
            rd_act_list.append(
                EditLabels(gh.issue, add=tuple(add_labels), remove=tuple(remove_labels))
            )
        rd_actions = tuple(rd_act_list)

    return IssuePlan(gh.issue, Stage.READY, rd_target, rd_actions)


def pending_fingerprint(view: IssueView, config: PipelineConfig) -> Fingerprint | None:
    plan = plan_issue(view, config, datetime.fromtimestamp(0, tz=timezone.utc))
    return plan.target.fingerprint if plan.target is not None else None


def reap(
    runs: Mapping[RunId, ActiveRun],
    views: Mapping[IssueRef, IssueView],
    config: PipelineConfig,
) -> tuple[Action, ...]:
    actions: list[Action] = []

    for run_id, run in runs.items():
        if run.liveness is Liveness.ALIVE:
            continue

        outcome = RunOutcome(
            exit_code=None,
            finished_at=run.record.started_at + run.record.timeout,
            liveness=run.liveness,
        )
        actions.append(FinishRun(run_id, outcome))

        if run.liveness is Liveness.TIMED_OUT or (run.liveness is Liveness.EXITED and run.group_alive):
            actions.append(KillRunGroup(run_id, run.pgid))

        issue = run.record.issue
        if issue in views:
            view = views[issue]
            if not isinstance(view.gh, FailedSnapshot):
                pf = pending_fingerprint(view, config)
                if pf == run.record.target.fingerprint:
                    # Integrator question check
                    is_integrator_question = False
                    if (
                        run.record.target.step is Step.INTEGRATE
                        and isinstance(run.record.target, IntegrateTarget)
                    ):
                        cutoff = run.record.started_at - timedelta(minutes=5)
                        for notice in view.gh.pipeline_notices:
                            if (
                                notice.kind == "needs_input"
                                and notice.review_id == run.record.target.review_id
                                and notice.created_at >= cutoff
                            ):
                                is_integrator_question = True
                                break

                    if is_integrator_question:
                        assert isinstance(run.record.target, IntegrateTarget)
                        actions.extend(
                            block(
                                view.gh.issue,
                                IntegratorQuestion(run.record.target.review_id),
                                notice=False,
                            )
                        )
                    else:
                        actions.append(RecordAttempt(view.gh.issue, run.record.target.fingerprint))

    return tuple(actions)


def _priority_key(view: IssueView) -> tuple[int, int, int]:
    imp = 0 if view.run.local.implement_attempted else 1
    sev = -view.gh.details.severity_rank if isinstance(view.gh, IssueSnapshot) else 0
    return (imp, sev, view.gh.issue.number)


def plan_tick(
    views: Mapping[IssueRef, IssueView],
    live_runs: Sequence[RunRecord],
    config: PipelineConfig,
    now: datetime,
) -> TickPlan:
    # 1. Inspect live lane run
    live_lane_run: RunRecord | None = None
    live_review_count = 0
    used_review_slots: set[int] = set()

    for r in live_runs:
        if r.target.step.holds_lane:
            if live_lane_run is None:
                live_lane_run = r
        else:
            live_review_count += 1
            if isinstance(r.workspace, ReviewSlot):
                used_review_slots.add(r.workspace.n)

    # 2. Issues holding implementation lane
    lane_holders: set[IssueRef] = set()
    for v in views.values():
        issue = v.gh.issue
        # Condition a: has live run whose step holds lane
        if any(r.issue == issue and r.target.step.holds_lane for r in live_runs):
            lane_holders.add(issue)
            continue

        if isinstance(v.gh, IssueSnapshot) and config.eligible_label in v.gh.labels and v.gh.is_open:
            # Condition b: has OpenPr or MergedPr
            if isinstance(v.gh.linked_pr, (OpenPr, MergedPr)):
                lane_holders.add(issue)
                continue
            # Condition c: has in-progress
            if PipelineLabels.IN_PROGRESS in v.gh.labels:
                lane_holders.add(issue)
                continue
            # Condition d: recorded block reason phase == IMPL
            if v.run.local.block is not None and v.run.local.block.reason.phase is Phase.IMPL:
                lane_holders.add(issue)
                continue

    # Also add live lane run issue if not in views
    if live_lane_run is not None:
        lane_holders.add(live_lane_run.issue)

    # Sort views into priority order
    sorted_views = sorted(views.values(), key=_priority_key)

    # Highest priority lane holder
    sorted_lane_holders = [
        v.gh.issue for v in sorted_views if v.gh.issue in lane_holders
    ]
    highest_priority_lane_holder: IssueRef | None = (
        sorted_lane_holders[0] if sorted_lane_holders else (live_lane_run.issue if live_lane_run else None)
    )

    lane_step_admitted_holder: IssueRef | None = None
    if live_lane_run is not None:
        lane_step_admitted_holder = live_lane_run.issue

    plans: list[IssuePlan] = []

    for view in sorted_views:
        issue = view.gh.issue
        plan = plan_issue(view, config, now)

        recorded_block = next((a.block for a in plan.actions if isinstance(a, RecordPipelineBlock)), None)
        if recorded_block is not None:
            block_to_render = recorded_block
        elif any(isinstance(a, ClearPipelineBlock) for a in plan.actions):
            block_to_render = None
        else:
            block_to_render = view.run.local.block

        if plan.target is None:
            # No dispatch
            plan_actions = list(plan.actions)
            if isinstance(view.gh, IssueSnapshot) and config.eligible_label in view.gh.labels:
                body = render(view.gh, plan.stage, None, None, block_to_render, config, now)
                if needs_patch(view.gh.status_comment, body):
                    plan_actions.append(
                        UpsertStatusComment(
                            issue,
                            view.gh.status_comment.ref if view.gh.status_comment else None,
                            body,
                        )
                    )
            plans.append(IssuePlan(issue, plan.stage, None, tuple(plan_actions)))
            continue

        # Target is present
        target = plan.target
        queued: QueueReason | None = None
        dispatched = False
        plan_actions = list(plan.actions)

        if not target.step.holds_lane:
            # Review or Integrate target
            if live_review_count < config.concurrency.review:
                # Find lowest free slot
                slot_n = next(
                    n for n in range(config.concurrency.review) if n not in used_review_slots
                )
                used_review_slots.add(slot_n)
                live_review_count += 1
                ws = ReviewSlot(slot_n)
                plan_actions.append(
                    Dispatch(
                        issue=issue,
                        target=target,
                        spec=config.spec_for(target),
                        workspace=ws,
                    )
                )
                dispatched = True
            else:
                queued = ReviewCapReached(cap=config.concurrency.review)
        else:
            # Lane-step target (implement / verify / revise)
            if lane_step_admitted_holder is not None:
                if lane_step_admitted_holder != issue:
                    queued = LaneBusy(holder=lane_step_admitted_holder)
            elif lane_holders:
                if issue == highest_priority_lane_holder:
                    lane_step_admitted_holder = issue
                    if isinstance(target, (VerifyTarget, ReviseTarget)):
                        assert isinstance(view.gh, IssueSnapshot) and isinstance(view.gh.linked_pr, OpenPr)
                        ws = ImplAtPrHead(view.gh.linked_pr.head_ref)
                    else:
                        ws = ImplAtDev()
                    plan_actions.append(
                        Dispatch(
                            issue=issue,
                            target=target,
                            spec=config.spec_for(target),
                            workspace=ws,
                        )
                    )
                    dispatched = True
                else:
                    assert highest_priority_lane_holder is not None
                    queued = LaneConflict(holder=highest_priority_lane_holder)
            else:
                # No issue holds lane: candidate is highest-priority READY issue with open_blocker_count == 0
                if plan.stage is Stage.READY and isinstance(view.gh, IssueSnapshot) and view.gh.open_blocker_count == 0:
                    lane_step_admitted_holder = issue
                    plan_actions.append(
                        EditLabels(
                            issue,
                            add=(PipelineLabels.IN_PROGRESS,),
                            remove=(PipelineLabels.READY_FOR_AGENT,),
                        )
                    )
                    plan_actions.append(DeleteStaleBranches(issue))
                    plan_actions.append(
                        Dispatch(
                            issue=issue,
                            target=target,
                            spec=config.spec_for(target),
                            workspace=ImplAtDev(),
                        )
                    )
                    dispatched = True
                else:
                    # Not admitted
                    if lane_step_admitted_holder is not None:
                        queued = LaneBusy(holder=lane_step_admitted_holder)

        # Status comment patching
        if isinstance(view.gh, IssueSnapshot) and config.eligible_label in view.gh.labels:
            body = render(view.gh, plan.stage, target, queued, block_to_render, config, now)
            if needs_patch(view.gh.status_comment, body):
                plan_actions.append(
                    UpsertStatusComment(
                        issue,
                        view.gh.status_comment.ref if view.gh.status_comment else None,
                        body,
                    )
                )

        plans.append(IssuePlan(issue, plan.stage, target, tuple(plan_actions)))

    return tuple(plans)
