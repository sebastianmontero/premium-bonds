"""Worktree management, preparation, and ref-lock retry resilience.

Manages the control worktree, implementation lane, and review pool worktrees.
Guarantees clean workspace states, cached npm dependency verification, and
automatic backoff retries when encountering git ref/index lock contention.
"""

from collections.abc import Callable, Mapping, Sequence
import hashlib
import logging
import os
from pathlib import Path
import re
import subprocess
import time

from .env import pipeline_env
from .model import ImplAtDev, ImplAtPrHead, ReviewSlot, Workspace
from .paths import PipelinePaths

logger = logging.getLogger(__name__)

LOCK_ERROR_REGEX = re.compile(r"cannot lock ref|Unable to create '.*\.lock': File exists")


def run_git_with_lock_retry(
    cmd: Sequence[str],
    *,
    cwd: Path | str | None = None,
    env: Mapping[str, str] | None = None,
    timeout: float | None = None,
    max_attempts: int = 3,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> subprocess.CompletedProcess[str]:
    """Run git command, retrying up to max_attempts on ref or index lock contention."""
    attempt = 0
    backoffs = [1.0, 2.0, 4.0]

    while attempt < max_attempts:
        attempt += 1
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            timeout=timeout,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            return proc

        # Check if error is due to lock contention
        if LOCK_ERROR_REGEX.search(proc.stderr):
            if attempt < max_attempts:
                delay = backoffs[attempt - 1] if attempt - 1 < len(backoffs) else 2.0
                logger.warning(
                    "Git lock contention during '%s'; retrying in %ss (attempt %s/%s)...",
                    " ".join(cmd),
                    delay,
                    attempt,
                    max_attempts,
                )
                sleep_fn(delay)
                continue

        # Non-lock failure or exhausted retries
        return proc

    return proc


def remove_stale_index_lock(worktree_path: Path, env: Mapping[str, str]) -> None:
    """Remove a stale index.lock from the worktree's git dir, if any.

    In a linked worktree `.git` is a gitlink file, so the index lives in the admin
    dir that `rev-parse --absolute-git-dir` resolves (`<common>/worktrees/<name>`).
    """
    res = subprocess.run(
        ["git", "-C", str(worktree_path), "rev-parse", "--absolute-git-dir"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    git_dir = res.stdout.strip()
    if res.returncode != 0 or not git_dir:
        return
    lock = Path(git_dir) / "index.lock"
    if lock.exists():
        logger.warning("Removing stale %s", lock)
        try:
            lock.unlink()
        except OSError:
            pass


def create_pipeline_worktrees(
    paths: PipelinePaths,
    repo_root: Path,
    review_slots: int,
    env: Mapping[str, str] | None = None,
) -> list[Path]:
    """Create the bounded set of pipeline worktrees at origin/dev; returns those created.

    The pool is fixed (control, impl, review-<slot> for slot in [0, review_slots)),
    so `.git/worktrees` never grows per issue. Existing worktrees are left untouched.
    """
    paths.ensure_dirs()
    targets = [paths.control, paths.impl, *(paths.review(slot) for slot in range(review_slots))]
    created: list[Path] = []
    for path in targets:
        if path.exists():
            continue
        logger.info("Creating worktree at %s...", path)
        subprocess.run(
            ["git", "worktree", "add", "--detach", str(path), "origin/dev"],
            cwd=repo_root,
            env=pipeline_env(env),
            capture_output=True,
            text=True,
            check=True,
        )
        created.append(path)
    return created


def check_and_run_npm_ci(worktree_path: Path, env: Mapping[str, str], timeout: float) -> None:
    """Run npm ci if package-lock.json sha256 differs from cached stamp."""
    lock_file = worktree_path / "package-lock.json"
    if not lock_file.exists():
        return

    current_hash = hashlib.sha256(lock_file.read_bytes()).hexdigest()
    stamp_file = worktree_path / "node_modules" / ".pipeline-lock.sha256"

    if stamp_file.exists():
        try:
            cached_hash = stamp_file.read_text(encoding="utf-8").strip()
            if cached_hash == current_hash:
                return
        except Exception:
            pass

    # Run npm ci
    logger.info("Running npm ci in %s...", worktree_path)
    res = subprocess.run(
        ["npm", "ci"],
        cwd=worktree_path,
        env=env,
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        raise RuntimeError(f"npm ci failed (exit {res.returncode}): {res.stderr}")

    # Write cache stamp
    stamp_file.parent.mkdir(parents=True, exist_ok=True)
    stamp_file.write_text(current_hash, encoding="utf-8")


def resolve_workspace_path(workspace: Workspace, paths: PipelinePaths) -> Path:
    match workspace:
        case ReviewSlot(n=s):
            return paths.review(s)
        case ImplAtDev() | ImplAtPrHead():
            return paths.impl
        case _:
            raise TypeError(f"Unknown workspace: {type(workspace)}")


def prepare_workspace(
    workspace: Workspace,
    paths: PipelinePaths,
    env: Mapping[str, str] | None = None,
    timeout: float = 300.0,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> Path:
    """Prepare worktree for agent run according to workspace specification."""
    worktree_path = resolve_workspace_path(workspace, paths)
    worktree_env = pipeline_env(env)

    # 1. Clear any stale index locks
    remove_stale_index_lock(worktree_path, worktree_env)

    match workspace:
        case ReviewSlot():
            # ReviewSlot runs NO fetch origin dev; ref was refreshed by control-worktree fetch
            res = subprocess.run(
                ["git", "-C", str(worktree_path), "checkout", "--detach", "--force", "origin/dev"],
                env=worktree_env,
                timeout=timeout,
                capture_output=True,
                text=True,
                check=False,
            )
            if res.returncode != 0:
                raise RuntimeError(f"Review slot checkout failed: {res.stderr}")

            clean_res = subprocess.run(
                ["git", "-C", str(worktree_path), "clean", "-fd"],
                env=worktree_env,
                timeout=timeout,
                capture_output=True,
                text=True,
                check=False,
            )
            if clean_res.returncode != 0:
                raise RuntimeError(f"Review slot clean failed: {clean_res.stderr}")

        case ImplAtDev():
            # Checkout origin/dev without fetch
            res = subprocess.run(
                ["git", "-C", str(worktree_path), "checkout", "--detach", "--force", "origin/dev"],
                env=worktree_env,
                timeout=timeout,
                capture_output=True,
                text=True,
                check=False,
            )
            if res.returncode != 0:
                raise RuntimeError(f"Impl checkout failed: {res.stderr}")

            clean_res = subprocess.run(
                ["git", "-C", str(worktree_path), "clean", "-fd"],
                env=worktree_env,
                timeout=timeout,
                capture_output=True,
                text=True,
                check=False,
            )
            if clean_res.returncode != 0:
                raise RuntimeError(f"Impl clean failed: {clean_res.stderr}")

            check_and_run_npm_ci(worktree_path, worktree_env, timeout)

        case ImplAtPrHead(head_ref=hr):
            # Fetch remote branch with retry
            fetch_res = run_git_with_lock_retry(
                ["git", "-C", str(worktree_path), "fetch", "origin", hr],
                env=worktree_env,
                timeout=timeout,
                sleep_fn=sleep_fn,
            )
            if fetch_res.returncode != 0:
                raise RuntimeError(f"Impl fetch {hr} failed: {fetch_res.stderr}")

            checkout_res = run_git_with_lock_retry(
                [
                    "git", "-C", str(worktree_path),
                    "checkout", "--ignore-other-worktrees", "--force", "-B", hr, f"origin/{hr}"
                ],
                env=worktree_env,
                timeout=timeout,
                sleep_fn=sleep_fn,
            )
            if checkout_res.returncode != 0:
                raise RuntimeError(f"Impl checkout {hr} failed: {checkout_res.stderr}")

            clean_res = subprocess.run(
                ["git", "-C", str(worktree_path), "clean", "-fd"],
                env=worktree_env,
                timeout=timeout,
                capture_output=True,
                text=True,
                check=False,
            )
            if clean_res.returncode != 0:
                raise RuntimeError(f"Impl clean failed: {clean_res.stderr}")

            check_and_run_npm_ci(worktree_path, worktree_env, timeout)

    return worktree_path
