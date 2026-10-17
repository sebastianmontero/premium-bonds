"""Unit tests for runner dispatch (herdr and headless / systemd-run)."""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import (
    Effort,
    ImplementTarget,
    ImplAtDev,
    IssueRef,
    RunId,
    StepSpec,
)
from pipeline.paths import PipelinePaths
from pipeline.runner import HeadlessRunner, HerdrRunner
from pipeline.state import HeadlessHandle, HerdrHandle, RunRecord, SystemdHandle


class TestRunner(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = PipelinePaths(root=self.root)
        self.mock_bin = self.root / "bin"
        self.mock_bin.mkdir(parents=True, exist_ok=True)
        self.orig_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{self.mock_bin}:{self.orig_path}"

        self.record = RunRecord(
            run_id=RunId("run-42-test"),
            issue=IssueRef(42),
            target=ImplementTarget(),
            spec=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(hours=1),
            started_at=datetime.now(timezone.utc),
        )

    def tearDown(self):
        os.environ["PATH"] = self.orig_path
        self.tmp.cleanup()

    def _create_mock_bin(self, name: str, script_body: str) -> Path:
        p = self.mock_bin / name
        p.write_text(f"#!/usr/bin/env bash\n{script_body}\n", encoding="utf-8")
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        return p

    def test_herdr_runner_creates_tab_and_returns_handle(self):
        # Fake herdr on PATH that outputs JSON
        log_file = self.root / "herdr.log"
        self._create_mock_bin(
            "herdr",
            f"""
            echo "$@" >> "{log_file}"
            if [[ "$1" == "ping" ]]; then
                exit 0
            fi
            echo '{{"tab_id": "tab-herdr-42"}}'
            exit 0
            """,
        )

        runner = HerdrRunner(self.paths)
        self.assertTrue(runner.is_available())
        handle = runner.start(self.record)
        self.assertIsInstance(handle, HerdrHandle)
        self.assertEqual(handle.tab_id, "tab-herdr-42")

        logged = log_file.read_text(encoding="utf-8")
        self.assertIn("new-tab", logged)
        self.assertIn("--workspace pipeline", logged)

    def test_headless_runner_picks_systemd_run_when_invocation_id_set(self):
        log_file = self.root / "systemd-run.log"
        self._create_mock_bin(
            "systemd-run",
            f"""
            echo "$@" >> "{log_file}"
            exit 0
            """,
        )

        runner = HeadlessRunner(self.paths)
        with patch.dict(os.environ, {"INVOCATION_ID": "svc-unit-123"}):
            handle = runner.start(self.record)
            self.assertIsInstance(handle, SystemdHandle)
            self.assertEqual(handle.unit, f"pb-pipeline-{self.record.run_id}")

        logged = log_file.read_text(encoding="utf-8")
        self.assertIn(f"--unit=pb-pipeline-{self.record.run_id}", logged)

    def test_headless_runner_falls_back_to_background_when_no_invocation_id(self):
        runner = HeadlessRunner(self.paths)
        with patch.dict(os.environ, {}, clear=True), patch("subprocess.Popen") as mock_popen:
            handle = runner.start(self.record)
            self.assertIsInstance(handle, HeadlessHandle)
            mock_popen.assert_called_once()


if __name__ == "__main__":
    unittest.main()
