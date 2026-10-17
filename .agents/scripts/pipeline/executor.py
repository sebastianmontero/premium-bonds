"""Reconciler action execution and infrastructure orchestration.

Applies planned actions in priority order, enforces fail-closed error handling
with on_failure hooks, and dispatches agent runs with atomic store commits.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
import subprocess
from typing import Any, Protocol

from .actions import (
    Action,
    ClearPipelineBlock,
    CloseMergedIssue,
    DeleteStaleBranches,
    Dispatch,
    EditLabels,
    FinishRun,
    GhAction,
    KillRunGroup,
    MergePr,
    PostComment,
    ProcessAction,
    RecordAttempt,
    RecordPipelineBlock,
    RecordRun,
    RecordRunnerHandle,
    StoreAction,
    UpsertStatusComment,
)
from .config import PipelineConfig
from .env import pipeline_env
from .gh import DryRunViolationError, GhPort
from .model import (
    IssueRef,
    PrRef,
    RunId,
    build_prompt,
)
from .paths import PipelinePaths
from .procs import ProcessControl
from .runner import Runner
from .snapshot import HelperPort
from .stages import IssuePlan, TickPlan
from .state import RunRecord, StoreState, apply_store_action
from .store import load_store, save_store

logger = logging.getLogger(__name__)


class GitPort(Protocol):
    def run(self, args: Sequence[str]) -> str: ...


class LocalGitClient:
    def __init__(self, repo_root: str | Path, base_env: dict[str, str] | None = None) -> None:
        self.repo_root = Path(repo_root)
        self.base_env = base_env

    def run(self, args: Sequence[str]) -> str:
        cmd = ["git", *args]
        env = pipeline_env(self.base_env)
        proc = subprocess.run(
            cmd,
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
        return proc.stdout


class StorePort(Protocol):
    def get_state(self) -> StoreState: ...
    def apply_action(self, action: StoreAction) -> StoreState: ...


class LocalStoreClient:
    def __init__(self, paths: PipelinePaths) -> None:
        self.paths = paths
        self._state = load_store(paths)

    def get_state(self) -> StoreState:
        return self._state

    def apply_action(self, action: StoreAction) -> StoreState:
        self._state = apply_store_action(self._state, action)
        save_store(self.paths, self._state)
        return self._state


@dataclass(frozen=True)
class ExecDeps:
    gh: GhPort
    helpers: HelperPort
    store: StorePort
    runner: Runner
    git: GitPort
    procs: ProcessControl
    paths: PipelinePaths
    config: PipelineConfig


class Executor:
    """Executes planned actions against GitHub, git, and local runners."""

    def __init__(self, deps: ExecDeps, *, dry_run: bool = False) -> None:
        self.deps = deps
        self.dry_run = dry_run

    def apply(self, action: Action, now: datetime | None = None) -> None:
        now_utc = now or datetime.now(timezone.utc)

        if self.dry_run:
            # In dry-run mode, refuse every write by type
            if isinstance(action, (GhAction, StoreAction, ProcessAction, Dispatch)):
                raise DryRunViolationError(f"Attempted write in dry-run mode: {type(action).__name__}")
            return

        match action:
            # 1. Process Actions
            case KillRunGroup(run_id=rid, pgid=pgid):
                logger.info("Executing KillRunGroup for %s (pgid %s)", str(rid), pgid)
                self.deps.procs.terminate_group(pgid)

            # 2. Store Actions
            case RecordAttempt() | RecordPipelineBlock() | ClearPipelineBlock() | FinishRun() | RecordRun() | RecordRunnerHandle():
                self.deps.store.apply_action(action)

            # 3. Dispatch
            case Dispatch(issue=issue, target=target, spec=spec, workspace=ws):
                run_id_val = f"run-{now_utc.strftime('%Y%m%d%H%M%S')}-{issue.number}-{target.step.value}"
                rid = RunId(run_id_val)
                prompt = build_prompt(target, issue, spec, self.deps.config.max_revision_cycles)
                timeout = self.deps.config.timeout_for(target.step)

                record = RunRecord(
                    run_id=rid,
                    issue=issue,
                    target=target,
                    spec=spec,
                    prompt=prompt,
                    workspace=ws,
                    timeout=timeout,
                    started_at=now_utc,
                )

                # Step 1: Record run and commit to store BEFORE starting runner
                self.deps.store.apply_action(RecordRun(record))

                # Step 2: Start runner
                handle = self.deps.runner.start(record)

                # Step 3: Record runner handle
                self.deps.store.apply_action(RecordRunnerHandle(rid, handle))

            # 4. GitHub Actions
            case EditLabels(target=t, add=add, remove=remove, on_failure=_):
                target_type = "pr" if isinstance(t, PrRef) else "issue"
                args = [target_type, "edit", str(t.number)]
                for a in add:
                    args.extend(["--add-label", a])
                for r in remove:
                    args.extend(["--remove-label", r])
                self.deps.gh.write(args)

            case PostComment(target=t, body=b, on_failure=_):
                target_type = "pr" if isinstance(t, PrRef) else "issue"
                self.deps.gh.write([target_type, "comment", str(t.number), "--body", b])

            case UpsertStatusComment(issue=issue, comment=c, body=b, on_failure=_):
                if c is not None and c.node_id:
                    # Patch in place with issue_review_helper --patch-comment --strict
                    self.deps.helpers.run_review_helper([
                        "--patch-comment", c.node_id,
                        "--body", b,
                        "--strict",
                    ])
                else:
                    self.deps.gh.write(["issue", "comment", str(issue.number), "--body", b])

            case CloseMergedIssue(issue=issue, pr=pr, on_failure=_):
                self.deps.helpers.run_lifecycle_helper([
                    "--close-merged-issue",
                    "--issue", str(issue.number),
                    "--pr", str(pr.number),
                ])

            case MergePr(issue=_, pr=pr, on_failure=_):
                self.deps.helpers.run_lifecycle_helper([
                    "--merge-pr", str(pr.number),
                ])

            case DeleteStaleBranches(issue=issue, on_failure=_):
                pattern = f"refs/heads/feat/issue-{issue.number}-*"
                try:
                    ls_out = self.deps.git.run(["ls-remote", "--heads", "origin", pattern])
                except Exception as e:
                    logger.warning("Failed to ls-remote for issue #%s: %s", issue.number, e)
                    return

                for line in ls_out.strip().splitlines():
                    if not line:
                        continue
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    ref_name = parts[1]
                    branch_name = ref_name.removeprefix("refs/heads/")

                    # Re-check if branch is head of any open PR
                    pr_check = self.deps.gh.read([
                        "pr", "list",
                        "--head", branch_name,
                        "--state", "open",
                        "--json", "number",
                    ])
                    try:
                        open_prs = json.loads(pr_check)
                        if open_prs:
                            logger.info("Skipping deletion of branch %s; head of open PR #%s", branch_name, open_prs[0].get("number"))
                            continue
                    except Exception:
                        continue

                    # Safe to delete
                    logger.info("Deleting stale remote branch: %s", branch_name)
                    try:
                        self.deps.git.run(["push", "origin", "--delete", branch_name])
                    except Exception as e:
                        logger.warning("Failed to delete branch %s: %s", branch_name, e)

            case _:
                raise TypeError(f"Unknown action: {type(action)}")

    def execute_issue_plan(self, plan: IssuePlan, now: datetime | None = None) -> None:
        """Execute all actions for an issue plan according to ordering invariants."""
        # GhActions run first, StoreActions run last.
        # On GhAction failure, apply on_failure with truncated error detail and skip remaining,
        # except UpsertStatusComment which runs last and never skips.
        gh_actions = [a for a in plan.actions if isinstance(a, GhAction) and not isinstance(a, UpsertStatusComment)]
        status_action = next((a for a in plan.actions if isinstance(a, UpsertStatusComment)), None)
        other_actions = [a for a in plan.actions if not isinstance(a, GhAction)]

        failed = False
        for act in gh_actions:
            if failed:
                break
            try:
                self.apply(act, now=now)
            except Exception as e:
                failed = True
                err_detail = str(e)[:300]
                logger.error("GitHub action %s failed: %s", type(act).__name__, err_detail)
                if hasattr(act, "on_failure") and act.on_failure is not None:
                    on_fail = act.on_failure
                    if isinstance(on_fail, RecordAttempt):
                        on_fail = RecordAttempt(
                            issue=on_fail.issue,
                            fingerprint=on_fail.fingerprint,
                            detail=err_detail,
                        )
                    self.apply(on_fail, now=now)

        if not failed:
            for act in other_actions:
                self.apply(act, now=now)

        # UpsertStatusComment runs last and is never skipped
        if status_action is not None:
            try:
                self.apply(status_action, now=now)
            except Exception as e:
                logger.warning("UpsertStatusComment failed for #%s: %s", plan.issue.number, e)
