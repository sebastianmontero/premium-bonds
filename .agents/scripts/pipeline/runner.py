"""Execution runners (herdr, systemd-run, headless background).

Launches the pipeline exec wrapper using interactive terminal multiplexers (herdr)
or non-interactive execution (systemd transient units / background processes).
"""

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
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
            res = subprocess.run(["herdr", "status", "server"], capture_output=True, text=True, check=False)
            return res.returncode == 0 and "status: running" in res.stdout
        except Exception:
            return False

    def start(self, record: RunRecord) -> RunnerHandle:
        try:
            return self._start_herdr(record)
        except Exception as e:
            logger.warning("HerdrRunner failed (%s); falling back to HeadlessRunner", e)
            return HeadlessRunner(self.paths).start(record)

    def _start_herdr(self, record: RunRecord) -> RunnerHandle:
        control_dir = str(self.paths.control)
        # 1. Find or create pipeline workspace
        ws_list_proc = subprocess.run(["herdr", "workspace", "list"], capture_output=True, text=True, check=True)
        ws_data = json.loads(ws_list_proc.stdout)
        workspaces = ws_data.get("result", {}).get("workspaces", [])
        workspace_id = None
        for w in workspaces:
            if w.get("label") == self.workspace_name:
                workspace_id = w.get("workspace_id")
                break

        if not workspace_id:
            ws_create_cmd = ["herdr", "workspace", "create", "--label", self.workspace_name, "--cwd", control_dir, "--no-focus"]
            ws_create_proc = subprocess.run(ws_create_cmd, capture_output=True, text=True, check=True)
            create_data = json.loads(ws_create_proc.stdout)
            workspace_id = (
                create_data.get("result", {}).get("workspace_id")
                or create_data.get("result", {}).get("workspace", {}).get("workspace_id")
                or create_data.get("workspace_id")
            )
            if not workspace_id:
                ws_list_proc2 = subprocess.run(["herdr", "workspace", "list"], capture_output=True, text=True, check=True)
                for w in json.loads(ws_list_proc2.stdout).get("result", {}).get("workspaces", []):
                    if w.get("label") == self.workspace_name:
                        workspace_id = w.get("workspace_id")
                        break
            if not workspace_id:
                raise RuntimeError("Failed to resolve workspace_id for pipeline workspace")

        # 2. Create tab
        tab_cmd = ["herdr", "tab", "create", "--workspace", workspace_id, "--cwd", control_dir, "--no-focus"]
        tab_proc = subprocess.run(tab_cmd, capture_output=True, text=True, check=True)
        tab_data = json.loads(tab_proc.stdout)
        tab_id = (
            tab_data.get("result", {}).get("tab", {}).get("tab_id")
            or tab_data.get("result", {}).get("tab_id")
            or tab_data.get("tab_id")
        )
        pane_id = (
            tab_data.get("result", {}).get("root_pane", {}).get("pane_id")
            or tab_data.get("result", {}).get("pane_id")
            or tab_data.get("pane_id")
        )
        if not tab_id or not pane_id:
            raise RuntimeError(f"Failed to parse tab_id / pane_id from herdr tab create: {tab_proc.stdout}")

        # 3. Rename tab "#<n> <step>"
        tab_title = f"#{record.issue.number} {record.target.step.value}"
        subprocess.run(["herdr", "tab", "rename", str(tab_id), tab_title], capture_output=True, check=False)

        # 4. Run pane
        exec_cmd = f"python3 {self.paths.control}/.agents/scripts/pipeline exec {record.run_id}"
        subprocess.run(["herdr", "pane", "run", str(pane_id), exec_cmd], capture_output=True, check=True)

        return HerdrHandle(tab_id=str(tab_id))

    def cleanup_stale_runs(self, finished: Mapping[RunId, FinishedRun], now: datetime) -> None:
        for rid, fin in finished.items():
            if isinstance(fin.handle, HerdrHandle):
                if (now - fin.outcome.finished_at) > timedelta(minutes=60):
                    try:
                        subprocess.run(["herdr", "tab", "close", str(fin.handle.tab_id)], capture_output=True, check=False)
                    except Exception:
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
                f"--working-directory={self.paths.control}",
                "--collect",
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
            cwd=self.paths.control,
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
