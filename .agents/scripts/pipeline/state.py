"""Store state types, reducer, and view builders for the reconciler.

This module imports only from model.py, actions.py, and standard library.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Union

from .actions import (
    Action,
    ClearPipelineBlock,
    EditLabels,
    FinishRun,
    RecordAttempt,
    RecordPipelineBlock,
    RecordRun,
    RecordRunnerHandle,
    StoreAction,
)
from .model import (
    FailedSnapshot,
    Fingerprint,
    ImplementTarget,
    IssueRef,
    IssueSnapshot,
    Liveness,
    PipelineBlock,
    PrRef,
    RunId,
    StepSpec,
    StepTarget,
    Workspace,
)


# Runner Handles


@dataclass(frozen=True)
class HeadlessHandle:
    pass


@dataclass(frozen=True)
class SystemdHandle:
    unit: str


@dataclass(frozen=True)
class HerdrHandle:
    tab_id: str


RunnerHandle = Union[HeadlessHandle, SystemdHandle, HerdrHandle]


# Run Records & Outcomes


@dataclass(frozen=True)
class RunRecord:
    run_id: RunId
    issue: IssueRef
    target: StepTarget
    spec: StepSpec
    prompt: str
    workspace: Workspace
    timeout: timedelta
    started_at: datetime


@dataclass(frozen=True)
class RunOutcome:
    exit_code: int | None
    finished_at: datetime
    liveness: Liveness


@dataclass(frozen=True)
class FinishedRun:
    record: RunRecord
    outcome: RunOutcome
    handle: RunnerHandle | None = None


# State


@dataclass(frozen=True)
class IssueLocalState:
    attempts: Mapping[Fingerprint, int] = field(default_factory=dict)
    last_detail: Mapping[Fingerprint, str] = field(default_factory=dict)
    block: PipelineBlock | None = None
    implement_attempted: bool = False
    abandoned_prs: frozenset[PrRef] = field(default_factory=frozenset)


@dataclass(frozen=True)
class StoreState:
    version: int = 1
    runs: Mapping[RunId, RunRecord] = field(default_factory=dict)
    handles: Mapping[RunId, RunnerHandle] = field(default_factory=dict)
    finished: Mapping[RunId, FinishedRun] = field(default_factory=dict)
    issues: Mapping[IssueRef, IssueLocalState] = field(default_factory=dict)


def apply_store_action(state: StoreState, action: StoreAction) -> StoreState:
    match action:
        case RecordAttempt(issue=issue, fingerprint=fp, detail=detail):
            local = state.issues.get(issue, IssueLocalState())
            new_attempts = dict(local.attempts)
            new_attempts[fp] = new_attempts.get(fp, 0) + 1

            new_last_detail = dict(local.last_detail)
            if detail is not None:
                new_last_detail[fp] = detail

            new_local = IssueLocalState(
                attempts=new_attempts,
                last_detail=new_last_detail,
                block=local.block,
                implement_attempted=local.implement_attempted,
                abandoned_prs=local.abandoned_prs,
            )
            new_issues = dict(state.issues)
            new_issues[issue] = new_local
            return StoreState(
                version=state.version,
                runs=state.runs,
                handles=state.handles,
                finished=state.finished,
                issues=new_issues,
            )

        case RecordPipelineBlock(issue=issue, block=blk):
            local = state.issues.get(issue, IssueLocalState())
            new_local = IssueLocalState(
                attempts=local.attempts,
                last_detail=local.last_detail,
                block=blk,
                implement_attempted=local.implement_attempted,
                abandoned_prs=local.abandoned_prs,
            )
            new_issues = dict(state.issues)
            new_issues[issue] = new_local
            return StoreState(
                version=state.version,
                runs=state.runs,
                handles=state.handles,
                finished=state.finished,
                issues=new_issues,
            )

        case ClearPipelineBlock(issue=issue, abandon_pr=abandon_pr):
            local = state.issues.get(issue, IssueLocalState())
            new_abandoned = set(local.abandoned_prs)
            if abandon_pr is not None:
                new_abandoned.add(abandon_pr)
            new_local = IssueLocalState(
                attempts={},
                last_detail={},
                block=None,
                implement_attempted=local.implement_attempted,
                abandoned_prs=frozenset(new_abandoned),
            )
            new_issues = dict(state.issues)
            new_issues[issue] = new_local
            return StoreState(
                version=state.version,
                runs=state.runs,
                handles=state.handles,
                finished=state.finished,
                issues=new_issues,
            )

        case FinishRun(run_id=rid, outcome=outcome):
            rec = state.runs.get(rid)
            hdl = state.handles.get(rid)
            if rec is None:
                return state

            new_runs = {k: v for k, v in state.runs.items() if k != rid}
            new_handles = {k: v for k, v in state.handles.items() if k != rid}
            new_finished = dict(state.finished)
            new_finished[rid] = FinishedRun(record=rec, outcome=outcome, handle=hdl)

            # Prune: keep last 5 finished runs per issue
            issue_finished = [
                (r_id, fr) for r_id, fr in new_finished.items()
                if fr.record.issue == rec.issue
            ]
            if len(issue_finished) > 5:
                issue_finished.sort(key=lambda it: it[1].outcome.finished_at)
                to_remove = set(r_id for r_id, _ in issue_finished[:-5])
                new_finished = {r_id: fr for r_id, fr in new_finished.items() if r_id not in to_remove}

            return StoreState(
                version=state.version,
                runs=new_runs,
                handles=new_handles,
                finished=new_finished,
                issues=state.issues,
            )

        case RecordRun(record=rec):
            new_runs = dict(state.runs)
            new_runs[rec.run_id] = rec

            new_issues = dict(state.issues)
            if isinstance(rec.target, ImplementTarget):
                local = new_issues.get(rec.issue, IssueLocalState())
                new_issues[rec.issue] = IssueLocalState(
                    attempts=local.attempts,
                    last_detail=local.last_detail,
                    block=local.block,
                    implement_attempted=True,
                    abandoned_prs=local.abandoned_prs,
                )

            return StoreState(
                version=state.version,
                runs=new_runs,
                handles=state.handles,
                finished=state.finished,
                issues=new_issues,
            )

        case RecordRunnerHandle(run_id=rid, handle=hdl):
            new_handles = dict(state.handles)
            new_handles[rid] = hdl
            return StoreState(
                version=state.version,
                runs=state.runs,
                handles=new_handles,
                finished=state.finished,
                issues=state.issues,
            )

        case _:
            raise TypeError(f"Unknown StoreAction: {type(action)}")


# Run & Issue Views


@dataclass(frozen=True)
class ActiveRun:
    record: RunRecord
    liveness: Liveness
    group_alive: bool
    pgid: int | None = None


@dataclass(frozen=True)
class IssueRunState:
    local: IssueLocalState
    live_run: RunRecord | None
    last_finished: FinishedRun | None


@dataclass(frozen=True)
class IssueView:
    gh: IssueSnapshot | FailedSnapshot
    run: IssueRunState


def build_views(
    snapshots: Sequence[IssueSnapshot | FailedSnapshot],
    state: StoreState,
    active_runs: Mapping[RunId, ActiveRun],
) -> Mapping[IssueRef, IssueView]:
    views: dict[IssueRef, IssueView] = {}

    for snap in snapshots:
        local = state.issues.get(snap.issue, IssueLocalState())

        # Only ALIVE runs are ever live_run
        live_run: RunRecord | None = None
        for ar in active_runs.values():
            if ar.record.issue == snap.issue and ar.liveness is Liveness.ALIVE:
                live_run = ar.record
                break

        # Latest finished run for this issue
        issue_finished = [
            fr for fr in state.finished.values()
            if fr.record.issue == snap.issue
        ]
        last_finished: FinishedRun | None = None
        if issue_finished:
            issue_finished.sort(key=lambda fr: fr.outcome.finished_at)
            last_finished = issue_finished[-1]

        views[snap.issue] = IssueView(
            gh=snap,
            run=IssueRunState(
                local=local,
                live_run=live_run,
                last_finished=last_finished,
            ),
        )

    return views


def overlay_labels(
    views: Mapping[IssueRef, IssueView],
    actions: Sequence[Action],
) -> Mapping[IssueRef, IssueView]:
    label_edits: dict[IssueRef, list[EditLabels]] = {}
    for act in actions:
        if isinstance(act, EditLabels) and isinstance(act.target, IssueRef):
            label_edits.setdefault(act.target, []).append(act)

    if not label_edits:
        return views

    updated: dict[IssueRef, IssueView] = dict(views)
    for issue_ref, edits in label_edits.items():
        if issue_ref not in updated:
            continue
        v = updated[issue_ref]
        current_labels = set(v.gh.labels)
        for edit in edits:
            current_labels.update(edit.add)
            current_labels.difference_update(edit.remove)
        new_gh = replace(v.gh, labels=frozenset(current_labels))
        updated[issue_ref] = IssueView(gh=new_gh, run=v.run)

    return updated
