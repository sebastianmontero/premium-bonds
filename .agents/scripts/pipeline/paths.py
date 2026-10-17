"""State directory paths and file resolution for the reconciler.

This module is the single source of truth for filesystem paths under
the pipeline state directory.
"""

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Union

from .model import IssueRef, RunId


@dataclass(frozen=True)
class PipelinePaths:
    root: Path

    @classmethod
    def from_env(cls, root: Path | str | None = None) -> "PipelinePaths":
        if root is not None:
            return cls(root=Path(root).resolve())
        xdg = os.environ.get("XDG_STATE_HOME")
        if xdg and xdg.strip():
            base = Path(xdg) / "premium-bonds-pipeline"
        else:
            base = Path.home() / ".local" / "state" / "premium-bonds-pipeline"
        return cls(root=base.resolve())

    @property
    def state_json(self) -> Path:
        return self.root / "state.json"

    @property
    def tick_lock(self) -> Path:
        return self.root / "tick.lock"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def runs_dir(self) -> Path:
        return self.root / "runs"

    @property
    def worktrees_dir(self) -> Path:
        return self.root / "worktrees"

    @property
    def control(self) -> Path:
        return self.root / "worktrees" / "control"

    @property
    def impl(self) -> Path:
        return self.root / "worktrees" / "impl"

    def review(self, slot: int) -> Path:
        return self.root / "worktrees" / f"review-{slot}"

    def log(self, run_id: Union[str, RunId]) -> Path:
        rid = str(run_id)
        return self.root / "logs" / f"{rid}.log"

    def pid_file(self, run_id: Union[str, RunId]) -> Path:
        rid = str(run_id)
        return self.root / "runs" / f"{rid}.pid"

    def exit_file(self, run_id: Union[str, RunId]) -> Path:
        rid = str(run_id)
        return self.root / "runs" / f"{rid}.exit"

    def ensure_dirs(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.worktrees_dir.mkdir(parents=True, exist_ok=True)
