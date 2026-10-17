"""File locking for tick and setup commands.

Uses non-blocking exclusive flock on tick.lock to guarantee single-instance
reconciler execution and handles inheritable lock descriptor re-execs.
"""

import fcntl
import os
import sys
from typing import IO

from .paths import PipelinePaths

EX_TEMPFAIL = 75


class LockContentionError(Exception):
    """Raised when tick.lock is already held by another process."""


class TickLock:
    def __init__(self, fd: int, file_obj: IO[bytes] | None = None) -> None:
        self.fd = fd
        self._file = file_obj

    def release(self) -> None:
        if self.fd != -1:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
            except OSError:
                pass
            if self._file is not None:
                try:
                    self._file.close()
                except OSError:
                    pass
            self.fd = -1


def acquire_tick_lock(paths: PipelinePaths) -> TickLock:
    """Acquire exclusive non-blocking lock on tick.lock.

    Raises LockContentionError if the lock is currently held.
    """
    paths.ensure_dirs()
    lock_path = paths.tick_lock
    # Open for read/write without truncating
    f = open(lock_path, "a+b")
    try:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Ensure fd is inheritable across re-exec
        os.set_inheritable(f.fileno(), True)
        return TickLock(f.fileno(), f)
    except (BlockingIOError, OSError) as e:
        f.close()
        raise LockContentionError("tick.lock is held by another process") from e


def verify_lock_fd(fd: int) -> TickLock:
    """Verify that fd is a valid open file descriptor holding an flock."""
    try:
        # Check stat
        os.fstat(fd)
        # Verify flock is valid on this open file description
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.set_inheritable(fd, True)
        return TickLock(fd)
    except OSError as e:
        raise ValueError(f"Invalid or unlocked lock file descriptor {fd}: {e}") from e


def handle_tick_lock_contention() -> None:
    """Exit 0 printing 'tick in progress' on stdout."""
    print("tick in progress")
    sys.exit(0)


def handle_setup_lock_contention() -> None:
    """Exit 75 printing error message to stderr."""
    sys.stderr.write("error: tick in progress; retry setup once it finishes\n")
    sys.exit(EX_TEMPFAIL)
