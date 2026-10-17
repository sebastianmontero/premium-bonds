"""Pipeline status comment rendering and patching.

This module imports only from model.py, config.py, and standard library.
It NEVER imports stages.py.
"""

from datetime import datetime

from .config import PipelineConfig
from .model import (
    BlockReason,
    ClosedPr,
    ExistingComment,
    IssueSnapshot,
    LaneBusy,
    LaneConflict,
    MergedPr,
    OpenPr,
    PipelineBlock,
    QueueReason,
    ReviewCapReached,
    ReviewStatus,
    Stage,
    StepTarget,
    Unresolved,
    _ACTION_REQUIRED,
)


def _format_queued(queued: QueueReason | None) -> str:
    if queued is None:
        return ""
    if isinstance(queued, LaneBusy):
        return f"lane busy: {queued.holder}"
    elif isinstance(queued, LaneConflict):
        return f"lane conflict: {queued.holder}"
    elif isinstance(queued, ReviewCapReached):
        return f"review cap reached: {queued.cap}"
    return str(queued)


def render(
    snapshot: IssueSnapshot,
    stage: Stage,
    target: StepTarget | None,
    queued: QueueReason | None,
    block: PipelineBlock | None,
    config: PipelineConfig,
    now: datetime,
) -> str:
    lines = [
        "### 🤖 Pipeline status",
        "| Stage | Detail |",
        "|---|---|",
    ]

    # Review rounds
    reviews_by_round = {r.round: r for r in snapshot.reviews if r.round is not None}
    for k in range(1, len(config.reviews) + 1):
        spec = config.reviews[k - 1]
        slug = spec.provenance_slug
        rev = reviews_by_round.get(k)

        if rev is not None:
            match rev.status:
                case ReviewStatus.INTEGRATED:
                    lines.append(f"| ✅ Review round {k} | {slug} · integrated ({rev.review_id.value}) |")
                case ReviewStatus.AWAITING_DECISION:
                    has_unresolved = any(isinstance(d.resolution, Unresolved) for d in rev.decisions)
                    if has_unresolved:
                        lines.append(f"| 🛑 Review round {k} | {slug} · **waiting on you** |")
                    else:
                        lines.append(f"| ⏳ Review round {k} | {slug} · ready to integrate |")
                case ReviewStatus.PARTIALLY_INTEGRATED:
                    lines.append(f"| ⏳ Review round {k} | {slug} · integrating ({rev.review_id.value}) |")
                case ReviewStatus.PENDING:
                    lines.append(f"| ⏳ Review round {k} | {slug} · review posted ({rev.review_id.value}) |")
                case ReviewStatus.MALFORMED:
                    lines.append(f"| 🛑 Review round {k} | {slug} · malformed |")
        else:
            is_active_review_round = (
                stage is Stage.REVIEW
                and (
                    (target is not None and getattr(target, "round", None) == k)
                    or (target is None and k == next((i for i in range(1, len(config.reviews) + 1) if i not in reviews_by_round), 1))
                )
            )
            if is_active_review_round:
                if queued is not None:
                    lines.append(f"| ⏳ Review round {k} | queued ({_format_queued(queued)}) |")
                else:
                    lines.append(f"| ⏳ Review round {k} | {slug} · running review |")
            elif config.skip_review_label in snapshot.labels:
                lines.append(f"| ⏭️ Review round {k} | skipped |")
            else:
                lines.append(f"| ⏳ Review round {k} | pending |")

    # Implementation row
    if stage is Stage.MERGED or isinstance(snapshot.linked_pr, MergedPr):
        pr_str = f" #{snapshot.linked_pr.pr.number}" if snapshot.linked_pr else ""
        lines.append(f"| ✅ Implementation | PR{pr_str} merged |")
    elif isinstance(snapshot.linked_pr, ClosedPr):
        lines.append(f"| 🛑 Implementation | PR #{snapshot.linked_pr.pr.number} closed |")
    elif isinstance(snapshot.linked_pr, OpenPr):
        pr = snapshot.linked_pr
        if stage is Stage.AWAITING_MERGE:
            lines.append(f"| ⏳ Implementation | PR #{pr.pr.number} awaiting merge |")
        elif stage is Stage.BREAKER_TRIP or (block is not None and block.reason is BlockReason.CIRCUIT_BREAKER):
            lines.append(f"| 🛑 Implementation | PR #{pr.pr.number} circuit breaker tripped |")
        elif stage is Stage.VERIFY:
            if queued is not None:
                lines.append(f"| ⏳ Implementation | queued ({_format_queued(queued)}) |")
            else:
                lines.append(f"| ⏳ Implementation | verifying PR #{pr.pr.number} |")
        elif stage is Stage.REVISE:
            if queued is not None:
                lines.append(f"| ⏳ Implementation | queued ({_format_queued(queued)}) |")
            else:
                lines.append(f"| ⏳ Implementation | revising PR #{pr.pr.number} |")
        else:
            lines.append(f"| ⏳ Implementation | PR #{pr.pr.number} ({pr.readiness.value.lower()}) |")
    else:
        # No PR
        if stage is Stage.IMPLEMENTING_ORPHAN or stage is Stage.READY:
            if queued is not None:
                lines.append(f"| ⏳ Implementation | queued ({_format_queued(queued)}) |")
            elif stage is Stage.READY and target is not None:
                lines.append("| ⏳ Implementation | ready for implementation |")
            else:
                lines.append("| ⏳ Implementation | implementing |")
        elif stage in (Stage.REVIEW, Stage.INTEGRATE, Stage.DECISIONS_UNRESOLVED):
            lines.append("| ⏳ Implementation | pending specification |")
        else:
            lines.append("| ⏳ Implementation | pending |")

    body = "\n".join(lines)

    # Action required block
    if block is not None:
        action_text = _ACTION_REQUIRED.get(block.reason, "")
        if block.reason is BlockReason.DECISIONS_UNRESOLVED:
            unresolved_ids = [
                d.id
                for r in snapshot.reviews
                for d in r.decisions
                if isinstance(d.resolution, Unresolved)
            ]
            if unresolved_ids:
                action_text = (
                    f"resolve {', '.join(unresolved_ids)} in review comment "
                    "(tick one option each or reply `DEC-N: …`), then remove the `needs-info` label."
                )
        body += f"\n\n**🛑 Action required:** {action_text}"

    # Timestamp footer
    body += f"\n<sub>State changed {now.isoformat()}</sub>"
    return body


def strip_footer(body: str) -> str:
    normalized = body.replace("\r\n", "\n")
    cleaned_lines = [
        line for line in normalized.splitlines()
        if not (line.strip().startswith("<sub>State changed ") and line.strip().endswith("</sub>"))
    ]
    return "\n".join(cleaned_lines).rstrip()


def needs_patch(existing: ExistingComment | None, rendered: str) -> bool:
    if existing is None:
        return True
    return strip_footer(existing.body) != strip_footer(rendered)
