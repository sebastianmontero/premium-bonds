"""Atomic JSON store persistence and tagged codec for StoreState.

Handles atomic file replacements within the state directory to avoid EXDEV,
strict schema version checks, and explicit tagged encoding/decoding for
all domain types (StepTarget, Workspace, RunnerHandle, BlockRef, etc.).
"""

from collections.abc import Callable
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import tempfile
from typing import Any

from .model import (
    AttemptKind,
    BlockReason,
    CommentRef,
    Editor,
    Effort,
    Fingerprint,
    ImplementTarget,
    ImplAtDev,
    ImplAtPrHead,
    IntegrateTarget,
    IssueRef,
    Liveness,
    PipelineBlock,
    PrRef,
    ReviewId,
    ReviewSlot,
    ReviewTarget,
    ReviseTarget,
    RunId,
    StepSpec,
    StepTarget,
    VerificationId,
    VerifyTarget,
    Workspace,
)
from .paths import PipelinePaths
from .state import (
    FinishedRun,
    HeadlessHandle,
    HerdrHandle,
    IssueLocalState,
    RunOutcome,
    RunRecord,
    RunnerHandle,
    StoreState,
    SystemdHandle,
)


class StoreError(Exception):
    """Raised when loading or saving store state fails."""


class CorruptStoreError(StoreError):
    """Raised when the store file is missing valid JSON or has an invalid schema."""


# --- Tagged Encoding ---


def encode_tagged(obj: object) -> dict[str, Any]:
    match obj:
        case ReviewTarget(round=r):
            return {"kind": "review_target", "round": r}
        case IntegrateTarget(review_id=rid, comment=c):
            return {"kind": "integrate_target", "review_id": rid.value, "comment": c.node_id}
        case ImplementTarget():
            return {"kind": "implement_target"}
        case VerifyTarget(pr=p, last_verification_cycle=c):
            return {"kind": "verify_target", "pr": p.number, "last_verification_cycle": c}
        case ReviseTarget(pr=p, last_verification_cycle=c):
            return {"kind": "revise_target", "pr": p.number, "last_verification_cycle": c}
        case Fingerprint(kind=k, key=v):
            return {"kind": "fingerprint", "attempt_kind": k.value, "key": v}
        case ReviewSlot(n=s):
            return {"kind": "review_slot", "slot": s}
        case ImplAtDev():
            return {"kind": "impl_at_dev"}
        case ImplAtPrHead(head_ref=hr):
            return {"kind": "impl_at_pr_head", "head_ref": hr}
        case HeadlessHandle():
            return {"kind": "headless_handle"}
        case SystemdHandle(unit=u):
            return {"kind": "systemd_handle", "unit": u}
        case HerdrHandle(tab_id=t):
            return {"kind": "herdr_handle", "tab_id": t}
        case ReviewId(value=v):
            return {"kind": "review_id", "value": v}
        case VerificationId(value=v):
            return {"kind": "verification_id", "value": v}
        case PrRef(number=n):
            return {"kind": "pr_ref", "number": n}
        case Editor(login=l):
            return {"kind": "editor", "login": l}
        case PipelineBlock(reason=r, ref=ref):
            return {"kind": "pipeline_block", "reason": r.value, "ref": encode_tagged(ref)}
        case _:
            raise TypeError(f"Cannot encode tagged object of type: {type(obj)}")


# --- Tagged Decoders Dispatch Table ---


def _decode_review_target(d: dict[str, Any]) -> ReviewTarget:
    return ReviewTarget(round=int(d["round"]))


def _decode_integrate_target(d: dict[str, Any]) -> IntegrateTarget:
    return IntegrateTarget(
        review_id=ReviewId(str(d["review_id"])),
        comment=CommentRef(str(d["comment"])),
    )


def _decode_implement_target(_: dict[str, Any]) -> ImplementTarget:
    return ImplementTarget()


def _decode_verify_target(d: dict[str, Any]) -> VerifyTarget:
    return VerifyTarget(
        pr=PrRef(int(d["pr"])),
        last_verification_cycle=int(d.get("last_verification_cycle", 0)),
    )


def _decode_revise_target(d: dict[str, Any]) -> ReviseTarget:
    return ReviseTarget(
        pr=PrRef(int(d["pr"])),
        last_verification_cycle=int(d.get("last_verification_cycle", 0)),
    )


def _decode_fingerprint(d: dict[str, Any]) -> Fingerprint:
    key_val = str(d.get("key", d.get("value", "")))
    return Fingerprint(kind=AttemptKind(str(d["attempt_kind"])), key=key_val)


def _decode_review_slot(d: dict[str, Any]) -> ReviewSlot:
    return ReviewSlot(n=int(d.get("slot", d.get("n", 0))))


def _decode_impl_at_dev(_: dict[str, Any]) -> ImplAtDev:
    return ImplAtDev()


def _decode_impl_at_pr_head(d: dict[str, Any]) -> ImplAtPrHead:
    return ImplAtPrHead(head_ref=str(d["head_ref"]))


def _decode_headless_handle(_: dict[str, Any]) -> HeadlessHandle:
    return HeadlessHandle()


def _decode_systemd_handle(d: dict[str, Any]) -> SystemdHandle:
    return SystemdHandle(unit=str(d["unit"]))


def _decode_herdr_handle(d: dict[str, Any]) -> HerdrHandle:
    return HerdrHandle(tab_id=str(d["tab_id"]))


def _decode_review_id(d: dict[str, Any]) -> ReviewId:
    return ReviewId(str(d["value"]))


def _decode_verification_id(d: dict[str, Any]) -> VerificationId:
    return VerificationId(str(d["value"]))


def _decode_pr_ref(d: dict[str, Any]) -> PrRef:
    return PrRef(int(d["number"]))


def _decode_editor(d: dict[str, Any]) -> Editor:
    return Editor(str(d["login"]))


def _decode_pipeline_block(d: dict[str, Any]) -> PipelineBlock:
    reason = BlockReason(str(d["reason"]))
    ref = decode_tagged(d["ref"])
    return PipelineBlock(reason=reason, ref=ref)  # type: ignore[arg-type]


TAGGED_DECODERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "review_target": _decode_review_target,
    "integrate_target": _decode_integrate_target,
    "implement_target": _decode_implement_target,
    "verify_target": _decode_verify_target,
    "revise_target": _decode_revise_target,
    "fingerprint": _decode_fingerprint,
    "review_slot": _decode_review_slot,
    "impl_at_dev": _decode_impl_at_dev,
    "impl_at_pr_head": _decode_impl_at_pr_head,
    "headless_handle": _decode_headless_handle,
    "systemd_handle": _decode_systemd_handle,
    "herdr_handle": _decode_herdr_handle,
    "review_id": _decode_review_id,
    "verification_id": _decode_verification_id,
    "pr_ref": _decode_pr_ref,
    "editor": _decode_editor,
    "pipeline_block": _decode_pipeline_block,
}


def decode_tagged(d: dict[str, Any]) -> Any:
    kind = d.get("kind")
    if not isinstance(kind, str):
        raise CorruptStoreError(f"Missing or invalid 'kind' field in tagged payload: {d}")
    decoder = TAGGED_DECODERS.get(kind)
    if decoder is None:
        raise CorruptStoreError(f"Unknown tagged codec kind: {kind}")
    return decoder(d)


# --- Full StoreState Serialization ---


def encode_store_state(state: StoreState) -> dict[str, Any]:
    runs_encoded = {}
    for rid, r in state.runs.items():
        runs_encoded[str(rid)] = {
            "run_id": str(r.run_id),
            "issue": r.issue.number,
            "target": encode_tagged(r.target),
            "spec": {
                "cli": r.spec.cli,
                "model": r.spec.model,
                "effort": r.spec.effort.value,
            },
            "prompt": r.prompt,
            "workspace": encode_tagged(r.workspace),
            "timeout": r.timeout.total_seconds(),
            "started_at": r.started_at.isoformat(),
        }

    handles_encoded = {
        str(rid): encode_tagged(handle) for rid, handle in state.handles.items()
    }

    finished_encoded = {}
    for rid, fr in state.finished.items():
        finished_encoded[str(rid)] = {
            "record": {
                "run_id": str(fr.record.run_id),
                "issue": fr.record.issue.number,
                "target": encode_tagged(fr.record.target),
                "spec": {
                    "cli": fr.record.spec.cli,
                    "model": fr.record.spec.model,
                    "effort": fr.record.spec.effort.value,
                },
                "prompt": fr.record.prompt,
                "workspace": encode_tagged(fr.record.workspace),
                "timeout": fr.record.timeout.total_seconds(),
                "started_at": fr.record.started_at.isoformat(),
            },
            "outcome": {
                "exit_code": fr.outcome.exit_code,
                "finished_at": fr.outcome.finished_at.isoformat(),
                "liveness": fr.outcome.liveness.value,
            },
            "handle": encode_tagged(fr.handle) if fr.handle is not None else None,
        }

    issues_encoded = {}
    for issue_ref, local in state.issues.items():
        attempts_list = [
            {"fingerprint": encode_tagged(fp), "count": count}
            for fp, count in local.attempts.items()
        ]
        last_detail_list = [
            {"fingerprint": encode_tagged(fp), "detail": detail}
            for fp, detail in local.last_detail.items()
        ]
        issues_encoded[str(issue_ref.number)] = {
            "attempts": attempts_list,
            "last_detail": last_detail_list,
            "block": encode_tagged(local.block) if local.block is not None else None,
            "implement_attempted": local.implement_attempted,
            "abandoned_prs": sorted(pr.number for pr in local.abandoned_prs),
        }

    return {
        "version": state.version,
        "runs": runs_encoded,
        "handles": handles_encoded,
        "finished": finished_encoded,
        "issues": issues_encoded,
    }


def decode_store_state(data: dict[str, Any]) -> StoreState:
    version = data.get("version")
    if version != 1:
        raise CorruptStoreError(f"Unsupported store state version: {version}")

    runs: dict[RunId, RunRecord] = {}
    for rid_str, r_data in data.get("runs", {}).items():
        spec_data = r_data["spec"]
        spec = StepSpec(
            cli=spec_data["cli"],
            model=spec_data["model"],
            effort=Effort(spec_data["effort"]),
        )
        runs[RunId(rid_str)] = RunRecord(
            run_id=RunId(str(r_data["run_id"])),
            issue=IssueRef(int(r_data["issue"])),
            target=decode_tagged(r_data["target"]),
            spec=spec,
            prompt=str(r_data["prompt"]),
            workspace=decode_tagged(r_data["workspace"]),
            timeout=timedelta(seconds=float(r_data["timeout"])),
            started_at=datetime.fromisoformat(r_data["started_at"]),
        )

    handles: dict[RunId, RunnerHandle] = {}
    for rid_str, h_data in data.get("handles", {}).items():
        handles[RunId(rid_str)] = decode_tagged(h_data)

    finished: dict[RunId, FinishedRun] = {}
    for rid_str, fr_data in data.get("finished", {}).items():
        rec_data = fr_data["record"]
        rec_spec = StepSpec(
            cli=rec_data["spec"]["cli"],
            model=rec_data["spec"]["model"],
            effort=Effort(rec_data["spec"]["effort"]),
        )
        rec = RunRecord(
            run_id=RunId(str(rec_data["run_id"])),
            issue=IssueRef(int(rec_data["issue"])),
            target=decode_tagged(rec_data["target"]),
            spec=rec_spec,
            prompt=str(rec_data["prompt"]),
            workspace=decode_tagged(rec_data["workspace"]),
            timeout=timedelta(seconds=float(rec_data["timeout"])),
            started_at=datetime.fromisoformat(rec_data["started_at"]),
        )
        out_data = fr_data["outcome"]
        outcome = RunOutcome(
            exit_code=int(out_data["exit_code"]) if out_data.get("exit_code") is not None else None,
            finished_at=datetime.fromisoformat(out_data["finished_at"]),
            liveness=Liveness(str(out_data["liveness"])),
        )
        handle = decode_tagged(fr_data["handle"]) if fr_data.get("handle") is not None else None
        finished[RunId(rid_str)] = FinishedRun(record=rec, outcome=outcome, handle=handle)

    issues: dict[IssueRef, IssueLocalState] = {}
    for num_str, i_data in data.get("issues", {}).items():
        attempts = {
            decode_tagged(item["fingerprint"]): int(item["count"])
            for item in i_data.get("attempts", [])
        }
        last_detail = {
            decode_tagged(item["fingerprint"]): str(item["detail"])
            for item in i_data.get("last_detail", [])
        }
        block = decode_tagged(i_data["block"]) if i_data.get("block") is not None else None
        abandoned = frozenset(PrRef(int(p)) for p in i_data.get("abandoned_prs", []))
        issues[IssueRef(int(num_str))] = IssueLocalState(
            attempts=attempts,
            last_detail=last_detail,
            block=block,
            implement_attempted=bool(i_data.get("implement_attempted", False)),
            abandoned_prs=abandoned,
        )

    return StoreState(
        version=version,
        runs=runs,
        handles=handles,
        finished=finished,
        issues=issues,
    )


def save_store(paths: PipelinePaths, state: StoreState) -> None:
    """Atomically save StoreState to state.json using tmp file on same filesystem."""
    paths.ensure_dirs()
    target = paths.state_json
    data = encode_store_state(state)

    # Use state dir for temp file to ensure atomic rename without EXDEV
    with tempfile.NamedTemporaryFile("w", dir=target.parent, delete=False, encoding="utf-8") as f:
        tmp_name = f.name
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

    os.replace(tmp_name, target)


def load_store(paths: PipelinePaths) -> StoreState:
    """Load StoreState from state.json, or return an empty StoreState if not yet created."""
    target = paths.state_json
    if not target.exists():
        return StoreState()

    try:
        content = target.read_text(encoding="utf-8")
        data = json.loads(content)
    except Exception as e:
        raise CorruptStoreError(f"Failed to parse store file {target}: {e}") from e

    if not isinstance(data, dict):
        raise CorruptStoreError(f"Store root must be a JSON object, got: {type(data)}")

    return decode_store_state(data)
