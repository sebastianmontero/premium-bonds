"""Execution runners (herdr, systemd-run, headless background).

Launches the pipeline exec wrapper using interactive terminal multiplexers (herdr)
or non-interactive execution (systemd transient units / background processes).
"""

from collections.abc import Mapping
from datetime import datetime, timezone
import json
import logging
import os
import shutil
import subprocess
from typing import Protocol

from .paths import PipelinePaths
from .state import (
    FinishedRun,
    HeadlessHandle,
    HerdrHandle,
    RunId,
    RunRecord,
    RunnerHandle,
    SystemdHandle,
)

logger = logging.getLogger(__name__)


class Runner(Protocol):
    def start(self, record: RunRecord) -> RunnerHandle: ...
    def cleanup_stale_runs(self, finished: Mapping[RunId, FinishedRun], now: datetime) -> None: ...


class HerdrRunner:
    def __init__(self, paths: PipelinePaths, workspace_name: str = "pipeline") -> None:
        self.paths = paths
        self.workspace_name = workspace_name

    def is_available(self) -> bool:
        if not shutil.which("herdr"):
            return False
        try:
            res = subprocess.run(["herdr", "ping"], capture_output=True, text=True, check=False)
            return res.returncode == 0
        except Exception:
            return False

    def start(self, record: RunRecord) -> RunnerHandle:
        rid = str(record.run_id)
        title = f"#{record.issue.number}-{record.target.step.value}"
        control_pkg = self.paths.control / ".agents" / "scripts" / "pipeline"

        exec_cmd = f"python3 {control_pkg} exec {rid}"

        cmd = [
            "herdr", "new-tab",
            "--workspace", self.workspace_name,
            "--title", title,
            "--command", exec_cmd,
            "--json",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        tab_id = rid
        if res.returncode == 0:
            try:
                data = json.loads(res.stdout)
                tab_id = str(data.get("tab_id") or data.get("id") or rid)
            except Exception:
                pass
        else:
            logger.warning("herdr new-tab failed (%s): %s; using headless fallback", res.returncode, res.stderr)
            # If herdr failed during tab creation, return HerdrHandle with rid
            return HerdrHandle(tab_id=rid)

        return HerdrHandle(tab_id=tab_id)

    def cleanup_stale_runs(self, finished: Mapping[RunId, FinishedRun], now: datetime) -> None:
        pass


class HeadlessRunner:
    def __init__(self, paths: PipelinePaths) -> None:
        self.paths = paths

    def start(self, record: RunRecord) -> RunnerHandle:
        rid = str(record.run_id)
        control_pkg = self.paths.control / ".agents" / "scripts" / "pipeline"

        invocation_id = os.environ.get("INVOCATION_ID")
        has_systemd_run = bool(shutil.which("systemd-run"))

        if invocation_id and has_systemd_run:
            unit_name = f"pb-pipeline-{rid}"
            cmd = [
                "systemd-run",
                "--user",
                f"--unit={unit_name}",
                "--description", f"Pipeline run {rid} for issue #{record.issue.number}",
                "python3", str(control_pkg), "exec", rid,
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if res.returncode != 0:
                logger.warning("systemd-run failed (%s): %s; falling back to subprocess", res.returncode, res.stderr)
            else:
                return SystemdHandle(unit=unit_name)

        # Standard background detached subprocess
        cmd = ["python3", str(control_pkg), "exec", rid]
        subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return HeadlessHandle()

    def cleanup_stale_runs(self, finished: Mapping[RunId, FinishedRun], now: datetime) -> None:
        pass


class AutoRunner:
    def __init__(self, paths: PipelinePaths) -> None:
        self.paths = paths
        self._herdr = HerdrRunner(paths)
        self._headless = HeadlessRunner(paths)

    def start(self, record: RunRecord) -> RunnerHandle:
        if self._herdr.is_available():
            return self._herdr.start(record)
        return self._headless.start(record)

    def cleanup_stale_runs(self, finished: Mapping[RunId, FinishedRun], now: datetime) -> None:
        self._herdr.cleanup_stale_runs(finished, now)
        self._headless.cleanup_stale_runs(finished, now)
