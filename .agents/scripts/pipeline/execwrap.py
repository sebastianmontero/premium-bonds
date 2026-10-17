"""Pipeline exec wrapper: workspace prep, agent execution, streaming, and supervisor.

Handles runs/<id>.pid writing, log file creation with mode 0600, StreamLogTee
with best-effort stdout rendering and resilient EPIPE handling, monotonic timeout
enforcement, and process-group termination.
"""

from collections.abc import Mapping
import errno
import json
import logging
import os
from pathlib import Path
import select
import sys
import time

from .config import PipelineConfig
from .env import pipeline_env
from .paths import PipelinePaths
from .procs import ProcessControl, ProcessIdentity, read_boot_id, read_stat_start_time
from .state import RunId, RunRecord
from .store import load_store
from .worktrees import prepare_workspace, resolve_workspace_path

logger = logging.getLogger(__name__)

EXIT_PREP_FAILED = 97


class StreamLogTee:
    """Tees subprocess output to log file (raw) and stdout (compact rendering).

    Swallows stdout errors (EPIPE/EIO) permanently so that closing a terminal tab
    never interrupts the agent execution or log file persistence.
    """

    def __init__(self, log_fd: int) -> None:
        self.log_fd = log_fd
        self._stdout_disabled = False

    def write_chunk(self, data: bytes) -> None:
        # 1. Raw bytes to log file
        try:
            os.write(self.log_fd, data)
        except OSError as e:
            logger.warning("Failed to write to log file: %s", e)

        # 2. Rendered output to stdout
        if self._stdout_disabled:
            return

        try:
            text = data.decode("utf-8", errors="replace")
            for line in text.splitlines(keepends=True):
                rendered = self._format_line(line)
                if rendered:
                    sys.stdout.write(rendered)
            sys.stdout.flush()
        except OSError as e:
            if e.errno in (errno.EPIPE, errno.EIO):
                self._stdout_disabled = True
            else:
                self._stdout_disabled = True
        except Exception:
            self._stdout_disabled = True

    def _format_line(self, raw_line: str) -> str:
        line = raw_line.strip()
        if not line:
            return ""

        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                return (line[:200] + "...\n") if len(line) > 200 else (line + "\n")

            # Extract assistant text delta or tool use
            # Claude stream-json format
            msg_type = payload.get("type")
            if msg_type == "content_block_delta":
                delta = payload.get("delta", {})
                if delta.get("type") == "text_delta":
                    return str(delta.get("text", ""))
            elif msg_type == "tool_use":
                name = payload.get("name", "unknown")
                return f"\n[tool: {name}]\n"

            # agy stream-json format
            if "tool" in payload:
                return f"\n[tool: {payload.get('tool')}]\n"
            if payload.get("role") == "assistant":
                content = payload.get("content", "")
                if isinstance(content, str):
                    return (content[:200] + "...\n") if len(content) > 200 else (content + "\n")

            return (line[:200] + "...\n") if len(line) > 200 else (line + "\n")
        except Exception:
            return (line[:200] + "...\n") if len(line) > 200 else (line + "\n")


def write_pid_file(paths: PipelinePaths, rid: RunId, identity: ProcessIdentity) -> None:
    """Atomically write ProcessIdentity to runs/<id>.pid."""
    paths.runs_dir.mkdir(parents=True, exist_ok=True)
    target = paths.pid_file(rid)
    tmp_path = paths.runs_dir / f".tmp-{str(rid)}.pid"
    tmp_path.write_text(identity.to_json(), encoding="utf-8")
    os.replace(tmp_path, target)


def write_exit_file(paths: PipelinePaths, rid: RunId, exit_code: int) -> None:
    """Write exit code to runs/<id>.exit."""
    paths.runs_dir.mkdir(parents=True, exist_ok=True)
    target = paths.exit_file(rid)
    target.write_text(f"{exit_code}\n", encoding="utf-8")


def exec_run(
    run_id_str: str,
    paths: PipelinePaths,
    config: PipelineConfig,
    repo_root: Path,
    procs: ProcessControl | None = None,
) -> int:
    """Execute run wrapper for run_id."""
    rid = RunId(run_id_str)
    procs = procs or ProcessControl()
    store = load_store(paths)

    record = store.runs.get(rid)
    if record is None:
        sys.stderr.write(f"Error: RunRecord {run_id_str} not found in store\n")
        return 1

    monotonic_start = time.monotonic()
    deadline = monotonic_start + record.timeout.total_seconds()

    # 1. Write initial PID file with pgid=None before any prep work
    pid = os.getpid()
    boot_id = procs.current_boot_id() or read_boot_id()
    start_time = read_stat_start_time(pid) or 0

    init_identity = ProcessIdentity(
        pid=pid,
        start_time=start_time,
        boot_id=boot_id,
        monotonic_start=monotonic_start,
        pgid=None,
        pgid_start_time=None,
    )
    write_pid_file(paths, rid, init_identity)

    # 2. Open log file with mode 0600
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = paths.log(rid)
    log_fd = os.open(log_path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
    tee = StreamLogTee(log_fd)

    # 3. Workspace prep
    remaining_prep_time = max(10.0, deadline - time.monotonic())
    try:
        prep_msg = f"=== Preparing workspace for issue #{record.issue.number} ({record.target.step.value}) ===\n"
        tee.write_chunk(prep_msg.encode("utf-8"))

        workspace_path = prepare_workspace(
            workspace=record.workspace,
            paths=paths,
            repo_root=repo_root,
            env=os.environ,
            timeout=remaining_prep_time,
        )
    except Exception as e:
        err_msg = f"Workspace prep failed: {e}\n"
        tee.write_chunk(err_msg.encode("utf-8"))
        os.close(log_fd)
        write_exit_file(paths, rid, EXIT_PREP_FAILED)
        return EXIT_PREP_FAILED

    # Check deadline after prep
    if time.monotonic() >= deadline:
        err_msg = "Deadline exceeded during workspace prep\n"
        tee.write_chunk(err_msg.encode("utf-8"))
        os.close(log_fd)
        write_exit_file(paths, rid, EXIT_PREP_FAILED)
        return EXIT_PREP_FAILED

    # 4. Build argv and environment
    extra_args: list[str] = []
    if record.spec.cli in config.cli:
        extra_args.extend(config.cli[record.spec.cli].extra_args)

    argv = record.spec.build_argv(record.prompt, extra_args)

    run_env = pipeline_env(
        extra={
            "PIPELINE_RUN_ID": str(rid),
        }
    )

    # 5. Spawn agent in new process group
    import subprocess
    pipe_r, pipe_w = os.pipe()

    try:
        agent_proc = subprocess.Popen(
            argv,
            cwd=workspace_path,
            env=run_env,
            stdin=subprocess.DEVNULL,
            stdout=pipe_w,
            stderr=subprocess.STDOUT,
            process_group=0,  # Create new process group with pgid = agent_proc.pid
        )
    finally:
        os.close(pipe_w)

    agent_pid = agent_proc.pid
    agent_pgid = agent_pid
    agent_pgid_start = read_stat_start_time(agent_pgid)

    # Rewrite PID file with agent pgid
    agent_identity = ProcessIdentity(
        pid=pid,
        start_time=start_time,
        boot_id=boot_id,
        monotonic_start=monotonic_start,
        pgid=agent_pgid,
        pgid_start_time=agent_pgid_start,
    )
    write_pid_file(paths, rid, agent_identity)

    # 6. Stream and supervisor loop
    exit_code = 0
    timed_out = False

    while True:
        # Check monotonic deadline
        now = time.monotonic()
        if now >= deadline:
            timed_out = True
            logger.warning("Run %s exceeded deadline (%ss). Terminating group %s...", str(rid), record.timeout.total_seconds(), agent_pgid)
            procs.terminate_group(agent_pgid, grace=30.0)
            break

        # Poll subprocess output
        r, _, _ = select.select([pipe_r], [], [], 0.5)
        if pipe_r in r:
            chunk = os.read(pipe_r, 4096)
            if chunk:
                tee.write_chunk(chunk)
            else:
                # EOF reached on agent output
                break

        if agent_proc.poll() is not None:
            # Drain remaining output
            while True:
                chunk = os.read(pipe_r, 4096)
                if not chunk:
                    break
                tee.write_chunk(chunk)
            break

    os.close(pipe_r)
    os.close(log_fd)

    if timed_out:
        agent_proc.wait()
        exit_code = 124  # Standard timeout exit code
    else:
        exit_code = agent_proc.wait()

    write_exit_file(paths, rid, exit_code)
    return exit_code
