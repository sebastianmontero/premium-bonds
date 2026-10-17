"""CLI status table and JSON reporter for pipeline state.

Presents a human-readable summary of current issue stages, block reasons,
active runs, elapsed execution times, and lane holdings.
"""

from collections.abc import Mapping
from datetime import datetime, timezone
import json
import sys
from typing import Any

from .model import IssueRef, Liveness
from .paths import PipelinePaths
from .procs import ProcessControl
from .probe import probe
from .state import ActiveRun, StoreState
from .store import load_store


def format_status(paths: PipelinePaths, json_output: bool = False) -> None:
    store = load_store(paths)
    procs = ProcessControl()
    now = datetime.now(timezone.utc)
    active_runs = probe(store.runs, paths, procs, now_wall=now)

    # Build active run by issue
    active_by_issue: dict[int, ActiveRun] = {}
    for ar in active_runs.values():
        if ar.liveness is Liveness.ALIVE:
            active_by_issue[ar.record.issue.number] = ar

    # Find lane holder
    lane_holder_str = "none"
    for ar in active_runs.values():
        if ar.liveness is Liveness.ALIVE and ar.record.target.step.holds_lane:
            lane_holder_str = f"#{ar.record.issue.number}"
            break

    issues_info: list[dict[str, Any]] = []

    for issue_ref, local in sorted(store.issues.items(), key=lambda x: x[0].number):
        num = issue_ref.number
        block_reason = local.block.reason.value if local.block else "-"
        ar = active_by_issue.get(num)

        active_run_info: dict[str, Any] | None = None
        if ar:
            elapsed = (now - ar.record.started_at).total_seconds()
            mins = int(elapsed // 60)
            secs = int(elapsed % 60)
            handle_str = "-"
            if ar.record.run_id in store.handles:
                handle_str = type(store.handles[ar.record.run_id]).__name__.removesuffix("Handle").lower()

            active_run_info = {
                "run_id": ar.record.run_id.value,
                "step": ar.record.target.step.value,
                "model": ar.record.spec.model,
                "handle": handle_str,
                "elapsed": f"{mins}m {secs}s",
                "log": str(paths.log(ar.record.run_id)),
            }

        issues_info.append({
            "issue": num,
            "block_reason": block_reason,
            "active_run": active_run_info,
        })

    if json_output:
        out = {
            "lane_holder": lane_holder_str,
            "issues": issues_info,
        }
        print(json.dumps(out, indent=2))
        return

    # Print human-readable table
    print(f"Implementation Lane Holder: {lane_holder_str}\n")
    headers = ["Issue", "Block Reason", "Active Step", "Model", "Runner", "Elapsed", "Log Path"]
    rows = []
    for info in issues_info:
        ar_info = info["active_run"]
        if ar_info:
            rows.append([
                f"#{info['issue']}",
                info["block_reason"],
                ar_info["step"],
                ar_info["model"],
                ar_info["handle"],
                ar_info["elapsed"],
                ar_info["log"],
            ])
        else:
            rows.append([
                f"#{info['issue']}",
                info["block_reason"],
                "-",
                "-",
                "-",
                "-",
                "-",
            ])

    if not rows:
        print("No issues currently tracked in pipeline state.")
        return

    # Compute column widths
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(val)))

    header_line = "  ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    sep_line = "  ".join("-" * col_widths[i] for i in range(len(headers)))
    print(header_line)
    print(sep_line)
    for row in rows:
        print("  ".join(str(val).ljust(col_widths[i]) for i, val in enumerate(row)))
