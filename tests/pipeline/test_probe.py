"""Unit tests for run probe, /proc inspection, and orphan detection."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import (
    Effort,
    ImplementTarget,
    ImplAtDev,
    IssueRef,
    Liveness,
    RunId,
    StepSpec,
)
from pipeline.paths import PipelinePaths
from pipeline.probe import probe
from pipeline.procs import ProcessControl, ProcessIdentity
from pipeline.state import RunRecord


class TestProbe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = PipelinePaths(root=self.root)
        self.proc_root = self.root / "proc"
        self.proc_root.mkdir(parents=True, exist_ok=True)

        self.mock_boot_id = "test-boot-123"
        boot_id_file = self.proc_root / "sys" / "kernel" / "random" / "boot_id"
        boot_id_file.parent.mkdir(parents=True, exist_ok=True)
        boot_id_file.write_text(self.mock_boot_id + "\n", encoding="utf-8")

        self.current_monotonic = 1000.0
        self.killed_pgids = []
        self.alive_groups = set()

        def fake_killpg(pgid: int, sig: int) -> None:
            if sig == 0:
                if pgid in self.alive_groups:
                    return
                raise ProcessLookupError()
            self.killed_pgids.append((pgid, sig))

        self.procs = ProcessControl(
            proc_root=self.proc_root,
            killpg_fn=fake_killpg,
            monotonic_fn=lambda: self.current_monotonic,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def _write_proc_stat(self, pid: int, start_time: int) -> None:
        pdir = self.proc_root / str(pid)
        pdir.mkdir(parents=True, exist_ok=True)
        # 52 fields. Field 22 is start_time.
        # Field 1: pid, Field 2: comm
        fields = ["0"] * 50  # 50 fields after comm
        # field 22 corresponds to remaining_fields index 19
        fields[19] = str(start_time)
        stat_line = f"{pid} (python3) " + " ".join(fields)
        (pdir / "stat").write_text(stat_line, encoding="utf-8")

    def _make_record(self, rid: str = "run-1", timeout_mins: int = 45) -> RunRecord:
        return RunRecord(
            run_id=RunId(rid),
            issue=IssueRef(1),
            target=ImplementTarget(),
            spec=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            prompt="",
            workspace=ImplAtDev(),
            timeout=timedelta(minutes=timeout_mins),
            started_at=datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc),
        )

    def test_process_identity_json_roundtrip_and_malformed(self):
        ident = ProcessIdentity(
            pid=1234,
            start_time=5678,
            boot_id=self.mock_boot_id,
            monotonic_start=100.0,
            pgid=1234,
            pgid_start_time=5678,
        )
        s = ident.to_json()
        loaded = ProcessIdentity.from_json(s)
        self.assertEqual(loaded, ident)

        # Malformed JSON decodes to None
        self.assertIsNone(ProcessIdentity.from_json("invalid json"))
        self.assertIsNone(ProcessIdentity.from_json("{}"))

    def test_prep_phase_pgid_is_none(self):
        rec = self._make_record("run-prep")
        self._write_proc_stat(1234, 5000)

        ident = ProcessIdentity(
            pid=1234,
            start_time=5000,
            boot_id=self.mock_boot_id,
            monotonic_start=950.0,
            pgid=None,
            pgid_start_time=None,
        )
        self.paths.pid_file("run-prep").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-prep").write_text(ident.to_json(), encoding="utf-8")

        res = probe({rec.run_id: rec}, self.paths, self.procs)
        ar = res[rec.run_id]
        self.assertEqual(ar.liveness, Liveness.ALIVE)
        self.assertIsNone(ar.pgid)
        self.assertFalse(ar.group_alive)

    def test_mismatched_boot_id_or_start_time_gives_exited_never_signalled(self):
        rec = self._make_record("run-boot")
        self._write_proc_stat(1234, 5000)

        # Different boot_id
        ident = ProcessIdentity(
            pid=1234,
            start_time=5000,
            boot_id="old-boot-id",
            monotonic_start=100.0,
            pgid=1234,
            pgid_start_time=5000,
        )
        self.paths.pid_file("run-boot").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-boot").write_text(ident.to_json(), encoding="utf-8")

        res = probe({rec.run_id: rec}, self.paths, self.procs)
        ar = res[rec.run_id]
        self.assertEqual(ar.liveness, Liveness.EXITED)
        self.assertEqual(len(self.killed_pgids), 0)

    def test_pgid_reuse_different_start_time_never_signalled(self):
        rec = self._make_record("run-pgid")
        self._write_proc_stat(1000, 5000)  # leader /proc exists with start_time 5000
        self.alive_groups.add(1000)

        ident = ProcessIdentity(
            pid=1000,
            start_time=5000,
            boot_id=self.mock_boot_id,
            monotonic_start=950.0,
            pgid=1000,
            pgid_start_time=9999,  # Mismatched expected pgid_start_time
        )
        self.paths.pid_file("run-pgid").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-pgid").write_text(ident.to_json(), encoding="utf-8")

        res = probe({rec.run_id: rec}, self.paths, self.procs)
        ar = res[rec.run_id]
        self.assertFalse(ar.group_alive)

    def test_group_alive_when_leader_gone_but_members_remain(self):
        rec = self._make_record("run-members")
        self._write_proc_stat(1000, 5000)
        self.alive_groups.add(2000)  # Group 2000 has alive members
        # /proc/2000 is absent (leader exited)

        ident = ProcessIdentity(
            pid=1000,
            start_time=5000,
            boot_id=self.mock_boot_id,
            monotonic_start=950.0,
            pgid=2000,
            pgid_start_time=7777,
        )
        self.paths.pid_file("run-members").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-members").write_text(ident.to_json(), encoding="utf-8")

        res = probe({rec.run_id: rec}, self.paths, self.procs)
        ar = res[rec.run_id]
        self.assertTrue(ar.group_alive)

    def test_suspend_does_not_time_out(self):
        # Wall clock advances past timeout + 10 min, but monotonic clock does not
        rec = self._make_record("run-suspend", timeout_mins=45)
        self._write_proc_stat(1000, 5000)

        ident = ProcessIdentity(
            pid=1000,
            start_time=5000,
            boot_id=self.mock_boot_id,
            monotonic_start=1000.0,
            pgid=1000,
            pgid_start_time=5000,
        )
        self.paths.pid_file("run-suspend").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-suspend").write_text(ident.to_json(), encoding="utf-8")

        # Monotonic time only advanced by 5 minutes
        self.current_monotonic = 1000.0 + 300.0

        # Wall clock is 2 hours later
        wall_now = datetime(2026, 10, 17, 14, 0, 0, tzinfo=timezone.utc)
        res = probe({rec.run_id: rec}, self.paths, self.procs, now_wall=wall_now)
        ar = res[rec.run_id]
        self.assertEqual(ar.liveness, Liveness.ALIVE)

    def test_monotonic_backstop_times_out(self):
        rec = self._make_record("run-timeout", timeout_mins=45)
        self._write_proc_stat(1000, 5000)

        ident = ProcessIdentity(
            pid=1000,
            start_time=5000,
            boot_id=self.mock_boot_id,
            monotonic_start=1000.0,
            pgid=1000,
            pgid_start_time=5000,
        )
        self.paths.pid_file("run-timeout").parent.mkdir(parents=True, exist_ok=True)
        self.paths.pid_file("run-timeout").write_text(ident.to_json(), encoding="utf-8")

        # Monotonic time advanced past 45m + 10m = 55m = 3300s
        self.current_monotonic = 1000.0 + 3301.0

        res = probe({rec.run_id: rec}, self.paths, self.procs)
        ar = res[rec.run_id]
        self.assertEqual(ar.liveness, Liveness.TIMED_OUT)

    def test_orphan_scan_synthesises_live_lane_run(self):
        self._write_proc_stat(3000, 8000)

        ident = ProcessIdentity(
            pid=3000,
            start_time=8000,
            boot_id=self.mock_boot_id,
            monotonic_start=900.0,
            pgid=3000,
            pgid_start_time=8000,
        )
        stray_file = self.paths.pid_file("run-stray")
        stray_file.parent.mkdir(parents=True, exist_ok=True)
        stray_file.write_text(ident.to_json(), encoding="utf-8")

        # No records passed in store
        res = probe({}, self.paths, self.procs)
        self.assertIn(RunId("run-stray"), res)
        ar = res[RunId("run-stray")]
        self.assertEqual(ar.liveness, Liveness.ALIVE)
        self.assertEqual(ar.record.target.step.holds_lane, True)


if __name__ == "__main__":
    unittest.main()
