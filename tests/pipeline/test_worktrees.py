"""Unit tests for worktree preparation, ref-lock retries, and npm cache verification."""

import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import ImplAtDev, ImplAtPrHead, ReviewSlot
from pipeline.paths import PipelinePaths
from pipeline.worktrees import (
    check_and_run_npm_ci,
    prepare_workspace,
    run_git_with_lock_retry,
)


class TestWorktrees(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = PipelinePaths(root=self.root)
        self.paths.ensure_dirs()
        self.repo_root = self.root / "repo"
        self.repo_root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_run_git_with_lock_retry_retries_on_lock_error_and_succeeds(self):
        attempts = 0
        delays = []

        def mock_sleep(d):
            delays.append(d)

        def fake_run(cmd, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return subprocess.CompletedProcess(
                    cmd, returncode=1, stdout="", stderr="fatal: cannot lock ref 'refs/remotes/origin/dev'"
                )
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="success", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            proc = run_git_with_lock_retry(["git", "fetch"], sleep_fn=mock_sleep)
            self.assertEqual(proc.returncode, 0)
            self.assertEqual(attempts, 2)
            self.assertEqual(delays, [1.0])

    def test_run_git_with_lock_retry_does_not_retry_other_errors(self):
        attempts = 0

        def fake_run(cmd, **kwargs):
            nonlocal attempts
            attempts += 1
            return subprocess.CompletedProcess(
                cmd, returncode=128, stdout="", stderr="fatal: remote error: repository not found"
            )

        with patch("subprocess.run", side_effect=fake_run):
            proc = run_git_with_lock_retry(["git", "fetch"])
            self.assertEqual(proc.returncode, 128)
            self.assertEqual(attempts, 1)

    def test_review_slot_and_impl_at_dev_run_no_fetch(self):
        git_calls = []

        def fake_run(cmd, **kwargs):
            git_calls.append(list(cmd))
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            # 1. ReviewSlot
            prepare_workspace(ReviewSlot(n=0), self.paths, self.repo_root)
            # 2. ImplAtDev
            prepare_workspace(ImplAtDev(), self.paths, self.repo_root)

        # Assert no call had 'fetch'
        for call in git_calls:
            self.assertNotIn("fetch", call)

    def test_impl_at_pr_head_uses_ignore_other_worktrees(self):
        git_calls = []

        def fake_run(cmd, **kwargs):
            git_calls.append(list(cmd))
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            prepare_workspace(ImplAtPrHead(head_ref="feat/issue-27-runtime"), self.paths, self.repo_root)

        # Confirm fetch and checkout with --ignore-other-worktrees occurred
        checkout_call = next(
            (c for c in git_calls if "checkout" in c and "-B" in c), None
        )
        self.assertIsNotNone(checkout_call)
        self.assertIn("--ignore-other-worktrees", checkout_call)

    def test_npm_ci_runs_when_stamp_missing_or_differs(self):
        worktree = self.paths.impl
        worktree.mkdir(parents=True, exist_ok=True)
        pkg_lock = worktree / "package-lock.json"
        pkg_lock.write_text('{"name": "test", "version": "1.0.0"}', encoding="utf-8")

        npm_runs = 0

        def fake_run(cmd, **kwargs):
            nonlocal npm_runs
            if cmd == ["npm", "ci"]:
                npm_runs += 1
                return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            # 1. Stamp is missing -> runs npm ci
            check_and_run_npm_ci(worktree, {}, timeout=30.0)
            self.assertEqual(npm_runs, 1)

            # 2. Stamp matches -> does NOT run npm ci
            check_and_run_npm_ci(worktree, {}, timeout=30.0)
            self.assertEqual(npm_runs, 1)

            # 3. Lockfile content changes -> runs npm ci again
            pkg_lock.write_text('{"name": "test", "version": "2.0.0"}', encoding="utf-8")
            check_and_run_npm_ci(worktree, {}, timeout=30.0)
            self.assertEqual(npm_runs, 2)

    def test_concurrent_review_slots_prepared_concurrently_both_succeed(self):
        import concurrent.futures

        def fake_run(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
                f0 = ex.submit(prepare_workspace, ReviewSlot(0), self.paths, self.repo_root)
                f1 = ex.submit(prepare_workspace, ReviewSlot(1), self.paths, self.repo_root)
                f0.result()
                f1.result()


if __name__ == "__main__":
    unittest.main()
