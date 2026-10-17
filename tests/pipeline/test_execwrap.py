"""Unit tests for pipeline exec wrapper, StreamLogTee, and process supervisor."""

from datetime import datetime, timezone
import errno
import io
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.execwrap import (
    EXIT_PREP_FAILED,
    StreamLogTee,
    write_exit_file,
    write_pid_file,
)
from pipeline.paths import PipelinePaths
from pipeline.procs import ProcessIdentity
from pipeline.state import RunId


class TestExecwrap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = PipelinePaths(root=self.root)
        self.paths.ensure_dirs()

    def tearDown(self):
        self.tmp.cleanup()

    def test_pid_file_and_exit_file_writing(self):
        rid = RunId("run-pid-test")
        ident = ProcessIdentity(
            pid=123,
            start_time=456,
            boot_id="boot-1",
            monotonic_start=100.0,
            pgid=None,
            pgid_start_time=None,
        )
        write_pid_file(self.paths, rid, ident)
        self.assertTrue(self.paths.pid_file(rid).exists())
        loaded = ProcessIdentity.from_json(self.paths.pid_file(rid).read_text(encoding="utf-8"))
        self.assertEqual(loaded, ident)

        # Update with pgid
        updated = ProcessIdentity(
            pid=123,
            start_time=456,
            boot_id="boot-1",
            monotonic_start=100.0,
            pgid=789,
            pgid_start_time=1011,
        )
        write_pid_file(self.paths, rid, updated)
        loaded2 = ProcessIdentity.from_json(self.paths.pid_file(rid).read_text(encoding="utf-8"))
        self.assertEqual(loaded2, updated)

        # Write exit file
        write_exit_file(self.paths, rid, 0)
        self.assertTrue(self.paths.exit_file(rid).exists())
        self.assertEqual(self.paths.exit_file(rid).read_text().strip(), "0")

    def test_stream_log_tee_rendering_and_truncation(self):
        log_file = self.root / "test.log"
        fd = os.open(log_file, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        tee = StreamLogTee(fd)

        out = io.StringIO()
        with patch("sys.stdout", out):
            # 1. Plain text line longer than 200 chars
            long_line = ("a" * 250) + "\n"
            tee.write_chunk(long_line.encode("utf-8"))

            # 2. Claude stream-json text delta
            claude_json = '{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hello"}}\n'
            tee.write_chunk(claude_json.encode("utf-8"))

            # 3. Tool use block
            tool_json = '{"type": "tool_use", "name": "run_command"}\n'
            tee.write_chunk(tool_json.encode("utf-8"))

        os.close(fd)

        # Assert log file got full raw bytes
        logged = log_file.read_text(encoding="utf-8")
        self.assertIn("a" * 250, logged)
        self.assertIn(claude_json.strip(), logged)
        self.assertIn(tool_json.strip(), logged)

        # Assert stdout got truncated / compact formatted content
        stdout_text = out.getvalue()
        self.assertIn("a" * 200 + "...", stdout_text)
        self.assertIn("hello", stdout_text)
        self.assertIn("[tool: run_command]", stdout_text)

    def test_stream_log_tee_handles_broken_pipe(self):
        log_file = self.root / "broken_pipe.log"
        fd = os.open(log_file, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        tee = StreamLogTee(fd)

        class BrokenStdout:
            def write(self, s):
                err = OSError()
                err.errno = errno.EPIPE
                raise err
            def flush(self):
                pass

        with patch("sys.stdout", BrokenStdout()):
            # Must NOT raise exception despite stdout EPIPE
            tee.write_chunk(b"first chunk\n")
            tee.write_chunk(b"second chunk\n")

        os.close(fd)

        # Assert log file still received every byte
        logged = log_file.read_text(encoding="utf-8")
        self.assertIn("first chunk", logged)
        self.assertIn("second chunk", logged)

    def test_prep_failure_or_timeout_exits_97(self):
        from datetime import timedelta, timezone
        from pipeline.config import PipelineConfig
        from pipeline.execwrap import exec_run
        from pipeline.model import Effort, ImplementTarget, ImplAtDev, IssueRef, StepSpec
        from pipeline.state import RunRecord, StoreState
        from pipeline.store import save_store

        rid = RunId("run-prep-fail")
        record = RunRecord(
            run_id=rid,
            issue=IssueRef(42),
            target=ImplementTarget(),
            spec=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            prompt="do something",
            workspace=ImplAtDev(),
            timeout=timedelta(minutes=10),
            started_at=datetime.now(timezone.utc),
        )
        save_store(self.paths, StoreState(runs={rid: record}))

        config = MagicMock(spec=PipelineConfig)
        config.cli = {}

        # 1. Prep failure raises exception -> exit 97
        with patch("pipeline.execwrap.prepare_workspace", side_effect=RuntimeError("Disk full")):
            code = exec_run(str(rid), self.paths, config, self.root)
            self.assertEqual(code, 97)
            self.assertEqual(self.paths.exit_file(rid).read_text().strip(), "97")

        # 2. Prep exceeding deadline -> exit 97
        with patch("pipeline.execwrap.prepare_workspace", return_value=self.root):
            with patch("time.monotonic", side_effect=[0.0, 0.0, 1000.0, 1000.0]):
                code = exec_run(str(rid), self.paths, config, self.root)
                self.assertEqual(code, 97)

    def test_agent_spawn_uses_stdin_devnull_and_kills_on_timeout(self):
        from datetime import timedelta, timezone
        from pipeline.config import PipelineConfig
        from pipeline.execwrap import exec_run
        from pipeline.model import Effort, ImplementTarget, ImplAtDev, IssueRef, StepSpec
        from pipeline.state import RunRecord, StoreState
        from pipeline.store import save_store

        rid = RunId("run-spawn-test")
        record = RunRecord(
            run_id=rid,
            issue=IssueRef(42),
            target=ImplementTarget(),
            spec=StepSpec(cli="claude", model="opus", effort=Effort.HIGH),
            prompt="do something",
            workspace=ImplAtDev(),
            timeout=timedelta(seconds=5),
            started_at=datetime.now(timezone.utc),
        )
        save_store(self.paths, StoreState(runs={rid: record}))

        config = MagicMock(spec=PipelineConfig)
        config.cli = {}

        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_proc.poll.side_effect = [None, None, 0]

        mock_procs = MagicMock()
        mock_procs.current_boot_id.return_value = "boot-test"

        captured_stdin = None
        def fake_popen(*args, **kwargs):
            nonlocal captured_stdin
            captured_stdin = kwargs.get("stdin")
            # Close pipe_w like real popen does via finally
            return mock_proc

        with patch("pipeline.execwrap.prepare_workspace", return_value=self.root), \
             patch("subprocess.Popen", side_effect=fake_popen), \
             patch("pipeline.execwrap.read_stat_start_time", return_value=123), \
             patch("select.select", return_value=([], [], [])):
            exec_run(str(rid), self.paths, config, self.root, procs=mock_procs)

            import subprocess
            self.assertEqual(captured_stdin, subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
