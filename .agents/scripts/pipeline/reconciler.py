"""Reconciler top-level orchestration: probe -> snapshot -> reap -> plan -> execute.

Pure functional core orchestration with side-effecting executor and snapshot ports.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import logging

from .actions import Action, StoreAction
from .config import PipelineConfig
from .executor import ExecDeps, Executor
from .model import FailedSnapshot, IssueSnapshot, Liveness, RunId
from .paths import PipelinePaths
from .probe import probe
from .snapshot import Snapshotter
from .stages import TickPlan, plan_tick, reap
from .state import ActiveRun, apply_store_action, build_views, overlay_labels

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TickDeps:
    exec: ExecDeps
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)


@dataclass(frozen=True)
class TickReport:
    active_runs: Mapping[RunId, ActiveRun]
    snapshots: tuple[IssueSnapshot | FailedSnapshot, ...]
    reaped_actions: tuple[Action, ...]
    plan: TickPlan
    dry_run: bool


def tick(
    deps: TickDeps,
    config: PipelineConfig,
    paths: PipelinePaths,
    *,
    dry_run: bool = False,
    only_issue: int | None = None,
) -> TickReport:
    """Run one reconcile cycle."""
    now = deps.clock()

    # 1. Probe known records and detect stray runs
    store = deps.exec.store.get_state()
    active_runs = probe(store.runs, paths, deps.exec.procs, now_wall=now)

    # 2. Snapshot eligible issues
    abandoned_prs_by_issue = {
        issue: local.abandoned_prs for issue, local in store.issues.items()
    }
    snapshotter = Snapshotter(deps.exec.gh, deps.exec.helpers)
    snapshots = snapshotter.snapshot(config, abandoned_prs_by_issue)

    # 3. Reap, reduce, plan
    initial_views = build_views(snapshots, store, active_runs)
    reaped_actions = reap(active_runs, initial_views, config)

    # Fold reaped store actions into store in memory for view rebuilding
    folded_store = store
    for act in reaped_actions:
        if isinstance(act, StoreAction):
            folded_store = apply_store_action(folded_store, act)

    views = build_views(snapshots, folded_store, active_runs)
    views = overlay_labels(views, reaped_actions)

    live_runs = [
        ar.record for ar in active_runs.values() if ar.liveness is Liveness.ALIVE
    ]

    full_plan = plan_tick(views, live_runs, config, now)

    # Apply only_issue filter if requested
    if only_issue is not None:
        plan = tuple(ip for ip in full_plan if ip.issue.number == only_issue)
    else:
        plan = full_plan

    # 4. Execute
    if dry_run:
        logger.info("Dry-run tick completed. Planned %s issue(s).", len(plan))
        for ip in plan:
            logger.info("Issue #%s plan: %s action(s)", ip.issue.number, len(ip.actions))
    else:
        executor = Executor(deps.exec, dry_run=False)

        # Execute reaped actions first (KillRunGroup, FinishRun, etc.)
        for act in reaped_actions:
            try:
                executor.apply(act, now=now)
            except Exception as e:
                err_detail = str(e)[:300]
                logger.error("Reaped action %s failed: %s", type(act).__name__, err_detail)
                if hasattr(act, "on_failure") and getattr(act, "on_failure", None) is not None:
                    on_fail = act.on_failure
                    from .actions import RecordAttempt
                    if isinstance(on_fail, RecordAttempt):
                        on_fail = RecordAttempt(
                            issue=on_fail.issue,
                            fingerprint=on_fail.fingerprint,
                            detail=err_detail,
                        )
                    try:
                        executor.apply(on_fail, now=now)
                    except Exception as inner_e:
                        logger.error("Reaped on_failure action failed: %s", inner_e)

        # Execute issue plans in priority order
        for issue_plan in plan:
            executor.execute_issue_plan(issue_plan, now=now)

        # Cleanup stale finished runs
        deps.exec.runner.cleanup_stale_runs(deps.exec.store.get_state().finished, now)

    return TickReport(
        active_runs=active_runs,
        snapshots=snapshots,
        reaped_actions=reaped_actions,
        plan=plan,
        dry_run=dry_run,
    )
