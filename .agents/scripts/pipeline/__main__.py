"""Pipeline CLI entry point.

Commands:
  setup [--install-timer] [--reset-store]
  tick [--dry-run] [--issue <n>] [--lock-fd <fd>]
  status [--json]
  exec <run-id>
  logs <issue|run-id> [-f]
"""

import argparse
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from .config import PipelineConfig, load_config
from .env import pipeline_env
from .executor import ExecDeps, LocalGitClient, LocalStoreClient
from .execwrap import exec_run
from .gh import GhClient
from .lock import (
    acquire_tick_lock,
    handle_setup_lock_contention,
    handle_tick_lock_contention,
    verify_lock_fd,
    LockContentionError,
)
from .paths import PipelinePaths
from .procs import ProcessControl, read_boot_id, read_stat_start_time
from .probe import probe
from .reconciler import TickDeps, tick
from .runner import AutoRunner
from .snapshot import LocalHelperClient
from .state import Liveness, RunId, StoreState
from .status_cli import format_status
from .store import load_store, save_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pipeline")


def find_repo_root() -> Path:
    """Resolve repository root from current file path or git rev-parse."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(res.stdout.strip())
    except Exception:
        return Path(__file__).resolve().parents[4]


def load_pipeline_config(repo_root: Path) -> PipelineConfig:
    config_path = repo_root / ".agents" / "pipeline.toml"
    if not config_path.exists():
        raise FileNotFoundError(f"Configuration file {config_path} not found")
    return load_config(config_path.read_text(encoding="utf-8"))


# --- Setup & Preflight ---


def run_preflight(install_timer: bool, repo_root: Path, config: PipelineConfig) -> None:
    # 1. gh auth status
    gh_res = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    if gh_res.returncode != 0:
        sys.stderr.write(f"Preflight error: gh auth status failed:\n{gh_res.stderr}\n")
        sys.exit(1)

    # 2. claude --help flags
    claude_help = subprocess.run(["claude", "--help"], capture_output=True, text=True)
    if claude_help.returncode != 0:
        sys.stderr.write("Preflight error: claude CLI not found or failed\n")
        sys.exit(1)
    for flag in ("--effort", "--output-format", "--permission-mode"):
        if flag not in claude_help.stdout:
            sys.stderr.write(f"Preflight error: claude CLI does not support {flag}\n")
            sys.exit(1)
    if "auto" not in claude_help.stdout:
        sys.stderr.write("Preflight error: claude CLI does not support permission mode 'auto'\n")
        sys.exit(1)

    # 3. agy --help and models
    agy_help = subprocess.run(["agy", "--help"], capture_output=True, text=True)
    if agy_help.returncode != 0:
        sys.stderr.write("Preflight error: agy CLI not found or failed\n")
        sys.exit(1)
    for flag in ("-p", "--mode", "--output-format"):
        if flag not in agy_help.stdout:
            sys.stderr.write(f"Preflight error: agy CLI does not support {flag}\n")
            sys.exit(1)

    # Verify configured agy models
    agy_models_res = subprocess.run(["agy", "models"], capture_output=True, text=True)
    agy_models_out = agy_models_res.stdout
    required_slugs = set()
    for spec in (*config.reviews, config.integrator, config.implement, config.verify, config.revise):
        if spec.cli == "agy":
            required_slugs.add(spec.provenance_slug)

    for slug in required_slugs:
        if slug not in agy_models_out and not any(slug.startswith(line.strip()) for line in agy_models_out.splitlines()):
            logger.warning("Configured agy model slug '%s' not explicitly listed in `agy models`", slug)

    # 4. systemd-run if timer requested
    if install_timer:
        sysd_res = subprocess.run(["systemd-run", "--user", "--version"], capture_output=True, text=True)
        if sysd_res.returncode != 0:
            sys.stderr.write("Preflight error: systemd-run --user not available for --install-timer\n")
            sys.exit(1)

    # 5. .claude/settings.json check
    settings_path = repo_root / ".claude" / "settings.json"
    if not settings_path.exists():
        sys.stderr.write(f"Preflight error: {settings_path} missing\n")
        sys.exit(1)


def cmd_setup(args: argparse.Namespace, paths: PipelinePaths, repo_root: Path) -> None:
    # 1. Take lock; exit 75 on contention
    try:
        lock = acquire_tick_lock(paths)
    except LockContentionError:
        handle_setup_lock_contention()

    try:
        config = load_pipeline_config(repo_root)

        # Handle --reset-store
        if args.reset_store:
            procs = ProcessControl()
            active = probe(load_store(paths).runs, paths, procs)
            if any(ar.liveness is Liveness.ALIVE for ar in active.values()):
                sys.stderr.write("Error: Cannot reset store while an agent run is active.\n")
                sys.exit(1)
            save_store(paths, StoreState())
            print("Store state reset to empty version 1.")

        print("Running preflight checks...")
        run_preflight(args.install_timer, repo_root, config)
        print("Preflight checks passed.")

        # Create labels idempotently
        labels = [
            ("agent:auto", "0e8a16", "Eligible for autonomous pipeline execution"),
            ("agent:skip-review", "fbca04", "Skip further automated review rounds"),
            ("in-progress", "ededed", "Work currently in progress"),
            ("ready-for-human", "d93f0b", "Requires human maintainer intervention"),
            ("needs-triage", "d4c5f9", "Requires issue specification triage"),
            ("verified", "0e8a16", "PR successfully verified by pr-verify"),
        ]
        for name, color, desc in labels:
            subprocess.run(
                ["gh", "label", "create", name, "--color", color, "--description", desc, "--force"],
                capture_output=True,
                text=True,
                env=pipeline_env(),
            )

        # Create worktrees
        paths.ensure_dirs()
        worktrees_to_create = [
            (paths.control, "origin/dev"),
            (paths.impl, "origin/dev"),
        ]
        for slot in range(config.concurrency.review):
            worktrees_to_create.append((paths.review(slot), "origin/dev"))

        for path, branch in worktrees_to_create:
            if not path.exists():
                print(f"Creating worktree at {path}...")
                subprocess.run(
                    ["git", "worktree", "add", "--detach", str(path), branch],
                    cwd=repo_root,
                    env=pipeline_env(),
                    check=True,
                )

        if args.install_timer:
            print("Installing and enabling systemd units...")
            systemd_user_dir = Path.home() / ".config" / "systemd" / "user"
            systemd_user_dir.mkdir(parents=True, exist_ok=True)

            service_tmpl = (repo_root / ".agents" / "systemd" / "premium-bonds-pipeline.service").read_text(encoding="utf-8")
            timer_tmpl = (repo_root / ".agents" / "systemd" / "premium-bonds-pipeline.timer").read_text(encoding="utf-8")

            control_str = str(paths.control)
            path_env = os.environ.get("PATH", "")
            service_rendered = service_tmpl.replace("{CONTROL_PATH}", control_str).replace("{PATH}", path_env)

            (systemd_user_dir / "premium-bonds-pipeline.service").write_text(service_rendered, encoding="utf-8")
            (systemd_user_dir / "premium-bonds-pipeline.timer").write_text(timer_tmpl, encoding="utf-8")

            subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
            subprocess.run(["systemctl", "--user", "enable", "--now", "premium-bonds-pipeline.timer"], check=True)
            print("systemd timer installed and enabled.")

        print("Setup completed successfully.")
    finally:
        lock.release()


# --- Tick Command ---


def cmd_tick(args: argparse.Namespace, paths: PipelinePaths, repo_root: Path) -> None:
    # Acquire or verify lock
    if args.lock_fd is not None:
        lock = verify_lock_fd(args.lock_fd)
    else:
        try:
            lock = acquire_tick_lock(paths)
        except LockContentionError:
            handle_tick_lock_contention()

    try:
        # Control worktree bootstrap: fetch and re-exec if HEAD changed
        control_path = paths.control
        if control_path.exists() and (repo_root.resolve() == control_path.resolve()):
            # Running inside control worktree: fetch latest origin/dev
            try:
                old_head = subprocess.run(
                    ["git", "-C", str(control_path), "rev-parse", "HEAD"],
                    capture_output=True,
                    text=True,
                    check=True,
                    env=pipeline_env(),
                ).stdout.strip()

                subprocess.run(
                    ["git", "-C", str(control_path), "fetch", "-q", "origin", "dev"],
                    capture_output=True,
                    text=True,
                    check=True,
                    env=pipeline_env(),
                )
                subprocess.run(
                    ["git", "-C", str(control_path), "checkout", "-q", "--detach", "--force", "origin/dev"],
                    capture_output=True,
                    text=True,
                    check=True,
                    env=pipeline_env(),
                )

                new_head = subprocess.run(
                    ["git", "-C", str(control_path), "rev-parse", "HEAD"],
                    capture_output=True,
                    text=True,
                    check=True,
                    env=pipeline_env(),
                ).stdout.strip()

                if old_head != new_head and args.lock_fd is None:
                    # Re-exec with inherited lock fd
                    logger.info("Control worktree updated (%s -> %s); re-executing...", old_head[:8], new_head[:8])
                    cmd = [sys.executable, *sys.argv, "--lock-fd", str(lock.fd)]
                    os.execv(sys.executable, cmd)
            except Exception as e:
                logger.warning("Control bootstrap check failed: %s", e)

        config = load_pipeline_config(repo_root)

        gh = GhClient(dry_run=args.dry_run)
        helpers = LocalHelperClient(repo_root)
        store = LocalStoreClient(paths)
        runner = AutoRunner(paths)
        git = LocalGitClient(repo_root)
        procs = ProcessControl()

        exec_deps = ExecDeps(
            gh=gh,
            helpers=helpers,
            store=store,
            runner=runner,
            git=git,
            procs=procs,
            paths=paths,
            config=config,
        )
        tick_deps = TickDeps(exec=exec_deps)

        report = tick(
            deps=tick_deps,
            config=config,
            paths=paths,
            dry_run=args.dry_run,
            only_issue=args.issue,
        )

        if args.dry_run:
            print(f"=== Dry-run completed: {len(report.plan.issues)} issue(s) planned ===")
            for ip in report.plan.issues:
                print(f"\n--- Issue #{ip.issue.number} Actions ({len(ip.actions)}) ---")
                for act in ip.actions:
                    print(f"  {type(act).__name__}: {act}")
    finally:
        lock.release()


# --- Logs Command ---


def cmd_logs(args: argparse.Namespace, paths: PipelinePaths) -> None:
    target = args.target
    store = load_store(paths)

    log_file = None
    if target.startswith("run-"):
        log_file = paths.log(target)
    else:
        # Issue number target: find latest finished or active run
        num = int(target.lstrip("#"))
        runs_for_issue = []
        for rid, r in store.runs.items():
            if r.issue.number == num:
                runs_for_issue.append((r.started_at, rid))
        for rid, fr in store.finished.items():
            if fr.record.issue.number == num:
                runs_for_issue.append((fr.record.started_at, rid))

        if not runs_for_issue:
            sys.stderr.write(f"No runs found for issue #{num}\n")
            sys.exit(1)

        runs_for_issue.sort(key=lambda x: x[0])
        latest_rid = runs_for_issue[-1][1]
        log_file = paths.log(latest_rid)

    if not log_file.exists():
        sys.stderr.write(f"Log file {log_file} does not exist\n")
        sys.exit(1)

    if args.follow:
        subprocess.run(["tail", "-f", str(log_file)])
    else:
        sys.stdout.write(log_file.read_text(encoding="utf-8", errors="replace"))


# --- Main Dispatcher ---


def main() -> None:
    parser = argparse.ArgumentParser(description="Premium Bonds Pipeline Reconciler")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # setup
    p_setup = subparsers.add_parser("setup", help="Initialize pipeline worktrees, labels, and timer")
    p_setup.add_argument("--install-timer", action="store_true", help="Install and enable systemd user timer")
    p_setup.add_argument("--reset-store", action="store_true", help="Reset store state to empty version 1")

    # tick
    p_tick = subparsers.add_parser("tick", help="Run one reconcile cycle")
    p_tick.add_argument("--dry-run", action="store_true", help="Plan actions without mutating store or GitHub")
    p_tick.add_argument("--issue", type=int, help="Limit execution to a single issue number")
    p_tick.add_argument("--lock-fd", type=int, help=argparse.SUPPRESS)

    # status
    p_status = subparsers.add_parser("status", help="Show pipeline status table")
    p_status.add_argument("--json", action="store_true", help="Output status as JSON")

    # exec
    p_exec = subparsers.add_parser("exec", help="Execute single run wrapper (internal)")
    p_exec.add_argument("run_id", help="RunId to execute")

    # logs
    p_logs = subparsers.add_parser("logs", help="View or follow run logs")
    p_logs.add_argument("target", help="Issue number (#42 or 42) or RunId")
    p_logs.add_argument("-f", "--follow", action="store_true", help="Follow log output")

    args = parser.parse_args()

    repo_root = find_repo_root()
    paths = PipelinePaths.from_env()

    if args.subcommand == "setup":
        cmd_setup(args, paths, repo_root)
    elif args.subcommand == "tick":
        cmd_tick(args, paths, repo_root)
    elif args.subcommand == "status":
        format_status(paths, json_output=args.json)
    elif args.subcommand == "exec":
        config = load_pipeline_config(repo_root)
        code = exec_run(args.run_id, paths, config, repo_root)
        sys.exit(code)
    elif args.subcommand == "logs":
        cmd_logs(args, paths)


if __name__ == "__main__":
    main()
