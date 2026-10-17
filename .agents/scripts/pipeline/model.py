"""Domain types for the automated issue pipeline reconciler core.

This module is a leaf: it imports nothing from the package.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import NewType, Union


class PipelineLabels:
    IN_PROGRESS = "in-progress"
    READY_FOR_AGENT = "ready-for-agent"
    READY_FOR_HUMAN = "ready-for-human"
    NEEDS_INFO = "needs-info"
    NEEDS_TRIAGE = "needs-triage"


class Phase(StrEnum):
    SPEC = "spec"
    IMPL = "impl"

    @property
    def block_label(self) -> str:
        return PipelineLabels.NEEDS_INFO if self is Phase.SPEC else PipelineLabels.READY_FOR_HUMAN


class Stage(StrEnum):
    RUNNING = "running"
    SNAPSHOT_FAILED = "snapshot_failed"
    INELIGIBLE = "ineligible"
    MERGED = "merged"
    RESUMED = "resumed"
    BLOCKED_HUMAN = "blocked_human"
    UNTRUSTED_EDIT = "untrusted_edit"
    BREAKER_TRIP = "breaker_trip"
    AWAITING_MERGE = "awaiting_merge"
    VERIFY = "verify"
    REVISE = "revise"
    PR_UNRECOGNIZED = "pr_unrecognized"
    PR_CLOSED_UNMERGED = "pr_closed_unmerged"
    IMPLEMENTING_ORPHAN = "implementing_orphan"
    DECISIONS_UNRESOLVED = "decisions_unresolved"
    INTEGRATE = "integrate"
    REVIEW = "review"
    READY = "ready"

    @property
    def phase(self) -> Phase | None:
        if self in (
            Stage.UNTRUSTED_EDIT,
            Stage.DECISIONS_UNRESOLVED,
            Stage.INTEGRATE,
            Stage.REVIEW,
            Stage.READY,
        ):
            return Phase.SPEC
        if self in (
            Stage.BREAKER_TRIP,
            Stage.AWAITING_MERGE,
            Stage.VERIFY,
            Stage.REVISE,
            Stage.PR_UNRECOGNIZED,
            Stage.PR_CLOSED_UNMERGED,
            Stage.IMPLEMENTING_ORPHAN,
        ):
            return Phase.IMPL
        return None

    @property
    def is_blocked_on_human(self) -> bool:
        return self is Stage.BLOCKED_HUMAN


class Step(StrEnum):
    REVIEW = "review"
    INTEGRATE = "integrate"
    IMPLEMENT = "implement"
    VERIFY = "verify"
    REVISE = "revise"

    @property
    def phase(self) -> Phase:
        return Phase.SPEC if self in (Step.REVIEW, Step.INTEGRATE) else Phase.IMPL

    @property
    def skill(self) -> str:
        match self:
            case Step.REVIEW:
                return "issue-review"
            case Step.INTEGRATE:
                return "issue-integrate-review"
            case Step.IMPLEMENT:
                return "issue-implement"
            case Step.VERIFY:
                return "pr-verify"
            case Step.REVISE:
                return "issue-implement"

    @property
    def holds_lane(self) -> bool:
        return self.phase is Phase.IMPL


class AttemptKind(StrEnum):
    REVIEW = "review"
    INTEGRATE = "integrate"
    IMPLEMENT = "implement"
    VERIFY = "verify"
    REVISE = "revise"
    MERGE = "merge"

    @property
    def phase(self) -> Phase:
        if self is AttemptKind.MERGE:
            return Phase.IMPL
        return Step(self.value).phase


class Effort(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


class Readiness(StrEnum):
    READY_FOR_INITIAL_VERIFICATION = "READY_FOR_INITIAL_VERIFICATION"
    READY_FOR_RE_VERIFICATION = "READY_FOR_RE_VERIFICATION"
    AWAITING_REVISION = "AWAITING_REVISION"
    CIRCUIT_BREAKER_TRIPPED = "CIRCUIT_BREAKER_TRIPPED"
    ALREADY_APPROVED = "ALREADY_APPROVED"
    UNKNOWN = "UNKNOWN"


class Mergeable(StrEnum):
    MERGEABLE = "MERGEABLE"
    CONFLICTING = "CONFLICTING"
    UNKNOWN = "UNKNOWN"


class ReviewStatus(StrEnum):
    PENDING = "PENDING"
    PARTIALLY_INTEGRATED = "PARTIALLY_INTEGRATED"
    AWAITING_DECISION = "AWAITING_DECISION"
    INTEGRATED = "INTEGRATED"
    MALFORMED = "MALFORMED"


class UnresolvedReason(StrEnum):
    NO_SELECTION = "NO_SELECTION"
    MULTIPLE_SELECTIONS = "MULTIPLE_SELECTIONS"


class Liveness(StrEnum):
    ALIVE = "ALIVE"
    EXITED = "EXITED"
    TIMED_OUT = "TIMED_OUT"


class CommentOrigin(StrEnum):
    MACHINE = "MACHINE"
    HUMAN_INPUT = "HUMAN_INPUT"
    OTHER = "OTHER"


class BlockReason(StrEnum):
    # SPEC
    DECISIONS_UNRESOLVED = "decisions_unresolved"
    INTEGRATOR_QUESTION = "integrator_question"
    SPEC_RETRIES_EXHAUSTED = "spec_retries_exhausted"
    UNTRUSTED_EDIT = "untrusted_edit"
    # IMPL
    CIRCUIT_BREAKER = "circuit_breaker"
    IMPL_RETRIES_EXHAUSTED = "impl_retries_exhausted"
    MERGE_CONFLICT = "merge_conflict"
    MERGE_FAILED = "merge_failed"
    PR_CLOSED_UNMERGED = "pr_closed_unmerged"
    PR_UNRECOGNIZED = "pr_unrecognized"

    @property
    def phase(self) -> Phase:
        if self in (
            BlockReason.DECISIONS_UNRESOLVED,
            BlockReason.INTEGRATOR_QUESTION,
            BlockReason.SPEC_RETRIES_EXHAUSTED,
            BlockReason.UNTRUSTED_EDIT,
        ):
            return Phase.SPEC
        return Phase.IMPL


@dataclass(frozen=True)
class IssueRef:
    number: int

    def __str__(self) -> str:
        return f"#{self.number}"


@dataclass(frozen=True)
class PrRef:
    number: int

    def __str__(self) -> str:
        return f"#{self.number}"


@dataclass(frozen=True)
class CommentRef:
    node_id: str
    database_id: int | None = None


@dataclass(frozen=True)
class ReviewId:
    value: str

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class VerificationId:
    value: str

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class Editor:
    login: str

    def __str__(self) -> str:
        return self.login


RunId = NewType("RunId", str)


@dataclass(frozen=True)
class Fingerprint:
    kind: AttemptKind
    key: str = ""

    def __str__(self) -> str:
        return f"{self.kind.value}:{self.key}" if self.key else self.kind.value


BlockRef = Union[ReviewId, VerificationId, Fingerprint, PrRef, Editor]


@dataclass(frozen=True)
class PipelineBlock:
    reason: BlockReason
    ref: BlockRef


@dataclass(frozen=True)
class DecisionsUnresolved:
    review_id: ReviewId
    unresolved: tuple[tuple[str, UnresolvedReason], ...]
    malformed: bool

    @property
    def reason(self) -> BlockReason:
        return BlockReason.DECISIONS_UNRESOLVED

    @property
    def ref(self) -> BlockRef:
        return self.review_id

    def notice_body(self) -> str:
        if self.malformed:
            return f"Review {self.review_id} declares decisions but none parse."
        items = [f"{dec_id} ({reason.value})" for dec_id, reason in self.unresolved]
        return f"Review {self.review_id} has unresolved decisions: {', '.join(items)}."


@dataclass(frozen=True)
class IntegratorQuestion:
    review_id: ReviewId

    @property
    def reason(self) -> BlockReason:
        return BlockReason.INTEGRATOR_QUESTION

    @property
    def ref(self) -> BlockRef:
        return self.review_id

    def notice_body(self) -> str:
        return f"Integrator requested clarification on review {self.review_id}."


@dataclass(frozen=True)
class RetriesExhausted:
    fingerprint: Fingerprint
    model_slug: str
    attempts: int
    run_id: RunId | None = None

    @property
    def reason(self) -> BlockReason:
        return (
            BlockReason.SPEC_RETRIES_EXHAUSTED
            if self.fingerprint.kind.phase is Phase.SPEC
            else BlockReason.IMPL_RETRIES_EXHAUSTED
        )

    @property
    def ref(self) -> BlockRef:
        return self.fingerprint

    def notice_body(self) -> str:
        log_hint = (
            f"run `pipeline logs {self.run_id}` locally"
            if self.run_id is not None
            else "inspect `pipeline logs` for the issue locally"
        )
        return (
            f"Step {self.fingerprint} reached {self.attempts} failed attempts with model `{self.model_slug}`. "
            f"Please {log_hint} to diagnose."
        )


@dataclass(frozen=True)
class CircuitBreaker:
    pr: PrRef
    verification_id: VerificationId

    @property
    def reason(self) -> BlockReason:
        return BlockReason.CIRCUIT_BREAKER

    @property
    def ref(self) -> BlockRef:
        return self.verification_id

    def notice_body(self) -> str:
        return f"Automated revision limit reached for PR #{self.pr.number} (verification {self.verification_id})."


@dataclass(frozen=True)
class MergeConflict:
    pr: PrRef

    @property
    def reason(self) -> BlockReason:
        return BlockReason.MERGE_CONFLICT

    @property
    def ref(self) -> BlockRef:
        return self.pr

    def notice_body(self) -> str:
        return f"PR #{self.pr.number} has merge conflicts with the target branch."


@dataclass(frozen=True)
class MergeFailed:
    pr: PrRef
    error: str = ""

    @property
    def reason(self) -> BlockReason:
        return BlockReason.MERGE_FAILED

    @property
    def ref(self) -> BlockRef:
        return self.pr

    def notice_body(self) -> str:
        detail = f": {self.error[:300]}" if self.error else "."
        return f"Merge failed for PR #{self.pr.number}{detail}"


@dataclass(frozen=True)
class PrClosedUnmerged:
    pr: PrRef

    @property
    def reason(self) -> BlockReason:
        return BlockReason.PR_CLOSED_UNMERGED

    @property
    def ref(self) -> BlockRef:
        return self.pr

    def notice_body(self) -> str:
        return f"PR #{self.pr.number} was closed unmerged while in-progress."


@dataclass(frozen=True)
class PrUnrecognized:
    pr: PrRef
    raw_verdict: str

    @property
    def reason(self) -> BlockReason:
        return BlockReason.PR_UNRECOGNIZED

    @property
    def ref(self) -> BlockRef:
        return self.pr

    def notice_body(self) -> str:
        return f"PR #{self.pr.number} has unrecognized readiness/verdict: `{self.raw_verdict}`."


@dataclass(frozen=True)
class UntrustedEdit:
    editor: Editor

    @property
    def reason(self) -> BlockReason:
        return BlockReason.UNTRUSTED_EDIT

    @property
    def ref(self) -> BlockRef:
        return self.editor

    def notice_body(self) -> str:
        return f"Issue body was edited by untrusted user @{self.editor.login}."


BlockCause = Union[
    DecisionsUnresolved,
    IntegratorQuestion,
    RetriesExhausted,
    CircuitBreaker,
    MergeConflict,
    MergeFailed,
    PrClosedUnmerged,
    PrUnrecognized,
    UntrustedEdit,
]


_ACTION_REQUIRED: Mapping[BlockReason, str] = {
    BlockReason.DECISIONS_UNRESOLVED: (
        "resolve decisions in the review comment (tick one option each or reply `DEC-N: …`), then remove `needs-info`."
    ),
    BlockReason.INTEGRATOR_QUESTION: (
        "reply to the integrator's question, then remove `needs-info`."
    ),
    BlockReason.SPEC_RETRIES_EXHAUSTED: (
        "inspect `pipeline logs` locally to diagnose repeated step failures, resolve the issue, then remove `needs-info`."
    ),
    BlockReason.UNTRUSTED_EDIT: (
        "a collaborator must re-save the issue body (any edit), then remove `needs-info`."
    ),
    BlockReason.CIRCUIT_BREAKER: (
        "inspect PR verification findings and provide maintainer guidance or push revisions, then remove `ready-for-human`."
    ),
    BlockReason.IMPL_RETRIES_EXHAUSTED: (
        "inspect `pipeline logs` locally to diagnose repeated step failures, resolve the issue, then remove `ready-for-human`."
    ),
    BlockReason.MERGE_CONFLICT: (
        "resolve merge conflicts on the PR branch, then remove `ready-for-human`."
    ),
    BlockReason.MERGE_FAILED: (
        "inspect merge failure details, resolve the issue, then remove `ready-for-human`."
    ),
    BlockReason.PR_CLOSED_UNMERGED: (
        "reopen or replace the closed PR, or remove `agent:auto` to abandon the issue, then remove `ready-for-human`."
    ),
    BlockReason.PR_UNRECOGNIZED: (
        "inspect the unrecognized PR state or verdict, fix the PR or verification, then remove `ready-for-human`."
    ),
}


@dataclass(frozen=True)
class LaneBusy:
    holder: IssueRef


@dataclass(frozen=True)
class LaneConflict:
    holder: IssueRef


@dataclass(frozen=True)
class ReviewCapReached:
    cap: int


QueueReason = Union[LaneBusy, LaneConflict, ReviewCapReached]


@dataclass(frozen=True)
class ReviewSlot:
    n: int


@dataclass(frozen=True)
class ImplAtDev:
    pass


@dataclass(frozen=True)
class ImplAtPrHead:
    head_ref: str


Workspace = Union[ReviewSlot, ImplAtDev, ImplAtPrHead]


@dataclass(frozen=True)
class StepSpec:
    cli: str
    model: str
    effort: Effort

    @property
    def provenance_slug(self) -> str:
        return f"{self.model}-{self.effort.value}"

    def build_argv(self, prompt: str, extra_args: Sequence[str] = ()) -> list[str]:
        if self.cli == "agy":
            return [
                "agy",
                "-p",
                prompt,
                "--model",
                self.provenance_slug,
                "--output-format",
                "stream-json",
                *extra_args,
            ]
        elif self.cli == "claude":
            return [
                "claude",
                "-p",
                prompt,
                "--model",
                self.model,
                "--effort",
                self.effort.value,
                "--output-format",
                "stream-json",
                "--verbose",
                *extra_args,
            ]
        else:
            raise ValueError(f"Unknown cli: {self.cli}")


@dataclass(frozen=True)
class ReviewTarget:
    round: int

    @property
    def step(self) -> Step:
        return Step.REVIEW

    @property
    def fingerprint(self) -> Fingerprint:
        return Fingerprint(AttemptKind.REVIEW, str(self.round))

    def slash_command(self, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
        return f"/issue-review {issue.number} --model {spec.provenance_slug} --round {self.round}"


@dataclass(frozen=True)
class IntegrateTarget:
    review_id: ReviewId
    comment: CommentRef

    @property
    def step(self) -> Step:
        return Step.INTEGRATE

    @property
    def fingerprint(self) -> Fingerprint:
        return Fingerprint(AttemptKind.INTEGRATE, self.review_id.value)

    def slash_command(self, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
        return f"/issue-integrate-review {issue.number} --comment-id {self.comment.node_id} --model {spec.provenance_slug}"


@dataclass(frozen=True)
class ImplementTarget:
    @property
    def step(self) -> Step:
        return Step.IMPLEMENT

    @property
    def fingerprint(self) -> Fingerprint:
        return Fingerprint(AttemptKind.IMPLEMENT, "")

    def slash_command(self, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
        return f"/issue-implement {issue.number} --model {spec.provenance_slug} --max-cycles {max_cycles}"


@dataclass(frozen=True)
class VerifyTarget:
    pr: PrRef
    last_verification_cycle: int

    @property
    def step(self) -> Step:
        return Step.VERIFY

    @property
    def fingerprint(self) -> Fingerprint:
        return Fingerprint(AttemptKind.VERIFY, str(self.last_verification_cycle))

    def slash_command(self, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
        return f"/pr-verify {self.pr.number} --model {spec.provenance_slug} --max-cycles {max_cycles}"


@dataclass(frozen=True)
class ReviseTarget:
    pr: PrRef
    last_verification_cycle: int

    @property
    def step(self) -> Step:
        return Step.REVISE

    @property
    def fingerprint(self) -> Fingerprint:
        return Fingerprint(AttemptKind.REVISE, str(self.last_verification_cycle))

    def slash_command(self, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
        return f"/issue-implement {issue.number} --pr {self.pr.number} --model {spec.provenance_slug} --max-cycles {max_cycles}"


StepTarget = Union[ReviewTarget, IntegrateTarget, ImplementTarget, VerifyTarget, ReviseTarget]


def build_prompt(target: StepTarget, issue: IssueRef, spec: StepSpec, max_cycles: int) -> str:
    slash = target.slash_command(issue, spec, max_cycles)
    return (
        f"{slash}\n\n"
        "Unattended pipeline run: never ask questions; if blocked, follow the skill's halt protocol and exit."
    )


@dataclass(frozen=True)
class Comment:
    ref: CommentRef
    author: str
    association: str
    created_at: datetime
    body: str
    origin: CommentOrigin


@dataclass(frozen=True)
class ExistingComment:
    ref: CommentRef
    body: str


@dataclass(frozen=True)
class PipelineNotice:
    kind: str
    review_id: ReviewId | None
    created_at: datetime


@dataclass(frozen=True)
class IssueDetails:
    severity_rank: int = 0


@dataclass(frozen=True)
class SelectedOption:
    key: str


@dataclass(frozen=True)
class CustomAnswer:
    text: str


@dataclass(frozen=True)
class Unresolved:
    reason: UnresolvedReason


DecisionResolution = Union[SelectedOption, CustomAnswer, Unresolved]


@dataclass(frozen=True)
class Decision:
    id: str
    question: str
    options: tuple[str, ...]
    resolution: DecisionResolution


@dataclass(frozen=True)
class ReviewSnapshot:
    review_id: ReviewId
    round: int | None
    comment: CommentRef
    status: ReviewStatus
    decisions: tuple[Decision, ...] = ()
    checklist_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class OpenPr:
    pr: PrRef
    head_ref: str
    readiness: Readiness
    last_verification_cycle: int
    effective_cycle: int
    verification_id: VerificationId | None
    raw_verdict: str
    mergeable: Mergeable
    auto_merge_enabled: bool
    has_ready_for_human_label: bool = False


@dataclass(frozen=True)
class MergedPr:
    pr: PrRef
    merged_at: datetime


@dataclass(frozen=True)
class ClosedPr:
    pr: PrRef
    closed_at: datetime


LinkedPr = Union[OpenPr, MergedPr, ClosedPr]


@dataclass(frozen=True)
class IssueSnapshot:
    issue: IssueRef
    details: IssueDetails
    labels: frozenset[str]
    is_open: bool
    body_trusted: bool
    editor: Editor | None
    open_blocker_count: int
    reviews: tuple[ReviewSnapshot, ...] = ()
    linked_pr: LinkedPr | None = None
    status_comment: ExistingComment | None = None
    pipeline_notices: tuple[PipelineNotice, ...] = ()


@dataclass(frozen=True)
class FailedSnapshot:
    issue: IssueRef
    labels: frozenset[str]
    error: str


class PipelineMarkers:
    @staticmethod
    def status(issue: IssueRef) -> str:
        return f'<!-- ai-pipeline-status: {{"issue": {issue.number}}} -->'

    @staticmethod
    def notice(cause: BlockCause) -> str:
        return f'<!-- ai-pipeline-notice: {{"kind": "{cause.reason.value}"}} -->\n{cause.notice_body()}'

    @staticmethod
    def cycle_reset(after_cycle: int, at: datetime) -> str:
        return f'<!-- ai-pipeline-cycle-reset: {{"after_cycle": {after_cycle}, "at": "{at.isoformat()}"}} -->'
