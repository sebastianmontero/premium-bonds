"""GitHub CLI interaction wrapper with dry-run enforcement.

Distinguishes between read-only queries and mutating write operations,
raising an error on any write attempted in dry-run mode.
"""

from collections.abc import Sequence
import json
import logging
import subprocess
from typing import Any, Protocol

from .env import pipeline_env

logger = logging.getLogger(__name__)


class DryRunViolationError(Exception):
    """Raised when a mutating GitHub write is attempted in dry-run mode."""


class GhPort(Protocol):
    def read(self, args: Sequence[str]) -> str: ...
    def write(self, args: Sequence[str]) -> str: ...


class GhClient:
    def __init__(self, dry_run: bool = False, base_env: dict[str, str] | None = None) -> None:
        self.dry_run = dry_run
        self.base_env = base_env

    def read(self, args: Sequence[str]) -> str:
        cmd = ["gh", *args]
        env = pipeline_env(self.base_env)
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc.stdout

    def write(self, args: Sequence[str]) -> str:
        if self.dry_run:
            raise DryRunViolationError(f"Attempted GitHub write in dry-run mode: gh {' '.join(args)}")
        cmd = ["gh", *args]
        env = pipeline_env(self.base_env)
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc.stdout
