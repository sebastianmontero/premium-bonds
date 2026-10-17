"""Process identity, /proc inspection, and group lifecycle management.

Handles PID identity serialization, Linux /proc/stat start_time checks,
boot_id verification to avoid PID wrap/reboot false positives, and safe
process group signaling (SIGTERM -> poll -> SIGKILL).
"""

from collections.abc import Callable
from dataclasses import asdict, dataclass
import json
import logging
import os
from pathlib import Path
import signal
import time

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    start_time: int
    boot_id: str
    monotonic_start: float
    pgid: int | None
    pgid_start_time: int | None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    @classmethod
    def from_json(cls, s: str) -> "ProcessIdentity | None":
        try:
            data = json.loads(s)
            if not isinstance(data, dict):
                return None
            return cls(
                pid=int(data["pid"]),
                start_time=int(data["start_time"]),
                boot_id=str(data["boot_id"]),
                monotonic_start=float(data["monotonic_start"]),
                pgid=int(data["pgid"]) if data.get("pgid") is not None else None,
                pgid_start_time=int(data["pgid_start_time"]) if data.get("pgid_start_time") is not None else None,
            )
        except Exception:
            return None


def read_stat_start_time(pid: int, proc_root: Path = Path("/proc")) -> int | None:
    """Read field 22 (start_time) from /proc/<pid>/stat.

    Field 22 is 1-indexed. The process comm (field 2) is enclosed in parentheses
    and may contain spaces and parentheses, so we parse after the last ')'.
    """
    stat_file = proc_root / str(pid) / "stat"
    try:
        content = stat_file.read_text(encoding="utf-8").strip()
    except Exception:
        return None

    rparen_idx = content.rfind(")")
    if rparen_idx == -1:
        return None

    # After ')', fields start with field 3 (state) at index 0.
    # Field 22 corresponds to index 22 - 3 = 19.
    remaining_fields = content[rparen_idx + 1 :].strip().split()
    if len(remaining_fields) <= 19:
        return None

    try:
        return int(remaining_fields[19])
    except ValueError:
        return None


def read_boot_id(proc_root: Path = Path("/proc")) -> str:
    """Read kernel boot_id from /proc/sys/kernel/random/boot_id."""
    boot_id_file = proc_root / "sys" / "kernel" / "random" / "boot_id"
    try:
        return boot_id_file.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


class ProcessControl:
    """Controls process checking and termination with injectable hooks for tests."""

    def __init__(
        self,
        proc_root: Path = Path("/proc"),
        killpg_fn: Callable[[int, int], None] = os.killpg,
        sleep_fn: Callable[[float], None] = time.sleep,
        monotonic_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.proc_root = proc_root
        self._killpg = killpg_fn
        self._sleep = sleep_fn
        self._monotonic = monotonic_fn

    def current_boot_id(self) -> str:
        return read_boot_id(self.proc_root)

    def current_monotonic(self) -> float:
        return self._monotonic()

    def is_pid_alive(self, pid: int, expected_start_time: int, expected_boot_id: str) -> bool:
        if not expected_boot_id or self.current_boot_id() != expected_boot_id:
            return False
        start_time = read_stat_start_time(pid, self.proc_root)
        return start_time is not None and start_time == expected_start_time

    def is_group_alive(
        self,
        pgid: int | None,
        pgid_start_time: int | None,
        boot_id: str,
    ) -> bool:
        """Check if process group pgid is alive per pipeline invariants.

        group_alive is true only if ALL of the following hold:
        - pgid is not None
        - os.killpg(pgid, 0) succeeds
        - boot_id matches current boot_id
        - either /proc/<pgid> is absent, or its stat start time equals pgid_start_time
        """
        if pgid is None or pgid <= 1:
            return False
        if not boot_id or self.current_boot_id() != boot_id:
            return False

        try:
            self._killpg(pgid, 0)
        except (ProcessLookupError, PermissionError):
            # ProcessLookupError: no process with this pgid exists
            # Note: if permission error occurs on signal 0, it still exists, but in our setup pgid shouldn't be foreign
            return False
        except OSError:
            return False

        # Check group leader proc entry
        leader_start_time = read_stat_start_time(pgid, self.proc_root)
        if leader_start_time is None:
            # /proc/<pgid> is absent, but killpg succeeded -> remaining group members exist
            return True
        return leader_start_time == pgid_start_time

    def terminate_group(
        self,
        pgid: int,
        grace: float = 30.0,
        *,
        grace_period_seconds: float | None = None,
        poll_interval_seconds: float = 0.25,
    ) -> None:
        """Terminate process group pgid cleanly with SIGTERM then SIGKILL.

        1. If pgid <= 1, logs warning and returns without sending signals.
        2. Otherwise sends SIGTERM.
        3. Polls killpg(pgid, 0) every poll_interval_seconds, returning as soon as group is gone.
        4. Sends SIGKILL if group is still alive after grace period.
        """
        if pgid <= 1:
            logger.warning("Attempted to terminate invalid or system process group %s; ignored.", pgid)
            return

        effective_grace = grace_period_seconds if grace_period_seconds is not None else grace

        try:
            self._killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except OSError as e:
            logger.warning("Failed to send SIGTERM to process group %s: %s", pgid, e)
            return

        start = self._monotonic()
        while self._monotonic() - start < effective_grace:
            self._sleep(poll_interval_seconds)
            try:
                self._killpg(pgid, 0)
            except ProcessLookupError:
                return
            except OSError:
                return

        # Escalate to SIGKILL
        try:
            self._killpg(pgid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
