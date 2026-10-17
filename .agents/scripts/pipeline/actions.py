"""Actions emitted by reconciler planning and reap.

This module imports only from model.py and standard library.
"""

from dataclasses import dataclass
from typing import Any, Union

from .model import (
    BlockCause,
    CommentRef,
    Fingerprint,
    IssueRef,
    PipelineBlock,
    PipelineMarkers,
    PrRef,
    RunId,
    StepSpec,
    StepTarget,
    Workspace,
)


# Store Actions


@dataclass(frozen=True)
class RecordAttempt:
    issue: IssueRef
    fingerprint: Fingerprint
    detail: str | None = None


@dataclass(frozen=True)
class RecordPipelineBlock:
    issue: IssueRef
    block: PipelineBlock


@dataclass(frozen=True)
class ClearPipelineBlock:
    issue: IssueRef
    abandon_pr: PrRef | None = None


@dataclass(frozen=True)
class FinishRun:
    run_id: RunId
    outcome: Any  # RunOutcome


@dataclass(frozen=True)
class RecordRun:
    record: Any  # RunRecord


@dataclass(frozen=True)
class RecordRunnerHandle:
    run_id: RunId
    handle: Any  # RunnerHandle


StoreAction = Union[
    RecordAttempt,
    RecordPipelineBlock,
    ClearPipelineBlock,
    FinishRun,
    RecordRun,
    RecordRunnerHandle,
]


# GitHub Actions


@dataclass(frozen=True)
class EditLabels:
    target: IssueRef | PrRef
    add: tuple[str, ...] = ()
    remove: tuple[str, ...] = ()
    on_failure: StoreAction | None = None


@dataclass(frozen=True)
class PostComment:
    target: IssueRef | PrRef
    body: str
    on_failure: StoreAction | None = None


@dataclass(frozen=True)
class UpsertStatusComment:
    issue: IssueRef
    comment: CommentRef | None
    body: str
    on_failure: StoreAction | None = None


@dataclass(frozen=True)
class CloseMergedIssue:
    issue: IssueRef
    pr: PrRef
    on_failure: StoreAction | None = None


@dataclass(frozen=True)
class MergePr:
    issue: IssueRef
    pr: PrRef
    on_failure: StoreAction | None = None


@dataclass(frozen=True)
class DeleteStaleBranches:
    issue: IssueRef
    on_failure: StoreAction | None = None


GhAction = Union[
    EditLabels,
    PostComment,
    UpsertStatusComment,
    CloseMergedIssue,
    MergePr,
    DeleteStaleBranches,
]


# Process Actions


@dataclass(frozen=True)
class KillRunGroup:
    run_id: RunId
    pgid: int


ProcessAction = KillRunGroup


# Dispatch Action


@dataclass(frozen=True)
class Dispatch:
    issue: IssueRef
    target: StepTarget
    spec: StepSpec
    workspace: Workspace


Action = Union[GhAction, StoreAction, ProcessAction, Dispatch]


def block(issue: IssueRef, cause: BlockCause, *, notice: bool = True) -> tuple[Action, ...]:
    """Construct the canonical tuple of actions for entering a pipeline block."""
    actions: list[Action] = [
        EditLabels(target=issue, add=(cause.reason.phase.block_label,)),
    ]
    if notice:
        actions.append(PostComment(target=issue, body=PipelineMarkers.notice(cause)))
    actions.append(RecordPipelineBlock(issue=issue, block=PipelineBlock(cause.reason, cause.ref)))
    return tuple(actions)
