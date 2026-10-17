"""Unit tests for pipeline locking and contention handling."""

import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.lock import (
    EX_TEMPFAIL,
    acquire_tick_lock,
    handle_setup_lock_contention,
    handle_tick_lock_contention,
    verify_lock_fd,
    LockContentionError,
)
from pipeline.paths import PipelinePaths


class TestLock(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = PipelinePaths(root=Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_acquire_and_release_lock(self):
        lock = acquire_tick_lock(self.paths)
        self.assertGreaterEqual(lock.fd, 0)
        lock.release()

    def test_contention_raises_error(self):
        lock1 = acquire_tick_lock(self.paths)
        with self.assertRaises(LockContentionError):
            acquire_tick_lock(self.paths)
        lock1.release()

        # After release, can acquire again
        lock2 = acquire_tick_lock(self.paths)
        self.assertGreaterEqual(lock2.fd, 0)
        lock2.release()

    def test_tick_lock_contention_exits_zero_with_message(self):
        out = io.StringIO()
        with patch("sys.stdout", out), patch("sys.exit") as mock_exit:
            handle_tick_lock_contention()
            mock_exit.assert_called_once_with(0)
            self.assertIn("tick in progress", out.getvalue())

    def test_setup_lock_contention_exits_nonzero(self):
        err = io.StringIO()
        with patch("sys.stderr", err), patch("sys.exit") as mock_exit:
            handle_setup_lock_contention()
            mock_exit.assert_called_once_with(EX_TEMPFAIL)
            self.assertIn("error: tick in progress; retry setup once it finishes", err.getvalue())

    def test_lock_fd_re_exec_keeps_lock(self):
        lock1 = acquire_tick_lock(self.paths)
        verified = verify_lock_fd(lock1.fd)
        self.assertEqual(verified.fd, lock1.fd)
        lock1.release()


if __name__ == "__main__":
    unittest.main()
