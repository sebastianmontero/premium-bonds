"""Unit tests for pipeline exec wrapper, StreamLogTee, and process supervisor."""

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

    def test_log_file_mode_is_0600(self):
        log_path = self.paths.log("run-mode-test")
        log_fd = os.open(log_path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        os.close(log_fd)

        mode = stat.S_IMODE(log_path.stat().st_mode)
        self.assertEqual(mode, 0o600)


if __name__ == "__main__":
    unittest.main()
