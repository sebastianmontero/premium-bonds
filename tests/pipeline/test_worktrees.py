"""Unit tests for worktree preparation, ref-lock retries, and npm cache verification."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents" / "scripts"))

from pipeline.model import ImplAtDev, ImplAtPrHead, ReviewSlot
from pipeline.paths import PipelinePaths
from pipeline.worktrees import (
    check_and_run_npm_ci,
    create_pipeline_worktrees,
    ensure_pipeline_repo,
    prepare_workspace,
    run_git_with_lock_retry,
)


def git(*args: str, cwd: Path) -> str:
    res = subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout.strip()


class BareRemoteFixture:
    """A local bare `origin` with a `dev` branch, plus a developer clone of it."""

    def __init__(self, base: Path) -> None:
        self.remote = base / "origin.git"
        self.dev_clone = base / "developer"
        git("init", "-q", "--bare", "-b", "dev", str(self.remote), cwd=base)
        git("clone", "-q", str(self.remote), str(self.dev_clone), cwd=base)
        git("checkout", "-q", "-b", "dev", cwd=self.dev_clone)
        self.commit(self.dev_clone, "README.md", "init\n")
        git("push", "-q", "origin", "dev", cwd=self.dev_clone)
        git("fetch", "-q", "origin", cwd=self.dev_clone)

    @staticmethod
    def commit(repo: Path, name: str, content: str) -> str:
        (repo / name).write_text(content, encoding="utf-8")
        git("add", name, cwd=repo)
        git("commit", "-q", "-m", f"update {name}", cwd=repo)
        return git("rev-parse", "HEAD", cwd=repo)


class TestWorktrees(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = PipelinePaths(root=self.root)
        self.paths.ensure_dirs()

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

    def test_worktree_add_retries_on_lock_contention(self):
        add_calls = 0
        delays = []

        def fake_run(cmd, **kwargs):
            nonlocal add_calls
            add_calls += 1
            if add_calls == 1:
                return subprocess.CompletedProcess(
                    cmd, returncode=128, stdout="", stderr="fatal: Unable to create '/x/.git/worktrees/control/index.lock': File exists"
                )
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            created = create_pipeline_worktrees(self.paths, 1, sleep_fn=delays.append)

        self.assertEqual(created, [self.paths.control, self.paths.impl, self.paths.review(0)])
        self.assertEqual(add_calls, 4)
        self.assertEqual(delays, [1.0])

    def test_worktree_add_failure_raises_without_retry(self):
        add_calls = 0

        def fake_run(cmd, **kwargs):
            nonlocal add_calls
            add_calls += 1
            return subprocess.CompletedProcess(cmd, returncode=128, stdout="", stderr="fatal: invalid reference: origin/dev")

        with patch("subprocess.run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "invalid reference"):
                create_pipeline_worktrees(self.paths, 1, sleep_fn=lambda _d: self.fail("must not retry"))
        self.assertEqual(add_calls, 1)

    def test_review_slot_and_impl_at_dev_run_no_fetch(self):
        git_calls = []

        def fake_run(cmd, **kwargs):
            git_calls.append(list(cmd))
            return subprocess.CompletedProcess(cmd, returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_run):
            # 1. ReviewSlot
            prepare_workspace(ReviewSlot(n=0), self.paths)
            # 2. ImplAtDev
            prepare_workspace(ImplAtDev(), self.paths)

        # Assert no call had 'fetch'
        for call in git_calls:
            self.assertNotIn("fetch", call)

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




class TestWorktreesRealGit(unittest.TestCase):
    """Worktree behaviour against real git, using a local bare-remote fixture."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.fx = BareRemoteFixture(base)
        self.paths = PipelinePaths(root=base / "state")
        self.review_slots = 2
        ensure_pipeline_repo(self.paths, self.fx.dev_clone)
        create_pipeline_worktrees(self.paths, self.review_slots)

    def tearDown(self):
        self.tmp.cleanup()

    def test_setup_creates_bounded_pool_and_review_pool_never_exceeds_concurrency(self):
        expected = {self.paths.control, self.paths.impl, *(self.paths.review(n) for n in range(self.review_slots))}
        self.assertEqual(set(self.paths.worktrees_dir.iterdir()), expected)

        # Re-running setup is idempotent: no new worktrees, so .git/worktrees stays bounded.
        self.assertEqual(create_pipeline_worktrees(self.paths, self.review_slots), [])

        # DEC-2: setup creates <state>/repo as a dissociated clone with no alternates
        self.assertTrue(self.paths.repo.exists())
        alternates = self.paths.repo / ".git" / "objects" / "info" / "alternates"
        self.assertFalse(alternates.exists(), "Clone must be dissociated (no alternates file)")

        # DEC-2: Registers no entry in the developer's .git/worktrees
        dev_worktrees = self.fx.dev_clone / ".git" / "worktrees"
        self.assertFalse(dev_worktrees.exists(), "Developer checkout must have no worktrees entry")
        dev_listed = git("worktree", "list", "--porcelain", cwd=self.fx.dev_clone)
        self.assertEqual(dev_listed.count("worktree "), 1)

        # Worktrees are registered in <state>/repo and bounded
        repo_listed = git("worktree", "list", "--porcelain", cwd=self.paths.repo)
        self.assertEqual(repo_listed.count("worktree "), 1 + len(expected))

    def test_rerun_setup_refreshes_existing_clone_origin_dev(self):
        new_tip = self.fx.commit(self.fx.dev_clone, "README.md", "v2\n")
        git("push", "-q", "origin", "dev", cwd=self.fx.dev_clone)
        self.assertNotEqual(git("rev-parse", "origin/dev", cwd=self.paths.repo), new_tip)

        self.assertEqual(ensure_pipeline_repo(self.paths, self.fx.dev_clone), self.paths.repo)

        self.assertEqual(git("rev-parse", "origin/dev", cwd=self.paths.repo), new_tip)

    def test_concurrent_review_slots_prepared_concurrently_both_succeed(self):
        import concurrent.futures

        dev_tip = git("rev-parse", "origin/dev", cwd=self.fx.dev_clone)
        for n in range(self.review_slots):
            (self.paths.review(n) / "untracked.txt").write_text("dirty", encoding="utf-8")

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.review_slots) as ex:
            futures = [ex.submit(prepare_workspace, ReviewSlot(n), self.paths) for n in range(self.review_slots)]
            prepared = [f.result() for f in futures]

        for n, path in enumerate(prepared):
            self.assertEqual(path, self.paths.review(n))
            self.assertEqual(git("rev-parse", "HEAD", cwd=path), dev_tip)
            self.assertFalse((path / "untracked.txt").exists())

    def test_impl_at_pr_head_syncs_to_remote_while_developer_has_branch_checked_out(self):
        branch = "feat/issue-27-runtime"
        git("checkout", "-q", "-b", branch, cwd=self.fx.dev_clone)
        self.fx.commit(self.fx.dev_clone, "feature.txt", "v1\n")
        git("push", "-q", "origin", branch, cwd=self.fx.dev_clone)

        # The developer has branch checked out with an unpushed commit on it.
        dev_unpushed_commit = self.fx.commit(self.fx.dev_clone, "unpushed.txt", "unpushed\n")

        # A maintainer pushes a further commit from another clone.
        maintainer = Path(self.tmp.name) / "maintainer"
        git("clone", "-q", "-b", branch, str(self.fx.remote), str(maintainer), cwd=Path(self.tmp.name))
        remote_tip = self.fx.commit(maintainer, "feature.txt", "v2\n")
        git("push", "-q", "origin", branch, cwd=maintainer)

        path = prepare_workspace(ImplAtPrHead(head_ref=branch), self.paths)

        self.assertEqual(git("rev-parse", "HEAD", cwd=path), remote_tip)
        self.assertEqual(git("branch", "--show-current", cwd=path), branch)
        self.assertEqual(git("branch", "--show-current", cwd=self.fx.dev_clone), branch)

        # DEC-2: Assert that the developer's git rev-parse <head_ref> is unchanged,
        # the unpushed commit is still on the branch, and git status --porcelain is empty.
        self.assertEqual(git("rev-parse", branch, cwd=self.fx.dev_clone), dev_unpushed_commit)
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.fx.dev_clone), dev_unpushed_commit)
        self.assertEqual(git("status", "--porcelain", cwd=self.fx.dev_clone), "")

    def test_stale_index_lock_in_linked_worktree_is_removed(self):
        git_dir = Path(git("rev-parse", "--absolute-git-dir", cwd=self.paths.impl))
        self.assertTrue((self.paths.impl / ".git").is_file(), "linked worktree .git must be a gitlink file")
        lock = git_dir / "index.lock"
        lock.write_text("", encoding="utf-8")

        prepare_workspace(ImplAtDev(), self.paths)

        self.assertFalse(lock.exists())


if __name__ == "__main__":
    unittest.main()
