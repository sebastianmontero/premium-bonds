"""Run probing and orphan detection for pipeline ticks.

Inspects runs/ pid and exit files against /proc and monotonic clock
to classify each RunRecord into ALIVE, EXITED, or TIMED_OUT, and scans
for stray/orphan live runs.
"""

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .model import (
    Effort,
    ImplementTarget,
    ImplAtDev,
    IssueRef,
    Liveness,
    RunId,
    StepSpec,
)
from .paths import PipelinePaths
from .procs import ProcessControl, ProcessIdentity
from .state import ActiveRun, RunRecord


def probe(
    records: Mapping[RunId, RunRecord],
    paths: PipelinePaths,
    procs: ProcessControl,
    now_wall: datetime | None = None,
) -> Mapping[RunId, ActiveRun]:
    """Probe status of all known run records and detect orphan live runs."""
    active_runs: dict[RunId, ActiveRun] = {}
    current_mono = procs.current_monotonic()
    now_utc = now_wall or datetime.now(timezone.utc)

    # 1. Probe known records from store
    for run_id, record in records.items():
        exit_file = paths.exit_file(run_id)
        pid_file = paths.pid_file(run_id)

        if exit_file.exists():
            # Exit file exists -> EXITED
            # Read PID identity if available for pgid/group_alive check
            identity = _read_pid_identity(pid_file)
            group_alive = False
            pgid = None
            if identity is not None:
                pgid = identity.pgid
                group_alive = procs.is_group_alive(
                    identity.pgid,
                    identity.pgid_start_time,
                    identity.boot_id,
                )
            active_runs[run_id] = ActiveRun(
                record=record,
                liveness=Liveness.EXITED,
                group_alive=group_alive,
                pgid=pgid,
            )
            continue

        if not pid_file.exists():
            # No exit file, no pid file
            # Check elapsed wall time since record.started_at
            elapsed_wall = (now_utc - record.started_at).total_seconds()
            if elapsed_wall > 120.0:
                active_runs[run_id] = ActiveRun(
                    record=record,
                    liveness=Liveness.EXITED,
                    group_alive=False,
                    pgid=None,
                )
            else:
                active_runs[run_id] = ActiveRun(
                    record=record,
                    liveness=Liveness.ALIVE,
                    group_alive=False,
                    pgid=None,
                )
            continue

        identity = _read_pid_identity(pid_file)
        if identity is None:
            # Malformed pid file treated as missing pid file
            elapsed_wall = (now_utc - record.started_at).total_seconds()
            liveness = Liveness.EXITED if elapsed_wall > 120.0 else Liveness.ALIVE
            active_runs[run_id] = ActiveRun(
                record=record,
                liveness=liveness,
                group_alive=False,
                pgid=None,
            )
            continue

        pid_alive = procs.is_pid_alive(identity.pid, identity.start_time, identity.boot_id)
        group_alive = procs.is_group_alive(
            identity.pgid,
            identity.pgid_start_time,
            identity.boot_id,
        )

        if not pid_alive:
            active_runs[run_id] = ActiveRun(
                record=record,
                liveness=Liveness.EXITED,
                group_alive=group_alive,
                pgid=identity.pgid,
            )
            continue

        # Pid is alive; check monotonic timeout (record.timeout + 10 min)
        timeout_sec = record.timeout.total_seconds() + 600.0
        elapsed_mono = current_mono - identity.monotonic_start
        if elapsed_mono > timeout_sec:
            active_runs[run_id] = ActiveRun(
                record=record,
                liveness=Liveness.TIMED_OUT,
                group_alive=group_alive,
                pgid=identity.pgid,
            )
        else:
            active_runs[run_id] = ActiveRun(
                record=record,
                liveness=Liveness.ALIVE,
                group_alive=group_alive,
                pgid=identity.pgid,
            )

    # 2. Orphan scan: any runs/*.pid without matching .exit and not in records
    if paths.runs_dir.exists():
        for pid_path in paths.runs_dir.glob("*.pid"):
            rid_str = pid_path.stem
            rid = RunId(rid_str)
            if rid in records:
                continue

            exit_path = paths.exit_file(rid)
            if exit_path.exists():
                continue

            identity = _read_pid_identity(pid_path)
            if identity is None:
                continue

            if procs.is_pid_alive(identity.pid, identity.start_time, identity.boot_id):
                # Stray running agent group -> synthetic live lane run
                group_alive = procs.is_group_alive(
                    identity.pgid,
                    identity.pgid_start_time,
                    identity.boot_id,
                )
                synthetic_record = RunRecord(
                    run_id=rid,
                    issue=IssueRef(0),
                    target=ImplementTarget(),
                    spec=StepSpec(cli="claude", model="unknown", effort=Effort.HIGH),
                    prompt="",
                    workspace=ImplAtDev(),
                    timeout=timedelta(hours=2),
                    started_at=datetime.fromtimestamp(identity.monotonic_start, tz=timezone.utc),
                )
                active_runs[rid] = ActiveRun(
                    record=synthetic_record,
                    liveness=Liveness.ALIVE,
                    group_alive=group_alive,
                    pgid=identity.pgid,
                )

    return active_runs


def _read_pid_identity(pid_file: Path) -> ProcessIdentity | None:
    try:
        content = pid_file.read_text(encoding="utf-8")
        return ProcessIdentity.from_json(content)
    except Exception:
        return None
