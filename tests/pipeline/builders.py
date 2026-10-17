"""Typed test builders for pipeline domain objects and views."""

from datetime import datetime, timedelta, timezone
from typing import Sequence

from pipeline.config import CliConfig, ConcurrencyConfig, PipelineConfig
from pipeline.model import (
    ClosedPr,
    CommentRef,
    CustomAnswer,
    Decision,
    DecisionResolution,
    Editor,
    Effort,
    FailedSnapshot,
    Fingerprint,
    ImplAtDev,
    ImplementTarget,
    IssueDetails,
    IssueRef,
    IssueSnapshot,
    LinkedPr,
    Liveness,
    Mergeable,
    MergedPr,
    OpenPr,
    PipelineBlock,
    PipelineLabels,
    PipelineNotice,
    PrRef,
    Readiness,
    ReviewId,
    ReviewSnapshot,
    ReviewStatus,
    RunId,
    SelectedOption,
    Step,
    StepSpec,
    StepTarget,
    Unresolved,
    UnresolvedReason,
    VerificationId,
    Workspace,
)
from pipeline.actions import Action, StoreAction
from pipeline.state import (
    ActiveRun,
    FinishedRun,
    IssueLocalState,
    IssueRunState,
    IssueView,
    RunOutcome,
    RunRecord,
    StoreState,
    apply_store_action,
)

EPOCH = datetime(2026, 10, 17, 0, 0, 0, tzinfo=timezone.utc)


def default_config(
    reviews: Sequence[StepSpec] | None = None,
    concurrency_review: int = 2,
    max_step_attempts: int = 2,
    skip_review_label: str = "agent:skip-review",
    eligible_label: str = "agent:auto",
) -> PipelineConfig:
    if reviews is None:
        reviews = (
            StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.HIGH),
            StepSpec(cli="claude", model="claude-opus-5-5", effort=Effort.HIGH),
        )
    timeouts = {
        Step.REVIEW: timedelta(minutes=45),
        Step.INTEGRATE: timedelta(minutes=30),
        Step.IMPLEMENT: timedelta(minutes=120),
        Step.VERIFY: timedelta(minutes=60),
        Step.REVISE: timedelta(minutes=90),
    }
    return PipelineConfig(
        eligible_label=eligible_label,
        skip_review_label=skip_review_label,
        max_revision_cycles=2,
        max_step_attempts=max_step_attempts,
        runner="auto",
        reviews=tuple(reviews),
        integrator=StepSpec(cli="claude", model="claude-opus-5-5", effort=Effort.HIGH),
        implement=StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM),
        verify=StepSpec(cli="claude", model="claude-opus-5-5", effort=Effort.HIGH),
        revise=StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM),
        concurrency=ConcurrencyConfig(review=concurrency_review),
        timeouts=timeouts,
        cli={
            "agy": CliConfig(extra_args=("--mode", "auto")),
            "claude": CliConfig(extra_args=("--permission-mode", "auto")),
        },
    )


def issue_ref(number: int = 1) -> IssueRef:
    return IssueRef(number=number)


def pr_ref(number: int = 101) -> PrRef:
    return PrRef(number=number)


def open_pr(
    number: int = 101,
    head_ref: str = "feat/issue-1",
    readiness: Readiness = Readiness.READY_FOR_INITIAL_VERIFICATION,
    last_verification_cycle: int = 0,
    effective_cycle: int = 0,
    verification_id: str | None = None,
    raw_verdict: str = "",
    mergeable: Mergeable = Mergeable.MERGEABLE,
    auto_merge_enabled: bool = False,
    has_ready_for_human_label: bool = False,
) -> OpenPr:
    return OpenPr(
        pr=PrRef(number=number),
        head_ref=head_ref,
        readiness=readiness,
        last_verification_cycle=last_verification_cycle,
        effective_cycle=effective_cycle,
        verification_id=VerificationId(verification_id) if verification_id else None,
        raw_verdict=raw_verdict,
        mergeable=mergeable,
        auto_merge_enabled=auto_merge_enabled,
        has_ready_for_human_label=has_ready_for_human_label,
    )


def merged_pr(number: int = 101, merged_at: datetime | None = None) -> MergedPr:
    return MergedPr(
        pr=PrRef(number=number),
        merged_at=merged_at or EPOCH,
    )


def closed_pr(number: int = 101, closed_at: datetime | None = None) -> ClosedPr:
    return ClosedPr(
        pr=PrRef(number=number),
        closed_at=closed_at or EPOCH,
    )


def decision(
    id: str = "DEC-1",
    question: str = "Which approach?",
    options: Sequence[str] = ("Option A", "Option B"),
    resolution: DecisionResolution | None = None,
) -> Decision:
    if resolution is None:
        resolution = SelectedOption(key="Option A")
    return Decision(
        id=id,
        question=question,
        options=tuple(options),
        resolution=resolution,
    )


def review(
    review_id: str = "rev-20261017-1-a1b2",
    round: int | None = 1,
    comment_node: str = "IC_kwDO123",
    status: ReviewStatus = ReviewStatus.INTEGRATED,
    decisions: Sequence[Decision] = (),
    checklist_keys: Sequence[str] = (),
) -> ReviewSnapshot:
    return ReviewSnapshot(
        review_id=ReviewId(review_id),
        round=round,
        comment=CommentRef(node_id=comment_node),
        status=status,
        decisions=tuple(decisions),
        checklist_keys=tuple(checklist_keys),
    )


def issue(
    number: int = 1,
    labels: Sequence[str] = ("agent:auto",),
    is_open: bool = True,
    body_trusted: bool = True,
    editor: str | None = None,
    open_blocker_count: int = 0,
    severity_rank: int = 0,
    reviews: Sequence[ReviewSnapshot] = (),
    pr: LinkedPr | None = None,
    status_comment=None,
    pipeline_notices: Sequence[PipelineNotice] = (),
) -> IssueSnapshot:
    return IssueSnapshot(
        issue=IssueRef(number=number),
        details=IssueDetails(severity_rank=severity_rank),
        labels=frozenset(labels),
        is_open=is_open,
        body_trusted=body_trusted,
        editor=Editor(editor) if editor else None,
        open_blocker_count=open_blocker_count,
        reviews=tuple(reviews),
        linked_pr=pr,
        status_comment=status_comment,
        pipeline_notices=tuple(pipeline_notices),
    )


def failed_snapshot(
    number: int = 1,
    labels: Sequence[str] = ("agent:auto",),
    error: str = "API timeout",
) -> FailedSnapshot:
    return FailedSnapshot(
        issue=IssueRef(number=number),
        labels=frozenset(labels),
        error=error,
    )


def run_record(
    run_id: str = "run-1",
    issue_num: int = 1,
    target: StepTarget | None = None,
    spec: StepSpec | None = None,
    workspace: Workspace | None = None,
    started_at: datetime | None = None,
    timeout_mins: int = 30,
) -> RunRecord:
    if target is None:
        target = ImplementTarget()
    if spec is None:
        spec = StepSpec(cli="agy", model="gemini-3.8-flash", effort=Effort.MEDIUM)
    if workspace is None:
        workspace = ImplAtDev()
    return RunRecord(
        run_id=RunId(run_id),
        issue=IssueRef(number=issue_num),
        target=target,
        spec=spec,
        prompt="/skill",
        workspace=workspace,
        timeout=timedelta(minutes=timeout_mins),
        started_at=started_at or EPOCH,
    )


def active_run(
    record: RunRecord | None = None,
    liveness: Liveness = Liveness.ALIVE,
    group_alive: bool = True,
    pgid: int = 1234,
) -> ActiveRun:
    if record is None:
        record = run_record()
    return ActiveRun(
        record=record,
        liveness=liveness,
        group_alive=group_alive,
        pgid=pgid,
    )


def finished_run(
    record: RunRecord | None = None,
    exit_code: int = 0,
    finished_at: datetime | None = None,
    liveness: Liveness = Liveness.EXITED,
) -> FinishedRun:
    if record is None:
        record = run_record()
    return FinishedRun(
        record=record,
        outcome=RunOutcome(
            exit_code=exit_code,
            finished_at=finished_at or EPOCH + timedelta(minutes=10),
            liveness=liveness,
        ),
    )


def view(
    gh: IssueSnapshot | FailedSnapshot | None = None,
    local: IssueLocalState | None = None,
    live_run: RunRecord | None = None,
    last_finished: FinishedRun | None = None,
) -> IssueView:
    if gh is None:
        gh = issue()
    if local is None:
        local = IssueLocalState()
    return IssueView(
        gh=gh,
        run=IssueRunState(
            local=local,
            live_run=live_run,
            last_finished=last_finished,
        ),
    )


def fold_store(state: StoreState, actions: Sequence[Action]) -> StoreState:
    for act in actions:
        if isinstance(act, StoreAction):
            state = apply_store_action(state, act)
    return state

